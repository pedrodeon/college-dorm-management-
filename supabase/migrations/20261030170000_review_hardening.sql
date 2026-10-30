-- Hardening from the October 2026 whole-app code review (the "fix before real
-- data" tier). Every change moves a rule that only the UI was holding into the
-- database, where a direct Data API call or a hand-rolled RPC call can't skip
-- it. Nothing here deletes or rewrites resident data; the one backfill copies
-- template names onto existing inspection items.
--
--  1. A staff member who still has to change their temporary password is not
--     staff yet. is_staff()/is_rd() refuse them, so every RLS policy and every
--     definer RPC locks them out of resident data until the password is their
--     own. They keep a self-read on their own users row so the app shell can
--     still route them to /change-password.
--  2. Function EXECUTE. Postgres grants PUBLIC execute on every new function,
--     and "revoke ... from anon" never removed that grant. Revoke from PUBLIC
--     everywhere, grant `authenticated` explicitly, and keep notify_desk
--     private to the RPCs that call it.
--  3. incident_reports and maintenance_requests lose their direct INSERT
--     policies. Filing goes only through the RPCs that write the RD's
--     notification in the same transaction, so an alert exists iff the row
--     does, and nobody can file a request already marked done.
--  4. A signature row must point at an object the caller themself uploaded,
--     under signatures/<inspection>/<role>-…; create_inspection applies the
--     same ownership rule to photo paths. A storage_path that points at
--     nothing, or at someone else's upload, no longer satisfies the gate.
--  5. occupancies, through the Data API (role `authenticated`): status,
--     presence and person are never editable, and room only while the stay is
--     still `expected`. Definer RPCs and the service role are unaffected.
--     record_occupancy and set_presence refuse archived and past-term stays
--     (an archived `expected` stay sits outside the one-active-stay index, so
--     checking it in could put one person in two rooms). reassign_room
--     refuses completed stays.
--  6. create_inspection takes the room from the stay, requires a stay and at
--     least one item for move-in / move-out, rejects unknown item ids, and
--     snapshots each item's name into inspection_items.item_name so renaming
--     the template later can't rewrite a signed record.

-- ---------------------------------------------------------------------------
-- 1. The password gate holds at the database
-- ---------------------------------------------------------------------------

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where id = (select auth.uid())
      and not must_change_password
  );
$$;

create or replace function public.is_rd()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where id = (select auth.uid())
      and role = 'rd'
      and not must_change_password
  );
$$;

-- "staff can read staff" now excludes a flagged user, who still has to see
-- their own row (name, role, the flag itself) to be sent to /change-password.
drop policy if exists "staff read own row" on public.users;
create policy "staff read own row" on public.users
  for select to authenticated
  using (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Function grants: close the PUBLIC default
-- ---------------------------------------------------------------------------

revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;
revoke execute on function public.is_rd() from public, anon;
grant execute on function public.is_rd() to authenticated, service_role;

revoke execute on function public.set_presence(uuid, boolean, text) from public, anon;
grant execute on function public.set_presence(uuid, boolean, text) to authenticated, service_role;
revoke execute on function public.set_presence_bulk(uuid, boolean) from public, anon;
grant execute on function public.set_presence_bulk(uuid, boolean) to authenticated, service_role;
revoke execute on function public.record_occupancy(uuid, public.occupancy_event_type, text) from public, anon;
grant execute on function public.record_occupancy(uuid, public.occupancy_event_type, text) to authenticated, service_role;
revoke execute on function public.reassign_room(uuid, uuid, text) from public, anon;
grant execute on function public.reassign_room(uuid, uuid, text) to authenticated, service_role;
revoke execute on function public.create_inspection(uuid, uuid, public.inspection_type, text, jsonb) from public, anon;
grant execute on function public.create_inspection(uuid, uuid, public.inspection_type, text, jsonb) to authenticated, service_role;

revoke execute on function public.desk_shift_start(date, int) from public, anon;
grant execute on function public.desk_shift_start(date, int) to authenticated, service_role;
revoke execute on function public.claim_desk_shift(date, int, boolean) from public, anon;
grant execute on function public.claim_desk_shift(date, int, boolean) to authenticated, service_role;
revoke execute on function public.set_desk_shift(date, int, uuid) from public, anon;
grant execute on function public.set_desk_shift(date, int, uuid) to authenticated, service_role;
revoke execute on function public.request_shift_coverage(date, int, boolean) from public, anon;
grant execute on function public.request_shift_coverage(date, int, boolean) to authenticated, service_role;
revoke execute on function public.accept_shift_coverage(date, int) from public, anon;
grant execute on function public.accept_shift_coverage(date, int) to authenticated, service_role;

revoke execute on function public.file_incident_report(date, time, text, text, text, uuid) from public, anon;
grant execute on function public.file_incident_report(date, time, text, text, text, uuid) to authenticated, service_role;
revoke execute on function public.file_maintenance_request(text, text, text) from public, anon;
grant execute on function public.file_maintenance_request(text, text, text) to authenticated, service_role;

-- Private insert helper: only the desk RPCs (running as the owner) call it.
revoke execute on function public.notify_desk(text, date, int, uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reports are filed only through their RPCs
-- ---------------------------------------------------------------------------

drop policy if exists "staff file incident reports" on public.incident_reports;
revoke insert on public.incident_reports from authenticated;

drop policy if exists "staff file maintenance requests" on public.maintenance_requests;
revoke insert on public.maintenance_requests from authenticated;

-- ---------------------------------------------------------------------------
-- 4. Signature and photo paths must be the caller's own uploads
-- ---------------------------------------------------------------------------

-- True when `path` names an object in the inspection-photos bucket that the
-- calling user uploaded. Definer so the check works from inside RLS and from
-- inside create_inspection alike, regardless of storage's own policies.
create or replace function public.owns_uploaded_object(path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'inspection-photos'
        and o.name = path
        and (
          o.owner_id = (select auth.uid())::text
          or o.owner = (select auth.uid())
        )
    );
$$;

revoke execute on function public.owns_uploaded_object(text) from public, anon;
grant execute on function public.owns_uploaded_object(text) to authenticated, service_role;

drop policy if exists "staff insert inspection signatures"
  on public.inspection_signatures;
create policy "staff insert inspection signatures" on public.inspection_signatures
  for insert to authenticated
  with check (
    public.is_staff()
    and captured_by = (select auth.uid())
    and exists (
      select 1 from public.inspections i
      where i.id = inspection_id
        and i.type in ('move_in', 'move_out')
        and i.occupancy_id is not null
    )
    -- The image must live under this inspection and role, and be an upload
    -- of the person recording it: no borrowing a photo or another
    -- inspection's signature, and no pointing at nothing.
    and starts_with(
      storage_path,
      'signatures/' || inspection_id::text || '/' || role::text || '-'
    )
    and public.owns_uploaded_object(storage_path)
  );

-- ---------------------------------------------------------------------------
-- 5. occupancies: the audited paths are the only paths
-- ---------------------------------------------------------------------------

-- Fires only for the Data API role. The definer RPCs run as their owner and
-- the service role (test fixtures, scripts) is trusted, so neither is
-- touched; what's closed is the RD's generic UPDATE skipping the gate and
-- the audit tables.
create or replace function public.guard_occupancy_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- New stays open as `expected`; the RD may also record a past stay that
    -- is already over. Nobody arrives `checked_in` without the gate.
    if new.occupancy_status not in ('expected', 'checked_out') then
      raise exception 'a stay opens as expected; check-in goes through record_occupancy'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.occupancy_status is distinct from old.occupancy_status then
    raise exception 'occupancy status changes only through record_occupancy'
      using errcode = 'check_violation';
  end if;
  if new.is_present is distinct from old.is_present then
    raise exception 'presence changes only through set_presence'
      using errcode = 'check_violation';
  end if;
  if new.person_id is distinct from old.person_id then
    raise exception 'a stay cannot be moved to another person'
      using errcode = 'check_violation';
  end if;
  -- Correcting the room of someone who has not arrived is a roster fix; once
  -- they have lived there, a move is history and must land in
  -- room_change_events.
  if new.room_id is distinct from old.room_id
     and old.occupancy_status <> 'expected' then
    raise exception 'room changes for a checked-in or completed stay go through reassign_room'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists occupancies_guard_writes on public.occupancies;
create trigger occupancies_guard_writes
  before insert or update on public.occupancies
  for each row execute function public.guard_occupancy_writes();

-- 5a. set_presence — refuse past-term stays too (set_presence_bulk already did)
create or replace function public.set_presence(
  target_occupancy uuid,
  make_present boolean,
  event_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count int;
begin
  if not public.is_staff() then
    raise exception 'only staff may set presence'
      using errcode = 'insufficient_privilege';
  end if;

  -- Presence is meaningful only for an active, checked-in stay in the
  -- current term.
  update public.occupancies
    set is_present = make_present
    where id = target_occupancy
      and occupancy_status = 'checked_in'
      and is_archived = false
      and term = (select s.current_term from public.app_settings s where s.id);

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    raise exception 'occupancy % is not an active checked-in stay in the current term', target_occupancy
      using errcode = 'check_violation';
  end if;

  insert into public.presence_events (occupancy_id, status, recorded_by, note)
  values (
    target_occupancy,
    (case when make_present then 'returned' else 'away' end)::public.presence_status,
    (select auth.uid()),
    event_note
  );
end;
$$;

-- 5b. record_occupancy — archived and past-term stays are refused; the
-- check-in gate names its two roles instead of counting distinct ones.
create or replace function public.record_occupancy(
  target_occupancy uuid,
  event_type public.occupancy_event_type,
  event_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  stay record;
begin
  if not public.is_staff() then
    raise exception 'only staff may record occupancy'
      using errcode = 'insufficient_privilege';
  end if;

  select occupancy_status, is_archived, term into stay
    from public.occupancies where id = target_occupancy
    for update;

  if not found then
    raise exception 'occupancy % not found', target_occupancy
      using errcode = 'no_data_found';
  end if;
  if stay.is_archived then
    raise exception 'occupancy % is archived', target_occupancy
      using errcode = 'check_violation';
  end if;
  if stay.term is distinct from
     (select s.current_term from public.app_settings s where s.id) then
    raise exception 'occupancy % is not in the current term', target_occupancy
      using errcode = 'check_violation';
  end if;

  if event_type = 'check_in' then
    if stay.occupancy_status <> 'expected' then
      raise exception 'occupancy % cannot check in from status %',
        target_occupancy, stay.occupancy_status
        using errcode = 'check_violation';
    end if;
    if not exists (
      select 1
      from public.inspections i
      where i.occupancy_id = target_occupancy
        and i.type = 'move_in'
        and exists (
          select 1 from public.inspection_signatures s
          where s.inspection_id = i.id and s.role = 'ra'
        )
        and exists (
          select 1 from public.inspection_signatures s
          where s.inspection_id = i.id and s.role = 'resident'
        )
    ) then
      raise exception
        'check-in requires a move-in inspection signed by both the resident and the RA'
        using errcode = 'check_violation';
    end if;
    update public.occupancies
      set occupancy_status = 'checked_in', is_present = true
      where id = target_occupancy;
  else -- check_out
    if stay.occupancy_status <> 'checked_in' then
      raise exception 'occupancy % cannot check out from status %',
        target_occupancy, stay.occupancy_status
        using errcode = 'check_violation';
    end if;
    if not exists (
      select 1
      from public.inspections i
      where i.occupancy_id = target_occupancy
        and i.type = 'move_out'
        and exists (
          select 1 from public.inspection_signatures s
          where s.inspection_id = i.id and s.role = 'ra'
        )
        and (
          exists (
            select 1 from public.inspection_signatures s
            where s.inspection_id = i.id and s.role = 'resident'
          )
          or exists (
            select 1 from public.inspection_signature_waivers w
            where w.inspection_id = i.id
          )
        )
    ) then
      raise exception
        'check-out requires a move-out inspection signed by the RA and either signed by the resident or carrying a recorded waiver'
        using errcode = 'check_violation';
    end if;
    update public.occupancies
      set occupancy_status = 'checked_out', is_present = false
      where id = target_occupancy;
  end if;

  insert into public.occupancy_events (occupancy_id, type, recorded_by, note)
  values (target_occupancy, event_type, (select auth.uid()), event_note);
end;
$$;

-- 5c. reassign_room — only a stay that is still expected or checked in can
-- change rooms. Moving a completed stay would say the resident lived
-- somewhere they never did, which is exactly what damage attribution reads.
create or replace function public.reassign_room(
  target_occupancy uuid,
  to_room uuid,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  stay record;
begin
  if not public.is_rd() then
    raise exception 'only the RD may reassign rooms'
      using errcode = 'insufficient_privilege';
  end if;

  select room_id, occupancy_status, is_archived into stay
    from public.occupancies where id = target_occupancy
    for update;

  if not found then
    raise exception 'occupancy % not found', target_occupancy
      using errcode = 'no_data_found';
  end if;
  if stay.is_archived or stay.occupancy_status = 'checked_out' then
    raise exception 'only an expected or checked-in stay can change rooms'
      using errcode = 'check_violation';
  end if;
  if stay.room_id = to_room then
    raise exception 'this stay is already in that room'
      using errcode = 'check_violation';
  end if;

  update public.occupancies set room_id = to_room where id = target_occupancy;

  insert into public.room_change_events
    (occupancy_id, from_room_id, to_room_id, changed_by, reason)
  values
    (target_occupancy, stay.room_id, to_room, (select auth.uid()), reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Inspections: the snapshot carries its own item names, and the RPC
--    checks what it is given
-- ---------------------------------------------------------------------------

-- inspection_items only ever stored the template item's id, so renaming
-- "Desk" to "Shelf" relabelled every signed snapshot ever taken. The name is
-- now copied in at creation; the id stays for ordering and the compare view.
alter table public.inspection_items
  add column if not exists item_name text;

update public.inspection_items ii
  set item_name = inv.name
  from public.inventory_items inv
  where inv.id = ii.inventory_item_id
    and ii.item_name is null;

alter table public.inspection_items
  alter column item_name set not null;

comment on column public.inspection_items.item_name is
  'The template item''s name at the time of the inspection. Immutable with the snapshot; the template may be renamed later.';

create or replace function public.create_inspection(
  target_room uuid,
  target_occupancy uuid,
  inspection_type public.inspection_type,
  inspection_notes text,
  items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_inspection_id uuid;
  stay_room uuid;
begin
  if not public.is_staff() then
    raise exception 'only staff may create inspections'
      using errcode = 'insufficient_privilege';
  end if;

  if items is null or jsonb_typeof(items) <> 'array' then
    raise exception 'items must be a JSON array'
      using errcode = 'check_violation';
  end if;

  -- The two snapshots damage is measured between always belong to a stay,
  -- and an empty one would be a "before" with nothing in it.
  if inspection_type in ('move_in', 'move_out') then
    if target_occupancy is null then
      raise exception 'a % inspection must name the stay it belongs to', inspection_type
        using errcode = 'check_violation';
    end if;
    if jsonb_array_length(items) = 0 then
      raise exception 'an inspection needs at least one item'
        using errcode = 'check_violation';
    end if;
  end if;

  -- The room is the stay's room. A snapshot filed under the wrong room
  -- would open the check-in gate and then appear in the wrong room's history.
  if target_occupancy is not null then
    select room_id into stay_room
      from public.occupancies where id = target_occupancy;
    if stay_room is null then
      raise exception 'occupancy % not found', target_occupancy
        using errcode = 'no_data_found';
    end if;
    if stay_room <> target_room then
      raise exception 'the inspection room does not match the room of the stay'
        using errcode = 'check_violation';
    end if;
  end if;

  if exists (
    select 1 from jsonb_array_elements(items) as elem
    where not exists (
      select 1 from public.inventory_items inv
      where inv.id = (elem->>'item_id')::uuid
    )
  ) then
    raise exception 'an item id is not on the inventory template'
      using errcode = 'check_violation';
  end if;

  -- Every photo path must be an object the caller uploaded to the bucket.
  if exists (
    select 1
    from jsonb_array_elements(items) as elem
    cross join lateral jsonb_array_elements_text(coalesce(elem->'photos', '[]'::jsonb)) as photo
    where not public.owns_uploaded_object(photo.value)
  ) then
    raise exception 'a photo path is not an upload by the caller'
      using errcode = 'check_violation';
  end if;

  insert into public.inspections (room_id, occupancy_id, type, inspected_by, notes)
  values (target_room, target_occupancy, inspection_type,
          (select auth.uid()), inspection_notes)
  returning id into new_inspection_id;

  -- Items and their photos in one pass, so the whole snapshot (rows AND photo
  -- links) commits or nothing does. The item name is copied from the
  -- template as it reads today.
  with inserted_items as (
    insert into public.inspection_items
      (inspection_id, inventory_item_id, item_name, condition, note)
    select new_inspection_id,
           inv.id,
           inv.name,
           (elem->>'condition')::public.item_condition,
           nullif(elem->>'note', '')
    from jsonb_array_elements(items) as elem
    join public.inventory_items inv on inv.id = (elem->>'item_id')::uuid
    returning id, inventory_item_id
  )
  insert into public.inspection_photos (inspection_id, inspection_item_id, storage_path)
  select new_inspection_id, ii.id, photo.value
  from jsonb_array_elements(items) as elem
  join inserted_items ii
    on ii.inventory_item_id = (elem->>'item_id')::uuid
  cross join lateral jsonb_array_elements_text(coalesce(elem->'photos', '[]'::jsonb)) as photo;

  return new_inspection_id;
end;
$$;

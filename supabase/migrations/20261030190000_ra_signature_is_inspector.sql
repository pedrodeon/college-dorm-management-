-- The RA half of an inspection's signatures attests "I confirm I conducted
-- this inspection." Until now any staff member could record it, so a record
-- could read "Conducted by A" beside an RA signature from B. The `ra` role
-- is now the inspector's alone: `inspections.inspected_by` must be the
-- caller. The resident half is unchanged — whoever is holding the phone
-- captures the resident's signature.
--
-- Same policy as 20261030170000_review_hardening.sql, with that one
-- condition added; every Tier 1 rule (staff only, captured_by = caller,
-- move-in / move-out with a stay, the image under the inspection's own
-- prefix and the signer's own upload) is kept verbatim.

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
    -- "I confirm I conducted this inspection" is only the inspector's to sign.
    and (
      role <> 'ra'
      or exists (
        select 1 from public.inspections i
        where i.id = inspection_id
          and i.inspected_by = (select auth.uid())
      )
    )
  );

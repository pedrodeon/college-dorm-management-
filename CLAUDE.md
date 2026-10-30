# CLAUDE.md — Tudor Hall Management App

This file gives you (Claude Code) the context for this project. Read it at the
start of every session. When something here is ambiguous or seems wrong, ask
before making large changes.

## What we're building

A web app to replace paper-based resident management in **Tudor Hall**, a
university dorm of ~200 residents, managed by one Resident Director (RD) and
**6 Resident Assistants (RAs)**. This is v1 — keep it small, shippable, and easy
to maintain by a solo developer (a senior CS student).

The app does four things:

1. **Occupancy (rare, bursty):** a resident checks in ONCE when they arrive at
   the start of the semester and checks out ONCE when they leave at the end.
   Move-in day means ~200 check-ins over a single weekend, so this flow must be
   fast and must surface who has not arrived yet.
2. **Presence (the everyday interaction):** during long breaks (Thanksgiving,
   spring break, etc.) staff flip a simple live toggle next to each resident's
   name when they leave and when they return. No full check-out procedure. The
   toggle is intentionally generic — not tied to named "break" records — so it
   works for any break or long weekend with zero configuration.
3. **Navigation by hallway:** browse the building structure down to a room and
   see who lives there.
4. **Room inspections:** dated condition snapshots of each room for damage control.

## Building structure

Tudor Hall has **8 hallways** across two wings (Holiday, Lebanon) over 3 floors.
Holiday's 2nd and 3rd floors are split into A/B sections:

| Hallway     | Wing    | Floor | Section |
|-------------|---------|-------|---------|
| Holiday 1   | Holiday | 1     | —       |
| Lebanon 1   | Lebanon | 1     | —       |
| Holiday 2A  | Holiday | 2     | A       |
| Holiday 2B  | Holiday | 2     | B       |
| Lebanon 2   | Lebanon | 2     | —       |
| Holiday 3A  | Holiday | 3     | A       |
| Holiday 3B  | Holiday | 3     | B       |
| Lebanon 3   | Lebanon | 3     | —       |

**Hallway — not floor — is the organizing unit.** Rooms belong to a hallway; the
hallway knows its wing and floor.

There are 8 hallways and 6 RAs, so coverage is NOT one-to-one — an RA may cover
two hallways, or the RD may cover one. Coverage is recorded as metadata only
(see `hallway_assignments`); it does NOT restrict access. All staff can see and
act on all hallways.

**Navigation hierarchy:** TUDOR HALL → hallway → rooms → room detail (residents).

## Tech stack

- **Framework:** Next.js (React), App Router, TypeScript.
- **Database + auth:** Supabase (Postgres). Use Supabase Auth and the Supabase
  JS client. Enforce access with Postgres Row-Level Security (RLS).
- **Styling:** simple and clean; used at a desk and on phones, so mobile-friendly
  layouts matter. Don't pull in a heavy component library unless it clearly earns
  its place.
- Prefer server components / server actions for data access where sensible;
  keep the Supabase service key server-side only.

**This may not be the Next.js you know.** The pinned version can differ from
what's in your training data — APIs, conventions, and file structure may all
have changed. The authoritative docs ship with the package at
`node_modules/next/dist/docs/`; read the relevant guide there before writing
code, and heed any deprecation notices.

## Visual design

School colors: **navy blue, light orange, black, white.** The app should read as
predominantly navy.

- **Navy:** dominant chrome — top nav, headers, primary buttons, key surfaces.
- **White:** content areas and list backgrounds.
- **Black:** body text.
- **Light orange:** ACCENT ONLY, used sparingly to draw the eye to status that
  needs attention — `away` residents during a break, `expected` (not yet arrived)
  residents on move-in day, and `damaged`/`missing` inspection items. If
  everything is orange, nothing is.
- Accessibility: light orange fails contrast against white for text. Use it as a
  background chip, badge, or left-border with dark text on top — never as text
  color on a white background. Verify contrast on interactive elements.

## Critical constraint: sensitive student data

This app stores real students' names, student ID numbers, room assignments,
contact info, and occupancy/presence logs. That data is sensitive and likely
covered by FERPA and/or the university's data policies.

- **Never develop against real resident records.** Do not load them until
  Residence Life and IT have signed off on where the data lives. The seed
  carries only real *building structure* (hallways, rooms — not FERPA data);
  the resident roster starts empty and is filled through the app.
- The automated test suite mutates resident rows, so it runs only against a
  separate fixture database seeded with a fake roster — its guard refuses to
  start anywhere the fixtures are absent. Never re-seed fake residents into
  the main project database to make tests pass.
- Never commit secrets. Keep keys in `.env.local`; ensure `.env*` is gitignored.
- Never put resident data in URLs, query strings, or logs.

**Setup prerequisite — use a dedicated Supabase organization.** This project must
live in its own Supabase organization, separate from any other projects (e.g.
garagehero). On the Free/Pro plans, every member of an organization can see every
project in it, so an isolated org keeps this work private and this sensitive data
walled off. Create the new org first, then the project inside it.

Supabase project security settings: Data API **on**, "automatically expose new
tables" **off**, automatic RLS **on**.

## Who logs in

Only **staff** log in: the RD and the 6 RAs. **Residents never log in** — they are
records, not user accounts. There is no student-facing login.

## Data model

### users (staff only)
- `id` (uuid, pk)
- `name` (text)
- `email` (text, unique) — used for Supabase Auth invite
- `role` (enum: `rd` | `ra`)
- `must_change_password` (boolean) — set on accounts created with a
  temporary password. **While it is true the account is not staff yet:**
  `is_staff()`/`is_rd()` return false, so RLS and every RPC refuse resident
  data until the password is changed (the user keeps a self-read on their
  own row so the app can send them to `/change-password`). The app layout
  redirect is a convenience on top of that, not the gate.

### hallway_assignments (metadata: which RA covers which hallway)
- `id` (uuid, pk)
- `user_id` (uuid, fk → users)
- `hallway_id` (uuid, fk → hallways)
- unique(user_id, hallway_id)

**Metadata only — NOT access control.** Used to display "RA: Jane Doe" on a
hallway so staff and the RD know who is responsible for it. Every staff member
can access every hallway regardless of assignment. This table is optional; the
app works without it if you'd rather cut it.

### hallways
- `id` (uuid, pk)
- `name` (text) — e.g. "Holiday 2A"
- `wing` (enum: `holiday` | `lebanon`)
- `floor` (int: 1 | 2 | 3)
- `section` (text, nullable) — "A" | "B" | null
- `sort_order` (int) — for stable display order

Seed with the 8 hallways in the table above.

### rooms
- `id` (uuid, pk)
- `hallway_id` (uuid, fk → hallways)
- `room_number` (text)
- `capacity` (int)

Seeded with the 84 real Tudor Hall rooms (all capacity 2), unique per
(hallway, room number) — see `supabase/seed.sql`. Counts per hallway:
Holiday 1 = 9, Lebanon 1 = 9, Holiday 2A = 11, Holiday 2B = 12,
Lebanon 2 = 10, Holiday 3A = 11, Holiday 3B = 12, Lebanon 3 = 10.

### app_settings (single row)
- `id` (boolean, pk, always true) — enforces exactly one row
- `current_term` (text) — e.g. "Fall 2026"
- `updated_at` (timestamptz)

The term everyday screens are scoped to, and the term new occupancies open in.
It lives in the database, not an env var, so the `current_residents` view and
`set_presence_bulk` filter on the same value the app writes. RD-writable
(Admin → Residents → Current term); rolling over a semester deletes nothing.

### people (the person, once — records, not accounts)
- `id` (uuid, pk)
- `full_name` (text)
- `student_id` (text, unique) — the identity key; displayed on room detail
- `phone` (text, nullable)
- `emergency_contact` (text, nullable)
- `created_at`, `updated_at` (timestamptz)

### occupancies (one person, one room, one term)
- `id` (uuid, pk)
- `person_id` (uuid, fk → people, on delete cascade)
- `room_id` (uuid, fk → rooms) — mutable *within* a stay; a mid-term move is a
  `reassign_room` call recorded in `room_change_events`, not a new occupancy
- `term` (text) — free text, e.g. "Fall 2026". Not an enum: terms are named by
  Residence Life, not by a migration
- `occupancy_status` (enum: `expected` | `checked_in` | `checked_out`) — cache;
  source of truth is the latest `occupancy_events` row for this stay. A new stay
  starts `expected`
- `is_present` (boolean, default true) — THE LIVE TOGGLE, per stay. Source of
  truth for "are they in the building right now." Only meaningful while
  `checked_in`
- `is_archived` (boolean, default false) — hidden, never deleted
- `created_at`, `updated_at` (timestamptz)

**Writes through the Data API are fenced by a trigger** (`guard_occupancy_writes`):
for the `authenticated` role, `occupancy_status`, `is_present` and `person_id`
never change by direct UPDATE, a new row opens only as `expected` (or as a
past `checked_out` stay), and `room_id` is editable only while the stay is
still `expected`. Status moves only through `record_occupancy`, presence
through `set_presence`, rooms after arrival through `reassign_room` — the
RPCs that write the audit rows. The service role and the definer RPCs are
not fenced. `record_occupancy` and `set_presence` also refuse archived and
past-term stays, and `reassign_room` refuses completed ones.

**A returning student is the same `people` row plus a NEW occupancy** — possibly
a different room. An old occupancy is never reused or reset, because the
inspections and events hanging off it are the record a damage dispute rests on.
A partial unique index allows only one *active* stay per person
(`where is_archived = false and occupancy_status <> 'checked_out'`), so history
and re-admission are both possible but nobody can be live in two rooms.

**Archived = hidden, not deleted.** Everyday screens (dashboard, hallway, room
detail, desk) read the `current_residents` view — current term, not archived —
so the filter lives in one place in the database instead of in every query.
Archived and past-term stays stay fully queryable: the RD sees them under
Admin → Residents, and a resident's screen links each person's other stays.

Pre-split, one `residents` table conflated the person with the stay. Migration
`20260729221553_person_occupancy_split` split it, preserving primary keys
(`occupancies.id` = the old `residents.id`) so every child row kept its exact
FK value. The old table survives as `residents_pre_split`, service-role read
only, and `supabase/rollback/` holds the down script.

### occupancy_events (semester move-in / move-out log)
- `id` (uuid, pk)
- `occupancy_id` (uuid, fk → occupancies)
- `type` (enum: `check_in` | `check_out`)
- `timestamp` (timestamptz, default now())
- `recorded_by` (uuid, fk → users)
- `note` (text, nullable)

~2 rows per stay. Append-only.

### presence_events (break toggle history)
- `id` (uuid, pk)
- `occupancy_id` (uuid, fk → occupancies)
- `status` (enum: `away` | `returned`)
- `timestamp` (timestamptz, default now())
- `recorded_by` (uuid, fk → users)
- `note` (text, nullable) — e.g. expected return date

Written every time the toggle flips, so we can answer "who stayed over
Thanksgiving?" after the fact. Append-only.

### room_change_events (RD-only room reassignments)
- `id` (uuid, pk)
- `occupancy_id` (uuid, fk → occupancies)
- `from_room_id` (uuid, fk → rooms, nullable)
- `to_room_id` (uuid, fk → rooms)
- `timestamp` (timestamptz, default now())
- `changed_by` (uuid, fk → users)
- `reason` (text, nullable)

Matters for damage attribution: it establishes which room a resident occupied
during which window.

### inventory_items (the 12-item template — seeded lookup table)
- `id` (uuid, pk)
- `name` (text)
- `sort_order` (int)

Seed exactly these 12: Air vents; Bed (frame, mattress, etc.); Bookshelves /
desk space; Ceiling; Floor; Walls; Chair; Table; Closet; Door; Sink; Windows.

A lookup table (not an enum) so the RD can adjust the list later without a
migration.

### inspections (a dated condition SNAPSHOT of one room)
- `id` (uuid, pk)
- `room_id` (uuid, fk → rooms)
- `occupancy_id` (uuid, fk → occupancies, nullable) — inspections attach to a
  STAY, not a person, so a snapshot stays pinned to the term it was taken in.
  Every inspection created now names one; nullable only because legacy
  `periodic` rows predate that rule
- `type` (enum: `move_in` | `move_out` | `periodic`) — **`periodic` is legacy:
  retained in the enum so existing records stay intact and keep rendering, but
  it is no longer offered anywhere in the UI. New inspections are move-in or
  move-out only.**
- `timestamp` (timestamptz, default now())
- `inspected_by` (uuid, fk → users)
- `notes` (text, nullable)

### inspection_items (one row per template item per inspection)
- `id` (uuid, pk)
- `inspection_id` (uuid, fk → inspections)
- `inventory_item_id` (uuid, fk → inventory_items)
- `item_name` (text) — the template item's name **as of the inspection**,
  copied in by `create_inspection`. Renaming a template item later never
  relabels a signed snapshot; the id stays for ordering and the compare view
- `condition` (enum: `good` | `fair` | `damaged` | `missing`)
- `note` (text, nullable)

### inspection_signatures (move-in attestations — added post-v1)
- `id` (uuid, pk)
- `inspection_id` (uuid, fk → inspections) — binds to that exact snapshot
- `role` (enum: `resident` | `ra`) — unique per (inspection, role)
- `storage_path` (text, unique) — PNG in the private inspection-photos bucket
- `signed_at` (timestamptz, default now())
- `captured_by` (uuid, fk → users) — RLS pins this to the caller

`storage_path` must start with `signatures/<inspection_id>/<role>-` and name
an object the caller themself uploaded (`owns_uploaded_object`), so a row
pointing at nothing, at a photo, or at another inspection's image cannot
satisfy the gate. `create_inspection` holds photo paths to the same
ownership rule.

The resident signs "I agree the recorded conditions are accurate"; the RA
signs "I confirm I conducted this inspection." Applies to `move_in` and
`move_out` inspections. Immutable once captured (no update/delete for any
role; the unique key blocks re-signing). **A check-in cannot be finalized
until both exist** — record_occupancy refuses `check_in` without a
fully-signed move_in inspection, so the gate holds at the database.
**Check-out is gated the same way**, except the resident half may instead be
satisfied by a waiver (below); the RA signature is never waivable.

### inspection_signature_waivers (move-out escape hatch — added post-v1)
- `id` (uuid, pk)
- `inspection_id` (uuid, fk → inspections, unique) — one waiver max
- `reason` (text, required non-blank)
- `waived_by` (uuid, fk → users) — RLS pins this to the caller
- `created_at` (timestamptz, default now())

Residents leave early or refuse to sign at move-out, so the RA can record
"resident unavailable / declined to sign" **with a required reason**. It
satisfies the resident half of the check-out gate while making the missing
signature explicit and permanent. Move-out only (at move-in the resident is
present by definition); immutable like the signatures it stands in for.

### Why inspections are snapshots, not one editable sheet per room

Damage control only works if you can compare a room's condition at move-in
against its condition at move-out. A single mutable checklist destroys the
"before" state the moment it's edited, leaving no basis to assign
responsibility. So: the 12 items are a template, and each inspection is an
immutable dated snapshot. **Damage is the diff between two snapshots**, attributed
to whoever occupied the room in between (via occupancy_events and
room_change_events).

Creating a `move_in` inspection should be part of the check-in flow, and a
`move_out` inspection part of the check-out flow.

**The full 12-item inspection happens only at move-in and move-out** — those
two snapshots are the whole point, since damage is the diff between them.
Routine weekly condition monitoring is NOT an inspection: that is
`room_checks` (four 1–5 ratings, notes, prohibited items), which is per room
and much lighter. Don't add a third inspection type for it.

### room_checks (weekly RA condition ratings — added post-v1)
- `id` (uuid, pk)
- `room_id` (uuid, fk → rooms)
- `checked_by` (uuid, fk → users) — RLS pins this to the caller
- `timestamp` (timestamptz, default now())
- `floor_cleanliness`, `trash`, `laundry`, `overall` (int, 1–5; 1 = poor,
  5 = excellent)
- `notes` (text, nullable)
- `prohibited_items` (text, nullable) — non-empty gets the orange accent

Append-only and immutable like the event tables (no update/delete for anyone).
Recorded from the "Room check" button on room detail.

### maintenance_requests (staff-filed, mutable status — added post-v1)
- `id` (uuid, pk)
- `location` (text, required non-blank) — free text: a room, a hallway, a
  bathroom, anywhere in the building. Never a person.
- `description` (text, required non-blank)
- `urgency` (text check: `low` | `normal` | `high`)
- `status` (text check: `open` | `done`) — deliberately MUTABLE, unlike the
  audit tables: open → done (and back) is the point. A check constraint keeps
  `done_by`/`done_at` set exactly when status is `done`.
- `created_by` (uuid, fk → users) — RLS pins this to the caller
- `created_at`, `done_by`, `done_at`

Any staff files one (through the RPC — there is no direct INSERT policy on
this table or on `incident_reports`, so a row can't exist without its RD
notification or arrive already `done`); only the RD reads the queue and
closes/reopens. NO delete policy for any role — closed requests are history.
Filing notifies the RD through the in-app bell.

### incident_reports (staff-filed, RD-only — added post-v1)
- `id` (uuid, pk)
- `occurred_on` (date), `occurred_at` (time) — when it happened
- `description` (text, required non-blank), `people_involved`, `actions_taken`
- `room_id` (uuid, fk → rooms, nullable) — never a resident reference; anyone
  involved is named in the free text, like the paper form
- `created_by` (uuid, fk → users) — RLS pins this to the caller
- `created_at` (timestamptz)

**Incident reports are STORED, not emailed** (this reverses the original
email-only design: a failed send used to lose the report outright). They carry
student-conduct narratives, so **SELECT is `is_rd()` only** — an RA can file
one but cannot read any, through the UI, a direct URL, or the API. Append-only:
no update/delete policy for any role, service_role included.

**Maintenance requests are RD-only too**: any staff files; only the RD reads
the queue and closes/reopens. Both are written by definer RPCs
(`file_incident_report`, `file_maintenance_request`) that insert the row and
the RD's notification in one transaction, so an alert exists iff the report
does. The RD reads both at Admin → Incidents & maintenance.

### The app sends no email, anywhere

Incidents, maintenance and the RA weekly report were each email-first at some
point, and each lost work when a send failed or was never configured. All
three now live in the app: the first two as rows the RD reads at Admin →
Incidents & maintenance, the third as an on-demand screen. There is no mail
library, no Resend key, and no scheduled job left in the codebase — **don't
reintroduce one.** If something needs to reach the RD, write a notification
row and let the bell carry it.

### desk_shifts (front-desk schedule — added post-v1)
- `id` (uuid, pk)
- `shift_date` (date)
- `slot` (int check: 1 | 2) — 1 = 6–8 PM, 2 = 8–10 PM (America/Chicago;
  `desk_shift_start()` is the one clock for shift starts)
- `claimed_by` (uuid, fk → users, nullable) — null = open
- `claimed_at` (timestamptz, moves with claimed_by)
- `coverage_requested_at` (timestamptz, nullable) — an open coverage request
  is a FLAG on a claimed shift; a check keeps it null on open shifts
- unique(shift_date, slot) — also the race guard for simultaneous claims

STAFF data only — no resident information. Rows materialize on first claim
(nothing is pre-seeded; open = missing row or null claimed_by). No direct
write policies for anyone: all mutations go through definer RPCs —
`claim_desk_shift` (any staff, self only, **refused within 24 hours of the
shift start** — the timing rule lives in the database), `set_desk_shift`
(RD only, no timing limit, assign anyone or clear — also closes coverage
requests: the force-fill), `request_shift_coverage` (owner only, any time
before start — **inside 24 h this is the ONLY way off a shift, and the owner
stays assigned until someone accepts**, so the desk is never left unstaffed
by an opt-out), and `accept_shift_coverage` (any other staff, first come
first served — racing accepts serialize on the row lock and the loser gets
"already covered"). The `/front-desk` monthly calendar shows claimed shifts
as initials avatars (accent ring = needs cover), open ones as tappable
slots, and a "Needs coverage" strip with Accept buttons.

**Which nights the desk is staffed** is the one desk rule that is NOT in the
database — deliberately. It lives in `DESK_SCHEDULE` in
`src/lib/desk-shifts.ts` (Mon/Thu/Fri both slots, Tue late only, Wed/Sat/Sun
none), read by both the calendar and the server actions so the schedule is
edited in exactly one place. The trade was made knowingly: putting it in SQL
too would mean maintaining the same rule twice, and the residual gap — a
staff member calling `claim_desk_shift` directly, skipping the app — costs
at worst a shift on a night nobody works, visible to the RD on the calendar.
The 24-hour lock stays in the database, where a bypass would actually matter.

The schedule governs what can be **newly claimed or assigned**, never what
displays. A shift already held on a night since dropped still renders, and
stays releasable, coverable and clearable — so `claimShift` and `assignShift`
(with a user) check it, while release, coverage, accept and clear do not. A
dropped night must not erase who worked it, or strand whoever holds it.

### notifications + notification_seen (in-app schedule feed — part 2)
- `notifications`: `type` (text check: claimed | released |
  coverage_requested | coverage_withdrawn | coverage_accepted | assigned |
  incident_filed | maintenance_filed), `shift_date`/`slot` (nullable — set
  for shift events), `target_id` (set for report events, for the deep link),
  `actor` (fk users), `other_user` (fk users, nullable), `audience`
  (`all` | `rd`), `created_at`. One row per event, written inside the RPCs
  (same transaction — a notification exists iff the change happened). Staff
  read-only, and the SELECT policy filters `audience = 'rd'` to the RD, so
  incident traffic never reaches an RA's bell or badge. No direct writes for
  anyone. The UI renders the sentence from the structured fields and links
  each row to what it is about.
- `notification_seen`: one watermark row per user (`user_id` pk, `seen_at`).
  The header bell badge counts notifications newer than the caller's
  watermark; visiting `/notifications` upserts it (auto-clear on view).
  RLS: each user reads/writes only their own row.
In-app only — no email. Staff scheduling data, never residents.

### Relationships
- A hallway has many rooms. A room has many occupancies (its residents).
- A person has many occupancies — one per term they lived here.
- An occupancy has many occupancy_events, presence_events, and
  room_change_events, and the move-in / move-out inspections that bracket it.
- A room has many inspections; an inspection has one row per inventory_item.
- A room has many room_checks; each records the staff member who did it.
- Every event and inspection records the staff member who performed it.

## Roles & permissions (drives the RLS rules)

Deliberately simple. There is **no hallway scoping of access.** Every staff
member can see and act on every hallway, room, and resident in Tudor Hall. Role
gates writes to the roster, nothing else.

**Any authenticated staff (rd or ra) can:**
- Read all hallways, rooms, people, and occupancies (and the current term).
- Search any resident by name or student ID.
- Record occupancy_events (check-in / check-out) for any resident.
- Flip `is_present` and record presence_events for any resident.
- Create and view inspections for any room.

**RD only:**
- Create/update/delete people and occupancies; archive and unarchive a stay;
  set the current term; assign and change rooms (room_change_events).
- Create/update/delete rooms and hallways.
- Invite/remove staff users and set hallway_assignments.
- Edit the inventory item template.

**Everyone:** the three event tables (occupancy_events, presence_events,
room_change_events) and inspections/inspection_items are **insert-only** — never
edited or deleted — which keeps a clean audit trail.

Implement as Postgres RLS policies keyed off the logged-in user's `role`. Do not
rely on client-side checks alone. These policies should be short: authenticated
staff can SELECT everything; only `rd` can INSERT/UPDATE/DELETE on the roster
tables.

Possible v2 tightening (do not build now): restrict full detail (phone,
emergency_contact) to the RD and the resident's own RA, exposing only name,
room, and occupancy_status building-wide. Implement via a restricted view or
column-level policies. Not worth the complexity in v1.

## Screens (v1)

**Navigation:** a fixed bottom tab bar is the primary nav — Home, Roster,
Front Desk, plus Admin for the RD (`src/components/bottom-nav.tsx`). The
Roster tab (`/roster`) sends an RA straight to their assigned hallway's
roster and gives the RD (or an unassigned RA) a hallway picker. The slim top
header holds only account items: the notifications bell, the user's email,
and Sign out. Incident report, Maintenance, Room checks, and check-in/out
(room → resident) are reached from the dashboard tiles and their flows, not
the tab bar.

1. **Login** — staff email/password via Supabase Auth.

2. **Dashboard — titled "TUDOR HALL".** Under the title, a list of **all 8
   hallways**, grouped by wing and floor in `sort_order`. Same view for every
   staff member — RD and RAs alike. Show at-a-glance counts per hallway (checked
   in / expected / away) and, if `hallway_assignments` is in use, the name of the
   RA who covers each one.

3. **Hallway view** — all rooms in that hallway. Also hosts the hallway roster
   with the **live present/away toggle inline next to each resident's name**.
   Flipping it updates `is_present` and writes a presence_event. Away rows are
   highlighted in the orange accent. Include **bulk actions: "mark all present"
   and "mark all away"** — nobody is flipping 150 toggles by hand after spring
   break. This list is safety-relevant (who is in the building during a break),
   so make it fast, obvious, and printable.

4. **Room detail** — the current-term residents living in that room with their **student ID
   numbers**, room capacity, and a link to the room's inspection history.
   Each resident row taps through to their own screen, where that resident's
   check-in / check-out lives (post-v1) — occupancy is per resident, never a
   room-level action. The only room-level action is the **Room check** button
   (weekly RA ratings, with history). Inspections appear here as **history +
   side-by-side compare only** — there is no create button, because both
   inspection types belong to a resident and are started from their screen.

5. **Inspection sheet** — create a new inspection: all 12 template items, each
   with a condition (good/fair/damaged/missing) and a note. Type is **move-in
   or move-out only**, and always tied to one resident. View past inspections
   read-only (including legacy `periodic` ones). Support a side-by-side compare
   of two inspections (typically move-in vs. move-out) with differences
   highlighted. A **complete** inspection (RA signature + resident signature
   or move-out waiver) exports as a self-contained PDF liability record —
   header, all items/notes, embedded photos and signatures, waiver reason —
   via /api/inspections/[id]/pdf (pdfkit; staff-only, read-only, gate
   re-checked server-side; filename is room+date, never resident data).
   Download buttons live on the inspection view and the resident screen's
   Inspections list.

6. **Check in / out** (the desk) — the semester occupancy flow.
   Search ANY resident building-wide by name or student ID, see status, record
   check-in or check-out, and create the paired move_in/move_out inspection.
   Prominently shows **who is still `expected`** so the RD can chase no-shows.
   Check-in order (post-v1): move_in inspection first → resident + RA sign on
   the inspection review → only then can the check-in be finalized (enforced
   by record_occupancy). Check-out mirrors it: move_out inspection → RA signs
   and the resident signs **or** the RA records "unavailable / declined" with
   a reason → finalize check-out. Every finalized event lands on its
   confirmation screen — check-in on the green
   `/residents/[occupancy]/checked-in` (the app's only use of green),
   check-out on the glass/navy `/residents/[occupancy]/checked-out` (which
   also surfaces the waiver reason when the resident didn't sign). Both
   finalize buttons route through `occupancySuccessPath` in
   src/lib/occupancy-gate.ts so the two paths can't diverge, and each route
   re-verifies the status server-side, bouncing anyone arriving mid-flow.

7. **Resident detail** — one STAY, routed by occupancy id: the person's full
   record (room, student ID, contacts) plus this stay's occupancy, presence and
   room-change history, and an **Other stays** list linking that person's other
   terms. Hosts the **occupancy action**, driven by this stay's status:
   `expected` → "Check-in", `checked_in` → "Check-out", `checked_out` → a
   completed state with no action (one stay's lifecycle is one-way; coming back
   means a new occupancy). The action walks the gated flow — inspection →
   signatures → record the event — the same ladder the desk uses, shared via
   `OccupancyGate` / `gateProgress`. An archived or past-term stay renders
   read-only.

8. **Admin (RD only)** — residents, rooms, staff invites, hallway coverage, the
   inventory item template, and the **current term**. Also archives/unarchives a
   stay (the only way `is_archived` becomes true through the app). Admin →
   Reports holds the **RA weekly report** (per-RA room-check + desk-shift
   counts, Mon–Sun weeks in America/Chicago, staff data only), built by
   `src/lib/ra-report.ts`. **On-demand screen only** — the RD opens it and
   walks back through weeks; nothing is sent or scheduled. Every RA is listed
   including the ones at zero, tagged `no activity`: the empty row is what
   the report is FOR, so it must never be filtered out.

9. **New or returning student** (`/admin/residents/new`, RD only) — the one way
   a resident enters the roster, so the duplicate guard and the archive rule
   can't diverge across two forms. Search `people` by name or student ID (client
   side; the query never touches the URL), see each person's existing stays, then
   open **one new occupancy** — room, term (free text, defaulting to the current
   term), contacts. A student ID that already exists never creates a second
   person: the flow says who it matched and switches to them. A person whose
   previous stay is still `expected`/`checked_in` is refused with an
   explanation; previous **completed** stays are archived as the new one opens.
   New stays always start `expected` — only `record_occupancy` moves status, and
   it holds the signature gate.

## Suggested build order

Build in this order; each step should be usable before starting the next:

1. Scaffold Next.js + Supabase; auth + login; navy/orange design tokens.
2. Schema + RLS for users, hallways, hallway_assignments, rooms, and the
   roster (originally one `residents` table; now `people` + `occupancies`).
   Seed the 8 hallways and the 84 real rooms; real staff accounts via
   `npm run seed:ras` or Admin → Staff (`npm run seed:staff` is fixture-only
   and refuses to run elsewhere). (Dev originally used a fake fixture roster here;
   it was retired in migration `20260728215914` — don't re-create it in the
   main database.)
3. TUDOR HALL dashboard → hallway view → room detail navigation.
4. Presence toggle + bulk actions on the hallway view (the everyday feature).
5. Move-in/move-out flow + occupancy_events + the `expected` no-show view.
6. Inspections: template, create sheet, history, compare.
7. Admin screens + room reassignment.

## Explicitly out of scope for v1

Do not build these yet: package logging, roommate agreements,
named/configurable break periods with date ranges, damage cost calculation or
billing, student self-service, and email/push delivery of notifications.
(Photo attachments, incident reports, maintenance requests, and the full
front-desk schedule — calendar, claiming, coverage requests, and the in-app
notification feed — have since been built; see the data model above.)

## Working conventions

- Before any non-trivial change, create a git branch.
- The seed (`supabase/seed.sql`) carries real building structure only — no
  resident data. For demos, add throwaway residents through the app and
  remove them after; fake fixture rosters belong only in a separate fixture
  database for the test suite.
- Write RLS policies alongside any new table or column that touches resident data.
- Keep functions and components small; favor readability over cleverness.
- Ask before adding new dependencies or changing the data model.

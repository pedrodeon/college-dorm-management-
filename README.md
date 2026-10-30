# Tudor Hall — resident management

A web app replacing paper-based resident management in Tudor Hall, a ~200-resident
university dorm run by one Resident Director (RD) and 6 Resident Assistants (RAs).

Only staff log in. Residents are records, never user accounts.

See [CLAUDE.md](CLAUDE.md) for the full product spec and data model.

## What it does

- **Dashboard** — all 8 hallways grouped by floor, with checked-in / expected /
  away counts and who covers each one.
- **Hallway view** — rooms plus the live roster with a **present/away toggle**
  and "mark all present / away" bulk actions. Printable; this is the everyday
  screen during breaks.
- **Room detail** — residents with student IDs, plus the room's inspection
  history and a side-by-side compare.
- **Check in / out** (`/desk`) — search any resident, record check-in or
  check-out, and see who has not arrived yet. Check-in is gated on a move-in
  inspection **signed by both the resident and the RA** (finger-drawn on
  screen, stored immutably against that exact inspection). Check-out is gated
  the same way, with one documented exception: if the resident is unavailable
  or declines, the RA records why and the check-out completes on the RA's
  signature alone — the missing signature stays on the record.
- **Inspections** — a 12-item template captured as immutable dated snapshots;
  damage is the diff between two of them. Items can carry **photos** (camera
  capture on phones), stored in a private bucket, immutable like the snapshot,
  and served only via short-lived signed URLs.
- **Room checks** — weekly RA condition ratings per room (floor, trash,
  laundry, overall on a 1–5 scale) with notes and prohibited-items flags,
  recorded append-only from the room page.
- **Resident detail** — one stay: the person's record, that stay's occupancy,
  presence and room-change history, and links to their other terms.
- **New or returning student** — search the people already on record, then open
  one new stay for them: same person, new occupancy, previous stay archived and
  untouched. A student ID we already have can never become a second record.
- **Admin** (RD only) — residents, rooms, staff invites, hallway coverage, the
  inspection template, and the current term.

## Stack

Next.js (App Router, TypeScript) · Supabase (Postgres, Auth, RLS) · Tailwind.

A resident is a **person** (`people`, once) plus a **stay** (`occupancies`: one
room, one term). A returning student keeps their person record and gets a new
stay, so last year's inspections and events stay attached to the term they
happened in. Everyday screens read the `current_residents` view — current term,
not archived.

Access control lives in **Postgres RLS**, not the UI. Any staff member can read
everything; only the RD writes the roster. The three event tables and
inspections are append-only and written exclusively through `SECURITY DEFINER`
RPCs, so a change and its audit record can never diverge.

## Setup

Follow [docs/SETUP.md](docs/SETUP.md) — create the Supabase project in its own
organization, apply migrations, and seed the real building structure (8
hallways, 84 rooms — no resident data).

```bash
npm install
npm run dev
```

Then sign in at http://localhost:3000 with a staff account (see
`docs/SETUP.md`: real accounts come from `npm run seed:ras` or Admin → Staff;
`npm run seed:staff` only works on the fixture database).

## Tests

```bash
npm test
```

An access-control suite (Node's built-in test runner, no extra dependencies)
that asserts the rules above against the live dev database as real signed-in
users: anon sees nothing, an RA reads building-wide but cannot write the
roster, only the RD can, the event tables are append-only and reachable only
through their RPCs, and inspection snapshots are immutable.

It mutates data and restores it, so it **only runs against a fixture
database** — a guard aborts if the fixture roster (`Testy McTestface`) is
absent, so the suite can never mutate a database holding real records. The
linked project's fixtures were retired when the real rooms were seeded, so the
suite deliberately aborts there; see docs/SETUP.md §7 for how to run it.

## Sensitive data

This app is designed to hold real students' names, ID numbers, room
assignments, and contact info — likely covered by FERPA. **Develop and test
against seed/fake data only.** Do not load real resident records until
Residence Life and IT have signed off. Never commit `.env.local`.

The seeded dev accounts (`*@tudor.test`) share a well-known password and exist
only for local development — remove them before any real deployment.

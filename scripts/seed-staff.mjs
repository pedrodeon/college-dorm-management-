// Seed the FIXTURE staff accounts: 1 RD + 2 RAs with a shared, known
// password, which the test suite signs in with. FAKE accounts only — .test
// addresses can never receive real mail.
//
// FIXTURE DATABASES ONLY. The script refuses to run unless the fake fixture
// roster (supabase/seed-fixtures.sql) is already present, the same guard the
// test suite uses: a known password on an RD account must never exist next
// to real resident records. Real staff accounts are created with
// `npm run seed:ras` (temporary password, forced change on first login) or
// from Admin → Staff.
//
// Staff need real auth.users rows (created via the Auth admin API, not SQL),
// so this runs as a script with the service-role key instead of in seed.sql.
// Idempotent: safe to re-run; existing users are left in place.
//
// Usage:  npm run seed:staff        (reads .env.local via --env-file)
// Env:    SEED_STAFF_PASSWORD       shared fixture password (defaults below)

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey || url.includes("your-project-ref")) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.",
  );
  process.exit(1);
}

const password = process.env.SEED_STAFF_PASSWORD ?? "tudor-dev-only-2026";

const STAFF = [
  { email: "rd@tudor.test", name: "Dana Whitfield (RD)", role: "rd" },
  { email: "ra1@tudor.test", name: "Jordan Lee (RA)", role: "ra" },
  { email: "ra2@tudor.test", name: "Sam Ortiz (RA)", role: "ra" },
];

// Coverage metadata (NOT access control). Deliberately non-1:1, like the
// real building: an RA covers multiple hallways, the RD covers the rest.
const ASSIGNMENTS = {
  "ra1@tudor.test": ["Holiday 1", "Holiday 2A", "Holiday 2B"],
  "ra2@tudor.test": ["Lebanon 1", "Lebanon 2"],
  "rd@tudor.test": ["Holiday 3A", "Holiday 3B", "Lebanon 3"],
};

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Same marker tests/helpers.mjs checks before touching anything.
{
  const { data: marker, error } = await supabase
    .from("people")
    .select("full_name")
    .eq("student_id", "S1000101")
    .maybeSingle();
  if (error) {
    console.error(`Could not reach the database: ${error.message}`);
    process.exit(1);
  }
  if (marker?.full_name !== "Testy McTestface") {
    console.error(
      "Refusing to run: this is not a fixture database (no fake roster found).\n" +
        "seed:staff creates accounts with a known password, so it only ever runs\n" +
        "against the fixture project — apply supabase/seed-fixtures.sql there\n" +
        "first. Real staff accounts come from `npm run seed:ras` or Admin → Staff.",
    );
    process.exit(1);
  }
}

async function findAuthUserByEmail(email) {
  // listUsers has no email filter param in supabase-js v2; page through.
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < 100) return null;
  }
}

async function ensureStaff({ email, name, role }) {
  let user = await findAuthUserByEmail(email);

  if (user) {
    console.log(`auth user exists:   ${email}`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
    console.log(`auth user created:  ${email}`);
  }

  const { error: upsertError } = await supabase
    .from("users")
    .upsert({ id: user.id, name, email, role }, { onConflict: "id" });
  if (upsertError) throw upsertError;
  console.log(`staff row upserted: ${email} (${role})`);

  return user.id;
}

async function ensureAssignments(userId, email) {
  const hallwayNames = ASSIGNMENTS[email] ?? [];
  if (hallwayNames.length === 0) return;

  const { data: hallways, error } = await supabase
    .from("hallways")
    .select("id, name")
    .in("name", hallwayNames);
  if (error) throw error;

  if (hallways.length !== hallwayNames.length) {
    console.warn(
      `  ! only ${hallways.length}/${hallwayNames.length} hallways found — run supabase/seed.sql first for assignments`,
    );
  }

  for (const hallway of hallways) {
    const { error: insertError } = await supabase
      .from("hallway_assignments")
      .upsert(
        { user_id: userId, hallway_id: hallway.id },
        { onConflict: "user_id,hallway_id", ignoreDuplicates: true },
      );
    if (insertError) throw insertError;
  }
  console.log(`  covers: ${hallways.map((h) => h.name).join(", ")}`);
}

for (const staff of STAFF) {
  const userId = await ensureStaff(staff);
  await ensureAssignments(userId, staff.email);
}

console.log("\nDone. Sign in at /login with any of the emails above.");
console.log(
  `Password: ${process.env.SEED_STAFF_PASSWORD ? "(from SEED_STAFF_PASSWORD)" : password}`,
);

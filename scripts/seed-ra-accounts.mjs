// Create the real RA staff accounts from a roster file, all sharing ONE
// temporary password (handed out in person). Every account is created as the
// PAIR the app requires — auth user + public.users row — because an auth user
// without a staff row is exactly what caused the login redirect loop. Each
// new account gets must_change_password = TRUE, so the app forces a personal
// password on first login (/change-password).
//
// Usage:
//   1. cp scripts/ra-roster.example.json scripts/ra-roster.json
//      … and fill in the real names/emails/roles. (ra-roster.json is
//      gitignored — staff emails don't belong in the repo.)
//   2. Set RA_TEMP_PASSWORD in .env.local (never hardcoded, never committed).
//   3. npm run seed:ras
//
// Safe to re-run: existing auth accounts are NEVER touched (no password
// reset, no re-flag — someone who already set their own password keeps it).
// A missing users row is repaired even for an existing auth user, so the
// pairing always ends up complete.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tempPassword = process.env.RA_TEMP_PASSWORD;

if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}
if (!tempPassword || tempPassword.length < 10) {
  console.error("Set RA_TEMP_PASSWORD in .env.local (at least 10 characters). Not hardcoded on purpose.");
  process.exit(1);
}

let roster;
try {
  roster = JSON.parse(readFileSync(new URL("./ra-roster.json", import.meta.url), "utf8"));
} catch {
  console.error("scripts/ra-roster.json not found. Copy ra-roster.example.json and fill in the real staff.");
  process.exit(1);
}

const valid = (entry) =>
  typeof entry?.name === "string" && entry.name.trim() &&
  typeof entry?.email === "string" && entry.email.includes("@") &&
  (entry?.role === "ra" || entry?.role === "rd");
const bad = Array.isArray(roster) ? roster.filter((e) => !valid(e)) : [];
if (!Array.isArray(roster) || roster.length === 0 || bad.length > 0) {
  console.error("Roster must be a non-empty array of { name, email, role: 'ra' | 'rd' }.");
  if (bad.length) console.error("Bad entries:", JSON.stringify(bad));
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findAuthUserByEmail(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 100) return null;
  }
}

const summary = [];

for (const { name, email, role } of roster) {
  const entry = { email, role, auth: "", row: "", forcedChange: "" };

  let user = await findAuthUserByEmail(email);
  if (user) {
    // Never reset an existing account: they may already use their own
    // password. Re-running is for adding the missing ones.
    entry.auth = "already existed (password untouched)";
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });
    if (error) throw new Error(`${email}: auth create failed — ${error.message}`);
    user = data.user;
    entry.auth = "created (temp password)";
  }

  // The other half of the pair. For a brand-new account (or a repaired
  // half-created one) the flag goes on; an existing complete row keeps its
  // current flag so re-runs never re-lock someone who already changed.
  const { data: existingRow, error: rowReadError } = await supabase
    .from("users")
    .select("id, must_change_password")
    .eq("id", user.id)
    .maybeSingle();
  if (rowReadError) throw new Error(`${email}: users read failed — ${rowReadError.message}`);

  if (existingRow) {
    const { error } = await supabase
      .from("users")
      .update({ name, email, role })
      .eq("id", user.id);
    if (error) throw new Error(`${email}: users update failed — ${error.message}`);
    entry.row = "updated (name/role)";
    entry.forcedChange = existingRow.must_change_password ? "yes (still pending)" : "no (already changed)";
  } else {
    const { error } = await supabase
      .from("users")
      .insert({ id: user.id, name, email, role, must_change_password: true });
    if (error) throw new Error(`${email}: users insert failed — ${error.message}`);
    entry.row = entry.auth.startsWith("created") ? "created" : "created (repaired missing pair!)";
    entry.forcedChange = "yes";
  }

  summary.push(entry);
}

console.log("\n=== Seed summary ===");
for (const s of summary) {
  console.log(`${s.email.padEnd(36)} ${s.role.padEnd(3)} | auth: ${s.auth} | row: ${s.row} | must change: ${s.forcedChange}`);
}
const created = summary.filter((s) => s.auth.startsWith("created")).length;
const ras = summary.filter((s) => s.role === "ra").length;
console.log(`\n${summary.length} accounts processed (${ras} RAs) — ${created} newly created with the temp password.`);
console.log("Hand out RA_TEMP_PASSWORD; each new account must set its own password on first login.");

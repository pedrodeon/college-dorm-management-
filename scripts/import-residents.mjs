// Import the real Fall 2026 roster from data/residents.csv (gitignored).
//
// Idempotent: keyed on people.student_id (unique). Re-running never creates a
// duplicate person or a second stay for the same person + term — it reports
// what it skipped instead. Rooms and hallways are looked up, never created:
// an unknown room aborts the run rather than inventing one.
//
// New stays open as `expected`. Only record_occupancy moves a stay's status,
// so nobody is marked arrived until the signed move-in inspection happens.
//
// Usage: node --env-file=.env.local scripts/import-residents.mjs [--dry-run]

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const CSV = "data/residents.csv";
const TERM = "Fall 2026";
const DRY_RUN = process.argv.includes("--dry-run");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}
const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Minimal CSV reader: handles quoted fields, which names can contain. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const cols = head.map((c) => c.trim());
  return body.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? "").trim()])));
}

const rows = parseCsv(readFileSync(CSV, "utf8"));
// The sheet keeps empty beds as blank rows; only named slots are residents.
const residents = rows.filter((r) => r.nome);
console.log(`${CSV}: ${rows.length} linhas, ${residents.length} residentes${DRY_RUN ? "  (DRY RUN)" : ""}`);

// ---- room lookup: hallway name + room number -> existing room id ------------
const [{ data: hallways }, { data: rooms }] = await Promise.all([
  supabase.from("hallways").select("id, name"),
  supabase.from("rooms").select("id, room_number, hallway_id"),
]);
const hallById = new Map(hallways.map((h) => [h.id, h.name]));
const roomId = new Map(
  rooms.map((r) => [`${hallById.get(r.hallway_id)}|${r.room_number}`, r.id]),
);

const missing = residents.filter((r) => !roomId.has(`${r.corredor}|${r.quarto}`));
if (missing.length) {
  console.error("Quartos inexistentes — abortado, nada foi importado:");
  for (const m of missing) console.error(`  ${m.corredor} / ${m.quarto}`);
  process.exit(1);
}

// ---- import ----------------------------------------------------------------
const stats = { pessoasCriadas: 0, pessoasExistentes: 0, estadiasCriadas: 0, estadiasExistentes: 0, erros: [] };

for (const [index, r] of residents.entries()) {
  // Never log names or student IDs: the CSV row number is enough to find it.
  const label = `linha ${index + 2}`;

  // Person: student_id is the identity key. An existing row is reused, so a
  // re-run updates contact details instead of making a second person.
  const { data: existing, error: readErr } = await supabase
    .from("people")
    .select("id")
    .eq("student_id", r.student_id)
    .maybeSingle();
  if (readErr) { stats.erros.push(`${label}: leitura people — ${readErr.message}`); continue; }

  let personId = existing?.id;
  if (personId) {
    stats.pessoasExistentes++;
    if (!DRY_RUN) {
      const { error } = await supabase
        .from("people")
        .update({ full_name: r.nome, phone: r.telefone || null })
        .eq("id", personId);
      if (error) { stats.erros.push(`${label}: update people — ${error.message}`); continue; }
    }
  } else {
    if (DRY_RUN) { stats.pessoasCriadas++; continue; }
    const { data, error } = await supabase
      .from("people")
      .insert({ full_name: r.nome, student_id: r.student_id, phone: r.telefone || null })
      .select("id")
      .single();
    if (error) { stats.erros.push(`${label}: insert people — ${error.message}`); continue; }
    personId = data.id;
    stats.pessoasCriadas++;
  }

  // Stay: one per person per term. A partial unique index already forbids two
  // live stays for one person; checking first keeps the re-run quiet.
  const { data: stay, error: stayErr } = await supabase
    .from("occupancies")
    .select("id")
    .eq("person_id", personId)
    .eq("term", TERM)
    .maybeSingle();
  if (stayErr) { stats.erros.push(`${label}: leitura occupancies — ${stayErr.message}`); continue; }

  if (stay) { stats.estadiasExistentes++; continue; }
  if (DRY_RUN) { stats.estadiasCriadas++; continue; }

  const { error } = await supabase.from("occupancies").insert({
    person_id: personId,
    room_id: roomId.get(`${r.corredor}|${r.quarto}`),
    term: TERM,
    occupancy_status: "expected",
  });
  if (error) { stats.erros.push(`${label}: insert occupancies — ${error.message}`); continue; }
  stats.estadiasCriadas++;
}

console.log("\n=== RESULTADO ===");
console.log(`  pessoas criadas:      ${stats.pessoasCriadas}`);
console.log(`  pessoas já existentes: ${stats.pessoasExistentes} (atualizadas)`);
console.log(`  estadias criadas:     ${stats.estadiasCriadas}`);
console.log(`  estadias já existentes: ${stats.estadiasExistentes} (puladas)`);
console.log(`  erros:                ${stats.erros.length}`);
for (const e of stats.erros) console.log(`    ! ${e}`);
process.exit(stats.erros.length ? 1 : 0);

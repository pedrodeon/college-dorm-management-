// The hallway check-in packet.
//
// The claim worth proving is that the packet is NOT a second template: one
// resident's pages must come out of the packet exactly as they come out of
// the individual export. These tests render both and compare the text drawn
// on every page, so a stray layout change to one path fails here rather than
// showing up on a liability document months later.
//
// PDF rendering needs no database. The selection rules — who belongs in a
// packet — do, and are gated on the fixture project.

import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import {
  renderInspectionPacket,
  renderInspectionPdf,
} from "../src/lib/inspection-pdf.ts";
import {
  byRoomNumber,
  checkedInInRoomOrder,
  slugify,
} from "../src/lib/packet-format.ts";
import {
  adminClient,
  staffClient,
  assertSeededDevDatabase,
  hallwayByName,
  occupancyByStudentId,
  RA_EMAIL,
} from "./helpers.mjs";

// ---------------------------------------------------------------------------
// Reading a rendered PDF back
// ---------------------------------------------------------------------------

/** Pull the drawn text out of a PDF buffer, page-marker included, by
    inflating its content streams. Enough to compare layouts. */
function textOf(pdf) {
  const out = [];
  const haystack = pdf.toString("latin1");
  const re = /stream\r?\n/g;
  let match;
  while ((match = re.exec(haystack)) !== null) {
    const start = match.index + match[0].length;
    const end = haystack.indexOf("endstream", start);
    if (end === -1) continue;
    let body;
    try {
      body = inflateSync(pdf.subarray(start, end)).toString("latin1");
    } catch {
      continue; // not a compressed content stream (images, fonts)
    }
    // pdfkit emits kerned TJ arrays of HEX strings — "TUDOR HALL" arrives as
    // [<5455444f522048414c4c> 0] TJ, split at every kerning pair. Decode the
    // hex, rejoin the array, and also accept plain (literal) strings so this
    // keeps working if the font path ever changes.
    const fromHex = (hex) =>
      Buffer.from(hex.replace(/\s+/g, ""), "hex").toString("latin1");
    const literal = (s) => s.replace(/\\([()\\])/g, "$1");
    const piece = (token) =>
      token.startsWith("<") ? fromHex(token.slice(1, -1)) : literal(token.slice(1, -1));

    for (const m of body.matchAll(
      /(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)\s*Tj|\[([^\]]*)\]\s*TJ/g,
    )) {
      if (m[1] !== undefined) {
        out.push(piece(m[1]));
      } else {
        const parts = [...m[2].matchAll(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>/g)].map(
          (p) => piece(p[0]),
        );
        out.push(parts.join(""));
      }
    }
  }
  return out;
}

/** The footer stamps the moment of generation, which differs between two
    renders; everything else must match exactly. */
function normalize(lines) {
  return lines.map((l) => l.replace(/generated .*$/, "generated <when>"));
}

function record(overrides = {}) {
  return {
    type: "move_in",
    residentName: "Sample Suzuki",
    studentId: "S1000103",
    roomNumber: "101",
    hallwayName: "Holiday 1",
    term: "Fall 2026",
    inspectedAt: "2026-08-01T15:00:00.000Z",
    inspectorName: "Probe RA",
    items: [
      { name: "Ceiling", condition: "good", note: null },
      { name: "Floor", condition: "damaged", note: "Scuffed by the door." },
      { name: "Sink", condition: "fair", note: null },
    ],
    inspectionNote: "Room was clean at move-in.",
    photos: [],
    signatures: [
      {
        role: "resident",
        signedAt: "2026-08-01T15:05:00.000Z",
        signerName: "Sample Suzuki",
        png: null,
      },
      {
        role: "ra",
        signedAt: "2026-08-01T15:06:00.000Z",
        signerName: "Probe RA",
        png: null,
      },
    ],
    waiver: null,
    ...overrides,
  };
}

describe("a packet of one is the individual export", () => {
  test("same text, page for page", async () => {
    const data = record();
    const single = normalize(textOf(await renderInspectionPdf(data)));
    const packet = normalize(
      textOf(await renderInspectionPacket([data], "Tudor Hall check-ins")),
    );
    // Guard the guard: if the extractor ever stops finding text, two empty
    // arrays would compare equal and this test would pass while proving
    // nothing.
    assert.ok(single.length > 10, "nothing was extracted from the PDF");
    assert.deepEqual(packet, single);
  });

  test("every section still prints", async () => {
    const text = textOf(
      await renderInspectionPacket([record()], "Tudor Hall check-ins"),
    ).join(" ");
    for (const section of [
      "TUDOR HALL",
      "Move-in inspection record",
      "Condition by item",
      "Inspection notes",
      "Signatures",
      "Sample Suzuki",
      "DAMAGED",
    ]) {
      assert.ok(text.includes(section), `"${section}" is missing`);
    }
  });

  test("a waiver prints in place of the resident signature", async () => {
    const text = textOf(
      await renderInspectionPacket(
        [
          record({
            type: "move_out",
            signatures: [
              {
                role: "ra",
                signedAt: "2026-08-01T15:06:00.000Z",
                signerName: "Probe RA",
                png: null,
              },
            ],
            waiver: {
              reason: "Resident left early.",
              recordedBy: "Probe RA",
              recordedAt: "2026-08-01T15:07:00.000Z",
            },
          }),
        ],
        "Tudor Hall check-ins",
      ),
    ).join(" ");
    assert.ok(text.includes("Resident did not sign"));
    assert.ok(text.includes("Resident left early."));
  });

  test("a waiver recorded before the resident signed after all still prints", async () => {
    // Both halves exist: the RA recorded the resident as unavailable, then
    // the resident turned up and signed. Neither may be dropped.
    const text = textOf(
      await renderInspectionPacket(
        [
          record({
            type: "move_out",
            waiver: {
              reason: "Resident had left for the airport.",
              recordedBy: "Probe RA",
              recordedAt: "2026-08-01T15:07:00.000Z",
            },
          }),
        ],
        "Tudor Hall check-ins",
      ),
    ).join(" ");
    assert.ok(text.includes("Resident did not sign"), "the waiver was dropped");
    assert.ok(text.includes("Resident had left for the airport."));
    assert.ok(text.includes("Resident — Sample Suzuki"), "the signature was dropped");
  });

  test("a long waiver reason renders in full", async () => {
    const reason = Array.from(
      { length: 60 },
      (_, i) => `Sentence ${i + 1} of a very long explanation.`,
    ).join(" ");
    const text = textOf(
      await renderInspectionPdf(
        record({
          type: "move_out",
          signatures: [
            {
              role: "ra",
              signedAt: "2026-08-01T15:06:00.000Z",
              signerName: "Probe RA",
              png: null,
            },
          ],
          waiver: {
            reason,
            recordedBy: "Probe RA",
            recordedAt: "2026-08-01T15:07:00.000Z",
          },
        }),
      ),
    ).join(" ");
    assert.ok(text.includes("Sentence 60 of a very long explanation."), "the reason was cut off");
    assert.ok(text.includes("Recorded by Probe RA"), "the attribution line was lost");
  });

  test("records can arrive one at a time from an async source", async () => {
    async function* lazily() {
      yield record({ roomNumber: "101", residentName: "Aaa Resident" });
      yield record({ roomNumber: "205", residentName: "Bbb Resident" });
    }
    const streamed = normalize(textOf(await renderInspectionPacket(lazily(), "packet")));
    const eager = normalize(
      textOf(
        await renderInspectionPacket(
          [
            record({ roomNumber: "101", residentName: "Aaa Resident" }),
            record({ roomNumber: "205", residentName: "Bbb Resident" }),
          ],
          "packet",
        ),
      ),
    );
    assert.deepEqual(streamed, eager);
  });
});

describe("many records in one document", () => {
  test("each record's pages carry its own room in the footer", async () => {
    const pdf = await renderInspectionPacket(
      [
        record({ roomNumber: "101", residentName: "First Resident" }),
        record({ roomNumber: "205", residentName: "Second Resident" }),
        record({ roomNumber: "312", residentName: "Third Resident" }),
      ],
      "Tudor Hall check-ins — packet",
    );
    const text = textOf(pdf).join("\n");

    for (const room of ["101", "205", "312"]) {
      assert.ok(
        text.includes(`Holiday 1 · Room ${room} · Move-in inspection`),
        `no footer for room ${room}`,
      );
    }
    // Three records, so three title blocks.
    assert.equal(
      text.split("Move-in inspection record").length - 1,
      3,
      "a record is missing its title block",
    );
    // Page numbering runs across the whole document, not per record.
    assert.ok(text.includes("Page 3 of 3"), "pages are not numbered as one document");
  });

  test("records keep the order they were given", async () => {
    const text = textOf(
      await renderInspectionPacket(
        [
          record({ roomNumber: "101", residentName: "Aaa Resident" }),
          record({ roomNumber: "205", residentName: "Bbb Resident" }),
        ],
        "packet",
      ),
    ).join("\n");
    assert.ok(
      text.indexOf("Aaa Resident") < text.indexOf("Bbb Resident"),
      "records came out in the wrong order",
    );
  });

  test("an empty packet is a programming error, not an empty file", async () => {
    await assert.rejects(() => renderInspectionPacket([], "packet"));
  });
});

describe("who belongs in a packet", () => {
  // The packet describes who is living in the hallway now, so the rule is
  // `checked_in` and nothing else. These run on plain rows: no database, and
  // no undeletable probe stays left behind in a fixture project.
  const room = (room_number, ...residents) => ({ room_number, current_residents: residents });
  const stay = (id, occupancy_status) => ({ id, occupancy_status });

  test("a resident who checked in then checked out is excluded", () => {
    const found = checkedInInRoomOrder([room("101", stay("gone", "checked_out"))]);
    assert.deepEqual(found, []);
  });

  test("a resident who is expected but never arrived is excluded", () => {
    const found = checkedInInRoomOrder([room("101", stay("waiting", "expected"))]);
    assert.deepEqual(found, []);
  });

  test("a resident checked in right now is included", () => {
    const found = checkedInInRoomOrder([room("101", stay("here", "checked_in"))]);
    assert.deepEqual(found, [{ room: "101", occupancyId: "here" }]);
  });

  test("a mixed hallway yields exactly its checked-in stays, in room order", () => {
    const found = checkedInInRoomOrder([
      room("205", stay("b", "checked_in"), stay("x", "expected")),
      room("101", stay("a", "checked_in"), stay("y", "checked_out")),
      room("312", stay("z", "checked_out")),
    ]);
    assert.deepEqual(found, [
      { room: "101", occupancyId: "a" },
      { room: "205", occupancyId: "b" },
    ]);
  });

  test("someone who moved rooms within the hallway appears once, in the room they are in now", () => {
    // Two stays for the SAME person this term: the old room they checked out
    // of, and the new one they are checked into. Both are current-term and
    // unarchived, which the partial unique index permits because only one is
    // active — so the status filter is what has to separate them.
    const found = checkedInInRoomOrder([
      room("101", stay("their-old-stay", "checked_out")),
      room("108", stay("their-new-stay", "checked_in")),
    ]);
    assert.equal(found.length, 1, "the resident appears more than once");
    assert.deepEqual(found, [{ room: "108", occupancyId: "their-new-stay" }]);
  });

  test("an empty hallway yields nothing", () => {
    assert.deepEqual(checkedInInRoomOrder([]), []);
    assert.deepEqual(checkedInInRoomOrder([room("101")]), []);
  });
});

describe("room ordering and filenames", () => {
  test("rooms sort as numbers, not as text", () => {
    const rooms = ["312", "9", "101", "205"];
    assert.deepEqual([...rooms].sort(byRoomNumber), ["9", "101", "205", "312"]);
  });

  test("a hallway name becomes a filename slug", () => {
    assert.equal(slugify("Holiday 2A"), "holiday-2a");
    assert.equal(slugify("Lebanon 1"), "lebanon-1");
  });
});

// ---------------------------------------------------------------------------
// Who belongs in a packet — needs the fixture project.
// ---------------------------------------------------------------------------

describe("against a live database", () => {
  let admin, ra, holiday1;

  before(async () => {
    await assertSeededDevDatabase();
    admin = adminClient();
    ({ client: ra } = await staffClient(RA_EMAIL));
    holiday1 = await hallwayByName("Holiday 1");
  });

  /** The route's selection step, run under whichever session is passed. */
  async function collect(client, hallwayId) {
    const { collectHallwayCheckins } = await import(
      "../src/lib/inspection-packet.ts"
    );
    return collectHallwayCheckins(client, hallwayId);
  }

  test("an RA can build the packet for a hallway", async () => {
    const found = await collect(ra, holiday1.id);
    assert.equal(found.kind, "found", "an RA could not read the hallway");
    assert.equal(found.hallwayName, "Holiday 1");
    assert.ok(
      found.inspectionIds.length > 0,
      "the fixture hallway has checked-in residents but produced no records",
    );
  });

  test("only residents checked in RIGHT NOW are included", async () => {
    const { data: rooms } = await admin
      .from("rooms")
      .select("room_number, current_residents ( id, occupancy_status )")
      .eq("hallway_id", holiday1.id);

    const notLivingHere = rooms
      .flatMap((r) => r.current_residents)
      .filter((r) => r.occupancy_status !== "checked_in")
      .map((r) => r.id);

    const { data: theirInspections } = await admin
      .from("inspections")
      .select("id")
      .eq("type", "move_in")
      .in("occupancy_id", notLivingHere.length > 0 ? notLivingHere : [holiday1.id]);

    const found = await collect(ra, holiday1.id);
    for (const inspection of theirInspections ?? []) {
      assert.equal(
        found.inspectionIds.includes(inspection.id),
        false,
        "a stay that is not checked in was included",
      );
    }
  });

  test("the packet holds one record per checked-in stay, no more", async () => {
    const { data: rooms } = await admin
      .from("rooms")
      .select("current_residents ( id, occupancy_status )")
      .eq("hallway_id", holiday1.id);
    const checkedIn = rooms
      .flatMap((r) => r.current_residents)
      .filter((r) => r.occupancy_status === "checked_in");

    const found = await collect(ra, holiday1.id);
    assert.equal(
      found.inspectionIds.length,
      checkedIn.length,
      "the packet does not match the hallway's checked-in count",
    );
  });

  test("checking a resident out drops them from the packet", async () => {
    const stay = await occupancyByStudentId("S1000101");
    const before = await collect(ra, holiday1.id);
    const { data: theirs } = await admin
      .from("inspections")
      .select("id")
      .eq("type", "move_in")
      .eq("occupancy_id", stay.id)
      .maybeSingle();
    assert.ok(theirs, "the fixture stay has no move-in record to track");
    assert.ok(
      before.inspectionIds.includes(theirs.id),
      "the resident was not in the packet to begin with",
    );

    await admin
      .from("occupancies")
      .update({ occupancy_status: "checked_out" })
      .eq("id", stay.id);
    try {
      const after = await collect(ra, holiday1.id);
      assert.equal(
        after.inspectionIds.includes(theirs.id),
        false,
        "a checked-out resident stayed in the packet",
      );
      assert.equal(after.inspectionIds.length, before.inspectionIds.length - 1);
    } finally {
      await admin
        .from("occupancies")
        .update({ occupancy_status: "checked_in" })
        .eq("id", stay.id);
    }
  });

  test("records come out in room order", async () => {
    const found = await collect(ra, holiday1.id);
    const { data: rows } = await admin
      .from("inspections")
      .select("id, rooms ( room_number )")
      .in("id", found.inspectionIds);

    const roomOf = new Map(rows.map((r) => [r.id, r.rooms.room_number]));
    const asReturned = found.inspectionIds.map((id) => roomOf.get(id));
    assert.deepEqual(
      asReturned,
      [...asReturned].sort(byRoomNumber),
      "the packet is not ordered by room number",
    );
  });

  test("a hallway with no completed check-ins yields nothing to download", async () => {
    const { data: rooms } = await admin
      .from("rooms")
      .select("id")
      .eq("hallway_id", holiday1.id);
    const roomIds = rooms.map((r) => r.id);

    const { data: stays } = await admin
      .from("occupancies")
      .select("id, occupancy_status")
      .in("room_id", roomIds)
      .neq("occupancy_status", "expected");

    // Park everyone back at `expected`, then restore.
    await admin
      .from("occupancies")
      .update({ occupancy_status: "expected" })
      .in("id", stays.map((s) => s.id));
    try {
      const found = await collect(ra, holiday1.id);
      assert.equal(
        found.inspectionIds.length,
        0,
        "an empty hallway still offered records",
      );
    } finally {
      for (const stay of stays) {
        await admin
          .from("occupancies")
          .update({ occupancy_status: stay.occupancy_status })
          .eq("id", stay.id);
      }
    }
  });
});

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth";
import {
  loadInspectionRecord,
  recordComplete,
  type InspectionRecord,
} from "@/lib/inspection-record";
import { toPdfData } from "@/lib/inspection-packet";
import { renderInspectionPdf } from "@/lib/inspection-pdf";

/**
 * The inspection record as a PDF — the damage-liability document. Loads
 * through the same `loadInspectionRecord` as the on-screen record view, so
 * the two can never disagree, and maps to the renderer through the same
 * `toPdfData` the hallway packet uses.
 *
 * Read-only by construction: every read (rows AND storage blobs) goes
 * through the caller's RLS-scoped client, and only completed records —
 * RA signature plus resident signature or waiver — are rendered. The
 * filename carries room + date only; resident data never enters a URL.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const staff = await getStaffContext();
  if (!staff) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Still on the temporary password: not staff yet. RLS already returns
  // nothing for them; say why instead of 404.
  if (staff.mustChangePassword) {
    return NextResponse.json({ error: "password change required" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const inspection = await loadInspectionRecord(supabase, id);

  if (!inspection || !inspection.rooms || !inspection.occupancies) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (inspection.type === "periodic") {
    return NextResponse.json(
      { error: "legacy periodic inspections have no signed record" },
      { status: 409 },
    );
  }
  if (!recordComplete(inspection)) {
    return NextResponse.json(
      { error: "this inspection is not fully signed yet" },
      { status: 409 },
    );
  }

  const data = await toPdfData(
    supabase,
    inspection as InspectionRecord & {
      rooms: NonNullable<InspectionRecord["rooms"]>;
      occupancies: NonNullable<InspectionRecord["occupancies"]>;
    },
  );
  const pdf = await renderInspectionPdf(data);

  // Room + date only in the filename — never resident data.
  const date = new Date(inspection.timestamp)
    .toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const filename = `${inspection.type === "move_in" ? "move-in" : "move-out"}-room-${inspection.rooms.room_number}-${date}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStaffContext } from "@/lib/auth";
import {
  collectHallwayCheckins,
  loadPrintableRecord,
} from "@/lib/inspection-packet";
import { slugify } from "@/lib/packet-format";
import { renderInspectionPacket } from "@/lib/inspection-pdf";

/**
 * A hallway's move-in records as ONE PDF, in room order, each starting on a
 * fresh page. Built by looping the per-resident pipeline — same loader, same
 * mapper, same template — so a page here is a page there.
 *
 * `?probe=1` answers "is there anything to download?" as JSON without
 * rendering anything. The button asks that first so an empty hallway can say
 * so instead of handing back an empty file, and so the expensive render only
 * happens when there is something to render.
 *
 * Read-only and RLS-bound: every row and every blob is read through the
 * caller's own client, so the packet can only hold records they could
 * already open one at a time. Nothing is stored or sent anywhere.
 */
export async function GET(
  request: Request,
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
  const found = await collectHallwayCheckins(supabase, id);
  if (!found) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (new URL(request.url).searchParams.get("probe") === "1") {
    return NextResponse.json(
      { count: found.inspectionIds.length },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const records = (
    await Promise.all(
      found.inspectionIds.map((inspectionId) =>
        loadPrintableRecord(supabase, inspectionId),
      ),
    )
  ).filter((record) => record !== null);

  if (records.length === 0) {
    return NextResponse.json(
      { error: "no completed check-ins in this hallway yet" },
      { status: 409 },
    );
  }

  const pdf = await renderInspectionPacket(
    records,
    `Tudor Hall check-ins — ${found.hallwayName}`,
  );

  // Hallway + date only. No resident data in a URL or a filename.
  const date = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  });
  const filename = `tudor-hall-${slugify(found.hallwayName)}-checkins-${date}.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

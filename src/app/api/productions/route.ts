import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Riwayat produksi — sumber restore setelah refresh (persisten di SQLite). */
export async function GET() {
  try {
    const rows = await db.production.findMany({
      orderBy: { createdAt: "desc" },
      take: 24,
      select: {
        jobId: true,
        mode: true,
        title: true,
        topic: true,
        ratio: true,
        styleCode: true,
        styleName: true,
        voice: true,
        narrationLang: true,
        status: true,
        stage: true,
        durationSec: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({ productions: rows });
  } catch (err) {
    console.error("[productions] list gagal:", err instanceof Error ? err.message : err);
    return NextResponse.json({ productions: [] });
  }
}

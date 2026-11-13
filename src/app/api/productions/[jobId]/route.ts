import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureVaultRestored } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Detail satu produksi (proposal + hasil) untuk restore di UI. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  try {
    await ensureVaultRestored();
    const row = await db.production.findUnique({ where: { jobId } });
    if (!row) {
      return NextResponse.json({ error: "Produksi tidak ditemukan." }, { status: 404 });
    }
    return NextResponse.json({
      jobId: row.jobId,
      mode: row.mode,
      title: row.title,
      topic: row.topic,
      ratio: row.ratio,
      styleCode: row.styleCode,
      styleName: row.styleName,
      voice: row.voice,
      narrationLang: row.narrationLang,
      status: row.status,
      stage: row.stage,
      durationSec: row.durationSec,
      proposal: row.proposalJson ? JSON.parse(row.proposalJson) : null,
      result: row.resultJson ? JSON.parse(row.resultJson) : null,
      createdAt: row.createdAt,
    });
  } catch (err) {
    console.error("[productions] detail gagal:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Gagal membaca produksi." }, { status: 500 });
  }
}

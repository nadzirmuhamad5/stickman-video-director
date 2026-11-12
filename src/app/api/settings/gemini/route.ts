import { NextRequest, NextResponse } from "next/server";
import { clearGeminiKey, maskKey, readGeminiKey, saveGeminiKey } from "@/lib/settings";
import { clearStatusCache } from "@/lib/status-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/settings/gemini  -> { present, masked?, source }
 *      (never returns the raw key)
 * POST /api/settings/gemini  { key }  -> save web-managed key
 * DELETE /api/settings/gemini         -> remove web-managed key
 */
export async function GET() {
  const found = readGeminiKey();
  return NextResponse.json({
    present: Boolean(found),
    masked: found ? maskKey(found.key) : null,
    source: found?.source ?? null,
  });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  try {
    const { masked, warning } = saveGeminiKey(String(body.key ?? ""));
    clearStatusCache();
    return NextResponse.json({ ok: true, masked, warning });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Gagal menyimpan key." },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  const found = readGeminiKey();
  if (found?.source === "env") {
    return NextResponse.json(
      { error: "Key ini berasal dari environment (.env), bukan dari web. Hapus/edit langsung di file .env." },
      { status: 409 }
    );
  }
  const removed = clearGeminiKey();
  clearStatusCache();
  return NextResponse.json({ ok: true, removed });
}

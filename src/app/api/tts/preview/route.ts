import { NextRequest, NextResponse } from "next/server";
import { getVoicePreview } from "@/lib/tts";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * POST /api/tts/preview  { voiceId, lang, text? }
 * Returns a short audio sample (audio/mpeg or audio/wav) so the user can
 * audition a narrator voice before producing the video.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  const voiceId = String(body.voiceId ?? "");
  if (!voiceId || voiceId.length > 80) {
    return NextResponse.json({ error: "voiceId tidak valid." }, { status: 400 });
  }
  const lang = body.lang === "en" ? "en" : "id";
  const text = typeof body.text === "string" && body.text.trim() ? body.text.trim() : undefined;

  try {
    const { buffer, contentType } = await getVoicePreview({ voiceId, lang, text });
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal membuat contoh suara.";
    console.error(`[tts/preview] failed: ${message}`);
    return NextResponse.json({ error: `Gagal membuat contoh suara: ${message}` }, { status: 502 });
  }
}

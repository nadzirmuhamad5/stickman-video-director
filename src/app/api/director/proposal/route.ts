import { NextRequest, NextResponse } from "next/server";
import { corsPreflight } from "@/lib/cors";
import { llmComplete, extractJson } from "@/lib/gemini";

type ProposalClip = {
  index: number;
  stage: string;
  time: string;
  narrationEn: string;
  narrationId: string;
  beats: string[];
  devices: string[];
  transition: string;
};

type ProposalScore = {
  total: number;
  hook: number;
  story: number;
  retensi: number;
  klaritas: number;
  tips: string[];
};

type Proposal = {
  title: string;
  logline: string;
  ratio: string;
  durationSeconds: number;
  styleCode: string;
  styleName: string;
  voiceProfile: string;
  bgm: string;
  clips: ProposalClip[];
  score: ProposalScore | null;
};

export const maxDuration = 120;

const STAGE_NAMES = [
  "Golden Hook",
  "Disrupting Assumptions",
  "Unveiling Insider Secrets",
  "Ultimate Truth Revelation",
  "Elevation & Discussion",
];

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function coerceScore(raw: unknown): ProposalScore | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const tips = Array.isArray(d.tips) ? d.tips.map((t) => String(t)).filter(Boolean).slice(0, 4) : [];
  if (d.total === undefined && tips.length === 0) return null;
  return {
    total: clampScore(d.total),
    hook: clampScore(d.hook),
    story: clampScore(d.story),
    retensi: clampScore(d.retensi),
    klaritas: clampScore(d.klaritas),
    tips,
  };
}

/**
 * Normalisasi beats. LLM kadang mengirim beats sebagai satu string
 * ("[0-2s] ... [2-4s] ...") alih-alih array — pecah di penanda waktu [Ns].
 */
function coerceBeats(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((b) => String(b).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    const timed = raw
      .split(/(?=\[\d)/)
      .map((b) => b.trim())
      .filter(Boolean);
    if (timed.length >= 2) return timed;
    const lined = raw
      .split(/\n+|;\s*/)
      .map((b) => b.trim())
      .filter(Boolean);
    return lined.length >= 2 ? lined : [raw.trim()];
  }
  return [];
}

function coerceProposal(data: unknown, ctx: { styleCode: string; styleName: string; ratio: string; durationSeconds: number }): Proposal {
  const d = data as Record<string, unknown>;
  const rawClips = Array.isArray(d.clips) ? (d.clips as Record<string, unknown>[]) : [];
  const clips: ProposalClip[] = rawClips.map((c, i) => ({
    index: typeof c.index === "number" ? c.index : i + 1,
    stage: typeof c.stage === "string" ? c.stage : STAGE_NAMES[i % STAGE_NAMES.length],
    time: typeof c.time === "string" ? c.time : `${i * 10}-${(i + 1) * 10}s`,
    narrationEn: typeof c.narrationEn === "string" ? c.narrationEn : "",
    narrationId: typeof c.narrationId === "string" ? c.narrationId : "",
    beats: coerceBeats(c.beats),
    devices: Array.isArray(c.devices) ? c.devices.map(String) : [],
    transition: typeof c.transition === "string" ? c.transition : "",
  }));

  return {
    title: typeof d.title === "string" && d.title ? d.title : "Untitled Proposal",
    logline: typeof d.logline === "string" ? d.logline : "",
    ratio: ctx.ratio,
    durationSeconds: ctx.durationSeconds,
    styleCode: ctx.styleCode,
    styleName: ctx.styleName,
    voiceProfile: typeof d.voiceProfile === "string" ? d.voiceProfile : "",
    bgm: typeof d.bgm === "string" ? d.bgm : "",
    clips,
    score: coerceScore(d.score),
  };
}

/**
 * Gerbang kualitas: minimal N-1 klip punya beats (≥2) dan narasi.
 * Kalau di bawah ambang, attempt dianggap gagal dan dicoba ulang.
 */
function proposalQualityOk(p: Proposal): boolean {
  if (p.clips.length === 0) return false;
  const withBeats = p.clips.filter((c) => c.beats.length >= 2).length;
  const withNarration = p.clips.filter((c) => c.narrationId.trim().length > 0).length;
  return withBeats >= p.clips.length - 1 && withNarration >= p.clips.length - 1;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const ratio = body.ratio === "9:16" ? "9:16" : "16:9";
  const durationSeconds = Number(body.durationSeconds);
  const styleCode = typeof body.styleCode === "string" ? body.styleCode : "";
  const styleName = typeof body.styleName === "string" ? body.styleName : "";

  if (!topic) {
    return NextResponse.json({ error: "Topik atau materi sumber wajib diisi." }, { status: 400 });
  }
  if (!styleCode || !styleName) {
    return NextResponse.json({ error: "Pilih salah satu gaya visual A1–A7." }, { status: 400 });
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < 10 || durationSeconds > 600) {
    return NextResponse.json({ error: "Durasi harus 10–600 detik." }, { status: 400 });
  }
  // Jumlah klip: ikut permintaan user (3–12) bila valid, kalau tidak "auto"
  // = durasi ÷ ±8 detik per klip.
  const reqClipCount = Number(body.clipCount);
  const clipCount =
    Number.isInteger(reqClipCount) && reqClipCount >= 3 && reqClipCount <= 12
      ? reqClipCount
      : Math.max(3, Math.min(12, Math.round(durationSeconds / 8)));

  const MAX_ATTEMPTS = 3;
  let lastError = "Unknown error";

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const outcome = await attemptProposal({ styleCode, styleName, ratio, durationSeconds, topic, clipCount });
      if (typeof outcome === "object") {
        if (proposalQualityOk(outcome)) {
          return NextResponse.json({ proposal: outcome });
        }
        const withBeats = outcome.clips.filter((c) => c.beats.length >= 2).length;
        const withNarration = outcome.clips.filter((c) => c.narrationId.trim().length > 0).length;
        lastError = `beats/narasi kosong (${withBeats}/${outcome.clips.length} beats, ${withNarration}/${outcome.clips.length} narasi)`;
        console.error(`[director/proposal] attempt ${attempt}/${MAX_ATTEMPTS} rejected: ${lastError}`);
        continue;
      }
      lastError = outcome;
      console.error(`[director/proposal] attempt ${attempt}/${MAX_ATTEMPTS} failed: ${outcome}`);
    }
    return NextResponse.json(
      { error: `Gagal menghasilkan proposal setelah ${MAX_ATTEMPTS} percobaan (${lastError}). Coba lagi.` },
      { status: 502 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal menghasilkan proposal.";
    return NextResponse.json({ error: `Gagal menghasilkan proposal: ${message}` }, { status: 500 });
  }
}

async function attemptProposal(
  ctx: { styleCode: string; styleName: string; ratio: string; durationSeconds: number; topic: string; clipCount: number }
): Promise<Proposal | string> {
  try {
    const perClip = Math.max(5, Math.round(ctx.durationSeconds / ctx.clipCount));
    const b1 = Math.max(2, Math.round(perClip * 0.35));
    const b2 = Math.max(b1 + 1, Math.round(perClip * 0.7));
    const beatsFormat = `[0-${b1}s] ..., [${b1}-${b2}s] ..., [${b2}-${perClip}s] ...`;
    const { content: raw } = await llmComplete([
      {
          role: "assistant",
          content: `You are a professional stickman video director. Produce "Phase A" — a director's proposal for a ${ctx.durationSeconds}-second stickman animation composed of exactly ${ctx.clipCount} clips of ~${perClip} seconds each (Gemini Omni Flash style).

STRICT RULES:
1. Structure the ${ctx.clipCount} clips through the 5-Stage High-Completion Heartbeat Engine: Golden Hook → Disrupting Assumptions → Unveiling Insider Secrets → Ultimate Truth Revelation → Elevation & Discussion. Distribute the stages across the clips; do not skip stages. Clip 1 must open with a counter-intuitive hook in the first 2-5 seconds, never generic platitudes. The final clip ends with a memorable punchline plus an irresistible discussion prompt.
2. English narration (narrationEn) at ${Math.round(perClip * 2.2)}-${Math.round(perClip * 2.8)} words per ${perClip}-second clip. Also give a natural Indonesian reference translation (narrationId).
3. Narration is AUDIO ONLY. Never narrate on-screen text; no speech bubbles, no captions in the visuals.
4. Each clip gets exactly 3 timed beats in format ${beatsFormat} covering the full ${perClip}-second clip, at least 4 concrete visual devices (named props, effects, background elements), and one concrete action-driven motion — never abstract liquid/shape morphing, never an idle character. A visual change every 2-3 seconds.
5. Keep one consistent narrator and one consistent main character across all clips. Character proportions, line weight and drawing grammar never change between clips.
6. Each clip must end in a way that matches the next clip's opening (shared prop, action, or screen direction). The final clip ends cleanly on the discussion prompt.
7. Do not invent statistics, quotes, or product claims. No technical color notation (hex/RGB) anywhere.
8. Choose a complete video-level voice profile (timbre, register, accent, pace, recording treatment) and a continuous BGM direction stated once for the whole video.
9. Write title, logline, beats, devices, transition, voiceProfile and bgm in Indonesian. narrationEn in English, narrationId in Indonesian.
10. JSON SAFETY: never use the double-quote character (") inside string values — use single quotes ' for quoted words. Escape nothing else; keep the JSON strictly valid.
11. SCORE: after structuring, evaluate the proposal honestly like a strict YouTube retention strategist. Score each aspect 0-100 (75+ = excellent, 60-74 = decent, below 60 = weak): "hook" (strength of the first 3 seconds), "story" (narrative arc and payoff), "retensi" (pacing, visual changes, curiosity gaps), "klaritas" (clarity of message for a first-time viewer), and "total" (weighted overall). Add 2-4 concrete improvement "tips" in Indonesian referencing specific clips.

Respond with ONLY a valid JSON object, no markdown fences, in this exact shape:
{"title": string, "logline": string, "voiceProfile": string, "bgm": string, "score": {"total": number, "hook": number, "story": number, "retensi": number, "klaritas": number, "tips": string[2-4]}, "clips": [{"index": number, "stage": string, "time": string, "narrationEn": string, "narrationId": string, "beats": string[3], "devices": string[4+], "transition": string}]}`,
        },
        {
          role: "user",
          content: `Gaya visual: ${ctx.styleCode} — ${ctx.styleName}. Rasio aspek: ${ctx.ratio} (${ctx.ratio === "16:9" ? "action disebar kiri-tengah-kanan, tracking lateral" : "gunakan kedalaman, gerak vertikal, reveal bertumpuk"}). Durasi target: ${ctx.durationSeconds} detik = ${ctx.clipCount} klip.\n\nMateri sumber / topik:\n${ctx.topic}`,
        },
    ]);

    const proposal = coerceProposal(extractJson(raw), {
      styleCode: ctx.styleCode,
      styleName: ctx.styleName,
      ratio: ctx.ratio,
      durationSeconds: ctx.durationSeconds,
    });
    if (proposal.clips.length === 0) {
      return "Proposal kosong dari model";
    }
    return proposal;
  } catch (err) {
    return err instanceof Error ? err.message : "Kesalahan tidak diketahui";
  }
}

export async function OPTIONS() {
  return corsPreflight();
}

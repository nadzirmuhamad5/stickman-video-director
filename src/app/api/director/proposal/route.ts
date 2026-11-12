import { NextRequest, NextResponse } from "next/server";
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
};

export const maxDuration = 120;

const STAGE_NAMES = [
  "Golden Hook",
  "Disrupting Assumptions",
  "Unveiling Insider Secrets",
  "Ultimate Truth Revelation",
  "Elevation & Discussion",
];

function coerceProposal(data: unknown, ctx: { styleCode: string; styleName: string; ratio: string; durationSeconds: number }): Proposal {
  const d = data as Record<string, unknown>;
  const rawClips = Array.isArray(d.clips) ? (d.clips as Record<string, unknown>[]) : [];
  const clips: ProposalClip[] = rawClips.map((c, i) => ({
    index: typeof c.index === "number" ? c.index : i + 1,
    stage: typeof c.stage === "string" ? c.stage : STAGE_NAMES[i % STAGE_NAMES.length],
    time: typeof c.time === "string" ? c.time : `${i * 10}-${(i + 1) * 10}s`,
    narrationEn: typeof c.narrationEn === "string" ? c.narrationEn : "",
    narrationId: typeof c.narrationId === "string" ? c.narrationId : "",
    beats: Array.isArray(c.beats) ? c.beats.map(String) : [],
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
  };
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
    return NextResponse.json({ error: "Pilih salah satu gaya visual A1–A5." }, { status: 400 });
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < 10 || durationSeconds > 600) {
    return NextResponse.json({ error: "Durasi harus 10–600 detik." }, { status: 400 });
  }
  const clipCount = Math.round(durationSeconds / 10);

  const MAX_ATTEMPTS = 3;
  let lastError = "Unknown error";

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const outcome = await attemptProposal({ styleCode, styleName, ratio, durationSeconds, topic, clipCount });
      if (typeof outcome === "object") {
        return NextResponse.json({ proposal: outcome });
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
    const { content: raw } = await llmComplete([
      {
          role: "assistant",
          content: `You are a professional stickman video director. Produce "Phase A" — a director's proposal for a ${ctx.durationSeconds}-second stickman animation composed of exactly ${ctx.clipCount} clips of ~10 seconds each (Gemini Omni Flash style).

STRICT RULES:
1. Structure the ${ctx.clipCount} clips through the 5-Stage High-Completion Heartbeat Engine: Golden Hook → Disrupting Assumptions → Unveiling Insider Secrets → Ultimate Truth Revelation → Elevation & Discussion. Distribute the stages across the clips; do not skip stages. Clip 1 must open with a counter-intuitive hook in the first 2-5 seconds, never generic platitudes. The final clip ends with a memorable punchline plus an irresistible discussion prompt.
2. English narration (narrationEn) at 20-25 words per 10-second clip. Also give a natural Indonesian reference translation (narrationId).
3. Narration is AUDIO ONLY. Never narrate on-screen text; no speech bubbles, no captions in the visuals.
4. Each clip gets exactly 3 timed beats in format "[0-3s] ...", "[3-7s] ...", "[7-10s] ...", at least 4 concrete visual devices (named props, effects, background elements), and one concrete action-driven motion — never abstract liquid/shape morphing, never an idle character. A visual change every 2-3 seconds.
5. Keep one consistent narrator and one consistent main character across all clips. Character proportions, line weight and drawing grammar never change between clips.
6. Each clip must end in a way that matches the next clip's opening (shared prop, action, or screen direction). The final clip ends cleanly on the discussion prompt.
7. Do not invent statistics, quotes, or product claims. No technical color notation (hex/RGB) anywhere.
8. Choose a complete video-level voice profile (timbre, register, accent, pace, recording treatment) and a continuous BGM direction stated once for the whole video.
9. Write title, logline, beats, devices, transition, voiceProfile and bgm in Indonesian. narrationEn in English, narrationId in Indonesian.
10. JSON SAFETY: never use the double-quote character (") inside string values — use single quotes ' for quoted words. Escape nothing else; keep the JSON strictly valid.

Respond with ONLY a valid JSON object, no markdown fences, in this exact shape:
{"title": string, "logline": string, "voiceProfile": string, "bgm": string, "clips": [{"index": number, "stage": string, "time": string, "narrationEn": string, "narrationId": string, "beats": string[3], "devices": string[4+], "transition": string}]}`,
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

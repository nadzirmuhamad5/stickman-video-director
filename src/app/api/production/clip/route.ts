import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import fs from "node:fs";
import path from "node:path";
import {
  buildScenePrompt,
  jobIdValid,
  jobDir,
  probeDuration,
  readJob,
  sleep,
  writeProgress,
} from "@/lib/production";
import { synthesizeTTS } from "@/lib/tts";
import { resolveVoice } from "@/lib/tts-voices";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  const jobId = String(body.jobId ?? "");
  const index = Number(body.index);
  if (!jobIdValid(jobId) || !fs.existsSync(path.join(jobDir(jobId), "job.json"))) {
    return NextResponse.json({ error: "Job produksi tidak ditemukan." }, { status: 404 });
  }
  const job = readJob(jobId);
  const clip = job.proposal.clips.find((c) => c.index === index);
  if (!clip) {
    return NextResponse.json({ error: `Klip ${index} tidak ada dalam proposal.` }, { status: 400 });
  }

  const assetsDir = path.join(jobDir(jobId), "assets");
  const imagePath = path.join(assetsDir, `clip-${index}.png`);
  const audioPath = path.join(assetsDir, `clip-${index}.wav`);
  const progress = { image: false, audio: false, audioDuration: 0 };

  // ---------------------------------------------------------------- image --
  const scenePrompt = buildScenePrompt(job.proposal, clip);
  let imageError = "Unknown image error";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const zai = await ZAI.create();
      const response = await zai.images.generations.create({
        prompt: scenePrompt,
        size: job.proposal.ratio === "9:16" ? "720x1440" : "1344x768",
      });
      const base64 = response.data?.[0]?.base64;
      if (!base64) throw new Error("Respons image generation kosong");
      fs.writeFileSync(imagePath, Buffer.from(base64, "base64"));
      progress.image = true;
      break;
    } catch (err) {
      imageError = err instanceof Error ? err.message : String(err);
      console.error(`[production/clip] image attempt ${attempt}/3 failed: ${imageError}`);
      await sleep(900 * attempt);
    }
  }
  if (!progress.image) {
    return NextResponse.json(
      { error: `Gagal membuat ilustrasi klip ${index}: ${imageError}` },
      { status: 502 }
    );
  }
  writeProgress(jobId, {
    clips: { [index]: { image: true, illustration: `/api/media/${jobId}/assets/clip-${index}.png` } },
  });

  // ------------------------------------------------------------------ tts --
  const narration = (job.narrationLang === "en" ? clip.narrationEn : clip.narrationId)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
  const voice = resolveVoice(job.voice);
  const engineLabel = voice.engine === "edge" ? "Edge Neural" : "ZAI";
  let audioError = "Unknown TTS error";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await synthesizeTTS({ text: narration, voiceId: job.voice, outPath: audioPath });
      progress.audio = true;
      break;
    } catch (err) {
      audioError = err instanceof Error ? err.message : String(err);
      console.error(`[production/clip] tts(${voice.engine}) attempt ${attempt}/3 failed: ${audioError}`);
      await sleep(900 * attempt);
    }
  }
  if (!progress.audio) {
    return NextResponse.json(
      { error: `Gagal membuat narasi klip ${index} (${engineLabel}): ${audioError}` },
      { status: 502 }
    );
  }

  const audioDuration = await probeDuration(audioPath);
  writeProgress(jobId, {
    clips: { [index]: { image: true, audio: true, audioDuration } },
  });

  return NextResponse.json({
    ok: true,
    index,
    illustration: `/api/media/${jobId}/assets/clip-${index}.png`,
    audio: `/api/media/${jobId}/assets/clip-${index}.wav`,
    audioDuration,
  });
}

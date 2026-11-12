// E2E mechanics test for the new autopilot capabilities, run with bun:
//   bun scripts/test-b3b4.ts
//
// 1. B1 (gurita)  — AI topic props via ZAI → whiten-alpha → canvas render.
// 2. B3 (Retro TV) — pure-vector scenes → canvas render (television finish).
// 3. B4 (Thriller) — Gemini illustrations (stand-in: bundled style-lock
//    references), ≤3 s shots, ambience bed, Brian voice → canvas render
//    (renderer also runs its opening-audio diagnostic for B4).
//
// Each stage builds the real project.json through src/lib builders and
// renders it through scripts/render-autopilot.mjs (which re-validates the
// whole project via the skill's loadProject).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { jobDir, ensureDir, probeDuration } from "@/lib/production";
import { buildAutopilotProject, buildB3Project, buildB4Project, type AutopilotScene } from "@/lib/canvas-project";
import { ensurePropImages, stagePropsIntoCanvasDir } from "@/lib/prop-art";
import { writeB4Ambience } from "@/lib/autopilot-runner";

const EDGE_PY = "/home/z/.venv/bin/python3";
const SKILL_B4 = path.join(process.cwd(), "skills/directing-stickman-videos/assets/b4");

function sh(cmd: string, args: string[], timeoutMs = 240_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exit ${code}: ${err.slice(-800)}`));
    });
  });
}

async function tts(text: string, voiceId: string, out: string) {
  await sh(EDGE_PY, ["-m", "edge_tts", "--voice", voiceId, "--text", text, "--write-media", out], 120_000);
}

async function renderProject(projectPath: string): Promise<{ duration: number; caption_count: number; shot_count: number; output: string }> {
  const out = await sh("node", [path.join(process.cwd(), "scripts/render-autopilot.mjs"), projectPath]);
  const marker = out.indexOf("REPORT_JSON:");
  if (marker === -1) throw new Error(`REPORT_JSON hilang: ${out.slice(-500)}`);
  return JSON.parse(out.slice(marker + "REPORT_JSON:".length));
}

function ffprobeJson(file: string): Promise<string> {
  return sh("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json", file]);
}

// ---------------------------------------------------------------- B1 props --
async function testB1() {
  const jobId = randomUUID();
  const dir = jobDir(jobId);
  const canvasDir = path.join(dir, "canvas");
  ensureDir(canvasDir);

  const scenes: AutopilotScene[] = [
    {
      narration: "Tahukah kamu? Gurita punya tiga jantung yang bekerja bergantian saat ia berenang.",
      keyword: "Tiga Jantung", asset: "none", pose: 1, overlay: "underline",
      beats: [
        { label: "tiga jantung", pose: 1, asset: "none", accent: "underline", prop: "gurita" },
        { label: "saat berenang", pose: 2, asset: "none", accent: "none", prop: "laut dalam" },
      ],
    },
    {
      narration: "Dua jantung mengepam darah ke insang, dan satu jantung istirahat ketika gurita berenang.",
      keyword: "Sirkulasi", asset: "none", pose: 0, overlay: "none",
      beats: [
        { label: "darah ke insang", pose: 0, asset: "none", accent: "underline", prop: "jantung" },
        { label: "gurita berenang", pose: 2, asset: "none", accent: "none", prop: "gurita" },
      ],
    },
    {
      narration: "Itulah kenapa gurita lebih suka berjalan di dasar laut daripada berenang. Menarik, kan?",
      keyword: "Suka Berjalan", asset: "none", pose: 1, overlay: "arrow",
      beats: [
        { label: "dasar laut", pose: 1, asset: "none", accent: "none", prop: "karang" },
        { label: "lebih suka berjalan", pose: 2, asset: "none", accent: "underline", prop: "gurita" },
      ],
    },
  ];

  console.log("[B1] menghasilkan prop via ZAI…");
  const hints = scenes.flatMap((s) => s.beats.map((b) => b.prop!)).filter(Boolean);
  const generated = await ensurePropImages(hints, "B1", { concurrency: 1, spacingMs: 5000, max: 12, onProgress: (d, t) => console.log(`  prop ${d}/${t}`) });
  console.log(`[B1] prop berhasil: ${generated.size}/${new Set(hints.map((h) => h.trim()).filter(Boolean)).size}`);
  if (generated.size === 0) throw new Error("Tidak ada prop yang berhasil dibuat");
  const staged = stagePropsIntoCanvasDir(canvasDir, generated);
  for (const s of scenes) {
    for (const b of s.beats) b.asset = staged.get(b.prop!) ?? "none";
  }

  await tts("Tahukah kamu? Gurita punya tiga jantung yang bekerja bergantian saat ia berenang. Dua jantung mengepam darah ke insang, dan satu jantung istirahat ketika gurita berenang. Itulah kenapa gurita lebih suka berjalan di dasar laut daripada berenang. Menarik, kan?", "id-ID-ArdiNeural", path.join(canvasDir, "voice.wav"));
  const voiceDuration = await probeDuration(path.join(canvasDir, "voice.wav"));
  console.log(`[B1] voice ${voiceDuration.toFixed(2)}s`);

  const { projectPath } = buildAutopilotProject({ jobId, title: "Tiga Jantung Gurita", ratio: "16:9", styleB: "B1", voiceDuration, scenes });
  const report = await renderProject(projectPath);
  const media = JSON.parse(await ffprobeJson(report.output));
  console.log(`[B1] OK duration=${report.duration.toFixed(2)}s captions=${report.caption_count} shots=${report.shot_count} codec=${media.streams[0].codec_name} ${media.streams[0].width}x${media.streams[0].height}`);
  return report.output.replace(process.cwd() + "/", "");
}

// ------------------------------------------------------------------- B3 TV --
async function testB3() {
  const jobId = randomUUID();
  const dir = jobDir(jobId);
  const canvasDir = path.join(dir, "canvas");
  ensureDir(canvasDir);

  const scenes: AutopilotScene[] = [
    {
      narration: "Pada tahun 1912, sebuah pesan singkat menyeramkan dikirim dari kapal yang katanya tak bisa tenggelam.",
      keyword: "Pesan Terakhir", asset: "none", pose: 1, overlay: "underline",
      beats: [
        { label: "kapal raksasa", pose: 1, asset: "none", accent: "underline" },
        { label: "pesan dikirim", pose: 0, asset: "none", accent: "none" },
      ],
    },
    {
      narration: "Operator radio lain memilih mengabaikannya — lampu sinyal akhirnya padam tanpa dibalas.",
      keyword: "Sinyal Diabaikan", asset: "none", pose: 0, overlay: "none",
      beats: [
        { label: "operator diam", pose: 0, asset: "none", accent: "none" },
        { label: "sinyal padam", pose: 2, asset: "none", accent: "underline" },
      ],
    },
    {
      narration: "Kadang pesan penting tidak pecah — ia hanya dikirim ke orang yang salah. Menurutmu, siapa yang salah duluan?",
      keyword: "Pelan Ke Orang Salah", asset: "none", pose: 1, overlay: "arrow",
      beats: [
        { label: "orang yang salah", pose: 1, asset: "none", accent: "underline" },
        { label: "siapa salah duluan", pose: 0, asset: "none", accent: "none" },
      ],
    },
  ];

  await tts("Pada tahun 1912, sebuah pesan singkat menyeramkan dikirim dari kapal yang katanya tak bisa tenggelam. Operator radio lain memilih mengabaikannya — lampu sinyal akhirnya padam tanpa dibalas. Kadang pesan penting tidak pecah — ia hanya dikirim ke orang yang salah. Menurutmu, siapa yang salah duluan?", "id-ID-ArdiNeural", path.join(canvasDir, "voice.wav"));
  const voiceDuration = await probeDuration(path.join(canvasDir, "voice.wav"));

  const { projectPath } = buildB3Project({ jobId, title: "Pesan Terakhir 1912", ratio: "16:9", styleB: "B3", voiceDuration, scenes });
  const report = await renderProject(projectPath);
  const media = JSON.parse(await ffprobeJson(report.output));
  console.log(`[B3] OK duration=${report.duration.toFixed(2)}s captions=${report.caption_count} shots=${report.shot_count} codec=${media.streams[0].codec_name} ${media.streams[0].width}x${media.streams[0].height}`);
  return report.output.replace(process.cwd() + "/", "");
}

// ------------------------------------------------------------------- B4 B4 --
async function testB4() {
  const jobId = randomUUID();
  const dir = jobDir(jobId);
  const canvasDir = path.join(dir, "canvas");
  ensureDir(canvasDir);
  const scenesDir = path.join(canvasDir, "scenes");
  ensureDir(scenesDir);

  const refs = [
    path.join(SKILL_B4, "reference-01-motor-room.png"),
    path.join(SKILL_B4, "reference-02-rooftop.png"),
    path.join(SKILL_B4, "reference-04-street.png"),
    path.join(SKILL_B4, "reference-03-driver.png"),
    path.join(SKILL_B4, "reference-05-opposite-rooftop.png"),
    path.join(SKILL_B4, "reference-01-motor-room.png"),
  ];
  refs.forEach((r, i) => fs.copyFileSync(r, path.join(scenesDir, `s${i}.png`)));

  const mkBeat = (label: string, k: number): AutopilotScene["beats"][number] => ({
    label, pose: 0, asset: `scenes/s${k}.png`, accent: "none",
  });
  const scenes: AutopilotScene[] = [
    {
      narration: "The power dies at 3 a.m., and every door in Meridian Tower unlocks itself at once.",
      keyword: "Blackout", asset: "none", pose: 0, overlay: "none", location: "indoor",
      beats: [mkBeat("generator room goes dark", 0), mkBeat("door locks click open", 1)],
    },
    {
      narration: "From the rooftop, Mara counts eleven silhouettes wading across the flooded street below.",
      keyword: "Eleven Silhouettes", asset: "none", pose: 0, overlay: "none", location: "outdoor",
      beats: [mkBeat("rooftop watch", 2), mkBeat("figures cross the water", 3)],
    },
    {
      narration: "Then the elevator starts moving again — but nobody in the building pressed the button.",
      keyword: "The Elevator", asset: "none", pose: 0, overlay: "none", location: "indoor",
      beats: [mkBeat("elevator lights rise", 4), mkBeat("doors open alone", 5)],
    },
  ];

  await tts("The power dies at 3 a.m., and every door in Meridian Tower unlocks itself at once. From the rooftop, Mara counts eleven silhouettes wading across the flooded street below. Then the elevator starts moving again — but nobody in the building pressed the button.", "en-US-BrianNeural", path.join(canvasDir, "voice.wav"));
  const voiceDuration = await probeDuration(path.join(canvasDir, "voice.wav"));

  writeB4Ambience(path.join(canvasDir, "ambience.wav"), 24);
  const { projectPath } = buildB4Project({
    jobId, title: "Meridian Tower 3 A.M.", ratio: "16:9", styleB: "B4", voiceDuration, scenes,
    voiceName: "Brian", voiceId: "en-US-BrianNeural",
    voiceOverride: "Edge Neural en-US-BrianNeural dipilih eksplisit di web Studio",
  });

  const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  const spans = project.shots.map((s: { start: number; end: number }) => (s.end - s.start).toFixed(2));
  console.log(`[B4] shots=${project.shots.length} spans=[${spans.join(", ")}] captions=${project.captions.length}`);

  const report = await renderProject(projectPath);
  const media = JSON.parse(await ffprobeJson(report.output));
  console.log(`[B4] OK duration=${report.duration.toFixed(2)}s captions=${report.caption_count} shots=${report.shot_count} codec=${media.streams[0].codec_name} ${media.streams[0].width}x${media.streams[0].height}`);
  return report.output.replace(process.cwd() + "/", "");
}

// ------------------------------------------------------------------- main --
const which = process.argv[2] ?? "all";
const results: string[] = [];
if (which === "all" || which === "b1") results.push("b1=" + (await testB1()));
if (which === "all" || which === "b3") results.push("b3=" + (await testB3()));
if (which === "all" || which === "b4") results.push("b4=" + (await testB4()));
console.log("RESULT " + results.join(" "));

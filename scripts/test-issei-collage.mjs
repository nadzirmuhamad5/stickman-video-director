// Uji visual gaya A7 "Issei Kolase":
// 1. Generate 1 ilustrasi A7 (prompt persis seperti production.ts + intro).
// 2. Render 2 proyek canvas: B2+collage (A7) dan B2 polos (sanity check).
// 3. Ekstrak frame tengah dari masing-masing untuk inspeksi visual.
// 4. Salin contact-sheet render A7 → public/previews/style-7-issei-collage.png.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ZAI from "z-ai-web-dev-sdk";
import { loadProject } from "../skills/directing-stickman-videos/scripts/autopilot-core.mjs";
import { render } from "../skills/directing-stickman-videos/scripts/autopilot-render.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TEST = path.join(ROOT, "research", "issei", "collage-test");
const A7_PROMPT =
  "vintage documentary collage illustration on aged sepia paper background with visible paper fibers and archival film grain, real black-and-white halftone photograph cutouts of people with rough scissor-cut edges highlighted by a bold hand-drawn white outline glow, one simple black stick figure with round head standing among the cutouts pointing at them, red ink circles arrows and rough underlines drawn over the cutouts, torn paper strips and adhesive tape corners pinning the photos, faded archival tones with one warm accent, flat 2D layered collage composition, storyboard still frame";
const INTRO =
  "INTRO SHOT: the main person appears as a large bold photo cutout highlighted with a rough white outline at the center, surrounded by smaller faded cutouts emerging from the aged paper, dramatic focal point.";

fs.mkdirSync(TEST, { recursive: true });
fs.mkdirSync(path.join(TEST, "a7"), { recursive: true });
fs.mkdirSync(path.join(TEST, "plain"), { recursive: true });

// Suara uji: nada 440Hz 3.0s (sintetis, cukup untuk kontrak durasi renderer).
for (const dir of ["a7", "plain"]) {
  const wav = path.join(TEST, dir, "voice.wav");
  if (!fs.existsSync(wav)) {
    execSync(
      `ffmpeg -v error -y -f lavfi -i "sine=frequency=440:duration=3.0" -ar 48000 -ac 1 "${wav}"`
    );
  }
}

// 1) Ilustrasi A7 (sekali, dipakai kedua proyek).
const imagePath = path.join(TEST, "clip-1.png");
if (!fs.existsSync(imagePath)) {
  console.log("menghasilkan ilustrasi A7 via ZAI...");
  const zai = await ZAI.create();
  const response = await zai.images.generations.create({
    prompt: `${A7_PROMPT} ${INTRO} Scene: a mysterious forgotten inventor. Absolutely no text, no letters, no captions, no speech bubbles, no watermark, no logo.`,
    size: "704x1408", // kelipatan 32 (syarat API), rasio 1:2 = 720x1440
  });
  const base64 = response.data?.[0]?.base64;
  if (!base64) throw new Error("Respons image generation kosong");
  fs.writeFileSync(imagePath, Buffer.from(base64, "base64"));
  console.log("ilustrasi tersimpan:", imagePath, fs.statSync(imagePath).size, "bytes");
}
for (const dir of ["a7", "plain"]) {
  fs.copyFileSync(imagePath, path.join(TEST, dir, "clip-1.png"));
}

// 2) Proyek canvas. Perhitungan geometri = buildClipCanvasProject (9:16).
function buildProject({ collage }) {
  const span = 3.6; // voice 3.0 + lead 0.3 + tail 0.3
  const planeW = 1280;
  const imgW = planeW * 1.1;
  const imgH = imgW * 2;
  const xRange = 110;
  const yRange = 240;
  const layers = [
    {
      type: "image",
      path: "clip-1.png",
      w: imgW,
      h: imgH,
      ...(collage
        ? {
            keys: [
              { t: 0, alpha: 0, w: imgW * 0.93 },
              { t: 1.1, alpha: 1, w: imgW * 1.02 },
              { t: 1.8, w: imgW },
              { t: span * 0.55, x: -xRange * 0.75, y: -yRange * 0.8 },
              { t: span, x: -xRange, y: -yRange * 0.35 },
            ],
          }
        : {
            keys: [
              { t: 0, alpha: 0.25, x: -xRange * 0.4, y: -yRange * 0.3 },
              { t: 0.5, alpha: 1 },
              { t: span * 0.55, x: -xRange * 0.75, y: -yRange * 0.8 },
              { t: span, x: -xRange, y: -yRange * 0.35 },
            ],
          }),
    },
    {
      type: "underline",
      x: 90,
      y: 2015,
      w: 300,
      lineWidth: 7,
      color: collage ? "#b3382c" : "#3a3428",
      keys: [
        { t: 0.9, progress: 0 },
        { t: 2.0, progress: 1 },
        { t: span - 0.6, alpha: 1 },
        { t: span - 0.15, alpha: 0 },
      ],
    },
    {
      type: "text",
      text: "Penemu yang Dilupakan",
      x: 80,
      y: 70,
      w: 680,
      size: 58,
      bold: true,
      color: collage ? "#1f1b13" : "#3a3428",
      keys: [
        { t: 0.3, alpha: 0, y: 92 },
        { t: 0.9, alpha: 1, y: 70 },
        { t: 2.4, alpha: 1 },
        { t: 3.2, alpha: 0 },
      ],
    },
  ];
  return {
    version: 1,
    style: "B2",
    ...(collage ? { collage: true } : {}),
    width: 720,
    height: 1280,
    fps: 24,
    voice: { path: "voice.wav", lead: 0.3, tail: 0.3, contains_sfx: false },
    shots: [{ start: 0, end: span, layers }],
    captions: [
      { start: 0.5, end: 2.0, text: "potongan orang ini di-highlight" },
      { start: 2.0, end: 3.3, text: "lalu fade in ke kolase kertas" },
    ],
  };
}

const results = {};
for (const [dir, collage] of [
  ["a7", true],
  ["plain", false],
]) {
  const dirPath = path.join(TEST, dir);
  const projectPath = path.join(dirPath, "project.json");
  fs.writeFileSync(projectPath, JSON.stringify(buildProject({ collage })));
  console.log(`render ${dir} (collage=${collage})...`);
  const report = await render(loadProject(projectPath), { full: true, replace: true });
  results[dir] = report;
  console.log(`${dir} selesai →`, report.output, report.duration, "dtk");
}

// 3) Frame tengah untuk inspeksi visual.
for (const dir of ["a7", "plain"]) {
  const mp4 = path.join(TEST, dir, "output", "film.mp4");
  execSync(`ffmpeg -v error -y -ss 1.6 -i "${mp4}" -frames:v 1 "${path.join(TEST, dir, "frame.png")}"`);
}

// 4) Preview aset publik dari contact-sheet A7.
const sheet = path.join(TEST, "a7", "output", "film-contact-sheet.png");
const previewDst = path.join(ROOT, "public", "previews", "style-7-issei-collage.png");
fs.mkdirSync(path.dirname(previewDst), { recursive: true });
fs.copyFileSync(sheet, previewDst);
console.log("preview tersimpan:", previewDst, fs.statSync(previewDst).size, "bytes");
console.log("FRAME_A7:", path.join(TEST, "a7", "frame.png"));
console.log("FRAME_PLAIN:", path.join(TEST, "plain", "frame.png"));

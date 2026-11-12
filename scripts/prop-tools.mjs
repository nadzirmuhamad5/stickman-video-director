// Prop image post-processing for the autopilot canvas pipeline.
//
// Usage:
//   node scripts/prop-tools.mjs whiten-alpha <in.png|jpg> <out.png>
//   node scripts/prop-tools.mjs selftest
//
// `whiten-alpha` removes a pure-white background from an AI-generated
// illustration (JPEG/PNG, no alpha) by converting "distance from white"
// into transparency (GIMP color-to-alpha, white). Antialiased edges become
// partially transparent instead of leaving a white halo, and colored fills
// stay fully opaque. Output is always a PNG.
//
// @napi-rs/canvas is resolved from the installed stickman skill's
// node_modules via createRequire — the same module the renderer itself uses.
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const skillRequire = createRequire(
  path.join(process.cwd(), "skills/directing-stickman-videos/scripts/autopilot-core.mjs")
);
const { loadImage } = skillRequire("@napi-rs/canvas");

function whitenAlpha(src, dst) {
  const abs = fs.realpathSync(path.resolve(src));
  if (!/\.(png|jpe?g)$/i.test(abs)) throw new Error(`Unsupported input: ${path.basename(abs)}`);
  return loadImage(abs).then((img) => {
    const w = img.width;
    const h = img.height;
    const canvas = skillRequire("@napi-rs/canvas").createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const image = ctx.getImageData(0, 0, w, h);
    const d = image.data;

    // Sticker cutout: hapus hanya wilayah latar yang TERHUBUNG ke tepi gambar
    // dan warnanya mendekati putih/krem (JPEG bg bukan putih murni pun hilang).
    // Bagian putih DI DALAM objek tetap opaqe. Tepi objek diberi feather halus.
    const L = (i) => Math.min(d[i], d[i + 1], d[i + 2]) / 255;
    const BG_L = 0.84;          // >= ini dianggap latar bila terhubung tepi
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let qs = 0, qe = 0;
    const push = (x, y) => {
      const idx = y * w + x;
      if (visited[idx]) return;
      visited[idx] = 1;
      if (L(idx * 4) >= BG_L) queue[qe++] = idx;
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (qs < qe) {
      const idx = queue[qs++];
      const x = idx % w, y = (idx / w) | 0;
      if (x > 0) push(x - 1, y);
      if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < h - 1) push(x, y + 1);
    }
    // visited & bukan bg = objek; visited & ada di queue = bg.
    const isBg = new Uint8Array(w * h);
    for (let i = 0; i < qe; i++) isBg[queue[i]] = 1;
    for (let i = 0; i < w * h; i++) {
      const p4 = i * 4;
      if (isBg[i]) {
        d[p4 + 3] = 0;
        continue;
      }
      const lum = L(p4);
      // Feather: piksel tepi objek yang terang → alpha parsial (anti-halo).
      if (lum >= 0.55 && lum < BG_L) {
        const x = i % w, y = (i / w) | 0;
        const nearBg =
          (x > 0 && isBg[i - 1]) || (x < w - 1 && isBg[i + 1]) ||
          (y > 0 && isBg[i - w]) || (y < h - 1 && isBg[i + w]);
        if (nearBg) {
          d[p4 + 3] = Math.round(Math.max(0, Math.min(1, (BG_L - lum) / (BG_L - 0.55))) * 255);
        }
      }
    }
    ctx.putImageData(image, 0, 0);
    fs.mkdirSync(path.dirname(path.resolve(dst)), { recursive: true });
    fs.writeFileSync(path.resolve(dst), canvas.toBuffer("image/png"));
    return { width: w, height: h };
  });
}

function selftest() {
  const { createCanvas } = skillRequire("@napi-rs/canvas");
  // Draw a dark circle + colored square on white, run the filter, assert alpha.
  const src = "/tmp/prop-tools-selftest-in.png";
  const dst = "/tmp/prop-tools-selftest-out.png";
  const c = createCanvas(64, 64), x = c.getContext("2d");
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, 64, 64);
  x.fillStyle = "#202020"; x.beginPath(); x.arc(20, 20, 10, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#cc4422"; x.fillRect(36, 36, 16, 16);
  fs.writeFileSync(src, c.toBuffer("image/png"));
  whitenAlpha(src, dst).then(() => {
    const { loadImage: L } = skillRequire("@napi-rs/canvas");
    L(dst).then((img) => {
      const cc = skillRequire("@napi-rs/canvas").createCanvas(img.width, img.height);
      const cx = cc.getContext("2d");
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, img.width, img.height).data;
      const px = (X, Y) => (Y * img.width + X) * 4;
      const bg = d[px(0, 0) + 3];
      const ink = d[px(20, 20) + 3];
      const fill = d[px(44, 44) + 3];
      const ok = bg === 0 && ink === 255 && fill === 255;
      console.log(JSON.stringify({ bg, ink, fill, ok }));
      process.exit(ok ? 0 : 1);
    });
  }).catch((e) => { console.error(e); process.exit(1); });
}

const [, , cmd, a, b] = process.argv;
if (cmd === "selftest") selftest();
else if (cmd === "whiten-alpha" && a && b) {
  whitenAlpha(a, b)
    .then((r) => console.log(JSON.stringify({ ok: true, ...r })))
    .catch((e) => { console.error(String(e)); process.exit(1); });
} else {
  console.error("usage: node scripts/prop-tools.mjs whiten-alpha <in> <out> | selftest");
  process.exit(2);
}

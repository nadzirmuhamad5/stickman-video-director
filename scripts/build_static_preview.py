#!/usr/bin/env python3
"""Build a fully self-contained static HTML preview of the Stickman Video Director dashboard."""
import base64
import json
import os

PUB = "/home/z/my-project/public/previews"
POSTERS = "/tmp/static-previews"
OUT = "/home/z/my-project/download/stickman-video-director-preview.html"
os.makedirs(os.path.dirname(OUT), exist_ok=True)

CDN = "https://cdn.jsdelivr.net/gh/kaomei/stickman-video-director@main/assets/readme/previews/"

def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()

# Animated (light) GIFs embedded directly
ANIM = {
    "b1": ("b1-minimal-handdrawn.gif", "B1 · Minimal"),
    "b2": ("b2-colorful-phone-weather.gif", "B2 · Cuaca ponsel"),
    "b3": ("b3-tv-dog.gif", "B3 · Anjing TV"),
    "b4": ("b4-death-clock.gif", "B4 · Jam kematian"),
    "a5": ("style-5-japan.gif", "A5 · Jepang"),
    "a2a": ("style-2a-demo.gif", "A2A · Studio Tech"),
}
# Poster (heavy) — static frame + CDN animation on click
POSTER = {
    "a1": ("dark-theme-demo.jpg", "dark-theme-demo.gif", "A1.2 · Putih di latar hitam"),
    "a3": ("style-3-community-fire.jpg", "style-3-community-fire.gif", "A3 · Api komunitas"),
    "a4": ("style-4-cozy-cafe.jpg", "style-4-cozy-cafe.gif", "A4 · Kafe hangat"),
    "a6": ("style-6-amber-noir-flow.jpg", "style-6-amber-noir-flow.gif", "A6 · Amber Noir"),
    "a2b": ("style-2b-demo.jpg", "style-2b-demo.gif", "A2B · Sinematik"),
}

MEDIA = {}
for key, (fname, label) in ANIM.items():
    MEDIA[key] = {"type": "gif", "b64": b64(f"{PUB}/{fname}"), "label": label, "cdn": CDN + fname}
for key, (poster, gif, label) in POSTER.items():
    MEDIA[key] = {
        "type": "poster",
        "b64": b64(f"{POSTERS}/{poster}"),
        "label": label,
        "cdn": CDN + gif,
    }

with open("/tmp/proposal-a1.json") as f:
    p_a1 = json.load(f)
with open("/tmp/proposal-a3.json") as f:
    p_a3 = json.load(f)

PROPOSALS = {
    "A1": {"style": "A1", "ratio": "16:9", "duration": 60, "proposal": p_a1, "topic": "Mengapa manusia prokrastinasi menurut sains"},
    "A3": {"style": "A3", "ratio": "16:9", "duration": 30, "proposal": p_a3, "topic": "Sehari dalam hidup manusia gua menemukan api untuk pertama kali"},
}

MEDIA_JSON = json.dumps(MEDIA)
PROP_JSON = json.dumps(PROPOSALS, ensure_ascii=False).replace("</", "<\\/")

HTML = r"""<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Stickman Video Director — Preview (Offline)</title>
<style>
:root{
  --bg:#0c0a09; --panel:#1c1917; --panel2:#292524; --line:#3a3431;
  --tx:#f5f5f4; --tx2:#a8a29e; --amber:#f59e0b; --amber2:#fbbf24;
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--tx);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--amber);text-decoration:none}
img{display:block;max-width:100%}
.wrap{max-width:1100px;margin:0 auto;padding:0 20px}
header{position:sticky;top:0;z-index:50;background:rgba(12,10,9,.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.nav{display:flex;align-items:center;justify-content:space-between;height:56px;gap:12px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden}
.logo{width:32px;height:32px;border-radius:9px;background:var(--amber);color:#0c0a09;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.badge{display:inline-block;border:1px solid rgba(245,158,11,.5);color:var(--amber);font-size:11px;padding:3px 9px;border-radius:999px}
.navlinks{display:flex;gap:14px}
.navlinks a{color:var(--tx2);font-size:13px}
.navlinks a:hover{color:var(--tx)}
@media(max-width:640px){.navlinks{display:none}}
.hero{border-bottom:1px solid var(--line);background:linear-gradient(180deg,rgba(245,158,11,.08),transparent);text-align:center;padding:64px 0 56px}
.hero h1{font-size:clamp(26px,5vw,44px);line-height:1.15;max-width:820px;margin:0 auto}
.hero h1 em{color:var(--amber);font-style:normal}
.hero p{color:var(--tx2);max-width:640px;margin:18px auto 0;font-size:15px}
.hero .row{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:26px}
.chips{display:flex;flex-wrap:wrap;gap:8px 22px;justify-content:center;margin-top:30px;color:var(--tx2);font-size:12px}
.chips b{color:var(--amber)}
.btn{display:inline-flex;align-items:center;gap:8px;border-radius:10px;padding:11px 20px;font-weight:600;font-size:14px;cursor:pointer;border:1px solid transparent}
.btn.primary{background:var(--amber);color:#0c0a09}
.btn.primary:hover{background:var(--amber2)}
.btn.ghost{border-color:var(--line);color:var(--tx);background:transparent}
.btn.ghost:hover{background:var(--panel2)}
h2.sec{font-size:clamp(22px,3.5vw,30px);text-align:center;letter-spacing:-.01em}
p.sub{color:var(--tx2);text-align:center;max-width:620px;margin:10px auto 0;font-size:14px}
section{padding:56px 0}
#mode .grid,#gaya .grid{display:grid;gap:16px;margin-top:32px}
#mode .grid{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px}
.mode{padding:24px}
.mode .ic{width:40px;height:40px;border-radius:11px;background:rgba(245,158,11,.15);color:var(--amber);display:flex;align-items:center;justify-content:center;font-size:19px;margin-bottom:12px}
.mode .tag{font-size:11px;letter-spacing:.14em;color:var(--amber);text-transform:uppercase}
.mode h3{font-size:18px;margin:2px 0 10px}
.mode ul{list-style:none;color:var(--tx2);font-size:13.5px}
.mode ul li{padding:3px 0}
#gaya{background:#141210;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
#gaya .grid{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.scard{overflow:hidden;display:flex;flex-direction:column}
.scard .media{position:relative;aspect-ratio:16/9;background:#000;cursor:pointer}
.scard .media img{width:100%;height:100%;object-fit:cover}
.scard .media .load{position:absolute;inset:0;display:none;align-items:center;justify-content:center;color:var(--amber);font-size:13px;background:#000d}
.scard .media.loading .load{display:flex}
.scard .code{position:absolute;left:10px;top:10px;background:rgba(12,10,9,.85);color:var(--amber);font-weight:800;font-size:12px;padding:2px 9px;border-radius:7px}
.scard .modebadge{position:absolute;right:10px;top:10px;background:rgba(12,10,9,.85);color:#d6d3d1;font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border-radius:7px}
.scard .body{padding:16px}
.scard h3{font-size:15px}
.scard .tg{color:var(--tx2);font-size:12px;margin:2px 0 8px}
.scard .ds{color:var(--tx2);font-size:12.5px}
.scard .act{margin-top:12px}
.scard button{width:100%;border:1px solid var(--line);background:transparent;color:var(--tx);border-radius:9px;padding:8px;font-size:13px;font-weight:600;cursor:pointer}
.scard button:hover{border-color:rgba(245,158,11,.5);color:var(--amber)}
.scard button.sel{background:var(--amber);border-color:var(--amber);color:#0c0a09}
#studio .cols{display:grid;grid-template-columns:2fr 3fr;gap:22px;margin-top:32px}
@media(max-width:900px){#studio .cols{grid-template-columns:1fr}}
.form{padding:22px;display:flex;flex-direction:column;gap:16px}
label{font-size:13px;font-weight:600;display:block;margin-bottom:6px}
textarea{width:100%;min-height:110px;resize:vertical;background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:10px;padding:11px 13px;font:14px/1.5 inherit}
textarea:focus{outline:2px solid rgba(245,158,11,.5)}
.ratio{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ratio button{border:1px solid var(--line);background:transparent;color:var(--tx2);border-radius:9px;padding:9px;font-size:13.5px;font-weight:600;cursor:pointer}
.ratio button.on{border-color:var(--amber);color:var(--amber);background:rgba(245,158,11,.08)}
.duo{display:grid;grid-template-columns:1fr 1fr;gap:10px}
select{width:100%;background:var(--bg);border:1px solid var(--line);color:var(--tx);border-radius:9px;padding:10px;font:14px inherit}
.hint{text-align:center;color:var(--tx2);font-size:11.5px}
.err{display:none;border:1px solid #7f1d1d;background:#2a1212;color:#fca5a5;border-radius:10px;padding:12px 14px;font-size:13px}
.empty{border:1px dashed var(--line);border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:280px;text-align:center;color:var(--tx2);padding:24px}
.empty .ic{font-size:34px;opacity:.4;margin-bottom:10px}
.prop .head{margin-bottom:14px}
.prop .head .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tagA{background:var(--amber);color:#0c0a09;font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px}
.tagM{border:1px solid var(--line);color:var(--tx2);font-size:12px;padding:3px 10px;border-radius:999px}
.prop h3{font-size:22px;margin-top:12px}
.prop .log{color:var(--tx2);font-size:14px;margin-top:4px}
.mic{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
@media(max-width:640px){.mic{grid-template-columns:1fr}}
.mic>div{border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12.5px;color:var(--tx2)}
.mic b{color:var(--tx)}
.clip{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:16px;margin-top:12px}
.clip .top{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.clip .num{width:24px;height:24px;border-radius:7px;background:var(--amber);color:#0c0a09;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center}
.clip .stage{border:1px solid rgba(245,158,11,.4);color:var(--amber);font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border-radius:999px}
.clip .t{margin-left:auto;font-family:ui-monospace,monospace;font-size:12px;color:var(--tx2)}
.clip .en{margin-top:10px;font-size:14.5px}
.clip .en::before{content:"▶ ";color:var(--amber)}
.clip .id{color:var(--tx2);font-style:italic;font-size:12.5px;margin-top:3px}
.clip .beats{margin-top:10px;display:flex;flex-direction:column;gap:5px;font-size:12.5px}
.clip .beats span{color:var(--amber);font-family:ui-monospace,monospace;font-size:11.5px}
.clip .beats div{display:flex;gap:8px;color:var(--tx2)}
.clip .devs{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px}
.clip .devs i{font-style:normal;background:var(--panel2);color:#d6d3d1;font-size:10.5px;padding:3px 8px;border-radius:6px}
.clip .tr{border-top:1px solid var(--line);margin-top:11px;padding-top:9px;font-size:11.5px;color:var(--tx2)}
.gate{margin-top:18px;border:1px solid rgba(245,158,11,.4);background:rgba(245,158,11,.06);border-radius:13px;padding:16px}
.gate b{color:var(--amber)}
.gate p{font-size:13px;color:var(--tx2);margin-top:6px}
#status{background:#141210;border-top:1px solid var(--line)}
#status .list{max-width:760px;margin:32px auto 0;display:flex;flex-direction:column;gap:10px}
.st{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:13px 16px}
.st .l{display:flex;align-items:center;gap:11px;font-size:14px;font-weight:600}
.dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.dot.ok{background:#22c55e}.dot.warn{background:var(--amber)}
.st .v{border:1px solid rgba(34,197,94,.4);color:#4ade80;font-size:12px;padding:2px 10px;border-radius:999px;white-space:nowrap}
.st .v.warn{border-color:rgba(245,158,11,.4);color:var(--amber)}
#status .note{max-width:760px;margin:16px auto 0;color:var(--tx2);font-size:12.5px}
#status code{background:var(--panel2);padding:2px 7px;border-radius:5px;font-size:12px}
footer{border-top:1px solid var(--line);margin-top:auto}
footer .in{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;padding:20px;color:var(--tx2);font-size:12.5px}
.offline{position:fixed;bottom:14px;left:14px;z-index:60;background:var(--panel2);border:1px solid var(--line);color:var(--tx2);font-size:11.5px;padding:7px 12px;border-radius:999px}
</style>
</head>
<body>
<header>
  <div class="wrap nav">
    <div class="brand"><span class="logo">🎬</span> Stickman Video Director <span class="badge">Terpasang</span></div>
    <nav class="navlinks"><a href="#gaya">Gaya</a><a href="#studio">Studio</a><a href="#status">Status</a><a href="https://github.com/kaomei/stickman-video-director" target="_blank">Repo ↗</a></nav>
  </div>
</header>

<div class="hero">
  <div class="wrap">
    <span class="badge">✨ Skill open source · MIT License</span>
    <h1 style="margin-top:20px">Ubah naskah apa pun jadi <em>video animasi stickman</em> yang siap unggah</h1>
    <p>Dua mode dalam satu skill: <b style="color:var(--tx)">Director</b> untuk storyboard &amp; prompt per adegan, dan <b style="color:var(--tx)">Autopilot</b> untuk video MP4 lengkap dengan narasi, subtitle, dan efek suara. Tanpa kamera, tanpa langganan mahal.</p>
    <div class="row">
      <a class="btn primary" href="#studio">🪄 Coba Studio Director</a>
      <a class="btn ghost" href="#gaya">Lihat 10 Gaya ↓</a>
    </div>
    <div class="chips">
      <span><b>✓</b> 102/102 test runtime lulus</span>
      <span><b>✓</b> FFmpeg + renderer lokal siap</span>
      <span><b>✓</b> 6 gaya Director · 4 gaya Autopilot</span>
    </div>
  </div>
</div>

<section id="mode">
  <div class="wrap">
    <h2 class="sec">Dua mode, satu skill</h2>
    <p class="sub">Pilih cara kerja yang pas: kendali penuh di tangan Anda, atau serahkan seluruh perakitan ke runtime lokal.</p>
    <div class="grid">
      <div class="card mode">
        <div class="ic">✂️</div>
        <div class="tag">Mode A</div>
        <h3>Director</h3>
        <ul>
          <li>• Proposal cerita + storyboard per bagian (klip ±10 detik)</li>
          <li>• Prompt video siap-tempel untuk Google Flow / alat sejenis</li>
          <li>• Anda generate klip &amp; finalisasi di CapCut — kendali penuh</li>
          <li>• Tanpa API key, cocok untuk Shorts 30 dtk s.d. video 3 menit</li>
        </ul>
      </div>
      <div class="card mode">
        <div class="ic">📺</div>
        <div class="tag">Mode B</div>
        <h3>Autopilot</h3>
        <ul>
          <li>• Dari satu permintaan → MP4 utuh yang bisa langsung diunggah</li>
          <li>• Narasi TTS, subtitle semantik, ilustrasi, micro-animation, SFX</li>
          <li>• Sampel ±20 detik dulu untuk disetujui sebelum produksi penuh</li>
          <li>• Butuh layanan image generation &amp; TTS (dicek otomatis)</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section id="gaya">
  <div class="wrap">
    <h2 class="sec">Pilih gaya visual</h2>
    <p class="sub">Sampel asli dari repo. Kartu bertanda <b style="color:var(--tx)">▶</b> menampilkan animasi penuh dari CDN saat diklik (butuh internet); versi offline menampilkan frame statis.</p>
    <div class="grid" id="gallery"></div>
  </div>
</section>

<section id="studio">
  <div class="wrap">
    <h2 class="sec">Studio Director — demo langsung</h2>
    <p class="sub">Simulasi <b style="color:var(--tx)">Tahap A (Proposal Sutradara)</b> dari Mode A: struktur 5 babak, narasi EN + terjemahan, beat berwaktu, dan perangkat visual per klip.</p>
    <div class="cols">
      <div class="card form">
        <div>
          <label for="topic">Topik / naskah / kebutuhan</label>
          <textarea id="topic" placeholder="Contoh: Mengapa manusia prokrastinasi menurut sains"></textarea>
        </div>
        <div>
          <label>Rasio aspek</label>
          <div class="ratio">
            <button type="button" id="r169" class="on">16:9 Horizontal</button>
            <button type="button" id="r916">9:16 Vertikal</button>
          </div>
        </div>
        <div class="duo">
          <div>
            <label for="dur">Durasi</label>
            <select id="dur">
              <option value="30">30 detik · 3 klip</option>
              <option value="60" selected>60 detik · 6 klip</option>
              <option value="90">90 detik · 9 klip</option>
              <option value="120">2 menit · 12 klip</option>
            </select>
          </div>
          <div>
            <label for="style">Gaya visual</label>
            <select id="style">
              <option value="A1">A1 — Hitam Putih Klasik</option>
              <option value="A2">A2 — Zeke Topi Modern</option>
              <option value="A3">A3 — Gua Prasejarah</option>
              <option value="A4">A4 — Cerita Menenangkan</option>
              <option value="A5">A5 — Kartun Sejarah</option>
            </select>
          </div>
        </div>
        <button class="btn primary" id="go" style="justify-content:center">🪄 Hasilkan Proposal Sutradara</button>
        <div class="hint" id="hint">6 klip × ±10 detik · narasi ±132 kata</div>
        <div class="err" id="err"></div>
        <div class="hint" style="opacity:.85">ℹ️ File offline ini menampilkan <b style="color:var(--tx)">contoh proposal asli buatan AI</b> (gaya A1 &amp; A3). Di preview interaktif online, proposal disusun langsung dari topik Anda.</div>
      </div>
      <div>
        <div class="empty" id="empty">
          <div class="ic">🎞️</div>
          <p style="font-weight:600;color:var(--tx)">Proposal Anda akan muncul di sini</p>
          <p style="font-size:12.5px;margin-top:4px;max-width:300px">Isi topik di kiri, tekan tombol, dan laporan sutradara lengkap disusun otomatis oleh AI.</p>
        </div>
        <div class="prop" id="prop" style="display:none"></div>
      </div>
    </div>
  </div>
</section>

<section id="status">
  <div class="wrap">
    <h2 class="sec">Status instalasi runtime</h2>
    <p class="sub">Hasil nyata perintah <code>doctor</code> dari runtime Autopilot yang terpasang di server.</p>
    <div class="list">
      <div class="st"><div class="l"><span class="dot ok"></span> Node.js ≥ 20</div><span class="v">Siap</span></div>
      <div class="st"><div class="l"><span class="dot ok"></span> FFmpeg (penggabung video)</div><span class="v">Siap</span></div>
      <div class="st"><div class="l"><span class="dot ok"></span> FFprobe (inspeksi media)</div><span class="v">Siap</span></div>
      <div class="st"><div class="l"><span class="dot ok"></span> Canvas renderer (ilustrasi &amp; micro-animation)</div><span class="v">Siap</span></div>
      <div class="st"><div class="l"><span class="dot ok"></span> Font lokal (Caveat, Noto Sans)</div><span class="v">Siap</span></div>
      <div class="st"><div class="l"><span class="dot warn"></span> Layanan image generation (Gemini)</div><span class="v warn">Belum dikonfigurasi</span></div>
    </div>
    <p class="note">Cek doctor memverifikasi dependensi lokal dan keberadaan key, bukan kuota/billing. Mode A (Director) tidak memerlukan key apa pun. Runtime skill terpasang di <code>skills/directing-stickman-videos</code> · 102/102 test lulus saat instalasi.</p>
  </div>
</section>

<footer>
  <div class="wrap in">
    <span>🎬 Stickman Video Director · open source MIT</span>
    <a href="https://github.com/kaomei/stickman-video-director" target="_blank">github.com/kaomei/stickman-video-director ↗</a>
  </div>
</footer>

<div class="offline">📦 Versi offline — data contoh tertanam di file ini</div>

<script>
const MEDIA = __MEDIA__;
const PROPOSALS = __PROPOSALS__;

const STYLES = [
  {code:"A1",name:"Hitam Putih Klasik",tag:"Klasik Minimalis",mode:"A",sel:true,media:"a1",
   desc:"Garis hitam di atas putih, atau putih di atas hitam. Sedikit warna cerah hanya untuk menyorot inti ide. Cocok untuk sains, psikologi, dan analogi visual."},
  {code:"A2",name:"Zeke Topi Modern",tag:"Studio Tech / Sinematik",mode:"A",sel:true,media:"a2a",media2:"a2b",
   desc:"Stickman berkupluk merah dan kaos kuning. Varian 2A: studio putih dengan UI holografik. Varian 2B: lokasi sinematik penuh warna."},
  {code:"A3",name:"Gua Prasejarah",tag:"Komedi Gelap",mode:"A",sel:true,media:"a3",
   desc:"Kepala putih ekspresif, tungkai stick hitam, kostum kulit hewan, setting earthy. Komedi gelap dengan setup → eskalasi → punchline ironis."},
  {code:"A4",name:"Cerita Menenangkan",tag:"Cozy Storytelling",mode:"A",sel:true,media:"a4",
   desc:"Kartun 2D penuh warna yang hangat dan menenangkan. Setiap segmen pindah ke lokasi cerita berbeda dengan perubahan shot sinematik."},
  {code:"A5",name:"Kartun Sejarah",tag:"Historical Cartoon",mode:"A",sel:true,media:"a5",
   desc:"Kepala putih berleher pendek, wajah ekspresif, pakaian periode, cel-shaded. Era bisa diganti: Jepang, Mesir, dan lainnya dengan tata gaya tetap."},
  {code:"A6",name:"Amber Noir",tag:"Rute Khusus",mode:"A",sel:false,media:"a6",
   desc:"Noir bernuansa amber dengan eksekusi berbasis referensi, narasi Gemini Puck, dan finishing khusus. Rute terpisah dari kontrak A1–A5."},
  {code:"B1",name:"Seni Garis Minimalis",tag:"Minimal Handdrawn",mode:"B",sel:false,media:"b1",
   desc:"Ilustrasi hand-drawn minimalis dengan narasi, subtitle semantik, micro-animation, dan SFX. Default: narasi Inggris, suara Bodi (Gemini)."},
  {code:"B2",name:"Hand-Drawn Berwarna",tag:"Colorful Hand-Drawn",mode:"B",sel:false,media:"b2",
   desc:"Ilustrasi crayon penuh warna yang ceria untuk konten lifestyle, cuaca, dan cerita sehari-hari. Tetap dengan subtitle dan narasi otomatis."},
  {code:"B3",name:"TV Retro",tag:"Retro Television",mode:"B",sel:false,media:"b3",
   desc:"Tampilan televisi retro dengan grafik khas jadul, sinyal malam, dan suasana nostalgia. Lengkap dengan narasi, subtitle, dan SFX."},
  {code:"B4",name:"Thriller Bertahan Hidup",tag:"Survival Thriller",mode:"B",sel:false,media:"b4",
   desc:"Cerita survival/thriller dengan eskalasi visual 3 detik pertama, sound design berlapis, dan reference-lock putih. Horor dipimpin cerita."}
];

let selected = "A1";
let ratio = "16:9";

function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}
function bsplit(b){const i=b.indexOf("]");return i<0?[b,""]:[b.slice(0,i+1),b.slice(i+1).trim()]}

function renderGallery(){
  const g=document.getElementById("gallery");
  g.innerHTML=STYLES.map((s,i)=>{
    const m=MEDIA[s.media];
    const play=s.media2?'<button class="cdny" data-m2="'+s.media2+'" style="margin-top:8px">▶ Lihat varian kedua ('+s.code+'B)</button>':"";
    return '<div class="card scard">'+
      '<div class="media" data-m="'+s.media+'">'+
        '<img alt="Contoh gaya '+s.code+' — '+esc(s.name)+'" src="data:image/'+(m.type==="gif"?"gif":"jpeg")+';base64,'+m.b64+'">'+
        (m.type==="poster"?'<span class="load">⏳ Memuat animasi dari CDN…</span><span style="position:absolute;left:10px;bottom:10px;background:rgba(12,10,9,.85);padding:2px 8px;border-radius:7px;font-size:10.5px;color:#d6d3d1"> klik ▶ untuk animasi</span>':"")+
        '<span class="code">'+s.code+'</span><span class="modebadge">Mode '+s.mode+'</span>'+
      '</div>'+
      '<div class="body"><h3>'+esc(s.name)+'</h3><p class="tg">'+esc(s.tag)+'</p><p class="ds">'+esc(s.desc)+'</p>'+
      '<div class="act">'+(s.sel
        ?'<button data-code="'+s.code+'" class="pick'+(s.code===selected?" sel":"")+'">'+(s.code===selected?"✓ Dipilih untuk Studio":"Pilih untuk Studio")+'</button>'
        :'<button disabled style="opacity:.55;cursor:not-allowed">Rute khusus — via percakapan</button>'+play)+'</div>'+
      '</div></div>';
  }).join("");

  g.querySelectorAll(".pick").forEach(b=>b.onclick=()=>{
    selected=b.dataset.code;
    document.getElementById("style").value=selected;
    renderGallery();
    document.getElementById("studio").scrollIntoView({behavior:"smooth"});
  });
  g.querySelectorAll(".media[data-m]").forEach(el=>{
    const m=MEDIA[el.dataset.m];
    if(m.type==="poster"){
      el.onclick=()=>{
        if(el.classList.contains("loading"))return;
        el.classList.add("loading");
        const img=new Image();
        img.onload=()=>{el.querySelectorAll("img")[0].src=m.cdn;el.classList.remove("loading");el.onclick=null;};
        img.onerror=()=>{el.classList.remove("loading");alert("Animasi dari CDN tidak dapat dimuat (offline?). Frame statis tetap ditampilkan.");};
        img.src=m.cdn;
      };
    }
  });
  g.querySelectorAll(".cdny").forEach(b=>b.onclick=()=>{
    const m2=MEDIA[b.dataset.m2];
    const card=b.closest(".scard");
    const media=card.querySelector(".media");
    const img=media.querySelector("img");
    media.classList.add("loading");
    const pre=new Image();
    pre.onload=()=>{img.src=m2.cdn;media.classList.remove("loading");b.remove();};
    pre.onerror=()=>{media.classList.remove("loading");alert("Varian dari CDN tidak dapat dimuat (offline?).");};
    pre.src=m2.cdn;
  });
}

function durHint(){const c=Math.round(+document.getElementById("dur").value/10);document.getElementById("hint").textContent=c+" klip × ±10 detik · narasi ±"+c*22+" kata"}
document.getElementById("dur").onchange=durHint;
document.getElementById("style").onchange=e=>{selected=e.target.value;renderGallery()};
document.getElementById("r169").onclick=()=>{ratio="16:9";document.getElementById("r169").classList.add("on");document.getElementById("r916").classList.remove("on")};
document.getElementById("r916").onclick=()=>{ratio="9:16";document.getElementById("r916").classList.add("on");document.getElementById("r169").classList.remove("on")};

function renderProposal(p){
  const el=document.getElementById("prop");
  el.style.display="block";
  document.getElementById("empty").style.display="none";
  el.innerHTML='<div class="head"><div class="row"><span class="tagA">Tahap A · Proposal</span><span class="tagM">'+p.style+' · '+p.ratio+' · '+p.duration+'s</span></div>'+
    '<h3>'+esc(p.proposal.title)+'</h3><p class="log">'+esc(p.proposal.logline)+'</p>'+
    '<div class="mic"><div>🎙️ <b>Suara:</b> '+esc(p.proposal.voiceProfile)+'</div><div>🎵 <b>BGM:</b> '+esc(p.proposal.bgm)+'</div></div></div>'+
    p.proposal.clips.map(c=>
      '<div class="clip"><div class="top"><span class="num">'+c.index+'</span><span class="stage">'+esc(c.stage)+'</span><span class="t">'+esc(c.time)+'</span></div>'+
      '<p class="en">'+esc(c.narrationEn)+'</p><p class="id">“'+esc(c.narrationId)+'”</p>'+
      '<div class="beats">'+c.beats.map(b=>{const s=bsplit(b);return "<div><span>"+esc(s[0])+"</span><span>"+esc(s[1])+"</span></div>"}).join("")+'</div>'+
      '<div class="devs">'+c.devices.map(d=>"<i>"+esc(d)+"</i>").join("")+'</div>'+
      '<p class="tr">📄 Transisi: '+esc(c.transition)+'</p></div>'
    ).join("")+
    '<div class="gate"><b>🛡 Gerbang persetujuan</b><p>Ini laporan Tahap A. Jika sudah cocok, lanjutkan di percakapan: <i>“Proposal ini disetujui, buat prompt video per klip (Tahap B).”</i> Ubah rasio, durasi, gaya, atau struktur berarti proposal disusun ulang.</p></div>';
  el.scrollIntoView({behavior:"smooth",block:"nearest"});
}

document.getElementById("go").onclick=()=>{
  const err=document.getElementById("err");
  const key=selected==="A3"?"A3":"A1";
  const preset=PROPOSALS[key];
  const btn=document.getElementById("go");
  btn.textContent="⏳ Menyusun proposal…";btn.disabled=true;err.style.display="none";
  setTimeout(()=>{
    btn.textContent="🪄 Hasilkan Proposal Sutradara";btn.disabled=false;
    const data=JSON.parse(JSON.stringify(preset));
    data.style=selected+" — "+(STYLES.find(s=>s.code===selected)||{}).name;
    data.ratio=ratio;
    data.duration=+document.getElementById("dur").value;
    renderProposal(data);
  },900);
};

renderGallery();
</script>
</body>
</html>"""

html = HTML.replace("__MEDIA__", MEDIA_JSON).replace("__PROPOSALS__", PROP_JSON)
with open(OUT, "w") as f:
    f.write(html)
print("OK", OUT, f"{os.path.getsize(OUT)/1024/1024:.1f} MB")

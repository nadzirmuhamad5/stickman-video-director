# Stickman Video Director

Ubah naskah apa pun menjadi video animasi stickman yang siap unggah — semuanya dari satu halaman web.

## Fitur

- **Dua mode langsung di web** — *Mode A · Director*: AI menyusun proposal sutradara (5 babak Heartbeat Engine), review, lalu produksi dengan ilustrasi AI per klip. *Mode B · Autopilot*: satu klik dari topik langsung jadi video animasi stickman (naskah + storyboard AI, stickman bergerak, props krayon, SFX).
- **Produksi 100% server-side** — pipeline berjalan sebagai job latar belakang di server. Tab browser boleh ditutup atau di-refresh; produksi tetap jalan dan bisa dilanjutkan (`Lanjutkan Produksi`) bila server sempat restart.
- **Riwayat Produksi persisten (SQLite/Prisma)** — setiap produksi tersimpan di database: judul, mode, gaya, durasi, hasil. Setelah refresh browser pun semua hasil bisa dibuka kembali dari daftar riwayat.
- **Generator ide konten viral** — pilih kategori (fakta unik, fakta sejarah, misteri, psikologi, sains, uang & bisnis, teknologi, lifestyle), sistem mencari tren terkini di internet (web search) lalu merangkum 6 ide: judul, hook pembuka 3 detik, alasan berpotensi viral, dan preview narasi.
- **Animasi canvas renderer (tanpa Ken Burns)** — klip dianimasikan lewat renderer canvas lokal (`@napi-rs/canvas` + FFmpeg): kamera drift halus, stroke/underline/panah yang menggambar sendiri, stickman dengan bobbing, kartu kata kunci, SFX sintesis — subtitle semantik terbakar otomatis.
- **Narasi berkualitas dengan Edge Neural TTS** — suara Indonesia asli (`id-ID-ArdiNeural`, `id-ID-GadisNeural`) dan Inggris (`en-US-GuyNeural`, `en-US-JennyNeural`, `en-GB-RyanNeural`), lengkap dengan pratinjau suara ("Dengar contoh") langsung dari halaman web. Suara ZAI bawaan tersedia sebagai cadangan.
- **API key Gemini diatur dari web & otomatis dipakai** — simpan/hapus kunci di panel Status tanpa restart; begitu tersimpan, SEMUA pembuatan naskah (proposal Director, skrip Autopilot, ide viral) otomatis memakai Gemini via endpoint OpenAI-compatible, dengan fallback ZAI bawaan. Kunci tidak pernah dikirim kembali mentah ke browser (hanya bentuk tersamarkan).
- **Render final siap unggah** — MP4 utuh + berkas `captions.srt` + poster untuk penyuntingan lanjutan.

## Menjalankan

```bash
npm install
npm run dev          # http://localhost:3000
```

Dependensi runtime di server:

- `ffmpeg` / `ffprobe` di `PATH`
- Python 3 + paket `edge-tts` untuk suara Edge Neural (mis. `pip install edge-tts`; diprobe otomatis dari `/home/z/.venv/bin/python3` atau `python3`)
- API key Gemini untuk pembuatan proposal (diatur dari panel Status di web)

## Struktur singkat

```
src/app/page.tsx                    Studio web (client) — Mode A & B, ide viral, riwayat
src/app/api/director/               Pembuatan proposal via Gemini/ZAI
src/app/api/autopilot/              Mode B: satu klik topic → video
src/app/api/ideas/                  Generator ide viral (web search + LLM)
src/app/api/productions/            Riwayat produksi (baca DB)
src/app/api/production/             start · clip · render · resume · status
src/lib/production.ts               Tipe, timeline, util FFmpeg
src/lib/production-runner.ts        Job latar belakang Mode A + lock berbasis PID
src/lib/autopilot-runner.ts         Job latar belakang Mode B
src/lib/canvas-project.ts           Builder project animasi canvas renderer
src/lib/gemini.ts                   Client LLM (Gemini utama, fallback ZAI)
src/lib/settings.ts                 Penyimpanan API key Gemini
src/lib/tts.ts / tts-voices.ts     Engine TTS (Edge Neural + ZAI)
scripts/render-autopilot.mjs        Wrapper renderer canvas (skill lokal)
prisma/schema.prisma                Model Production (SQLite)
```

## Lisensi

[MIT](./LICENSE)

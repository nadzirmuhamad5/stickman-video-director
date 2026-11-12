# Stickman Video Director

Ubah naskah apa pun menjadi video animasi stickman yang siap unggah — semuanya dari satu halaman web.

## Fitur

- **Director di web** — tulis topik, pilih gaya visual (A1–A5), rasio (16:9 / 9:16), dan durasi. Proposal storyboard (klip, narasi, beats) dibuat otomatis oleh AI dan bisa direvisi sebelum produksi.
- **Produksi 100% server-side** — ilustrasi AI per klip, narasi, dan render MP4 berjalan sebagai job latar belakang di server. Tab browser boleh ditutup atau di-refresh; produksi tetap jalan dan bisa dilanjutkan (`Lanjutkan Produksi`) bila server sempat restart.
- **Narasi berkualitas dengan Edge Neural TTS** — suara Indonesia asli (`id-ID-ArdiNeural`, `id-ID-GadisNeural`) dan Inggris (`en-US-GuyNeural`, `en-US-JennyNeural`, `en-GB-RyanNeural`), lengkap dengan pratinjau suara ("Dengar contoh") langsung dari halaman web. Suara ZAI bawaan tersedia sebagai cadangan.
- **API key Gemini diatur dari web** — simpan/hapus kunci di panel Status tanpa restart; tersimpan di `data/settings.json` (permission 0600) atau lewat env `GEMINI_API_KEY`. Kunci tidak pernah dikirim kembali mentah ke browser (hanya bentuk tersamarkan).
- **Render final siap unggah** — efek Ken Burns per klip, subtitle terbakar ke dalam video, campur audio, plus berkas `captions.srt` dan poster untuk penyuntingan lanjutan.

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
src/app/page.tsx                    Studio web (client)
src/app/api/director/               Pembuatan proposal via Gemini
src/app/api/production/             start · clip · render · resume · status
src/lib/production.ts               Tipe, timeline, caption, util FFmpeg
src/lib/production-runner.ts        Job latar belakang + lock berbasis PID
src/lib/tts.ts / tts-voices.ts      Engine TTS (Edge Neural + ZAI)
src/lib/settings.ts                 Penyimpanan API key Gemini
```

## Lisensi

[MIT](./LICENSE)

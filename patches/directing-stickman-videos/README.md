# Cadangan modifikasi skill directing-stickman-videos

Folder `/skills/` sengaja di-gitignore (skill ter-install lokal), tapi renderer
dimodifikasi untuk gaya A7 "Issei Kolase". Salin file di sini ke
`skills/directing-stickman-videos/` (path sama) bila skill di-install ulang.

Perubahan terhadap autopilot-render.mjs (flag proyek `collage: true`, dipakai
gaya A7 — lihat src/lib/canvas-project.ts):
1. Registrasi font bold `B1CaptionBold` (assets/fonts/Caption-Bold.ttf).
2. Latar B2 collage: kertas tua `#eae0ca` + serat kertas deterministik + tepi gelap.
3. Caption collage: KAPITAL, 700, 42px, putih `#f8f3e6` outline hitam 9px.
4. Layer teks collage memakai font `B1Caption` (bukan hand font).
5. `collage` ikut cache key per-shot.

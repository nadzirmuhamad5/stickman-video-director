export type StickmanStyle = {
  code: string;
  name: string;
  mode: "A" | "B";
  tagline: string;
  desc: string;
  previews: { src: string; label: string }[];
  selectable?: boolean;
};

export const STYLES: StickmanStyle[] = [
  {
    code: "A1",
    name: "Hitam Putih Klasik",
    mode: "A",
    tagline: "Klasik Minimalis",
    desc: "Garis hitam di atas putih, atau putih di atas hitam. Sedikit warna cerah hanya untuk menyorot inti ide. Cocok untuk sains, psikologi, dan analogi visual.",
    previews: [
      { src: "/previews/dark-theme-demo.gif", label: "A1.2 · Putih di latar hitam" },
      { src: "/previews/light-theme-demo.gif", label: "A1.1 · Hitam di latar putih" },
    ],
    selectable: true,
  },
  {
    code: "A2",
    name: "Zeke Topi Modern",
    mode: "A",
    tagline: "Studio Tech / Sinematik",
    desc: "Stickman berkupluk merah dan kaos kuning. Varian 2A: studio putih dengan UI holografik. Varian 2B: lokasi sinematik penuh warna.",
    previews: [
      { src: "/previews/style-2a-demo.gif", label: "A2A · Studio Tech" },
      { src: "/previews/style-2b-demo.gif", label: "A2B · Sinematik" },
    ],
    selectable: true,
  },
  {
    code: "A3",
    name: "Gua Prasejarah",
    mode: "A",
    tagline: "Komedi Gelap",
    desc: "Kepala putih ekspresif, tungkai stick hitam, kostum kulit hewan, setting earthy. Komedi gelap dengan setup → eskalasi → punchline ironis.",
    previews: [{ src: "/previews/style-3-community-fire.gif", label: "A3 · Api komunitas" }],
    selectable: true,
  },
  {
    code: "A4",
    name: "Cerita Menenangkan",
    mode: "A",
    tagline: "Cozy Storytelling",
    desc: "Kartun 2D penuh warna yang hangat dan menenangkan. Setiap segmen pindah ke lokasi cerita yang berbeda dengan perubahan shot sinematik.",
    previews: [{ src: "/previews/style-4-cozy-cafe.gif", label: "A4 · Kafe hangat" }],
    selectable: true,
  },
  {
    code: "A5",
    name: "Kartun Sejarah",
    mode: "A",
    tagline: "Historical Cartoon",
    desc: "Kepala putih berleher pendek, wajah ekspresif, pakaian periode, cel-shaded. Era bisa diganti: Jepang, Mesir, dan lainnya dengan tata gaya tetap.",
    previews: [{ src: "/previews/style-5-japan.gif", label: "A5 · Jepang" }],
    selectable: true,
  },
  {
    code: "A7",
    name: "Issei Kolase",
    mode: "A",
    tagline: "Dokumenter Kolase",
    desc: "Kolase dokumenter di atas kertas tua: potongan foto orang hitam-putih ber-outline putih yang fade in, anotasi tinta merah, caption kapital tebal. Intro mengikuti gaya Issei Nugroho — subjek utama muncul sebagai potongan yang di-highlight.",
    previews: [{ src: "/previews/style-7-issei-collage.png", label: "A7 · Kolase dokumenter" }],
    selectable: true,
  },
  {
    code: "A6",
    name: "Amber Noir",
    mode: "A",
    tagline: "Rute Khusus",
    desc: "Noir bernuansa amber dengan eksekusi berbasis referensi, narasi Gemini Puck, dan finishing khusus. Rute terpisah dari kontrak A1–A5.",
    previews: [{ src: "/previews/style-6-amber-noir-flow.gif", label: "A6 · Amber Noir" }],
  },
  {
    code: "B1",
    name: "Seni Garis Minimalis",
    mode: "B",
    tagline: "Minimal Handdrawn",
    desc: "Ilustrasi hand-drawn minimalis dengan narasi, subtitle semantik, micro-animation, dan SFX. Default: narasi Inggris, suara Bodi (Gemini).",
    previews: [{ src: "/previews/b1-minimal-handdrawn.gif", label: "B1 · Minimal" }],
  },
  {
    code: "B2",
    name: "Hand-Drawn Berwarna",
    mode: "B",
    tagline: "Colorful Hand-Drawn",
    desc: "Ilustrasi crayon penuh warna yang ceria untuk konten lifestyle, cuaca, dan cerita sehari-hari. Tetap dengan subtitle dan narasi otomatis.",
    previews: [{ src: "/previews/b2-colorful-phone-weather.gif", label: "B2 · Cuaca ponsel" }],
  },
  {
    code: "B3",
    name: "TV Retro",
    mode: "B",
    tagline: "Retro Television",
    desc: "Tampilan televisi retro dengan grafik khas jadul, sinyal malam, dan suasana nostalgia. Lengkap dengan narasi, subtitle, dan SFX.",
    previews: [{ src: "/previews/b3-tv-dog.gif", label: "B3 · Anjing TV" }],
  },
  {
    code: "B4",
    name: "Thriller Bertahan Hidup",
    mode: "B",
    tagline: "Survival Thriller",
    desc: "Cerita survival/thriller dengan eskalasi visual 3 detik pertama, sound design berlapis, dan reference-lock putih. Horor dipimpin cerita.",
    previews: [{ src: "/previews/b4-death-clock.gif", label: "B4 · Jam kematian" }],
  },
];

export const SELECTABLE_STYLES = STYLES.filter((s) => s.selectable);

export const DURATIONS = [
  { seconds: 30, clips: 4, label: "30 detik" },
  { seconds: 60, clips: 8, label: "60 detik" },
  { seconds: 90, clips: 11, label: "90 detik" },
  { seconds: 120, clips: 12, label: "2 menit" },
];

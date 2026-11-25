import type { NextConfig } from "next";

// NEXT_STATIC_EXPORT=1 → build frontend statis (output: "export") untuk deploy
// terpisah, mis. ke Vercel. Route API dipindah sementara oleh
// scripts/build-vercel-frontend.sh sehingga hasil build murni statis.
const staticExport = process.env.NEXT_STATIC_EXPORT === "1";

// CORS untuk API server produksi: dipakai frontend statis yang memanggil API
// lintas origin (lihat src/lib/cors.ts). Tidak ada cookie/auth — * aman.
const CORS_HEADERS = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Content-Type, Range" },
  { key: "Access-Control-Expose-Headers", value: "Content-Range, Accept-Ranges, Content-Length" },
];

const nextConfig: NextConfig = {
  output: staticExport ? "export" : "standalone",
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  ...(staticExport ? {} : { headers: async () => [{ source: "/api/:path*", headers: CORS_HEADERS }] }),
};

export default nextConfig;

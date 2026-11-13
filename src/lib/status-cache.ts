// Shared status cache so the Settings API can invalidate the /api/system/status
// payload immediately when the Gemini key changes.

let cachedAt = 0;
let cachedPayload: unknown = null;
const CACHE_TTL_MS = 60_000; // kedaluwarsa otomatis: status pulih sendiri (mis. edge-tts dipasang ulang setelah recycle)

export function getStatusCache(): { at: number; payload: unknown } | null {
  if (!cachedPayload) return null;
  if (Date.now() - cachedAt > CACHE_TTL_MS) return null;
  return { at: cachedAt, payload: cachedPayload };
}

export function setStatusCache(payload: unknown): void {
  cachedAt = Date.now();
  cachedPayload = payload;
}

export function clearStatusCache(): void {
  cachedPayload = null;
  cachedAt = 0;
}

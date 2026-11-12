// Shared status cache so the Settings API can invalidate the /api/system/status
// payload immediately when the Gemini key changes.

let cachedAt = 0;
let cachedPayload: unknown = null;

export function getStatusCache(): { at: number; payload: unknown } | null {
  return cachedPayload ? { at: cachedAt, payload: cachedPayload } : null;
}

export function setStatusCache(payload: unknown): void {
  cachedAt = Date.now();
  cachedPayload = payload;
}

export function clearStatusCache(): void {
  cachedPayload = null;
  cachedAt = 0;
}

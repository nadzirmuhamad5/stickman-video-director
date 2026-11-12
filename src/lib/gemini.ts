import ZAI from "z-ai-web-dev-sdk";
import { readGeminiKey } from "@/lib/settings";

// ---------------------------------------------------------------------------
// Unified LLM client for the web app.
//
// Priority: user's Gemini API key (set from the Status panel or env) — the
// OpenAI-compatible Google endpoint — with automatic fallback to the built-in
// ZAI chat when no key is configured or the call fails. Setting the key in the
// web therefore switches ALL text generation (proposals, autopilot scripts,
// viral ideas) to Gemini immediately, without a restart.
// ---------------------------------------------------------------------------

export type LlmResult = { content: string; engine: "gemini" | "zai" };

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

async function geminiChat(key: string, messages: ChatMsg[], timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: GEMINI_MODEL, messages, temperature: 0.8 }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) throw new Error("Gemini mengembalikan konten kosong");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function zaiChat(messages: ChatMsg[]): Promise<string> {
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    thinking: { type: "disabled" },
  });
  const content = completion.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new Error("Model tidak mengembalikan konten");
  return content;
}

export async function llmComplete(messages: ChatMsg[], opts: { timeoutMs?: number } = {}): Promise<LlmResult> {
  const stored = readGeminiKey();
  if (stored?.key) {
    try {
      const content = await geminiChat(stored.key, messages, opts.timeoutMs ?? 120_000);
      return { content, engine: "gemini" };
    } catch (err) {
      console.error(
        `[llm] Gemini gagal, fallback ke ZAI: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  const content = await zaiChat(messages);
  return { content, engine: "zai" };
}

/** Extract the first JSON object from a model reply (handles markdown fences). */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Tidak ada objek JSON di keluaran model");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

// ---------------------------------------------------------------------------
// Gemini image generation (B4 scene illustrations).
//
// Uses the native generateContent image endpoint so a drawing-style reference
// image can be attached (required by the B4 style lock). Returns the first
// inline image part, or null when no key is configured / every model fails.
// ---------------------------------------------------------------------------

const GEMINI_IMAGE_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_IMAGE_MODELS = [
  process.env.GEMINI_IMAGE_MODEL,
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
].filter(Boolean) as string[];

export type GeminiImageInput = {
  prompt: string;
  /** PNG/JPEG bytes of a drawing-style reference attached before the prompt. */
  refImage?: { bytes: Buffer; mime: string };
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:2";
  timeoutMs?: number;
};

export async function geminiImage(input: GeminiImageInput): Promise<Buffer | null> {
  const stored = readGeminiKey();
  if (!stored?.key) return null;
  const parts: Record<string, unknown>[] = [];
  if (input.refImage) {
    parts.push({ inline_data: { mime_type: input.refImage.mime, data: input.refImage.bytes.toString("base64") } });
  }
  parts.push({ text: input.prompt });

  let lastError = "unknown";
  for (const model of GEMINI_IMAGE_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 120_000);
    try {
      const res = await fetch(`${GEMINI_IMAGE_BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": stored.key },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            ...(input.aspectRatio ? { imageConfig: { aspectRatio: input.aspectRatio } } : {}),
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        // An unsupported imageConfig is retried without it; other errors fall
        // through to the next model in the list.
        if (res.status === 400 && input.aspectRatio && /imageConfig|aspect/i.test(text)) {
          const retry = await fetch(`${GEMINI_IMAGE_BASE}/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": stored.key },
            body: JSON.stringify({
              contents: [{ role: "user", parts }],
              generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
            }),
          });
          if (!retry.ok) throw new Error(`Gemini image HTTP ${retry.status}`);
          const okData = (await retry.json()) as GeminiImageResponse;
          const img = pickImage(okData);
          if (img) return img;
        }
        throw new Error(`Gemini image HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as GeminiImageResponse;
      const img = pickImage(data);
      if (img) return img;
      throw new Error("Gemini image tidak mengembalikan gambar");
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[gemini-image] ${model} gagal: ${lastError}`);
    } finally {
      clearTimeout(timer);
    }
  }
  console.error(`[gemini-image] semua model gagal: ${lastError}`);
  return null;
}

type GeminiImageResponse = {
  candidates?: {
    content?: { parts?: { inlineData?: { data?: string }; inline_data?: { data?: string } }[] };
  }[];
};

function pickImage(data: GeminiImageResponse): Buffer | null {
  for (const part of data.candidates?.[0]?.content?.parts ?? []) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) return Buffer.from(inline.data, "base64");
  }
  return null;
}

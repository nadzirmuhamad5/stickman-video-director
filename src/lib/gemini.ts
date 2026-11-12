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

import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { llmComplete, extractJson } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 180;
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Generator ide konten viral: web search (tren & fakta terkini per kategori)
// + LLM menyaring 6 ide paling potensial (judul, hook, alasan viral, opening).
// ---------------------------------------------------------------------------

export const IDEA_CATEGORIES = [
  { id: "fakta-unik", label: "Fakta Unik", queries: ["fun facts that sound fake but are true", "fakta unik viral 2026"] },
  { id: "fakta-sejarah", label: "Fakta Sejarah", queries: ["surprising historical facts ignored by textbooks", "fakta sejarah mengejutkan"] },
  { id: "misteri", label: "Misteri", queries: ["unsolved mysteries explained by science", "misteri dunia terpecahkan"] },
  { id: "psikologi", label: "Psikologi", queries: ["psychology tricks backed by research", "fakta psikologi menarik"] },
  { id: "sains", label: "Sains", queries: ["mind blowing science facts recent discoveries", "fakta sains terbaru menakjubkan"] },
  { id: "uang-bisnis", label: "Uang & Bisnis", queries: ["surprising business facts how money works", "fakta uang dan bisnis unik"] },
  { id: "teknologi", label: "Teknologi & AI", queries: ["AI technology facts people don't know", "fakta teknologi AI 2026"] },
  { id: "lifestyle", label: "Lifestyle & Tips", queries: ["life changing habits backed by science", "tips hidup viral fakta"] },
] as const;

type Idea = {
  title: string;
  hook: string;
  whyViral: string;
  opening: string;
};

type SearchItem = { name: string; snippet: string; host_name: string; url: string; date: string };

function coerceIdeas(data: unknown): Idea[] {
  const raw = (data as { ideas?: unknown }).ideas;
  if (!Array.isArray(raw)) throw new Error("Format ideas tidak sesuai");
  const ideas = raw.slice(0, 8).map((r) => {
    const d = r as Record<string, unknown>;
    return {
      title: typeof d.title === "string" ? d.title.trim().slice(0, 120) : "",
      hook: typeof d.hook === "string" ? d.hook.trim().slice(0, 200) : "",
      whyViral: typeof d.whyViral === "string" ? d.whyViral.trim().slice(0, 200) : "",
      opening: typeof d.opening === "string" ? d.opening.trim().slice(0, 300) : "",
    };
  }).filter((i) => i.title && i.hook);
  if (!ideas.length) throw new Error("Tidak ada ide valid dari model");
  return ideas;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  const categoryId = typeof body.category === "string" ? body.category : "fakta-unik";
  const category = IDEA_CATEGORIES.find((c) => c.id === categoryId) ?? IDEA_CATEGORIES[0];

  try {
    // 1) Riset tren via web search (2 kueri paralel).
    const zai = await ZAI.create();
    const searchResults = await Promise.all(
      category.queries.map(async (q) => {
        try {
          return await zai.functions.invoke("web_search", { query: q, num: 6 });
        } catch (err) {
          console.error(`[ideas] web_search '${q}' gagal:`, err instanceof Error ? err.message : err);
          return [] as SearchItem[];
        }
      })
    );
    const items: SearchItem[] = searchResults.flat().slice(0, 12);
    const context = items
      .map((r, i) => `${i + 1}. [${r.host_name}${r.date ? ` · ${r.date}` : ""}] ${r.name} — ${String(r.snippet ?? "").slice(0, 220)}`)
      .join("\n");

    // 2) LLM menyusun ide viral dari hasil riset.
    const system = `You are a viral content strategist for short-form stickman explainer videos (TikTok/Reels/Shorts).
Based on the RESEARCH CONTEXT (recent web results), propose exactly 6 video ideas for the requested category.

Rules:
1. Every idea must be grounded in or inspired by the research context — no invented statistics, quotes or claims.
2. title: punchy clickable title, max 12 words, in Indonesian.
3. hook: the counter-intuitive opening line spoken in the first 3 seconds, max 20 words, Indonesian.
4. whyViral: one short reason why this would perform (curiosity gap, taboo, debate, payoff), Indonesian.
5. opening: 2-3 sentence narration preview the creator could read first, Indonesian.
6. JSON SAFETY: never use the double-quote character (") inside string values — use single quotes '.

Respond with ONLY valid JSON: {"ideas": [{"title": string, "hook": string, "whyViral": string, "opening": string}]}`;

    const user = `Kategori: ${category.label}\n\nRESEARCH CONTEXT (hasil pencarian web terbaru):\n${context || "(pencarian tidak tersedia — gunakan pengetahuan umum yang terverifikasi)"}\n\nBuat 6 ide video stickman untuk kategori ini.`;

    let lastError = "unknown";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { content, engine } = await llmComplete([
          { role: "system", content: system },
          { role: "user", content: user },
        ]);
        const ideas = coerceIdeas(extractJson(content));
        return NextResponse.json({
          category: category.id,
          sources: items.slice(0, 8).map((r) => ({ name: r.name, url: r.url, host: r.host_name })),
          ideas,
          engine,
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`[ideas] attempt ${attempt}/3 gagal: ${lastError}`);
        await new Promise((r) => setTimeout(r, 700 * attempt));
      }
    }
    return NextResponse.json(
      { error: `Gagal menghasilkan ide setelah 3 percobaan (${lastError}).` },
      { status: 502 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal menghasilkan ide.";
    return NextResponse.json({ error: `Gagal menghasilkan ide: ${message}` }, { status: 500 });
  }
}

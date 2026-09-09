import { translateApiUrl, type TranslateRequest } from "@/lib/prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function isTranslateRequest(value: unknown): value is TranslateRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.text === "string" &&
    typeof body.sourceLang === "string" &&
    typeof body.targetLang === "string"
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  if (!isTranslateRequest(body)) {
    return Response.json({ error: "缺少 text / 语言字段。" }, { status: 400 });
  }

  const url = translateApiUrl();
  let upstream: Response;
  try {
    upstream = await fetch(`${url}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: request.signal,
      body: JSON.stringify({
        text: body.text,
        sourceLang: body.sourceLang,
        targetLang: body.targetLang,
        glossary: body.glossary ?? [],
      }),
    });
  } catch {
    return Response.json(
      { error: "连不上本地翻译 API。先运行 scripts/start-api.sh。" },
      { status: 503 },
    );
  }

  const payload = (await upstream.json().catch(() => null)) as
    | { text?: string; detail?: string }
    | null;
  if (!upstream.ok) {
    return Response.json(
      { error: payload?.detail || `翻译失败（${upstream.status}）` },
      { status: 502 },
    );
  }

  const text = payload?.text ?? "";
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const chunk = {
        choices: [{ delta: { content: text } }],
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

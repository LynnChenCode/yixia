import { translateApiUrl } from "@/lib/prompts";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = translateApiUrl();
  try {
    const response = await fetch(`${url}/health`, { cache: "no-store" });
    const payload = (await response.json()) as {
      ok?: boolean;
      status?: string;
      model?: string;
      error?: string;
      rss_mb?: number;
    };
    if (!payload.ok && payload.status !== "ok") {
      return Response.json(
        { ok: false, url, error: payload.error || "翻译服务未就绪。" },
        { status: 503 },
      );
    }
    return Response.json({
      ok: true,
      url,
      model: payload.model || "OPUS-MT 中英",
      rss_mb: payload.rss_mb,
    });
  } catch {
    return Response.json(
      {
        ok: false,
        url,
        error: "连不上本地翻译 API。先运行 scripts/start-api.sh 或 start-api.ps1。",
      },
      { status: 503 },
    );
  }
}

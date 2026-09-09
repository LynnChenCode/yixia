"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  BookMarked,
  Check,
  Copy,
  Eraser,
  History,
  Loader2,
  Square,
  WifiOff,
  Zap,
} from "lucide-react";
import { EXAMPLES } from "@/lib/examples";
import { languageName } from "@/lib/languages";
import type { GlossaryEntry } from "@/lib/prompts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { LanguageSelect } from "@/components/language-select";

type Health = {
  ok: boolean;
  url?: string;
  model?: string;
  error?: string;
  rss_mb?: number;
};

type HistoryItem = {
  id: string;
  sourceLang: string;
  targetLang: string;
  source: string;
  target: string;
  at: number;
};

const HISTORY_KEY = "yixia-history";

function parseSseDelta(chunk: string) {
  let output = "";
  for (const rawLine of chunk.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const json = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };
      const piece = json.choices?.[0]?.delta?.content;
      if (piece) output += piece;
    } catch {
      // Incomplete JSON frames are ignored; the next chunk completes them.
    }
  }
  return output;
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function Translator() {
  const [sourceLang, setSourceLang] = useState("zh");
  const [targetLang, setTargetLang] = useState("en");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [useGlossary, setUseGlossary] = useState(false);
  const [style, setStyle] = useState("");
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([
    { source: "", target: "" },
  ]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const pollHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const payload = (await response.json()) as Health;
      setHealth(payload);
    } catch {
      setHealth({ ok: false, error: "无法检查模型状态。" });
    }
  }, []);

  useEffect(() => {
    const kickoff = window.setTimeout(() => {
      void pollHealth();
    }, 0);
    const timer = window.setInterval(() => void pollHealth(), 8000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  }, [pollHealth]);

  const persistHistory = useCallback((item: HistoryItem) => {
    const current = loadHistory();
    const next = [
      item,
      ...current.filter(
        (entry) => entry.source !== item.source || entry.targetLang !== item.targetLang,
      ),
    ].slice(0, 20);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    setHistory(next);
  }, []);

  const showHistory = () => {
    setHistory(loadHistory());
  };

  const translate = useCallback(async () => {
    const text = source.trim();
    if (!text) {
      setError("请先输入要翻译的内容。");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setTarget("");
    setCopied(false);

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          sourceLang,
          targetLang,
          style: useGlossary ? "" : style,
          glossary: useGlossary ? glossary : [],
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || `翻译失败（${response.status}）`);
      }
      if (!response.body) throw new Error("模型没有返回内容。");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let leftover = "";
      let output = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        leftover += decoder.decode(value, { stream: true });
        const lastNewline = leftover.lastIndexOf("\n");
        if (lastNewline === -1) continue;
        const complete = leftover.slice(0, lastNewline + 1);
        leftover = leftover.slice(lastNewline + 1);
        output += parseSseDelta(complete);
        setTarget(output);
      }
      output += parseSseDelta(leftover);
      const finalText = output.trim();
      setTarget(finalText);
      if (finalText) {
        persistHistory({
          id: crypto.randomUUID(),
          sourceLang,
          targetLang,
          source: text,
          target: finalText,
          at: Date.now(),
        });
      } else {
        setError("模型没有给出译文。可以换一句再试。");
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "翻译失败。");
    } finally {
      setBusy(false);
    }
  }, [glossary, persistHistory, source, sourceLang, style, targetLang, useGlossary]);

  const swap = () => {
    setSourceLang(targetLang === "auto" ? "zh" : targetLang);
    setTargetLang(sourceLang === "auto" ? "en" : sourceLang);
    setSource(target);
    setTarget(source);
  };

  const copyTarget = async () => {
    if (!target) return;
    await navigator.clipboard.writeText(target);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const readyLabel = useMemo(() => {
    if (!health) return "正在连接本地模型…";
    if (health.ok) {
      const memory =
        typeof health.rss_mb === "number" ? ` · ${health.rss_mb} MB` : "";
      return `${health.model ?? "本地模型已就绪"}${memory}`;
    }
    return "模型未启动";
  }, [health]);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="seal" aria-hidden>
              译
            </div>
            <div>
              <p className="font-heading text-lg tracking-wide text-foreground">译匣</p>
              <p className="text-xs text-muted-foreground">
                本地离线翻译 · 中英互译，约 400 MB
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={health?.ok ? "secondary" : "destructive"} className="gap-1.5">
              {health?.ok ? <Zap className="size-3" /> : <WifiOff className="size-3" />}
              {readyLabel}
            </Badge>
            <Sheet onOpenChange={(open) => { if (open) showHistory(); }}>
              <SheetTrigger render={<Button variant="outline" size="sm" />}>
                <History className="size-4" />
                记录
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>最近译文</SheetTitle>
                  <SheetDescription>只存在这台浏览器里，不会上传。</SheetDescription>
                </SheetHeader>
                <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-6">
                  {history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">还没有翻译记录。</p>
                  ) : (
                    history.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="rounded-xl border border-border/80 bg-card p-3 text-left transition-colors hover:bg-accent"
                        onClick={() => {
                          setSourceLang(item.sourceLang);
                          setTargetLang(item.targetLang);
                          setSource(item.source);
                          setTarget(item.target);
                        }}
                      >
                        <p className="mb-1 text-[11px] text-muted-foreground">
                          {languageName(item.sourceLang)} → {languageName(item.targetLang)}
                        </p>
                        <p className="line-clamp-2 text-sm">{item.source}</p>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {item.target}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6">
        {health && !health.ok ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {health.error || "本地模型还没起来。"}
            <span className="mt-1 block text-destructive/80">
              先运行 <code>scripts/start-api.ps1</code> 或 <code>scripts/start-api.sh</code>
            </span>
          </div>
        ) : null}

        <section className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/40 p-3 sm:flex-row sm:items-center sm:px-4">
          <LanguageSelect
            id="source-lang"
            value={sourceLang}
            onChange={setSourceLang}
            includeAuto
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="交换语言"
            onClick={swap}
            className="self-center"
          >
            <ArrowLeftRight className="size-4" />
          </Button>
          <LanguageSelect id="target-lang" value={targetLang} onChange={setTargetLang} />
          <div className="hidden flex-1 sm:block" />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <BookMarked className="size-4" />
            术语表
            <Switch
              checked={useGlossary}
              onCheckedChange={(checked) => setUseGlossary(Boolean(checked))}
            />
          </label>
        </section>

        {useGlossary ? (
          <section className="rounded-2xl border border-border/70 bg-card/50 p-4">
            <p className="mb-3 text-sm text-muted-foreground">
              固定译名会在译文里做替换，适合产品名、人名、接口字段。
            </p>
            <div className="flex flex-col gap-2">
              {glossary.map((entry, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Input
                    placeholder="原文术语"
                    value={entry.source}
                    onChange={(event) => {
                      const next = [...glossary];
                      next[index] = { ...entry, source: event.target.value };
                      setGlossary(next);
                    }}
                  />
                  <Input
                    placeholder="固定译法"
                    value={entry.target}
                    onChange={(event) => {
                      const next = [...glossary];
                      next[index] = { ...entry, target: event.target.value };
                      setGlossary(next);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setGlossary((current) => current.filter((_, i) => i !== index))}
                  >
                    删除
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => setGlossary((current) => [...current, { source: "", target: "" }])}
              >
                添加术语
              </Button>
            </div>
          </section>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={style}
              onChange={(event) => setStyle(event.target.value)}
              placeholder="可选：指定文风，例如「商务邮件」「口语」「字幕简短」"
            />
          </div>
        )}

        <section className="grid flex-1 gap-4 lg:grid-cols-2">
          <article className="flex min-h-72 flex-col rounded-3xl border border-border/80 bg-card shadow-[0_20px_60px_-40px_rgba(0,0,0,0.6)]">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <p className="text-sm font-medium">原文</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSource("");
                  setTarget("");
                  setError(null);
                }}
              >
                <Eraser className="size-4" />
                清空
              </Button>
            </div>
            <Textarea
              value={source}
              onChange={(event) => setSource(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void translate();
                }
              }}
              placeholder="输入要翻译的文字。Ctrl / ⌘ + Enter 开始翻译。"
              className="min-h-56 flex-1 resize-none rounded-none border-0 bg-transparent px-4 py-3 text-base leading-7 shadow-none focus-visible:ring-0 md:text-base dark:bg-transparent"
            />
            <div className="flex flex-wrap gap-2 border-t border-border/60 px-4 py-3">
              {EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  className="rounded-full border border-border/80 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  onClick={() => {
                    setSourceLang(example.sourceLang);
                    setTargetLang(example.targetLang);
                    setSource(example.text);
                    setTarget("");
                    setError(null);
                  }}
                >
                  {example.label}
                </button>
              ))}
              <span className="ml-auto text-xs text-muted-foreground">{source.length} 字</span>
            </div>
          </article>

          <article className="flex min-h-72 flex-col rounded-3xl border border-border/80 bg-[color-mix(in_oklch,var(--card)_88%,var(--primary)_6%)] shadow-[0_20px_60px_-40px_rgba(0,0,0,0.6)]">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <p className="text-sm font-medium">译文</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => void copyTarget()} disabled={!target}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
            <div className="min-h-56 flex-1 px-4 py-3 text-base leading-7 whitespace-pre-wrap">
              {target ? (
                target
              ) : busy ? (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  正在本地解码…
                </span>
              ) : (
                <span className="text-muted-foreground">译文会出现在这里。数据不会离开这台机器。</span>
              )}
              {busy && target ? <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary" /> : null}
            </div>
            {error ? (
              <p className="border-t border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</p>
            ) : null}
          </article>
        </section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-xs leading-5 text-muted-foreground">
            插件把 API 填成 <code>http://127.0.0.1:18790/v1</code>，模型名 <code>yixia</code>，密钥任意。只做中英互译，目标语言选中文或英语。
          </p>
          <div className="flex gap-2">
            {busy ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => abortRef.current?.abort()}
              >
                <Square className="size-4" />
                停止
              </Button>
            ) : null}
            <Button type="button" size="lg" onClick={() => void translate()} disabled={busy || !health?.ok}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
              翻译
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

import { languageName } from "./languages";

export type GlossaryEntry = {
  source: string;
  target: string;
};

export type TranslateRequest = {
  text: string;
  sourceLang: string;
  targetLang: string;
  glossary: GlossaryEntry[];
  style: string;
};

export function buildTranslatePrompt(input: TranslateRequest) {
  const target = languageName(input.targetLang, "zh");
  const source = input.sourceLang === "auto" ? "" : languageName(input.sourceLang, "zh");
  const sourceText = input.text.trim();
  const glossary = input.glossary.filter(
    (entry) => entry.source.trim() && entry.target.trim(),
  );
  const style = input.style.trim();

  if (glossary.length > 0) {
    const terms = glossary
      .map((entry) => `${entry.source.trim()}翻译成${entry.target.trim()}`)
      .join("\n");
    return `参考下面的翻译：\n${terms}\n将以下${source ? source : ""}文本翻译为${target}，注意只需要输出翻译后的结果，不要额外解释：${sourceText}`;
  }

  if (style) {
    return `请将以下${source ? source : ""}文本翻译为${target}。注意翻译的风格要严格符合【${style}】\n${sourceText}`;
  }

  return `将以下${source ? source : ""}文本翻译为${target}，注意只需要输出翻译后的结果，不要额外解释：${sourceText}`;
}

export function translateApiUrl() {
  return process.env.TRANSLATE_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:18790";
}

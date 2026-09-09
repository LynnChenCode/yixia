export type Language = {
  code: string;
  en: string;
  zh: string;
};

export const LANGUAGES: Language[] = [
  { code: "zh", en: "Chinese", zh: "中文" },
  { code: "en", en: "English", zh: "英语" },
];

export const LANGUAGE_BY_CODE = Object.fromEntries(
  LANGUAGES.map((language) => [language.code, language]),
) as Record<string, Language>;

export function languageName(code: string, locale: "zh" | "en" = "zh") {
  if (code === "auto") return locale === "zh" ? "自动检测" : "Auto detect";
  return LANGUAGE_BY_CODE[code]?.[locale] ?? code;
}

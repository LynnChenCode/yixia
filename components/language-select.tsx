"use client";

import { LANGUAGES, languageName } from "@/lib/languages";
import { cn } from "@/lib/utils";

type LanguageSelectProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  includeAuto?: boolean;
  className?: string;
};

export function LanguageSelect({
  id,
  value,
  onChange,
  includeAuto = false,
  className,
}: LanguageSelectProps) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-9 min-w-40 flex-1 appearance-none rounded-lg border border-border/80 bg-card/70 px-3 pr-8 text-sm text-foreground outline-none transition-colors",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23c4b8a8' stroke-width='2'><path d='m6 9 6 6 6-6'/></svg>\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 0.6rem center",
      }}
    >
      {includeAuto ? (
        <option value="auto">{languageName("auto", "zh")}</option>
      ) : null}
      {LANGUAGES.map((language) => (
        <option key={language.code} value={language.code}>
          {language.zh} · {language.en}
        </option>
      ))}
    </select>
  );
}

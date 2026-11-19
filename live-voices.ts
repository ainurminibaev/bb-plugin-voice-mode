export const LIVE_VOICES = ["cove", "juniper", "arbor", "breeze", "ember", "maple", "sol", "spruce", "vale"] as const;

export const REALTIME_VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"] as const;
export const LANGUAGES = {
  auto: "Авто · по речи", ru: "Русский", en: "English", uk: "Українська", de: "Deutsch",
  fr: "Français", es: "Español", it: "Italiano", pt: "Português", tr: "Türkçe",
  ja: "日本語", ko: "한국어", zh: "中文",
} as const;
export type SpeechLanguage = keyof typeof LANGUAGES;

export function speechLanguage(value: unknown): SpeechLanguage {
  return typeof value === "string" && Object.hasOwn(LANGUAGES, value) ? value as SpeechLanguage : "ru";
}

export function languageInstruction(language: SpeechLanguage): string {
  return language === "auto"
    ? "Reply in the language the caller is speaking. Follow the caller when they switch languages."
    : `Speak ${LANGUAGES[language]} for all spoken replies, including greetings and thread results. Translate supplied text as needed.`;
}

export const LIVE_VOICES = ["cove", "juniper", "arbor", "breeze", "ember", "maple", "sol", "spruce", "vale"] as const;

// Measured on gpt-live-1.1-codex (median pitch of the same Russian phrase):
// the backend honours every voice, but four of them sit at the same low pitch
// and are easy to mistake for one another.
export const LIVE_VOICE_PITCH: Record<(typeof LIVE_VOICES)[number], "низкий" | "средний" | "высокий"> = {
  cove: "низкий", arbor: "низкий", ember: "низкий", spruce: "низкий",
  sol: "средний", breeze: "средний", vale: "средний",
  maple: "высокий", juniper: "высокий",
};

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

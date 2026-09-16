import type { LanguageTag } from "../types.js"

/**
 * Languages opennib offers in the picker.
 *
 * `auto` is the default and lets Whisper detect — that's what most casual
 * users want. The named entries are a curated subset of the languages
 * whisper.cpp accepts (full list at github.com/openai/whisper); we expose
 * the ones our base/multilingual models handle reasonably well so the
 * picker isn't a wall of 99 options nobody scrolls through.
 *
 * Native names appear in the user's chosen language so they're recognizable
 * even when the OS UI is in a different language.
 */
export interface SupportedLanguage {
  readonly tag: LanguageTag
  readonly displayName: string
  readonly nativeName: string
}

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  { tag: "auto", displayName: "Auto-detect", nativeName: "Auto-detect" },
  { tag: "en", displayName: "English", nativeName: "English" },
  { tag: "es", displayName: "Spanish", nativeName: "Español" },
  { tag: "fr", displayName: "French", nativeName: "Français" },
  { tag: "de", displayName: "German", nativeName: "Deutsch" },
  { tag: "it", displayName: "Italian", nativeName: "Italiano" },
  { tag: "pt", displayName: "Portuguese", nativeName: "Português" },
  { tag: "nl", displayName: "Dutch", nativeName: "Nederlands" },
  { tag: "pl", displayName: "Polish", nativeName: "Polski" },
  { tag: "ru", displayName: "Russian", nativeName: "Русский" },
  { tag: "ja", displayName: "Japanese", nativeName: "日本語" },
  { tag: "ko", displayName: "Korean", nativeName: "한국어" },
  { tag: "zh", displayName: "Chinese", nativeName: "中文" },
  { tag: "ar", displayName: "Arabic", nativeName: "العربية" },
  { tag: "hi", displayName: "Hindi", nativeName: "हिन्दी" },
  { tag: "vi", displayName: "Vietnamese", nativeName: "Tiếng Việt" },
  { tag: "tr", displayName: "Turkish", nativeName: "Türkçe" },
  { tag: "uk", displayName: "Ukrainian", nativeName: "Українська" },
]

export function isSupportedLanguage(tag: string): boolean {
  return SUPPORTED_LANGUAGES.some((l) => l.tag === tag)
}

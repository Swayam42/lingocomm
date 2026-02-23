import { LingoDotDevEngine } from "lingo.dev/sdk";

const lingo = new LingoDotDevEngine({
  apiKey: process.env.LINGODOTDEV_API_KEY,
});

export const LANG_NAMES = {
  en: "English", ja: "Japanese", hi: "Hindi", or: "Odia",
  zh: "Chinese", ko: "Korean", ar: "Arabic",
  pt: "Portuguese", es: "Spanish", fr: "French",
  de: "German", ru: "Russian", it: "Italian",
  tr: "Turkish", pl: "Polish", nl: "Dutch",
  vi: "Vietnamese", th: "Thai", id: "Indonesian",
  uk: "Ukrainian", sv: "Swedish", bn: "Bengali",
  ta: "Tamil", te: "Telugu", mr: "Marathi",
  "pt-br": "Portuguese (Brazil)",
  "zh-cn": "Chinese (Simplified)",
};

export const LANG_FLAGS = {
  en: "🇬🇧", ja: "🇯🇵", hi: "🇮🇳", or: "🇮🇳",
  zh: "🇨🇳", ko: "🇰🇷", ar: "🇸🇦",
  pt: "🇵🇹", es: "🇪🇸", fr: "🇫🇷",
  de: "🇩🇪", ru: "🇷🇺", it: "🇮🇹",
  tr: "🇹🇷", pl: "🇵🇱", nl: "🇳🇱",
  vi: "🇻🇳", th: "🇹🇭", id: "🇮🇩",
  uk: "🇺🇦", sv: "🇸🇪", bn: "🇮🇳",
  ta: "🇮🇳", te: "🇮🇳", mr: "🇮🇳",
  "pt-br": "🇧🇷",
  "zh-cn": "🇨🇳",
};

export const flagOf = (l) => LANG_FLAGS[l?.toLowerCase()] || "🌐";
export const nameOf = (l) => LANG_NAMES[l?.toLowerCase()] || (l || "Unknown").toUpperCase();

function detectByUnicodeScript(text) {
  if (!text) return null;

  if (/[\u3040-\u30FF]/u.test(text)) return "ja";
  if (/[\uAC00-\uD7AF]/u.test(text)) return "ko";
  if (/[\u0600-\u06FF]/u.test(text)) return "ar";
  if (/[\u0400-\u04FF]/u.test(text)) return "ru";
  if (/[\u0B00-\u0B7F]/u.test(text)) return "or";
  if (/[\u0900-\u097F]/u.test(text)) return "hi";
  if (/[\u0980-\u09FF]/u.test(text)) return "bn";
  if (/[\u0B80-\u0BFF]/u.test(text)) return "ta";
  if (/[\u0C00-\u0C7F]/u.test(text)) return "te";
  if (/[\u4E00-\u9FFF]/u.test(text)) return "zh";

  return null;
}

function detectByKeyword(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  const hinglishMarkers = [
    "namaste", "kaise", "kya", "kyu", "kyun", "hain", "hai", "nahi", "nahin",
    "mera", "meri", "mere", "tum", "tumhara", "aap", "apka", "apki", "hum",
    "mujhe", "mujh", "tera", "teri", "hamara", "acha", "accha", "theek", "thik",
    "bahut", "bohot", "yaar", "bhai", "behen", "karna", "krna", "kar", "karo",
    "mat", "chalo", "jaldi", "kal", "aaj", "abhi", "fir", "phir", "samjha", "samjho"
  ];

  const hinglishScore = hinglishMarkers.reduce(
    (acc, word) => (new RegExp(`\\b${word}\\b`, "i").test(lower) ? acc + 1 : acc),
    0
  );

  if (hinglishScore >= 2) return "hi";

  const keywordSets = {
    es: ["hola", "gracias", "buenos", "buenas", "cómo", "usted", "por favor"],
    fr: ["bonjour", "merci", "s'il", "vous", "être", "avec"],
    de: ["hallo", "danke", "bitte", "nicht", "ich", "und"],
    pt: ["olá", "obrigado", "obrigada", "você", "como", "não"],
    it: ["ciao", "grazie", "per favore", "come stai"],
    tr: ["merhaba", "teşekkür", "nasılsın", "lütfen"],
    id: ["halo", "terima", "kasih", "bagaimana", "anda"],
    vi: ["xin chào", "cảm ơn", "bạn", "không"],
  };

  for (const [locale, words] of Object.entries(keywordSets)) {
    const score = words.reduce((acc, word) => (lower.includes(word) ? acc + 1 : acc), 0);
    if (score >= 2) return locale;
  }

  return null;
}

/**
 * Detect the language of a text string.
 * Uses lingo.dev recognizeLocale with a fresh timeout each time.
 * @param {string} text
 * @param {string} fallbackHint - returned if detection fails/times out
 */
export async function detectLanguage(text, fallbackHint = "en") {
  const fallback = (fallbackHint || "en").toLowerCase();
  const trimmed = String(text || "").trim();
  if (!trimmed) return fallback;

  const byScript = detectByUnicodeScript(trimmed);
  if (byScript && LANG_NAMES[byScript]) return byScript;

  const byKeyword = detectByKeyword(trimmed);
  if (byKeyword && LANG_NAMES[byKeyword]) return byKeyword;

  return LANG_NAMES[fallback] ? fallback : "en";
}

/**
 * THE CORE: Translate one message into MULTIPLE languages simultaneously.
 * Uses batchLocalizeText first (fastest), falls back to parallel localizeText.
 * IMPORTANT: always pass an explicit sourceLocale — null hangs in this SDK version.
 *
 * @param {string} text          - Original message
 * @param {string} sourceLocale  - Source locale (e.g. "en"). Never pass null.
 * @param {string[]} targetLocales - Array of target locales e.g. ["ja","hi","es"]
 * @returns {Promise<Object>}    - { "ja": "...", "hi": "...", "es": "..." }
 */
export async function translateToMany(text, sourceLocale, targetLocales) {
  if (!targetLocales || targetLocales.length === 0) return {};

  const src = sourceLocale || "en"; // always explicit — null hangs
  const filtered = targetLocales.filter((l) => l !== src);
  if (filtered.length === 0) return {};

  console.log(`[Lingo.dev] Translating "${text.substring(0, 40)}" (${src}) → [${filtered.join(", ")}]`);

  // ── Attempt 1: batch (single API call, fastest) ───────────────────────
  try {
    const batchResult = await Promise.race([
      lingo.batchLocalizeText(text, {
        sourceLocale: src,
        targetLocales: filtered,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("batch timeout")), 15000)
      ),
    ]);

    if (Array.isArray(batchResult) && batchResult.length === filtered.length) {
      const results = {};
      filtered.forEach((locale, i) => {
        results[locale] = batchResult[i] || text;
        console.log(`[Lingo.dev] ✓ ${locale}: "${String(batchResult[i]).substring(0, 40)}"`);
      });
      return results;
    }
    console.warn(`[Lingo.dev] Batch returned unexpected format, falling back`);
  } catch (err) {
    console.warn(`[Lingo.dev] Batch failed (${err.message}), falling back to parallel`);
  }

  // ── Attempt 2: parallel individual localizeText calls ────────────────
  const settled = await Promise.allSettled(
    filtered.map((targetLocale) =>
      Promise.race([
        lingo.localizeText(text, { sourceLocale: src, targetLocale }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 10000)
        ),
      ])
    )
  );

  const results = {};
  filtered.forEach((locale, index) => {
    const r = settled[index];
    if (r.status === "fulfilled" && r.value) {
      results[locale] = r.value;
      console.log(`[Lingo.dev] ${locale}: "${String(r.value).substring(0, 40)}"`);
    } else {
      console.error(`[Lingo.dev] ${locale}: ${r.reason?.message}`);
      results[locale] = text;
    }
  });
  return results;
}

/**
 * Translate a single string to one target language.
 * Used for bot UI messages (/help text, welcome messages etc.)
 */
export async function translateOne(text, sourceLocale, targetLocale) {
  if (sourceLocale === targetLocale) return text;
  try {
    return await lingo.localizeText(text, { sourceLocale, targetLocale });
  } catch {
    return text;
  }
}

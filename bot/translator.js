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

/**
 * Detect the language of a message.
 * Returns ISO locale code. Falls back to "en" on failure.
 */
export async function detectLanguage(text) {
  try {
    if (!text || text.trim().length < 3) return "en";
    
    console.log(`[Lingo.dev] Detecting language for: "${text.substring(0, 30)}..."`);
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Language detection timeout')), 5000)
    );
    
    const detectionPromise = lingo.recognizeLocale(text);
    
    const locale = await Promise.race([detectionPromise, timeoutPromise]);
    console.log(`[Lingo.dev] Detected language: ${locale || "en"}`);
    return locale || "en";
  } catch (err) {
    console.error(`[Lingo.dev] Language detection failed:`, err.message);
    return "en";
  }
}

/**
 * THE CORE: Translate one message into MULTIPLE languages simultaneously.
 * This is what makes LingoComm powerful — one API call, N translations.
 *
 * @param {string} text          - Original message
 * @param {string} sourceLocale  - Detected source language
 * @param {string[]} targetLocales - Array of target locales e.g. ["ja","hi","es","fr"]
 * @returns {Promise<Object>}    - { "ja": "...", "hi": "...", "es": "..." }
 */
export async function translateToMany(text, sourceLocale, targetLocales) {
  if (!targetLocales || targetLocales.length === 0) return {};

  // Remove source locale from targets (no need to translate to same language)
  const filtered = targetLocales.filter((l) => l !== sourceLocale);
  if (filtered.length === 0) return {};

  try {
    console.log(`[Lingo.dev] Translating "${text.substring(0, 30)}..." from ${sourceLocale} to [${filtered.join(", ")}]`);
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Translation timeout after 15s')), 15000)
    );
    
    // batchLocalizeText returns an ARRAY of strings in the same order as targetLocales
    const translationPromise = lingo.batchLocalizeText(text, {
      sourceLocale,
      targetLocales: filtered,
    });
    
    const translationsArray = await Promise.race([translationPromise, timeoutPromise]);
    
    // Convert array to object: { "ja": "translation", "hi": "translation" }
    const results = {};
    filtered.forEach((locale, index) => {
      results[locale] = translationsArray[index];
    });
    
    console.log(`[Lingo.dev] Translated to ${filtered.length} languages successfully`);
    return results;
  } catch (err) {
    console.error("[Lingo.dev] Batch translation failed:", err.message);
    console.error(err.stack);
    
    console.log("[Lingo.dev] Falling back to individual translations...");
    const results = {};
    
    for (const targetLocale of filtered) {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Translation timeout')), 10000)
        );
        
        const translationPromise = lingo.localizeText(text, {
          sourceLocale,
          targetLocale,
        });
        
        const translated = await Promise.race([translationPromise, timeoutPromise]);
        results[targetLocale] = translated;
        console.log(`[Lingo.dev] ${targetLocale}: Done`);
      } catch (fallbackErr) {
        console.error(`[Lingo.dev] Failed ${targetLocale}:`, fallbackErr.message);
        results[targetLocale] = text;
      }
    }
    
    return results;
  }
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

/**
 * Translate a chat history for the /summary command.
 * localizeChat() preserves speaker names beautifully.
 *
 * @param {Array<{name: string, text: string}>} messages
 * @param {string} targetLocale - User's preferred language
 */
export async function summarizeChat(messages, targetLocale) {
  try {
    const translated = await lingo.localizeChat(messages, {
      sourceLocale: "en",
      targetLocale,
    });
    return translated;
  } catch (err) {
    console.error("[Lingo.dev] localizeChat failed:", err.message);
    return messages;
  }
}
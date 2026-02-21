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

 * @param {string} 
 * @param {string} 
 */
export async function detectLanguage(text, fallbackHint = "en") {
  try {
    if (!text || text.trim().length < 3) return fallbackHint;
    
    console.log(`[Lingo.dev] Detecting language for: "${text.substring(0, 30)}..."`);

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Language detection timeout')), 5000)
    );
    
    const detectionPromise = lingo.localizeText(text, {
      sourceLocale: null, // Auto-detect
      targetLocale: "en",
      fast: true, // Prioritize speed for detection
    });
    
    const result = await Promise.race([detectionPromise, timeoutPromise]);
    const localePromise = lingo.recognizeLocale(text);
    const locale = await Promise.race([localePromise, timeoutPromise]);
    
    console.log(`[Lingo.dev] ✓ Detected language: ${locale || fallbackHint}`);
    return locale || fallbackHint;
  } catch (err) {
    console.log(`[Lingo.dev] Detection timeout - using fallback: ${fallbackHint}`);
    return fallbackHint;
  }
}

/**
 * THE CORE: Translate one message into MULTIPLE languages simultaneously.
 *
 * @param {string} text          - Original message
 * @param {string} sourceLocale  - Detected source language (or null for auto-detect)
 * @param {string[]} targetLocales - Array of target locales e.g. ["ja","hi","es","fr"]
 * @returns {Promise<Object>}    - { "ja": "...", "hi": "...", "es": "..." }
 */
export async function translateToMany(text, sourceLocale, targetLocales) {
  if (!targetLocales || targetLocales.length === 0) return {};

  // Remove source locale from targets (no need to translate to same language)
  const filtered = sourceLocale 
    ? targetLocales.filter((l) => l !== sourceLocale)
    : targetLocales;
    
  if (filtered.length === 0) return {};

  try {
    const sourceInfo = sourceLocale || "auto-detect";
    console.log(`[Lingo.dev] Translating "${text.substring(0, 30)}..." from ${sourceInfo} to [${filtered.join(", ")}]`);
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Translation timeout after 8s')), 8000)
    );
    
    const translationPromise = lingo.batchLocalizeText(text, {
      sourceLocale: sourceLocale || null,
      targetLocales: filtered,
      fast: true,
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
          setTimeout(() => reject(new Error('Translation timeout')), 5000)
        );
        
        const translationPromise = lingo.localizeText(text, {
          sourceLocale: sourceLocale || null, // null = auto-detect
          targetLocale,
          fast: true,
        });
        
        const translated = await Promise.race([translationPromise, timeoutPromise]);
        results[targetLocale] = translated;
        console.log(`[Lingo.dev] ${targetLocale}: ✓`);
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
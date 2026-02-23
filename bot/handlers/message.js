import { detectLanguage, translateToMany, nameOf, flagOf } from "../translator.js";
import { User } from "../models/User.js";
import { messageLog } from "../models/messageLog.js";
import { groupStats } from "../models/groupStats.js";

const MIN_LENGTH = 3;
const TELEGRAM_MAX_LENGTH = 4096; // Telegram message limit
const cooldowns = new Map();
const COOLDOWN_MS = 500; // Reduced for faster response
const messageBurst = new Map();
const BURST_THRESHOLD = 10; // Max messages per window
const BURST_WINDOW = 5000; // 5 second window


const URL_REGEX = /(https?:\/\/[^\s]+)/gi;
const EMOJI_REGEX = /^[\p{Emoji}\s]+$/u;
const CODE_BLOCK_REGEX = /(```[\s\S]*?```|`[^`]+`)/g;


function isUrlOnly(text) {
  const withoutUrls = text.replace(URL_REGEX, '').trim();
  return withoutUrls.length === 0;
}
function isEmojiOnly(text) {
  return EMOJI_REGEX.test(text.trim());
}

function extractCodeBlocks(text) {
  const codeBlocks = [];
  const textWithPlaceholders = text.replace(CODE_BLOCK_REGEX, (block) => {
    codeBlocks.push(block);
    return `__CODE_${codeBlocks.length - 1}__`;
  });
  return { textWithPlaceholders, codeBlocks };
}

function restoreCodeBlocks(translatedText, codeBlocks) {
  let result = translatedText;
  codeBlocks.forEach((block, index) => {
    result = result.replace(`__CODE_${index}__`, block);
  });
  return result;
}

function truncateToLimit(text, limit = TELEGRAM_MAX_LENGTH) {
  if (text.length <= limit) return text;
  return text.substring(0, limit - 50) + "\n\n<i>... (truncated)</i>";
}


function extractUrls(text) {
  const urls = [];
  const textWithPlaceholders = text.replace(URL_REGEX, (url) => {
    urls.push(url);
    return `__URL_${urls.length - 1}__`;
  });
  return { textWithPlaceholders, urls };
}


function restoreUrls(translatedText, urls) {
  let result = translatedText;
  urls.forEach((url, index) => {
    result = result.replace(`__URL_${index}__`, url);
  });
  return result;
}

// Helper function to retry Telegram API calls with fast retries
async function sendWithRetry(ctx, text, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await ctx.reply(text, options);
    } catch (err) {
      if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ECONNABORTED') {
        if (i < retries - 1) {
          const delay = Math.min(300 * Math.pow(2, i), 2000); // Fast retry: 300ms, 600ms, 1200ms max
          console.log(`[Lingo.dev] Telegram API timeout, retrying in ${delay}ms... (${i + 1}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
  }
}

export async function handleMessage(ctx) {
  const msg = ctx.message;
  if (!msg || !msg.text) return;
  if (msg.from.is_bot) return;
  if (msg.text.startsWith("/")) return;
  if (msg.text.trim().length < MIN_LENGTH) return;


  if (isUrlOnly(msg.text)) {
    console.log(`[Lingo.dev] Skipping URL-only message`);
    return;
  }

  if (isEmojiOnly(msg.text)) {
    console.log(`[Lingo.dev] Skipping emoji-only message`);
    return;
  }

  const senderId = msg.from.id;
  const now = Date.now();
  const lastMsg = cooldowns.get(senderId) || 0;
  if (now - lastMsg < COOLDOWN_MS) return;
  cooldowns.set(senderId, now);

  const burstKey = `${senderId}_${msg.chat.id}`;
  let burstData = messageBurst.get(burstKey) || { count: 0, windowStart: now };

  if (now - burstData.windowStart > BURST_WINDOW) {
    // Reset window
    burstData = { count: 1, windowStart: now };
  } else {
    burstData.count++;
    if (burstData.count > BURST_THRESHOLD) {
      console.log(`[Lingo.dev] Rate limiting ${msg.from.username || senderId} - burst detected`);
      return;
    }
  }
  messageBurst.set(burstKey, burstData);

  // Clean up old burst data periodically
  if (messageBurst.size > 1000) {
    for (const [key, data] of messageBurst.entries()) {
      if (now - data.windowStart > BURST_WINDOW * 2) {
        messageBurst.delete(key);
      }
    }
  }

  const groupId = msg.chat.id.toString();
  const groupName = msg.chat.title || "Unknown Group";
  const text = msg.text;
  const senderUsername = msg.from.first_name || msg.from.username || "User";

  const { textWithPlaceholders: textWithoutCode, codeBlocks } = extractCodeBlocks(text);
  const hasCodeBlocks = codeBlocks.length > 0;

  // Extract URLs to preserve them during translation
  const { textWithPlaceholders, urls } = extractUrls(hasCodeBlocks ? textWithoutCode : text);
  const hasUrls = urls.length > 0;

  try {
    // Get or create sender profile
    let sender = await User.findOne({ telegramId: senderId });
    const isNewUser = !sender;
    
    if (!sender) {
      // Use Telegram language code as hint if available
      const telegramLangHint = msg.from.language_code?.split('-')[0] || "en";
      const detectedLocale = await detectLanguage(text, telegramLangHint);
      sender = await User.create({
        telegramId: senderId,
        username: msg.from.username || "",
        firstName: msg.from.first_name || "",
        locale: detectedLocale,
        manuallySet: false,
        groups: [groupId],
      });
      console.log(`[Lingo.dev] Auto-detected ${senderUsername}: ${detectedLocale}`);
      
      // Send DM notification to pre-existing members who just got auto-registered
      try {
        const langName = nameOf(detectedLocale);
        const langFlag = flagOf(detectedLocale);
        const safeGroupName = groupName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const safeLangName = langName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        
        await ctx.telegram.sendMessage(
          senderId,
          `${langFlag} <b>Welcome to LingoComm</b>\n\n` +
          `You're now registered in <b>${safeGroupName}</b>\n\n` +
          `<b>Detected Language: ${safeLangName}</b>\n` +
          `I auto-detected your language as <b>${safeLangName}</b> based on your message. You'll receive translations in this language.\n\n` +
          `<b>To change your language:</b>\n` +
          `🇮🇳 <code>/lang hi</code> - Hindi\n` +
          `🇮🇳 <code>/lang or</code> - Odia\n` +
          `🇯🇵 <code>/lang ja</code> - Japanese\n` +
          `🇪🇸 <code>/lang es</code> - Spanish\n\n` +
          `See all languages: <code>/langs</code>\n\n` +
          `<i>Continue chatting - I'll translate automatically.</i>`,
          { parse_mode: "HTML" }
        );
        console.log(`[Lingo.dev] Sent DM to pre-existing member ${senderUsername}`);
      } catch (err) {
        console.log(`[Lingo.dev] Can't DM ${senderUsername} - they need to start the bot first`);
      }
    } else {
      // Auto-register to group if needed
      if (!sender.groups.includes(groupId)) {
        sender.groups.push(groupId);
      }
      
      // ONLY auto-detect language if user hasn't manually set it
      if (!sender.manuallySet) {
        // Use current locale as hint
        const detectedLocale = await detectLanguage(text, sender.locale);
        if (detectedLocale !== sender.locale) {
          sender.locale = detectedLocale;
          console.log(`[Lingo.dev] Auto-updated ${senderUsername} language: ${detectedLocale} (not manually set)`);
        }
      } else {
        console.log(`[Lingo.dev] Keeping ${senderUsername}'s manual language setting: ${sender.locale}`);
      }
      
      sender.messageCount += 1;
      await sender.save();
    }

    // === INTELLIGENT TRANSLATION LOGIC ===
    // Always auto-detect the actual message language (user can send in any language)
    const textToDetect = hasCodeBlocks ? textWithPlaceholders : (hasUrls ? textWithPlaceholders : text);
    
    let detectedSourceLang;
    if (sender.manuallySet && text.trim().length < 50) {
      // For short messages from users with manual language settings, use their preference as initial hint
      // but still allow them to send messages in other languages
      detectedSourceLang = await detectLanguage(textToDetect, sender.locale);
    } else {
      // For longer messages or auto-detected users, perform detection with fallback
      detectedSourceLang = await detectLanguage(textToDetect, sender.locale);
    }
    
    console.log(`[Lingo.dev] Message language: ${detectedSourceLang} | Sender preference: ${sender.locale}${hasUrls ? ' | URLs preserved' : ''}${hasCodeBlocks ? ' | Code preserved' : ''}`);

    // 2. Fetch all unique preferred languages of users in this group
    const allGroupUsers = await User.find({ groups: groupId });
    const allLocales = new Set(allGroupUsers.map(u => u.locale));

    console.log(`[Lingo.dev] Group has ${allLocales.size} unique languages: [${[...allLocales].join(", ")}]`);

    // 3. Remove only the detected source language (translate to ALL other languages)
    const targetLocales = [...allLocales].filter(
      locale => locale !== detectedSourceLang
    );

    // 4. If no target languages remain, do nothing
    if (targetLocales.length === 0) {
      console.log(`[Lingo.dev] No translation needed (everyone speaks ${detectedSourceLang})`);
      return;
    }

    // 5. Translate — use detected language as sourceLocale
    console.log(`[Lingo.dev] Translating from ${detectedSourceLang} to [${targetLocales.join(", ")}]`);
    const textToTranslate = hasCodeBlocks ? textWithPlaceholders : (hasUrls ? textWithPlaceholders : text);
    const translations = await translateToMany(textToTranslate, detectedSourceLang, targetLocales);

    // 6. Send a minimal, professional translation message (no username, just translations)
    const translationLines = [];
    for (const locale of targetLocales) {
      let translated = translations[locale];

      // Restore URLs if they were extracted
      if (hasUrls && translated) {
        translated = restoreUrls(translated, urls);
      }

      if (hasCodeBlocks && translated) {
        translated = restoreCodeBlocks(translated, codeBlocks);
      }

      // Post translation if it exists and has content
      if (translated && translated.trim().length > 0) {
        const flag = flagOf(locale);
        const langName = nameOf(locale);
        // Minimal professional format: 🇮🇳 Hindi: translation
        translationLines.push(`${flag} ${langName}: ${escapeHtml(translated)}`);
        console.log(`[Lingo.dev] Added ${locale} translation: ${translated.substring(0, 50)}...`);
      } else {
        console.log(`[Lingo.dev] Skipping ${locale} - empty or invalid translation`);
      }
    }

    if (translationLines.length > 0) {
      // Clean, minimal format - just the translations
      let replyText = translationLines.join('\n\n');
      replyText = truncateToLimit(replyText);

      console.log(`[Lingo.dev] Posting ${translationLines.length} translation(s) to group...`);

      try {
        await sendWithRetry(ctx, replyText, {
          parse_mode: "HTML",
          reply_to_message_id: msg.message_id,
        });
        console.log(`[Lingo.dev] ✓ Successfully posted ${translationLines.length} translation(s)`);
      } catch (err) {
        console.error(`[Lingo.dev] Failed to post translation after retries: ${err.message}`);
        // Try without reply_to_message_id as fallback
        try {
          await sendWithRetry(ctx, replyText, { parse_mode: "HTML" });
          console.log(`[Lingo.dev] ✓ Posted translation without thread (fallback)`);
        } catch (fallbackErr) {
          console.error(`[Lingo.dev] ✗ Complete failure to post translation: ${fallbackErr.message}`);
        }
      }
    } else {
      console.log(`[Lingo.dev] No translations to post - all were empty or filtered`);
    }

    // Log for analytics
    await messageLog.create({
      groupId,
      userId: senderId,
      username: senderUsername,
      text,
      detectedLocale: detectedSourceLang,
    });

    await groupStats.findOneAndUpdate(
      { groupId },
      {
        groupName,
        lastActivity: new Date(),
        $inc: {
          totalTranslations: targetLocales.length,
          [`languageBreakdown.${detectedSourceLang}`]: 1,
        },
      },
      { upsert: true, new: true }
    );

  } catch (err) {
    console.error("[LingoComm] Error:", err.message);
  }
}

/**
 * Handle photo messages with captions
 */
export async function handlePhotoCaption(ctx) {
  const msg = ctx.message;

  // Ignore photos without captions
  if (!msg.caption || msg.caption.trim().length < MIN_LENGTH) {
    console.log(`[Lingo.dev] Skipping photo without caption`);
    return;
  }

  // Ignore if caption is URL-only
  if (isUrlOnly(msg.caption)) {
    console.log(`[Lingo.dev] Skipping photo with URL-only caption`);
    return;
  }

  if (msg.from.is_bot) return;
  if (msg.caption.startsWith("/")) return;

  // Translate caption using the same logic as text messages
  await translateCaption(ctx, msg.caption);
}

/**
 * Handle document messages with captions
 */
export async function handleDocumentCaption(ctx) {
  const msg = ctx.message;

  // Ignore documents without captions
  if (!msg.caption || msg.caption.trim().length < MIN_LENGTH) {
    console.log(`[Lingo.dev] Skipping document without caption`);
    return;
  }

  // Ignore if caption is URL-only
  if (isUrlOnly(msg.caption)) {
    console.log(`[Lingo.dev] Skipping document with URL-only caption`);
    return;
  }

  if (msg.from.is_bot) return;
  if (msg.caption.startsWith("/")) return;

  // Translate caption using the same logic as text messages
  await translateCaption(ctx, msg.caption);
}

/**
 * Shared caption translation logic
 */
async function translateCaption(ctx, captionText) {
  const msg = ctx.message;
  const senderId = msg.from.id;
  const now = Date.now();

  // Apply cooldown
  const lastMsg = cooldowns.get(senderId) || 0;
  if (now - lastMsg < COOLDOWN_MS) return;
  cooldowns.set(senderId, now);

  if (isEmojiOnly(captionText)) {
    console.log(`[Lingo.dev] Skipping emoji-only caption`);
    return;
  }

  const groupId = msg.chat.id.toString();
  const groupName = msg.chat.title || "Unknown Group";
  const senderUsername = msg.from.first_name || msg.from.username || "User";

  const { textWithPlaceholders: textWithoutCode, codeBlocks } = extractCodeBlocks(captionText);
  const hasCodeBlocks = codeBlocks.length > 0;

  // Extract URLs to preserve them
  const { textWithPlaceholders, urls } = extractUrls(hasCodeBlocks ? textWithoutCode : captionText);
  const hasUrls = urls.length > 0;

  try {
    // Get or create sender profile
    let sender = await User.findOne({ telegramId: senderId });
    if (!sender) {
      const telegramLangHint = msg.from.language_code?.split('-')[0] || "en";
      const detectedLocale = await detectLanguage(captionText, telegramLangHint);
      sender = await User.create({
        telegramId: senderId,
        username: msg.from.username || "",
        firstName: msg.from.first_name || "",
        locale: detectedLocale,
        manuallySet: false,
        groups: [groupId],
      });
      console.log(`[Lingo.dev] Auto-detected ${senderUsername}: ${detectedLocale}`);
    } else {
      if (!sender.groups.includes(groupId)) {
        sender.groups.push(groupId);
      }
      
      if (!sender.manuallySet) {
        const detectedLocale = await detectLanguage(captionText, sender.locale);
        if (detectedLocale !== sender.locale) {
          sender.locale = detectedLocale;
          console.log(`[Lingo.dev] Auto-updated ${senderUsername} language: ${detectedLocale}`);
        }
      }
      
      sender.messageCount += 1;
      await sender.save();
    }
    
    // Detect caption language - always auto-detect
    const textToDetect = hasCodeBlocks ? textWithPlaceholders : (hasUrls ? textWithPlaceholders : captionText);
    
    let detectedSourceLang;
    // Always detect caption language properly
    detectedSourceLang = await detectLanguage(textToDetect, sender.locale);
    // Get target languages
    const allGroupUsers = await User.find({ groups: groupId });
    const allLocales = new Set(allGroupUsers.map(u => u.locale));

    const targetLocales = [...allLocales].filter(locale => locale !== detectedSourceLang);

    if (targetLocales.length === 0) {
      console.log(`[Lingo.dev] No caption translation needed`);
      return;
    }

    // Translate caption — use detected language as source
    console.log(`[Lingo.dev] Translating caption from ${detectedSourceLang} to [${targetLocales.join(", ")}]`);
    const textToTranslate = hasCodeBlocks ? textWithPlaceholders : (hasUrls ? textWithPlaceholders : captionText);
    const translations = await translateToMany(textToTranslate, detectedSourceLang, targetLocales);

    // Build minimal professional translations
    const translationLines = [];
    for (const locale of targetLocales) {
      let translated = translations[locale];

      if (hasUrls && translated) {
        translated = restoreUrls(translated, urls);
      }

      if (hasCodeBlocks && translated) {
        translated = restoreCodeBlocks(translated, codeBlocks);
      }

      // Post translation if it exists and has content
      if (translated && translated.trim().length > 0) {
        const flag = flagOf(locale);
        const langName = nameOf(locale);
        // Minimal format: 🇮🇳 Hindi: translation
        translationLines.push(`${flag} ${langName}: ${escapeHtml(translated)}`);
        console.log(`[Lingo.dev] Added ${locale} caption translation`);
      }
    }

    if (translationLines.length > 0) {
      // Clean minimal format
      let replyText = translationLines.join('\n\n');
      replyText = truncateToLimit(replyText);

      console.log(`[Lingo.dev] Posting ${translationLines.length} caption translation(s)...`);

      try {
        await sendWithRetry(ctx, replyText, {
          parse_mode: "HTML",
          reply_to_message_id: msg.message_id,
        });
        console.log(`[Lingo.dev] ✓ Successfully posted caption translation(s)`);
      } catch (err) {
        console.error(`[Lingo.dev] Failed to post caption translation: ${err.message}`);
      }
    } else {
      console.log(`[Lingo.dev] No caption translations to post`);
    }

    // Log for analytics
    await messageLog.create({
      groupId,
      userId: senderId,
      username: senderUsername,
      text: captionText,
      detectedLocale: detectedSourceLang,
    });

    await groupStats.findOneAndUpdate(
      { groupId },
      {
        groupName,
        lastActivity: new Date(),
        $inc: {
          totalTranslations: targetLocales.length,
          [`languageBreakdown.${detectedSourceLang}`]: 1,
        },
      },
      { upsert: true, new: true }
    );

  } catch (err) {
    console.error("[LingoComm] Caption translation error:", err.message);
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
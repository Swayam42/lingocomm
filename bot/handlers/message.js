import { detectLanguage, translateToMany, nameOf, flagOf } from "../translator.js";
import { User } from "../models/User.js";
import { messageLog } from "../models/messageLog.js";
import { groupStats } from "../models/groupStats.js";

const MIN_LENGTH = 3;
const cooldowns = new Map();
const COOLDOWN_MS = 1500;


const URL_REGEX = /(https?:\/\/[^\s]+)/gi;


function isUrlOnly(text) {
  const withoutUrls = text.replace(URL_REGEX, '').trim();
  return withoutUrls.length === 0;
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

// Helper function to retry Telegram API calls
async function sendWithRetry(ctx, text, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await ctx.reply(text, options);
    } catch (err) {
      if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
        if (i < retries - 1) {
          const delay = Math.min(1000 * Math.pow(2, i), 5000); // Exponential backoff, max 5s
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

  const senderId = msg.from.id;
  const now = Date.now();
  const lastMsg = cooldowns.get(senderId) || 0;
  if (now - lastMsg < COOLDOWN_MS) return;
  cooldowns.set(senderId, now);

  const groupId = msg.chat.id.toString();
  const groupName = msg.chat.title || "Unknown Group";
  const text = msg.text;
  const senderUsername = msg.from.first_name || msg.from.username || "User";

  // Extract URLs to preserve them during translation
  const { textWithPlaceholders, urls } = extractUrls(text);
  const hasUrls = urls.length > 0;

  try {
    // Get or create sender profile
    let sender = await User.findOne({ telegramId: senderId });
    const isNewUser = !sender;
    
    if (!sender) {
      const detectedLocale = await detectLanguage(text);
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
        const detectedLocale = await detectLanguage(text);
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
    // 1. Detect actual message language (may differ from sender's preferred language)
    const textToDetect = hasUrls ? textWithPlaceholders : text;
    const detectedSourceLang = await detectLanguage(textToDetect);
    console.log(`[Lingo.dev] Message language: ${detectedSourceLang} | Sender preference: ${sender.locale}${hasUrls ? ' | URLs preserved' : ''}`);

    // 2. Fetch all unique preferred languages of users in this group
    const allGroupUsers = await User.find({ groups: groupId });
    const allLocales = new Set(allGroupUsers.map(u => u.locale));
    
    console.log(`[Lingo.dev] Group has ${allLocales.size} unique languages: [${[...allLocales].join(", ")}]`);

    // 3. Remove detected source language and sender's preferred language
    const targetLocales = [...allLocales].filter(
      locale => locale !== detectedSourceLang && locale !== sender.locale
    );

    // 4. If no target languages remain, do nothing
    if (targetLocales.length === 0) {
      console.log(`[Lingo.dev] No translation needed (everyone speaks ${detectedSourceLang} or sender's language)`);
      return;
    }

    // 5. Use batchLocalizeText() for efficiency
    console.log(`[Lingo.dev] Translating from ${detectedSourceLang} to [${targetLocales.join(", ")}]`);
    const textToTranslate = hasUrls ? textWithPlaceholders : text;
    const translations = await translateToMany(textToTranslate, detectedSourceLang, targetLocales);

    // 6. Send a single grouped message containing all translations
    const translationLines = [];
    for (const locale of targetLocales) {
      let translated = translations[locale];
      
      // Restore URLs if they were extracted
      if (hasUrls && translated) {
        translated = restoreUrls(translated, urls);
      }
      
      if (translated && translated !== text) {
        const flag = flagOf(locale);
        const langName = nameOf(locale);
        translationLines.push(`${flag} <b>${langName}:</b> ${escapeHtml(translated)}`);
      }
    }

    if (translationLines.length > 0) {
      const replyText = `${header}\n\n${translationLines.join('\n\n')}`;
      
      try {
        await sendWithRetry(ctx, replyText, {
          parse_mode: "HTML",
          reply_to_message_id: msg.message_id,
        });
        console.log(`[Lingo.dev] Posted ${translationLines.length} translations to group`);
      } catch (err) {
        console.error(`[Lingo.dev] Failed to post translation after retries: ${err.message}`);
        // Try without reply_to_message_id as fallback
        try {
          await sendWithRetry(ctx, replyText, { parse_mode: "HTML" });
          console.log(`[Lingo.dev] Posted translation without thread (fallback)`);
        } catch (fallbackErr) {
          console.error(`[Lingo.dev] Complete failure to post translation: ${fallbackErr.message}`);
        }
      }
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
  
  const groupId = msg.chat.id.toString();
  const groupName = msg.chat.title || "Unknown Group";
  const senderUsername = msg.from.first_name || msg.from.username || "User";
  
  // Extract URLs to preserve them
  const { textWithPlaceholders, urls } = extractUrls(captionText);
  const hasUrls = urls.length > 0;
  
  try {
    // Get or create sender profile
    let sender = await User.findOne({ telegramId: senderId });
    if (!sender) {
      const textToDetect = hasUrls ? textWithPlaceholders : captionText;
      const detectedLocale = await detectLanguage(textToDetect);
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
        const textToDetect = hasUrls ? textWithPlaceholders : captionText;
        const detectedLocale = await detectLanguage(textToDetect);
        if (detectedLocale !== sender.locale) {
          sender.locale = detectedLocale;
          console.log(`[Lingo.dev] Auto-updated ${senderUsername} language: ${detectedLocale}`);
        }
      }
      
      sender.messageCount += 1;
      await sender.save();
    }
    
    // Detect caption language
    const textToDetect = hasUrls ? textWithPlaceholders : captionText;
    const detectedSourceLang = await detectLanguage(textToDetect);
    console.log(`[Lingo.dev] Caption language: ${detectedSourceLang}${hasUrls ? ' | URLs preserved' : ''}`);
    
    // Get target languages
    const allGroupUsers = await User.find({ groups: groupId });
    const allLocales = new Set(allGroupUsers.map(u => u.locale));
    
    const targetLocales = [...allLocales].filter(
      locale => locale !== detectedSourceLang && locale !== sender.locale
    );
    
    if (targetLocales.length === 0) {
      console.log(`[Lingo.dev] No caption translation needed`);
      return;
    }
    
    // Translate caption
    console.log(`[Lingo.dev] Translating caption from ${detectedSourceLang} to [${targetLocales.join(", ")}]`);
    const textToTranslate = hasUrls ? textWithPlaceholders : captionText;
    const translations = await translateToMany(textToTranslate, detectedSourceLang, targetLocales);
    
    // Build translations
    const translationLines = [];
    for (const locale of targetLocales) {
      let translated = translations[locale];
      
      if (hasUrls && translated) {
        translated = restoreUrls(translated, urls);
      }
      
      if (translated && translated !== captionText) {
        const flag = flagOf(locale);
        const langName = nameOf(locale);
        translationLines.push(`${flag} <b>${langName}:</b> ${escapeHtml(translated)}`);
      }
    }
    
    if (translationLines.length > 0) {
      const replyText = `${header}\n\n${translationLines.join('\n\n')}`;
      
      try {
        await sendWithRetry(ctx, replyText, {
          parse_mode: "HTML",
          reply_to_message_id: msg.message_id,
        });
        console.log(`[Lingo.dev] Posted ${translationLines.length} caption translations`);
      } catch (err) {
        console.error(`[Lingo.dev] Failed to post caption translation: ${err.message}`);
      }
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
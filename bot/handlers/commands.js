import { User } from "../models/User.js";
import { messageLog } from "../models/messageLog.js";
import { groupStats } from "../models/groupStats.js";
import { translateOne, summarizeChat, nameOf, flagOf, LANG_NAMES } from "../translator.js";


//Check if user is admin in current chat
async function isGroupAdmin(ctx) {
  if (ctx.chat.type === "private") return true;
  
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return ["creator", "administrator"].includes(member.status);
  } catch (err) {
    console.error("[Admin Check] Error:", err.message);
    return false;
  }
}

export async function handleStart(ctx) {
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || "there";

  let user = await User.findOne({ telegramId: userId });
  if (!user) {
    user = await User.create({
      telegramId: userId,
      username: ctx.from.username || "",
      firstName: ctx.from.first_name || "",
      locale: "en",
      manuallySet: false,
    });
  }

  const isGroup = ctx.chat.type !== "private";

  if (isGroup) {
    await ctx.reply(
      `<b>LingoComm is now active in this group!</b>\n\n` +
      `<b>How it works:</b>\n` +
      `• Each member sets their preferred language\n` +
      `• When anyone sends a message, I reply with translations\n` +
      `• Everyone sees all translations in the group thread\n\n` +
      `<b>Setup:</b>\n` +
      `1. DM @${ctx.botInfo.username}\n` +
      `2. Use /lang to set your preferred language\n\n` +
      `Type /help for all commands.`,
      { parse_mode: "HTML" }
    );
  } else {
    // Private chat onboarding with inline keyboard
    await ctx.reply(
      `<b>Welcome to LingoComm</b>\n\n` +
      `Real-time multilingual communication for Telegram communities.\n\n` +
      `Break language barriers effortlessly.\n\n` +
      `<i>Type /help to see all commands.</i>`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "Support Developer", url: "https://buymeacoffee.com/swayam42" }],
            [{ text: "Set Language", callback_data: "set_language" }],
            [{ text: "Add to Group", url: `https://t.me/${ctx.botInfo.username}?startgroup=true` }],
          ],
        },
      }
    );
  }
}

export async function handleLang(ctx) {
  if (ctx.chat.type !== "private") {
    return ctx.reply(
      "Please use /lang in a private message with me.\n\n" +
      `Open a DM: @${ctx.botInfo.username}`,
      { parse_mode: "HTML" }
    );
  }

  const userId = ctx.from.id;
  const args = ctx.message.text.split(" ").slice(1);
  const requestedLang = args[0]?.toLowerCase().trim();

  if (!requestedLang) {
    const user = await User.findOne({ telegramId: userId });
    const current = user?.locale || "en";
    return ctx.reply(
      `${flagOf(current)} Your current language: <b>${nameOf(current)}</b>\n\n` +
      `To change: <code>/lang [code]</code>\n` +
      `Example: <code>/lang ja</code>\n\n` +
      `See all codes: /langs`,
      { parse_mode: "HTML" }
    );
  }

  if (!LANG_NAMES[requestedLang]) {
    return ctx.reply(
      `"${requestedLang}" is not a supported language code.\n\n` +
      `Type /langs to see all supported languages.`,
      { parse_mode: "HTML" }
    );
  }

  await User.findOneAndUpdate(
    { telegramId: userId },
    {
      locale: requestedLang,
      manuallySet: true,
      username: ctx.from.username || "",
      firstName: ctx.from.first_name || "",
    },
    { upsert: true, new: true }
  );

  const langName = nameOf(requestedLang);
  const flag = flagOf(requestedLang);
  const confirmMsg = `Language set to ${langName}. All messages will now appear in ${langName}.`;
  const localizedConfirm = await translateOne(confirmMsg, "en", requestedLang);

  await ctx.reply(
    `${flag} <b>${localizedConfirm}</b>\n\n` +
    `<i>English: Language set to ${langName}. You will now see translations in ${langName}.</i>`,
    { parse_mode: "HTML" }
  );
}

export async function handleLangs(ctx) {
  // DM-only restriction
  if (ctx.chat.type !== "private") {
    return ctx.reply(
      "Please use /langs in a private message with me.\n\n" +
      `Open a DM: @${ctx.botInfo.username}`,
      { parse_mode: "HTML" }
    );
  }

  const langLines = Object.entries(LANG_NAMES)
    .filter(([code]) => !code.includes("-"))
    .map(([code, name]) => `${flagOf(code)} <code>/lang ${code}</code> - ${name}`)
    .join("\n");

  await ctx.reply(
    `🌐 <b>Supported Languages</b>\n\n${langLines}\n\n` +
    `Use <code>/lang [code]</code> to set your language.`,
    { parse_mode: "HTML" }
  );
}

export async function handleSummary(ctx) {
  const userId = ctx.from.id;
  const groupId = ctx.chat.id;

  if (ctx.chat.type === "private") {
    return ctx.reply(
      "<b>Summary Command</b>\n\n" +
      "This command works in group chats only.\n\n" +
      "<i>Add me to a group and type /summary to get recent chat history in your language.</i>",
      { parse_mode: "HTML" }
    );
  }

  // Check if user is admin in group
  if (!(await isGroupAdmin(ctx))) {
    return ctx.reply("Only group admins can use this command.");
  }

  const user = await User.findOne({ telegramId: userId });
  const userLocale = user?.locale || "en";

  const logs = await messageLog.find({ groupId })
    .sort({ sentAt: -1 })
    .limit(50)
    .lean();

  if (logs.length === 0) {
    return ctx.reply("No recent messages to summarize.");
  }

  const chatHistory = logs
    .reverse()
    .map((log) => ({ name: log.username, text: log.text }));

  await ctx.reply("Generating summary in your language...");

  try {
    const translatedChat = await summarizeChat(chatHistory, userLocale);

    const summaryLines = translatedChat
      .slice(-15)
      .map((m) => `<b>${escapeHtml(m.name)}:</b> ${escapeHtml(m.text)}`)
      .join("\n");

    const langName = nameOf(userLocale);
    const flag = flagOf(userLocale);

    await ctx.reply(
      `${flag} <b>Last ${Math.min(15, translatedChat.length)} messages in ${langName}</b>\n\n` +
      `${summaryLines}`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    await ctx.reply("❌ Could not generate summary. Try again in a moment.");
  }
}

export async function handleStats(ctx) {
  const userId = ctx.from.id;
  const groupId = ctx.chat.id;

  // Only works in group chats
  if (ctx.chat.type === "private") {
    return ctx.reply(
      "<b>Stats Command</b>\n\n" +
      "This command works in group chats only.\n\n" +
      "<i>Add me to a group and type /stats to see your personal statistics.</i>",
      { parse_mode: "HTML" }
    );
  }

  // Get user's personal stats in this group
  const user = await User.findOne({ telegramId: userId });
  
  if (!user) {
    return ctx.reply(
      "You haven't sent any messages yet.\n\n" +
      "Send a message first, then use /stats to see your activity.",
      { reply_to_message_id: ctx.message.message_id }
    );
  }

  // Check if user is registered in this group
  const isInGroup = user.groups?.includes(groupId.toString());
  
  const statsMessage = 
    `<b>Your Stats in ${escapeHtml(ctx.chat.title || "this group")}</b>\n\n` +
    `Language: ${flagOf(user.locale)} <b>${nameOf(user.locale)}</b>\n` +
    `Messages sent: <b>${user.messageCount || 0}</b>\n` +
    `Member since: <b>${user.createdAt?.toDateString() || "Today"}</b>\n` +
    `Status: <b>${isInGroup ? "Active in this group" : "Not registered in this group"}</b>`;

  await ctx.reply(statsMessage, {
    parse_mode: "HTML",
    reply_to_message_id: ctx.message.message_id,
  });
}

export async function handleHelp(ctx) {
  await ctx.reply(
    `<b>LingoComm - Real-Time Translation</b>\n\n` +
    `<b>Commands:</b>\n` +
    `/start - Welcome and setup guide\n` +
    `/lang [code] - Set your language (DM only)\n` +
    `/langs - List all supported languages (DM only)\n` +
    `/stats - View your personal stats (groups only)\n` +
    `/summary - Get recent chat in your language (groups only, admin)\n` +
    `/debug - Troubleshooting info (groups only, admin)\n` +
    `/help - Show this message\n\n` +
    `<b>How it works:</b>\n` +
    `1. Set your language with /lang in DM\n` +
    `2. Chat naturally in any language\n` +
    `3. Bot replies with translations for all group members\n` +
    `4. Everyone sees translations in the thread\n\n` +
    `<b>Example:</b>\n` +
    `• You write: "こんにちは" (Japanese)\n` +
    `• Bot replies: 🇮🇳 Hindi: नमस्ते, 🇪🇸 Spanish: Hola\n\n` +
    `<i>Powered by Lingo.dev</i>`,
    { parse_mode: "HTML" }
  );
}

export async function handleDebug(ctx) {
  const userId = ctx.from.id;
  const isGroup = ctx.chat.type !== "private";

  // If in group, check if user is admin/owner
  if (isGroup) {
    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
      const isAdmin = ["creator", "administrator"].includes(member.status);
      
      if (!isAdmin) {
        return ctx.reply("This command is restricted to group administrators.");
      }

      // Admin confirmed - send debug info via DM
      const groupId = ctx.chat.id.toString();
      const members = await User.find({ groups: groupId });
      
      const memberList = members.length > 0
        ? members.map(m => `• @${m.username || m.telegramId}: ${flagOf(m.locale)} ${nameOf(m.locale)}`).join("\n")
        : "No members registered yet";
      
      const debugMsg = 
        `<b>Debug Info - ${ctx.chat.title || "Group"}</b>\n\n` +
        `<b>Group ID:</b> <code>${groupId}</code>\n` +
        `<b>Registered Members:</b> ${members.length}\n\n` +
        `${memberList}\n\n` +
        `<b>Note:</b>\n` +
        `• Unregistered members see <b>English translations</b> by default\n` +
        `• Encourage them to DM @${ctx.botInfo.username} and use /lang\n` +
        `• Example: <code>/lang hi</code> for Hindi, <code>/lang or</code> for Odia\n\n` +
        `<b>System Status:</b>\n` +
        `API Key: ${process.env.LINGODOTDEV_API_KEY ? "Connected" : "Missing"}\n` +
        `MongoDB: ${await checkMongoConnection() ? "Connected" : "Disconnected"}`;

      try {
        await ctx.telegram.sendMessage(userId, debugMsg, { parse_mode: "HTML" });
        const sentMsg = await ctx.reply("Debug info sent to your DM.");
        
        // Auto-delete after 3 seconds
        setTimeout(async () => {
          try {
            await ctx.telegram.deleteMessage(ctx.chat.id, sentMsg.message_id);
          } catch (err) {
            console.error("[Debug] Failed to delete message:", err.message);
          }
        }, 3000);
      } catch (err) {
        const errorMsg = await ctx.reply("Cannot send DM. Please start a private chat with me first: @" + ctx.botInfo.username);
        
        // Auto-delete after 3 seconds
        setTimeout(async () => {
          try {
            await ctx.telegram.deleteMessage(ctx.chat.id, errorMsg.message_id);
          } catch (err) {
            console.error("[Debug] Failed to delete message:", err.message);
          }
        }, 3000);
      }
    } catch (err) {
      console.error("[Lingo.dev] Failed to check admin status:", err.message);
      const errorMsg = await ctx.reply("Error checking permissions.");
      
      // Auto-delete after 3 seconds
      setTimeout(async () => {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, errorMsg.message_id);
        } catch (err) {
          console.error("[Debug] Failed to delete message:", err.message);
        }
      }, 3000);
    }
  } else {
    // Private chat - not allowed for debug
    return ctx.reply(
      "<b>Debug Command</b>\n\n" +
      "This command works in groups only if you are an admin.\n\n" +
      "<i>Add me to a group where you're an admin and use /debug to troubleshoot.</i>",
      { parse_mode: "HTML" }
    );
  }
}

/**
 * Handle "Set Language" button callback
 */
export async function handleSetLanguageCallback(ctx) {
  await ctx.answerCbQuery();
  
  await ctx.editMessageText(
    `🌐 <b>Choose Your Language</b>\n\n` +
    `Select your preferred language for translations:`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🇬🇧 English", callback_data: "lang_en" },
            { text: "🇮🇳 Hindi", callback_data: "lang_hi" },
          ],
          [
            { text: "🇯🇵 Japanese", callback_data: "lang_ja" },
            { text: "🇪🇸 Spanish", callback_data: "lang_es" },
          ],
          [
            { text: "🇫🇷 French", callback_data: "lang_fr" },
            { text: "🇩🇪 German", callback_data: "lang_de" },
          ],
          [
            { text: "🇨🇳 Chinese", callback_data: "lang_zh" },
            { text: "🇰🇷 Korean", callback_data: "lang_ko" },
          ],
          [{ text: "Other Languages", callback_data: "other_languages" }],
          [{ text: "Back", callback_data: "back_to_welcome" }],
        ],
      },
    }
  );
}

/**
 * Handle language selection callback
 */
export async function handleLanguageSelectionCallback(ctx) {
  await ctx.answerCbQuery();
  
  const langCode = ctx.callbackQuery.data.replace("lang_", "");
  const userId = ctx.from.id;

  // Update user's language preference
  await User.findOneAndUpdate(
    { telegramId: userId },
    {
      locale: langCode,
      manuallySet: true,
      username: ctx.from.username || "",
      firstName: ctx.from.first_name || "",
    },
    { upsert: true, new: true }
  );

  const langName = nameOf(langCode);
  const flag = flagOf(langCode);
  
  // Translate confirmation message to selected language
  const confirmMsg = `Language set to ${langName}. You will now see translations in ${langName}.`;
  const localizedConfirm = await translateOne(confirmMsg, "en", langCode);

  await ctx.editMessageText(
    `${flag} <b>${localizedConfirm}</b>\n\n` +
    `<i>English: Language set to ${langName}. You will now see translations in ${langName}.</i>\n\n` +
    `<i>Add me to a group to start translating!</i>`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Add to Group", url: `https://t.me/${ctx.botInfo.username}?startgroup=true` }],
          [{ text: "Back to Welcome", callback_data: "back_to_welcome" }],
        ],
      },
    }
  );
}

/**
 * Handle "Other Languages" button callback
 */
export async function handleOtherLanguagesCallback(ctx) {
  await ctx.answerCbQuery();
  
  await ctx.editMessageText(
    `<b>Set Custom Language</b>\n\n` +
    `To set a language not listed in the quick options:\n\n` +
    `<b>Step 1:</b> Type /langs to see all supported languages\n` +
    `<b>Step 2:</b> Type <code>/lang [code]</code> to set your language\n\n` +
    `<b>Examples:</b>\n` +
    `• <code>/lang pt</code> - Portuguese\n` +
    `• <code>/lang ar</code> - Arabic\n` +
    `• <code>/lang ru</code> - Russian\n` +
    `• <code>/lang te</code> - Telugu\n\n` +
    `<i>We support 25+ languages</i>`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "View All Languages", callback_data: "view_all_langs" }],
          [{ text: "Back", callback_data: "set_language" }],
        ],
      },
    }
  );
}

/**
 * Handle "View All Languages" callback
 */
export async function handleViewAllLangsCallback(ctx) {
  await ctx.answerCbQuery("Opening language list...");
  
  // Send /langs output
  const langLines = Object.entries(LANG_NAMES)
    .filter(([code]) => !code.includes("-"))
    .map(([code, name]) => `${flagOf(code)} <code>/lang ${code}</code> - ${name}`)
    .join("\n");

  await ctx.reply(
    `<b>All Supported Languages</b>\n\n${langLines}\n\n` +
    `Use <code>/lang [code]</code> to set your language.`,
    { parse_mode: "HTML" }
  );
}

/**
 * Handle back to welcome callback
 */
export async function handleBackToWelcomeCallback(ctx) {
  await ctx.answerCbQuery();
  
  await ctx.editMessageText(
    `<b>Welcome to LingoComm</b>\n\n` +
    `Real-time multilingual communication for Telegram communities.\n\n` +
    `Break language barriers effortlessly.\n\n` +
    `<i>Type /help to see all commands.</i>`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "☕ Support My Developer", url: "https://buymeacoffee.com/swayam42" }],
          [{ text: "🌐 Set Language", callback_data: "set_language" }],
          [{ text: "➕ Add to Group", url: `https://t.me/${ctx.botInfo.username}?startgroup=true` }],
        ],
      },
    }
  );
}

async function checkMongoConnection() {
  try {
    const mongoose = (await import("mongoose")).default;
    return mongoose.connection.readyState === 1;
  } catch {
    return false;
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
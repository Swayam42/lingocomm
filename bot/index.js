import "dotenv/config";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";

import { connectDB } from "./db.js";
import { handleMessage, handlePhotoCaption, handleDocumentCaption } from "./handlers/message.js";
import { handleNewMember, handleLeftMember } from "./handlers/onJoin.js";
import {
  handleStart,
  handleLang,
  handleLangs,
  handleStats,
  handleHelp,
  handleDebug,
  handleSetLanguageCallback,
  handleLanguageSelectionCallback,
  handleOtherLanguagesCallback,
  handleViewAllLangsCallback,
  handleBackToWelcomeCallback,
} from "./handlers/commands.js";
import { handleAnalyzeVoice, handleVoiceAnalysisCallback } from "./handlers/voiceAnalyzer.js";

// ── Validate required env vars ────────────────────────────────────────
const required = ["TELEGRAM_BOT_TOKEN", "LINGODOTDEV_API_KEY", "MONGODB_URI"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("Missing env vars:", missing.join(", "));
  console.error("   Copy .env.example → .env and fill in values.");
  process.exit(1);
}

// ── Connect to MongoDB ────────────────────────────────────────────────
await connectDB();

// ── Init bot with timeout settings ────────────────────────────────────
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {
  telegram: {
    apiRoot: process.env.TELEGRAM_API_ROOT || "https://api.telegram.org",
    webhookReply: false,
    agent: null,
    // Increase timeout for slow networks
    attachmentAgent: null,
  },
  handlerTimeout: 90000, // 90 second timeout for handlers
});

// ── Register commands ─────────────────────────────────────────────────
bot.command("start", handleStart);
bot.command("lang", handleLang);
bot.command("langs", handleLangs);
bot.command("stats", handleStats);
bot.command("help", handleHelp);
bot.command("debug", handleDebug);
bot.command("analyze", handleAnalyzeVoice);

// ── Register callback query handlers ──────────────────────────────────
bot.action("set_language", handleSetLanguageCallback);
bot.action(/^lang_/, handleLanguageSelectionCallback);
bot.action("other_languages", handleOtherLanguagesCallback);
bot.action("view_all_langs", handleViewAllLangsCallback);
bot.action("back_to_welcome", handleBackToWelcomeCallback);
bot.action(/^va_/, handleVoiceAnalysisCallback);

// ── New member joins/leaves ────────────────────────────────────────────
bot.on(message("new_chat_members"), handleNewMember);
bot.on(message("left_chat_member"), handleLeftMember);

// ── Every text message → translate ────────────────────────────────────
bot.on(message("text"), handleMessage);

// ── Photo captions → translate ────────────────────────────────────────
bot.on(message("photo"), handlePhotoCaption);

// ── Document captions → translate ────────────────────────────────────
bot.on(message("document"), handleDocumentCaption);

// ── Error handling ────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`[LingoComm] Bot error for update ${ctx.updateType}:`, err.message);
});

// ── Launch with retry logic ───────────────────────────────────────────
async function launchBot(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Connecting to Telegram (Attempt ${i + 1}/${retries})...`);
      
      await bot.launch({
        dropPendingUpdates: true,
        allowedUpdates: ["message", "callback_query", "chat_member"],
      });

      console.log(`\nBot is running as @${bot.botInfo.username}\nWaiting for messages...\n`);
      return;
      
    } catch (err) {
      console.error(`Connection failed: ${err.message}`);
      
      if (i < retries - 1) {
        const delay = (i + 1) * 2;
        console.log(`Retrying in ${delay} seconds...\n`);
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
      }
    }
  }
  
  console.error("\nFailed to connect. Check TELEGRAM_BOT_TOKEN and internet connection.\n");
  process.exit(1);
}

await launchBot();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
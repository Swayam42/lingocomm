import { createClient } from "@deepgram/sdk";
import googleTextToSpeech from "@google-cloud/text-to-speech";
import { translateOne, flagOf, nameOf } from "../translator.js";
import { User } from "../models/User.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.join(__dirname, "../../temp");

// Initialize API clients
let deepgramClient;
let ttsClient;

try {
  if (process.env.DEEPGRAM_API_KEY) {
    deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
  }
  
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    ttsClient = new googleTextToSpeech.TextToSpeechClient();
  }
} catch (err) {
  console.error("[VoiceAnalyzer] API client initialization failed:", err.message);
}

// Module-level cache (better than global)
const analysisCache = new Map();

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Voice language to TTS voice mapping
const TTS_VOICES = {
  en: { languageCode: 'en-US', name: 'en-US-Wavenet-D' },
  hi: { languageCode: 'hi-IN', name: 'hi-IN-Wavenet-A' },
  es: { languageCode: 'es-ES', name: 'es-ES-Wavenet-B' },
  fr: { languageCode: 'fr-FR', name: 'fr-FR-Wavenet-A' },
  de: { languageCode: 'de-DE', name: 'de-DE-Wavenet-B' },
  ja: { languageCode: 'ja-JP', name: 'ja-JP-Wavenet-A' },
  zh: { languageCode: 'cmn-CN', name: 'cmn-CN-Wavenet-A' },
  ko: { languageCode: 'ko-KR', name: 'ko-KR-Wavenet-A' },
  pt: { languageCode: 'pt-BR', name: 'pt-BR-Wavenet-A' },
  ru: { languageCode: 'ru-RU', name: 'ru-RU-Wavenet-A' },
  ar: { languageCode: 'ar-XA', name: 'ar-XA-Wavenet-A' },
  it: { languageCode: 'it-IT', name: 'it-IT-Wavenet-A' },
  tr: { languageCode: 'tr-TR', name: 'tr-TR-Wavenet-A' },
};

/**
 * Download audio file from Telegram
 */
async function downloadAudioFile(ctx, fileId, fileExtension) {
  const audioFile = await ctx.telegram.getFile(fileId);
  const audioUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${audioFile.file_path}`;
  
  const tempFilePath = path.join(tempDir, `audio_${ctx.from.id}_${Date.now()}.${fileExtension}`);
  
  const fetch = (await import("node-fetch")).default;
  const response = await fetch(audioUrl);
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(tempFilePath, Buffer.from(arrayBuffer));
  
  return tempFilePath;
}

/**
 * Speech-to-Text using Deepgram
 */
async function speechToText(audioFilePath) {
  if (!deepgramClient) throw new Error("Voice analysis unavailable");

  const audioBuffer = fs.readFileSync(audioFilePath);
  const { result, error } = await deepgramClient.listen.prerecorded.transcribeFile(
    audioBuffer,
    {
      model: "nova-2",
      detect_language: true,
      punctuate: true,
      smart_format: true,
    }
  );

  if (error) throw new Error("Transcription failed");

  const transcript = result.results.channels[0].alternatives[0].transcript;
  if (!transcript?.trim()) throw new Error("No speech detected");

  // Get detected language (Deepgram returns ISO language codes like 'en', 'hi', 'es', etc.)
  const detectedLang = result.results.channels[0].detected_language || 'en';

  return { transcript, detectedLang };
}

/**
 * Translate text using Lingo.dev
 */
async function translateText(text, sourceLang, targetLang) {
  // If source and target are the same, no translation needed
  if (sourceLang === targetLang) return text;
  
  return await translateOne(text, sourceLang, targetLang);
}

/**
 * Text-to-Speech using Google Cloud TTS
 */
async function textToSpeech(text, lang) {
  if (!ttsClient) throw new Error("TTS unavailable");

  const voice = TTS_VOICES[lang] || TTS_VOICES.en;
  const request = {
    input: { text },
    voice: { languageCode: voice.languageCode, name: voice.name },
    audioConfig: { 
      audioEncoding: 'MP3',
      speakingRate: 0.95,
      sampleRateHertz: 24000,
    },
  };

  const [response] = await ttsClient.synthesizeSpeech(request);
  return response.audioContent;
}

/**
 * Core voice analysis logic (used by both manual and auto handlers)
 */
async function processVoiceAnalysis(ctx, fileId, fileExtension, messageToReplyTo) {
  const userId = ctx.from.id;
  
  // Get user's preferred language for UI messages
  const user = await User.findOne({ telegramId: userId });
  const userLang = user?.locale || 'en';
  
  const processingMsg = await ctx.reply("⏳ Analyzing...");
  
  let tempFilePath;
  let ttsFilePath;

  try {
    // 1. Download audio
    tempFilePath = await downloadAudioFile(ctx, fileId, fileExtension);

    // 2. Transcribe and detect language
    const { transcript, detectedLang } = await speechToText(tempFilePath);

    // 3. Translate to user's preferred language
    const translatedText = await translateText(transcript, detectedLang, userLang);

    // 4. Generate TTS in user's preferred language
    const audioBuffer = await textToSpeech(translatedText, userLang);
    ttsFilePath = path.join(tempDir, `tts_${userId}_${Date.now()}.mp3`);
    fs.writeFileSync(ttsFilePath, audioBuffer);

    // 5. Send result
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    await ctx.telegram.sendMessage(
      ctx.chat.id,
      "✅ Audio analyzed!",
      {
        reply_to_message_id: messageToReplyTo,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "📝 Original", callback_data: `va_transcript_${userId}_${ctx.message.message_id}` },
              { text: "🌐 Translated", callback_data: `va_translated_${userId}_${ctx.message.message_id}` },
            ],
            [{ text: "🔊 Listen", callback_data: `va_audio_${userId}_${ctx.message.message_id}` }],
          ],
        },
      }
    );

    // 6. Cache results (1 hour)
    analysisCache.set(`${userId}_${ctx.message.message_id}`, {
      transcript,
      translatedText,
      ttsFilePath,
      detectedLang,
      userLang,
      originalAudioMessageId: messageToReplyTo,
      expiresAt: Date.now() + 3600000, // 1 hour
    });

  } catch (err) {
    console.error("[VoiceAnalyzer]", err.message);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      processingMsg.message_id,
      null,
      "❌ Could not analyze audio. Try a clearer voice message."
    );
  } finally {
    // Clean up downloaded file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

/**
 * Main handler for /analyze command
 */
export async function handleAnalyzeVoice(ctx) {
  const replyMsg = ctx.message.reply_to_message;
  
  if (!replyMsg) {
    return ctx.reply(
      "💡 Reply to a voice message or audio file with /analyze to transcribe and translate it to your preferred language!"
    );
  }

  // Get file details
  let fileId, fileExtension;
  if (replyMsg.voice) {
    fileId = replyMsg.voice.file_id;
    fileExtension = "oga";
  } else if (replyMsg.audio) {
    fileId = replyMsg.audio.file_id;
    fileExtension = "mp3";
  } else if (replyMsg.document?.mime_type?.includes("audio")) {
    fileId = replyMsg.document.file_id;
    fileExtension = replyMsg.document.file_name?.split('.').pop() || "mp3";
  } else {
    return ctx.reply("⚠️ Please reply to a voice or audio message.");
  }

  await processVoiceAnalysis(ctx, fileId, fileExtension, replyMsg.message_id);
}

/**
 * Handle callback queries for voice analysis results
 */
export async function handleVoiceAnalysisCallback(ctx) {
  const [action, type, userId, messageId] = ctx.callbackQuery.data.split('_');
  if (action !== 'va') return;

  await ctx.answerCbQuery();

  const cached = analysisCache.get(`${userId}_${messageId}`);
  if (!cached || Date.now() > cached.expiresAt) {
    return ctx.reply("⚠️ Results expired. Send the audio again.");
  }

  try {
    const chatId = ctx.callbackQuery.message.chat.id;
    const originalMsgId = cached.originalAudioMessageId;

    if (type === 'transcript') {
      const langName = nameOf(cached.detectedLang);
      const langFlag = flagOf(cached.detectedLang);
      await ctx.telegram.sendMessage(
        chatId,
        `${langFlag} <b>Original (${langName}):</b>\n\n${cached.transcript}`,
        { parse_mode: "HTML", reply_to_message_id: originalMsgId }
      );
    } else if (type === 'translated') {
      const langName = nameOf(cached.userLang);
      const langFlag = flagOf(cached.userLang);
      await ctx.telegram.sendMessage(
        chatId,
        `${langFlag} <b>Translated (${langName}):</b>\n\n${cached.translatedText}`,
        { parse_mode: "HTML", reply_to_message_id: originalMsgId }
      );
    } else if (type === 'audio') {
      if (!cached.ttsFilePath || !fs.existsSync(cached.ttsFilePath)) {
        return ctx.reply("⚠️ Audio unavailable.");
      }
      const langName = nameOf(cached.userLang);
      const langFlag = flagOf(cached.userLang);
      await ctx.telegram.sendVoice(
        chatId,
        { source: cached.ttsFilePath },
        { caption: `${langFlag} Translated Audio (${langName})`, reply_to_message_id: originalMsgId }
      );
    }
  } catch (err) {
    console.error("[VoiceAnalyzer]", err.message);
    await ctx.reply("❌ Error retrieving results.");
  }
}

// Clean up expired cache every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of analysisCache.entries()) {
    if (now > value.expiresAt) {
      if (value.ttsFilePath && fs.existsSync(value.ttsFilePath)) {
        fs.unlinkSync(value.ttsFilePath);
      }
      analysisCache.delete(key);
    }
  }
}, 600000);

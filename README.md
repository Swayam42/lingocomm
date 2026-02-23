<div align="center">

# 🌐 LingoComm

### Real-time multilingual translation bot for Telegram communities

[![Hackathon](https://img.shields.io/badge/Lingo.dev-Multilingual%20Hackathon-7c3aed?style=for-the-badge)](https://lingo.dev)
[![Bot](https://img.shields.io/badge/Telegram-@autoTranslateCommBot-2CA5E0?style=for-the-badge&logo=telegram)](https://t.me/autoTranslateCommBot)
[![Deploy](https://img.shields.io/badge/Hosted%20on-Render-46E3B7?style=for-the-badge&logo=render)](https://lingocomm-bot.onrender.com)

---

> **80 % of internet users don't speak English natively.**
> In multilingual tech groups, developers from Brazil, Japan, and India stay silent — because manual translation takes minutes and the conversation has already moved on.

**LingoComm** fixes this by translating every group message into each member's preferred language in real time, across **25+ languages**.

```
@rahul (🇮🇳) :  मुझे बग मिला

LingoComm  →  🇬🇧 English: I found a bug
               🇯🇵 Japanese: バグを見つけました`
               🇧🇷 Portuguese (Brazil): Encontrei um bug
```

**Core innovation:** Lingo.dev's `batchLocalizeText()` — **1 API call** translates into all target languages simultaneously (10× faster than sequential translation loops).

</div>

---

## 📑 Table of Contents

- [How It Works](#-how-it-works)
- [Architecture](#-architecture)
- [Features](#-features)
- [Commands](#-commands)
- [Voice Analysis Pipeline](#-voice-analysis-pipeline)
- [Project Structure](#-project-structure)
- [Tech Stack](#-tech-stack)
- [Database Schemas](#-database-schemas)
- [Deployment](#-deployment)
- [Local Development](#-local-development)
- [Why Lingo.dev?](#-why-lingodev)

---

## 🔄 How It Works

1. **Add LingoComm** to your Telegram group
2. Each member sets their preferred language via `/lang` in a DM
3. Anyone sends a message in **any** language
4. LingoComm auto-detects the language, batch-translates, and replies in-thread with translations for every other language in the group

> Members who haven't set a preference are auto-detected based on their Telegram language and the language they write in.

---

## 🏗 Architecture

```mermaid
flowchart LR
    subgraph Users["Telegram Group"]
        U1["🇮🇳 User"]
        U2["🇯🇵 User"]
        U3["🇧🇷 User"]
    end

    subgraph Bot["LingoComm Bot · Node.js on Render"]
        RL["Rate Limiter\n500 ms cooldown\n10 msg / 5 s burst"]
        H{"Router"}
    end

    subgraph Pipeline["Translation Pipeline"]
        D["Detect Language\nlingo.recognizeLocale()"]
        B["Batch Translate\nlingo.batchLocalizeText()"]
    end

    subgraph Voice["Voice Pipeline"]
        DG["STT\nDeepgram Nova-2"]
        TTS["TTS\nGoogle WaveNet"]
        VC["In-Memory Cache\n1 h TTL"]
    end

    subgraph Data["MongoDB Atlas"]
        DB1["users\nlang prefs · groups"]
        DB2["groupStats\ntranslation counts"]
        DB3["messageLogs\n24 h TTL index"]
    end

    subgraph Web["Web · Render"]
        EX["Express API\n/api/stats · /health"]
        FE["Static Landing Page"]
    end

    U1 & U2 & U3 -->|send message| RL
    RL --> H
    H -->|text / caption| D --> B
    H -->|voice / audio| DG --> D --> B --> TTS
    B -->|reply in thread| U1 & U2 & U3
    TTS -->|audio reply| U1 & U2 & U3
    DG --> VC
    DB1 -->|language prefs| B
    B --> DB3 & DB2
    EX --- DB1 & DB2
    FE --> EX
```

> **Deploy topology:** `start.js` spawns both the Telegram bot process and the Express server as child processes. Render runs this as a single web service — the bot uses Telegram long-polling while Express serves the API and static landing page on the configured port (default `3001`).

---

## ✨ Features

| | Feature | Details |
|---|---------|---------|
| 🌐 | **Real-Time Translation** | Every text message is auto-translated to all group members' languages using a single `batchLocalizeText()` call |
| 🖼 | **Caption Translation** | Photo and document captions are translated just like text messages |
| 🎙 | **Voice Analysis** | Reply `/analyze` to a voice note → Deepgram transcribes → Lingo.dev translates → Google TTS synthesizes audio in your language |
| 🔗 | **Smart Content Handling** | URLs, code blocks, and emojis are preserved during translation — never broken |
| 🏷 | **Language Lock** | Set your language once with `/lang`; the bot remembers it even if you leave and rejoin |
| 🤖 | **Auto-Detection** | New users are auto-registered with language detected from their Telegram client and first message |
| 🛡 | **Rate Limiting** | 500 ms per-user cooldown + 10-message burst window prevents spam and API abuse |
| 🔁 | **Retry Logic** | Bot launch, MongoDB connection, and Telegram API calls all have exponential back-off retries |
| 📊 | **Personal Stats** | `/stats` in a group shows your language, message count, and membership info |
| 🔧 | **Admin Debug** | `/debug` (admin-only in groups) sends full diagnostics to your DM — registered members, language prefs, API status |
| 📈 | **Dashboard API** | Express REST API exposes live stats with geo-mapped language data |

---

## 🤖 Commands

| Command | Where | What it does |
|---------|-------|--------------|
| `/start` | DM / Group | Onboarding card with setup guide + inline keyboard |
| `/help` | DM / Group | List all commands and usage examples |
| `/lang <code>` | **DM only** | Set your preferred language (e.g. `/lang hi`) |
| `/langs` | **DM only** | Show all 27 supported language codes |
| `/stats` | **Group only** | Your personal stats in the current group |
| `/analyze` | **Group** (reply to voice/audio) | Transcribe + translate + generate TTS audio |
| `/debug` | **Group only** (admin) | Send full group diagnostic info to your DM |

### Supported Languages

<img src="https://flagcdn.com/24x18/gb.png" alt="English"> `/lang en` – English  
<img src="https://flagcdn.com/24x18/jp.png" alt="Japanese"> `/lang ja` – Japanese  
<img src="https://flagcdn.com/24x18/in.png" alt="Hindi"> `/lang hi` – Hindi  
<img src="https://flagcdn.com/24x18/in.png" alt="Odia"> `/lang or` – Odia  
<img src="https://flagcdn.com/24x18/cn.png" alt="Chinese"> `/lang zh` – Chinese  
<img src="https://flagcdn.com/24x18/cn.png" alt="Chinese (Simplified)"> `/lang zh-cn` – Chinese (Simplified)  
<img src="https://flagcdn.com/24x18/kr.png" alt="Korean"> `/lang ko` – Korean  
<img src="https://flagcdn.com/24x18/sa.png" alt="Arabic"> `/lang ar` – Arabic  
<img src="https://flagcdn.com/24x18/pt.png" alt="Portuguese"> `/lang pt` – Portuguese  
<img src="https://flagcdn.com/24x18/br.png" alt="Portuguese (Brazil)"> `/lang pt-br` – Portuguese (Brazil)  
<img src="https://flagcdn.com/24x18/es.png" alt="Spanish"> `/lang es` – Spanish  
<img src="https://flagcdn.com/24x18/fr.png" alt="French"> `/lang fr` – French  
<img src="https://flagcdn.com/24x18/de.png" alt="German"> `/lang de` – German  
<img src="https://flagcdn.com/24x18/ru.png" alt="Russian"> `/lang ru` – Russian  
<img src="https://flagcdn.com/24x18/it.png" alt="Italian"> `/lang it` – Italian  
<img src="https://flagcdn.com/24x18/tr.png" alt="Turkish"> `/lang tr` – Turkish  
<img src="https://flagcdn.com/24x18/pl.png" alt="Polish"> `/lang pl` – Polish  
<img src="https://flagcdn.com/24x18/nl.png" alt="Dutch"> `/lang nl` – Dutch  
<img src="https://flagcdn.com/24x18/vn.png" alt="Vietnamese"> `/lang vi` – Vietnamese  
<img src="https://flagcdn.com/24x18/th.png" alt="Thai"> `/lang th` – Thai  
<img src="https://flagcdn.com/24x18/id.png" alt="Indonesian"> `/lang id` – Indonesian  
<img src="https://flagcdn.com/24x18/ua.png" alt="Ukrainian"> `/lang uk` – Ukrainian  
<img src="https://flagcdn.com/24x18/se.png" alt="Swedish"> `/lang sv` – Swedish  
<img src="https://flagcdn.com/24x18/in.png" alt="Bengali"> `/lang bn` – Bengali  
<img src="https://flagcdn.com/24x18/in.png" alt="Tamil"> `/lang ta` – Tamil  
<img src="https://flagcdn.com/24x18/in.png" alt="Telugu"> `/lang te` – Telugu  
<img src="https://flagcdn.com/24x18/in.png" alt="Marathi"> `/lang mr` – Marathi


---

## 🎙 Voice Analysis Pipeline

```mermaid
sequenceDiagram
    autonumber
    participant User as 👤 User
    participant Bot as 🤖 LingoComm
    participant DG as 🎤 Deepgram Nova-2
    participant Lingo as 🔮 Lingo.dev
    participant GTTS as 🔊 Google WaveNet TTS

    User->>Bot: Reply to voice/audio with /analyze
    Bot->>Bot: Download audio via Telegram File API
    Bot->>DG: transcribe(buffer, nova-2, detect_language: true)
    DG-->>Bot: transcript + detectedLang
    Bot->>Lingo: translateOne(transcript, detectedLang, userLang)
    Lingo-->>Bot: Translated text
    Bot->>GTTS: synthesizeSpeech(translatedText, WaveNet voice)
    GTTS-->>Bot: MP3 audio buffer
    Bot->>User: Inline buttons — 📝 Original │ 🌐 Translated │ 🔊 Listen
    Note over Bot: Results cached in-memory for 1 hour
    User->>Bot: Tap any button
    Bot->>User: Text transcript or MP3 audio
```

---

## 📂 Project Structure

```
lingocomm/
├── bot/
│   ├── index.js              # Bot init, env validation, middleware, retry launch
│   ├── db.js                 # MongoDB connection with retry + reconnect handling
│   ├── translator.js         # Lingo.dev SDK — detectLanguage, translateToMany, translateOne
│   ├── handlers/
│   │   ├── message.js        # Text + photo/document caption translation engine
│   │   ├── commands.js       # /start /lang /langs /stats /help /debug + inline keyboards
│   │   ├── onJoin.js         # Member join/leave — auto-register, welcome messages
│   │   └── voiceAnalyzer.js  # Deepgram STT → Lingo.dev → Google TTS pipeline
│   └── models/
│       ├── User.js           # User preferences, groups, message count
│       ├── groupStats.js     # Per-group translation analytics
│       └── messageLog.js     # Message log with 24 h TTL index
├── server/
│   └── index.js              # Express API — /api/stats, /health, /healthz + static files
├── public/
│   ├── index.html            # Landing page
│   ├── script.js             # Dashboard stats fetching + animation
│   └── style.css             # Custom CSS with cursor effects
├── misc/
│   ├── DEPLOYMENT.md
│   ├── DEPLOYMENT_GUIDE.md
│   ├── TEST_PLAN.md
│   ├── TESTING_GUIDE.md
│   ├── VOICE_ANALYSIS_SETUP.md
│   └── analyze.md
├── start.js                  # Entry point — spawns bot + server as child processes
├── package.json
└── .env.example
```

---

## 🧰 Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| **Bot Framework** | Telegraf.js `4.16.3` | Telegram Bot API, middleware, inline keyboards |
| **Translation** | Lingo.dev SDK `0.131.1` | `recognizeLocale()` + `batchLocalizeText()` + `localizeText()` |
| **Speech-to-Text** | Deepgram SDK `4.11.3` | Nova-2 model, auto language detection |
| **Text-to-Speech** | Google Cloud TTS `6.4.0` | WaveNet neural voices for 13 locales |
| **Database** | MongoDB Atlas (Mongoose `8.3.0`) | User prefs, group stats, message logs |
| **Web Server** | Express.js `4.18.3` | REST API + static file serving |
| **Runtime** | Node.js 22.x (ES Modules) | Top-level `await`, `--watch` for dev |
| **Hosting** | Render | Single web service (bot + API) |

---

## 💾 Database Schemas

```js
// User — language preferences & group memberships
{
  telegramId: Number,       // unique
  username: String,
  firstName: String,
  locale: String,           // "en", "hi", "ja", ...
  manuallySet: Boolean,     // true = user ran /lang; false = auto-detected
  messageCount: Number,
  groups: [String],         // group IDs the user belongs to
  joinedAt: Date
}

// GroupStats — per-group analytics
{
  groupId: Number,          // unique
  groupName: String,
  totalTranslations: Number,
  memberCount: Number,
  languageBreakdown: Map<String, Number>,  // { "hi": 15, "en": 10 }
  lastActivity: Date
}

// MessageLog — auto-deleted after 24 hours (TTL index on sentAt)
{
  groupId: Number,
  userId: Number,
  username: String,
  text: String,
  detectedLocale: String,
  sentAt: Date
}
```

### REST API

```
GET  https://lingocomm-bot.onrender.com/api/stats   — users, translations, groups, language breakdown, map pins
GET  https://lingocomm-bot.onrender.com/health       — health check
GET  https://lingocomm-bot.onrender.com/healthz      — health check with uptime
```

---

## 🚀 Deployment

### Render (Production)

LingoComm is live at **[lingocomm-bot.onrender.com](https://lingocomm-bot.onrender.com)**

1. Push the repo to GitHub
2. Render Dashboard → **New Web Service** → connect the repo
3. Configure build & start:
   ```
   Build Command:  npm install
   Start Command:  node start.js
   ```
4. Add environment variables:

   | Variable | Source |
   |----------|--------|
   | `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) |
   | `LINGODOTDEV_API_KEY` | [lingo.dev](https://lingo.dev) |
   | `MONGODB_URI` | [MongoDB Atlas](https://cloud.mongodb.com) |
   | `DEEPGRAM_API_KEY` | [deepgram.com](https://deepgram.com) *(for /analyze)* |
   | `GOOGLE_APPLICATION_CREDENTIALS` | Google Cloud Console *(path to service account JSON — for /analyze TTS)* |
   | `PORT` | Port for Express server (default `3001`) |
   | `ADMIN_USERNAME` | Your Telegram username |

5. Click **Deploy**

> ⚠️ Render's free tier sleeps after 15 min of inactivity. Use Paid tier or a keep-alive ping service for production bots.

---

## 💻 Local Development

```bash
git clone https://github.com/Swayam42/lingocomm.git
cd lingocomm
npm install

cp .env.example .env
# Fill in: TELEGRAM_BOT_TOKEN, LINGODOTDEV_API_KEY, MONGODB_URI
# Optional: DEEPGRAM_API_KEY, GOOGLE_APPLICATION_CREDENTIALS, ADMIN_USERNAME

# Start both bot + server
npm start

# Or run just the bot in watch mode (auto-restarts on changes)
npm run dev

# Or run just the Express server
npm run server
```

---

## 🔬 Why Lingo.dev?

```js
// ❌ Traditional — N sequential API calls for N languages
for (const lang of targetLanguages) {
  await someTranslateAPI(text, lang);   // 10 calls, 4 – 8 seconds
}

// ✅ Lingo.dev — 1 call, all languages at once
const translations = await lingo.batchLocalizeText(text, {
  sourceLocale: "hi",
  targetLocales: ["en", "ja", "pt", "es", "fr", "de", "ko", "ar", "zh", "ru"],
});
```

| Metric | Traditional | Lingo.dev |
|--------|-------------|-----------|
| API calls (10 langs) | 10 | **1** |
| Avg response time | 4 – 8 s | **0.8 – 1.5 s** |
| Cost at scale | High | **~90 % less** |
| Language support | Varies | **100+** |

**Additional Lingo.dev features used:**
- `recognizeLocale()` — auto-detect source language without a full translation call
- `localizeText()` with `fast: true` — single-target translation for UI strings and fallbacks
- Batch fallback — if `batchLocalizeText()` fails, graceful degradation to individual `localizeText()` calls

---

<div align="center">

**Built for the [Lingo.dev Multilingual Hackathon](https://lingo.dev) · February 2026**

[![Try Bot](https://img.shields.io/badge/Try-@autoTranslateCommBot-2CA5E0?style=for-the-badge&logo=telegram)](https://t.me/autoTranslateCommBot)
[![Render](https://img.shields.io/badge/Live-lingocomm--bot.onrender.com-46E3B7?style=for-the-badge&logo=render)](https://lingocomm-bot.onrender.com)
[![GitHub](https://img.shields.io/badge/Source-GitHub-black?style=for-the-badge&logo=github)](https://github.com/Swayam42/lingocomm)

---

*"Language should never be a barrier to brilliant ideas."*

</div>

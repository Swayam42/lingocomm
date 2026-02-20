import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB } from "../bot/db.js";
import { User } from "../bot/models/User.js";
import { groupStats } from "../bot/models/groupStats.js";
import { messageLog } from "../bot/models/messageLog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await connectDB();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "../public")));


const LANG_COORDS = {
  en: { lat:51.5, lng:-0.1, country:"United Kingdom" },
  ja: { lat:36.2, lng:138.3, country:"Japan" },
  hi: { lat:20.6, lng:78.9, country:"India" },
  zh: { lat:35.9, lng:104.2, country:"China" },
  ko: { lat:35.9, lng:127.7, country:"South Korea" },
  ar: { lat:23.8, lng:45.0, country:"Saudi Arabia" },
  pt: { lat:-14.2, lng:-51.9, country:"Brazil" },
  es: { lat:40.4, lng:-3.7, country:"Spain" },
  fr: { lat:46.2, lng:2.2, country:"France" },
  de: { lat:51.2, lng:10.4, country:"Germany" },
  ru: { lat:61.5, lng:105.3, country:"Russia" },
  it: { lat:41.9, lng:12.5, country:"Italy" },
  tr: { lat:38.9, lng:35.2, country:"Turkey" },
  pl: { lat:51.9, lng:19.1, country:"Poland" },
  nl: { lat:52.1, lng:5.3, country:"Netherlands" },
  vi: { lat:14.1, lng:108.3, country:"Vietnam" },
  th: { lat:15.9, lng:100.9, country:"Thailand" },
  id: { lat:-0.8, lng:113.9, country:"Indonesia" },
  uk: { lat:48.4, lng:31.2, country:"Ukraine" },
  bn: { lat:23.7, lng:90.4, country:"Bangladesh" },
  sv: { lat:60.1, lng:18.6, country:"Sweden" },
};

//  /api/stats
app.get("/api/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const allUsers = await User.find().lean();

    // Language breakdown from user preferences
    const langCounts = {};
    for (const u of allUsers) {
      const l = u.locale || "en";
      langCounts[l] = (langCounts[l] || 0) + 1;
    }

    // Total translations across all groups
    const groups = await groupStats.find().lean();
    const totalTranslations = groups.reduce((sum, g) => sum + (g.totalTranslations || 0), 0);
    const totalGroups = groups.length;

    // Map pins
    const mapPins = Object.entries(langCounts)
      .map(([locale, count]) => {
        const coords = LANG_COORDS[locale];
        if (!coords) return null;
        return { locale, count, ...coords };
      })
      .filter(Boolean);

    res.json({
      totalUsers,
      totalTranslations,
      totalGroups,
      languageBreakdown: langCounts,
      mapPins,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//  Health
app.get("/health", (req, res) => {
  res.json({ status: "ok", app: "LingoComm API", ts: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`LingoComm API running at http://localhost:${PORT}`);
});
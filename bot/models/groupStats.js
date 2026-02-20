import mongoose from "mongoose";

const groupStatsSchema = new mongoose.Schema(
  {
    groupId: { type: Number, required: true, unique: true },
    groupName: { type: String, default: "Unknown Group" },
    totalTranslations: { type: Number, default: 0 },
    memberCount: { type: Number, default: 0 },
    languageBreakdown: { type: Map, of: Number, default: {} },
    lastActivity: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const groupStats = mongoose.model("groupStats", groupStatsSchema);
import mongoose from "mongoose";

const messageLogSchema = new mongoose.Schema(
  {
    groupId: { type: Number, required: true, index: true },
    userId: { type: Number, required: true },
    username: { type: String, default: "Anonymous" },
    text: { type: String, required: true },
    detectedLocale: { type: String, default: "en" },
    sentAt: { type: Date, default: Date.now },
  }
);

// Auto-delete messages older than 24 hours
messageLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 86400 });

export const messageLog = mongoose.model("messageLog", messageLogSchema);
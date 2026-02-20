import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true },
    username: { type: String, default: "" },
    firstName: { type: String, default: "" },
    locale: { type: String, default: "en" },
    manuallySet: { type: Boolean, default: false },   // true if user explicitly set language
    messageCount: { type: Number, default: 0 },
    groups: [{ type: String }],
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", UserSchema);
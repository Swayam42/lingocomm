import { User } from "../models/User.js";
import { translateOne, nameOf, flagOf } from "../translator.js";

export async function handleNewMember(ctx) {
  const newMembers = ctx.message.new_chat_members;
  if (!newMembers || newMembers.length === 0) return;

  const groupId = ctx.chat.id.toString();

  for (const member of newMembers) {
    if (member.is_bot) {
      if (member.id === ctx.botInfo.id) {
        console.log(`[Lingo.dev] Added to group: ${ctx.chat.title || groupId}`);
        
        // Send welcome message to existing members in the group
        await ctx.reply(
          `<b>LingoComm Bot Activated</b>\n\n` +
          `I'll automatically translate messages into everyone's preferred language.\n\n` +
          `<b>For existing members:</b>\n` +
          `<b>To customize your language:</b>\n` +
          `1. DM me: @${ctx.botInfo.username}\n` +
          `2. Use /lang [code]\n\n` +
          `Examples:\n` +
          `🇮🇳 <code>/lang hi</code> - Hindi\n` +
          `🇮🇳 <code>/lang or</code> - Odia\n` +
          `🇯🇵 <code>/lang ja</code> - Japanese\n` +
          `🇪🇸 <code>/lang es</code> - Spanish\n\n` +
          `See all: <code>/langs</code>\n\n` +
          `<i>Just start chatting - I'll handle the rest.</i>`,
          { parse_mode: "HTML" }
        );
      }
      continue;
    }

    const userId = member.id;
    const firstName = member.first_name || "there";
    const username = member.username || firstName;

    console.log(`[Lingo.dev] User ${username} joined group ${groupId}`);

    let user = await User.findOne({ telegramId: userId });
    const hasPreference = user && user.manuallySet;

    if (!user) {
      user = await User.create({
        telegramId: userId,
        username: member.username || "",
        firstName: member.first_name || "",
        locale: "en",
        manuallySet: false,
        groups: [groupId],
      });
    } else {
      await User.findOneAndUpdate(
        { telegramId: userId },
        { 
          $addToSet: { groups: groupId },
          username: member.username || user.username,
          firstName: member.first_name || user.firstName,
        }
      );
    }

    const safeFirstName = escapeHtml(firstName);
    const englishWelcome =
      `Welcome ${safeFirstName}\n\n` +
      `This group uses LingoComm - messages are translated into everyone's language automatically.\n\n` +
      `<b>Important:</b> Until you register, you'll see English translations by default.\n\n` +
      `To set your language:\n` +
      `1. DM @${ctx.botInfo.username}\n` +
      `2. Use /lang (example: /lang or for Odia)\n\n` +
      `Then just chat - translations will match your preference.`;

    let welcomeLocale = user.locale || "en";
    let localizedWelcome = englishWelcome;

    if (!hasPreference && member.language_code) {
      const tgLang = member.language_code.split("-")[0];
      welcomeLocale = tgLang || "en";
      if (welcomeLocale !== "en") {
        localizedWelcome = await translateOne(englishWelcome, "en", welcomeLocale);
        await User.findOneAndUpdate(
          { telegramId: userId },
          { locale: welcomeLocale, manuallySet: false }
        );
      }
    }

    const flag = flagOf(welcomeLocale);

    await ctx.reply(
      `${flag}\n\n${localizedWelcome}`,
      { parse_mode: "HTML" }
    );

    try {
      const safeGroupTitle = escapeHtml(ctx.chat.title || "a group");
      await ctx.telegram.sendMessage(
        userId,
        `Hi ${safeFirstName}\n\n` +
        `You joined <b>${safeGroupTitle}</b> that uses LingoComm.\n\n` +
        `<b>Default Language: English</b>\n` +
        `Until you set a preference, you'll see English translations.\n\n` +
        `<b>To change your language:</b>\n` +
        `🇮🇳 <code>/lang hi</code> - Hindi\n` +
        `🇮🇳 <code>/lang or</code> - Odia\n` +
        `🇯🇵 <code>/lang ja</code> - Japanese\n` +
        `🇪🇸 <code>/lang es</code> - Spanish\n\n` +
        `See all languages: <code>/langs</code>\n\n` +
        `<i>Start chatting in the group - the bot will handle the rest.</i>`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.log(`[Lingo.dev] Can't DM ${username} (needs to /start bot)`);
    }
  }
}

export async function handleLeftMember(ctx) {
  const leftMember = ctx.message.left_chat_member;
  if (!leftMember || leftMember.is_bot) return;

  const groupId = ctx.chat.id.toString();
  const userId = leftMember.id;

  console.log(`[Lingo.dev] User ${leftMember.username || userId} left group ${groupId}`);

  const user = await User.findOne({ telegramId: userId });
  if (!user) return;

  // Remove this group from user's groups array
  const updatedGroups = user.groups.filter(g => g !== groupId);

  // Keep user preferences even if they leave all groups
  // This allows them to retain language settings when they rejoin
  await User.findOneAndUpdate(
    { telegramId: userId },
    { groups: updatedGroups }
  );
  
  console.log(`[Lingo.dev] Removed group ${groupId} from user ${userId} (${updatedGroups.length} groups remaining)`);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
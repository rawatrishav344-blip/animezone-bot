// Delivery Bot — 2 payload types:
//   "ep_<animeId>_<episodeId>" → anime episode (auto-delete NAHI hota)
//   "x001" (ya jo bhi exclusiveContent id ho) → standalone exclusive content (30 min baad auto-delete)

const { Telegraf } = require("telegraf");
const db = require("./db");

const BOT_TOKEN = "PASTE_DELIVERY_BOT_TOKEN_HERE"; // har delivery bot ka apna token

const SOURCE_GROUP_ID = -1004482181536;

const bot = new Telegraf(BOT_TOKEN);

const AUTO_DELETE_MS = 30 * 60 * 1000; // 30 minute

async function sendContent(ctx, ids, label, autoDelete) {
  await ctx.reply(`📤 Content Bhej Raha Hoon\n\n${label}\n\nThoda intezaar karein...`);

  for (const msgId of ids) {
    try {
      const sent = await ctx.telegram.copyMessage(ctx.chat.id, SOURCE_GROUP_ID, msgId, {
        protect_content: true,
      });

      if (autoDelete) {
        setTimeout(() => {
          ctx.telegram.deleteMessage(ctx.chat.id, sent.message_id).catch(() => {});
        }, AUTO_DELETE_MS);
      }
    } catch (err) {
      console.log("Failed to send message", msgId, err.message);
    }
  }

  if (autoDelete) {
    ctx.reply(
      `✅ Delivery Complete\n\n${label}\n\n⏱️ Yeh content 30 minute baad is chat se automatically delete ho jayega. Kripya isi dauran dekh lein.`
    );
  } else {
    ctx.reply(`✅ Delivery Complete\n\n${label}\n\nYeh content hamesha aapki chat mein available rahega.`);
  }
}

bot.start(async (ctx) => {
  const payload = ctx.startPayload;
  if (!payload) {
    return ctx.reply("👋 AnimeZone Delivery Bot\n\nMini App se content select karke yahan aayein.");
  }

  const data = db.read();

  if (payload.startsWith("ep_")) {
    const [, animeId, epId] = payload.split("_");
    const anime = data.animeList.find((a) => a.id === animeId);
    const episode = anime?.episodes.find((e) => e.id === epId);
    const ids = episode?.sourceMessageIds || [];

    if (!episode || ids.length === 0) {
      return ctx.reply("❌ Episode Nahi Mila\n\nYeh episode abhi available nahi hai. Baad mein try karein.");
    }
    return sendContent(ctx, ids, `${anime.name} — ${episode.title}`, false);
  }

  // Exclusive content (id jaisa "x001") — auto-delete hota hai
  const item = (data.exclusiveContent || []).find((c) => c.id === payload);
  const ids = item?.sourceMessageIds || [];

  if (!item || ids.length === 0) {
    return ctx.reply("❌ Content Nahi Mila\n\nYeh content abhi available nahi hai. Baad mein try karein.");
  }
  return sendContent(ctx, ids, item.title, true);
});

bot.launch();
console.log("Delivery bot started.");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));


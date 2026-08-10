const { Telegraf } = require("telegraf");
const axios = require('axios');
const FormData = require('form-data');
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const db = require("./db");

// ---------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------
const BOT_TOKEN = "8663771330:AAGAqc2aep2tGKSLy-ZspnF97ZnYlC-kdyU";
const MINI_APP_URL = "https://rawatrishav344-blip.github.io/signal-app/";
const IMGBB_API_KEY = "e12ba8362a50878ec4a308d7658d2093";

const REQUIRED_CHANNEL_ID = -1003658720982;
const REQUIRED_CHANNEL_LINK = "https://t.me/+urVKqfH6Q143MTc9";

const CONTENT_SOURCE_CHANNEL_ID = -1004482181536;

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ---------------------------------------------------------------------
// TELEGRAM initData VERIFICATION
// ---------------------------------------------------------------------
function verifyInitData(initData) {
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    urlParams.delete("hash");

    const dataCheckArr = [];
    for (const [key, value] of [...urlParams.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      dataCheckArr.push(`${key}=${value}`);
    }
    const dataCheckString = dataCheckArr.join("\n");

    const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (computedHash !== hash) return null;

    const userStr = urlParams.get("user");
    return userStr ? JSON.parse(userStr) : null;
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------
// ACCESS CHECK
// ---------------------------------------------------------------------
async function isUserVerified(userId) {
  try {
    const member = await bot.telegram.getChatMember(REQUIRED_CHANNEL_ID, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (err) {
    return false;
  }
}

function sendJoinPrompt(ctx) {
  return ctx.reply("AnimeZone use karne ke liye pehle channel join karo 👇", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📢 Join Channel", url: REQUIRED_CHANNEL_LINK }],
        [{ text: "✅ Maine Join Kar Liya — Verify Karo", callback_data: "verify_join" }],
      ],
    },
  });
}

async function sendOpenAppButton(ctx) {
  const userId = ctx.from.id;
  const data = await db.read();
  const prevMsgId = data.users[userId]?.lastAppMessageId;

  // Point 1: agar purana "Open App" message hai to pehle delete karo, spam-proof
  if (prevMsgId) {
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, prevMsgId);
    } catch (err) {
      // purana message pehle se delete ho chuka hoga, ignore
    }
  }

  const sent = await ctx.reply("Verified ✅ Anime dekhne ke liye niche button dabao 👇", {
    reply_markup: {
      inline_keyboard: [[{ text: "▸ Open App", web_app: { url: MINI_APP_URL } }]],
    },
  });

  await db.update((d) => {
    d.users[userId] = { ...(d.users[userId] || {}), lastAppMessageId: sent.message_id };
  });
}

bot.start(async (ctx) => {
  const verified = await isUserVerified(ctx.from.id);
  if (verified) return sendOpenAppButton(ctx);
  return sendJoinPrompt(ctx);
});

bot.action("verify_join", async (ctx) => {
  await ctx.answerCbQuery("Checking your membership...");
  const verified = await isUserVerified(ctx.from.id);
  if (verified) {
    await ctx.editMessageText(
      "✅ Verification Successful\n\nAapne channel join kar liya hai. Ab aap AnimeZone ka poora content access kar sakte hain."
    );
    return sendOpenAppButton(ctx);
  }
  return ctx.reply(
    "⚠️ Verification Failed\n\nHumein channel mein aapki membership nahi mili. Kripya pehle channel join karein, uske baad dobara verify karein."
  );
});

async function isAdmin(userId) {
  const data = await db.read();
  return data.config.adminIds.includes(userId);
}

// ---------------------------------------------------------------------
// AUTO-ADD FROM CONTENT SOURCE CHANNEL
// ---------------------------------------------------------------------
// Do tarah ke posts:
// 1) ANIME INFO POST — caption format:
//      #ANIME
//      Naam
//      Category line (e.g. "Action • Dual Audio")
//      Description (baaki lines)
//    Isse ek naya anime series banta hai, jab tak agla #ANIME na aaye
//    tab tak jitne bhi episode posts aayenge sab isी series mein jud jayenge.
//
// 2) EPISODE POST — caption format:
//      1. Episode Title
//      Episode description (optional)
//      Duration (optional, jaise "23m")
//    Yeh jis anime ke "current" context mein hai usी mein add hota hai.
//
// [DARK] marker kisi bhi caption mein ho to wo exclusive/DARK bucket mein jata hai
// (episode ya poora anime dono par lagaya ja sakta hai)
// ---------------------------------------------------------------------

const pendingGroups = {}; // media_group_id -> { messages, caption, timer }

bot.on(["channel_post"], async (ctx) => {
  const post = ctx.channelPost || ctx.update.channel_post;
  if (!post) return;
  if (post.chat.id !== CONTENT_SOURCE_CHANNEL_ID) return;

  const hasMedia = post.photo || post.video;
  if (!hasMedia) return;

  if (post.media_group_id) {
    const key = post.media_group_id;
    if (!pendingGroups[key]) pendingGroups[key] = { messages: [], caption: null, timer: null };
    pendingGroups[key].messages.push(post);
    if (post.caption) pendingGroups[key].caption = post.caption;

    if (pendingGroups[key].timer) clearTimeout(pendingGroups[key].timer);
    pendingGroups[key].timer = setTimeout(async () => {
      await handleIncomingPost(pendingGroups[key].messages, pendingGroups[key].caption);
      delete pendingGroups[key];
    }, 1500);
  } else {
    if (!post.caption) return;
    handleIncomingPost([post], post.caption);
  }
});
bot.on("edited_channel_post", async (ctx) => {
  const post = ctx.editedChannelPost || ctx.update.edited_channel_post;

  if (!post) return;
  if (post.chat.id !== CONTENT_SOURCE_CHANNEL_ID) return;

  const hasMedia = post.photo || post.video;
  if (!hasMedia) return;

  console.log("Edited post detected:", post.message_id);

  if (post.media_group_id) {
    const key = "edit_" + post.media_group_id;

    if (!pendingGroups[key]) {
      pendingGroups[key] = {
        messages: [],
        caption: null,
        timer: null,
      };
    }

    pendingGroups[key].messages.push(post);

    if (post.caption) {
      pendingGroups[key].caption = post.caption;
    }

    if (pendingGroups[key].timer) {
      clearTimeout(pendingGroups[key].timer);
    }

    pendingGroups[key].timer = setTimeout(async () => {
      await handleEditedPost(
        pendingGroups[key].messages,
        pendingGroups[key].caption
      );

      delete pendingGroups[key];
    }, 1500);

  } else {

    handleEditedPost(
      [post],
      post.caption || ""
    );

  }
});
async function getThumbnailUrl(firstMsg) {
  let fileId = null;
  if (firstMsg.photo && firstMsg.photo.length > 0) fileId = firstMsg.photo[firstMsg.photo.length - 1].file_id;
  else if (firstMsg.video) fileId = firstMsg.video.thumb?.file_id || firstMsg.video.thumbnail?.file_id || null;

  if (!fileId) return "https://via.placeholder.com/500x750";

  try {
    const file = await bot.telegram.getFile(fileId);
    const tgUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    // 1. Download image into Buffer
    const response = await axios.get(tgUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    // 2. Try ImgBB first
    try {
      const imgbbForm = new FormData();
      imgbbForm.append('image', buffer.toString('base64'));
      const imgbbUpload = await axios.post(
        `https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`,
        imgbbForm,
        { headers: imgbbForm.getHeaders() }
      );
      if (imgbbUpload.data?.data?.url) return imgbbUpload.data.data.url;
    } catch (e) { console.log("ImgBB failed, trying Telegra.ph..."); }

    // 3. Try Telegra.ph as backup
    try {
      const form = new FormData();
      form.append('file', buffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
      const upload = await axios.post('https://telegra.ph/upload', form, { headers: form.getHeaders() });
      if (upload.data[0]?.src) return `https://telegra.ph${upload.data[0].src}`;
    } catch (e) { console.log("Telegra.ph failed, trying Graph.org..."); }

    // 4. Try Graph.org as backup
    try {
      const form2 = new FormData();
      form2.append('file', buffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
      const upload2 = await axios.post('https://graph.org/upload', form2, { headers: form2.getHeaders() });
      if (upload2.data[0]?.src) return `https://graph.org${upload2.data[0].src}`;
    } catch (e) { console.log("Graph.org also failed."); }

    // 5. Fallback to Telegram link
    const link = await bot.telegram.getFileLink(fileId);
    return link.href || link.toString();

  } catch (err) {
    console.log("❌ All permanent methods failed:", err.message);
    return "https://via.placeholder.com/500x750";
  }
}
// ---------------------------------------------------------------------
// CONTENT SYNC HELPERS
// ---------------------------------------------------------------------

function getPhotoMessage(messages) {
  return messages.find((m) => m.photo || m.video) || null;
}

function findEpisodeByMessageId(data, messageId) {
  for (const anime of data.animeList){
    const episode = anime.episodes.find(
      (ep) => (ep.sourceMessageIds || []).includes(messageId)
    );

    if (episode) {
      return { anime, episode };
    }
  }

  return null;
}

function findAnimeByMessageId(data, messageId) {
  return data.animeList.find(
    (anime) => (anime.sourceMessageIds || []).includes(messageId)
  );
}

function findExclusiveByMessageId(data, messageId) {
  return (data.exclusiveContent || []).find(
    (item) => (item.sourceMessageIds || []).includes(messageId)
  );
}

function deleteEpisodeByMessageId(data, messageId) {
  for (const anime of data.animeList) {
    const index = anime.episodes.findIndex(
      (ep) => (ep.sourceMessageIds || []).includes(messageId)
    );

    if (index !== -1) {
      anime.episodes.splice(index, 1);
      return true;
    }
  }

  return false;
}

function deleteAnimeByMessageId(data, messageId) {
  const index = data.animeList.findIndex(
    (anime) => (anime.sourceMessageIds || []).includes(messageId)
  );

  if (index !== -1) {
    data.animeList.splice(index, 1);
    return true;
  }

  return false;
}

function deleteExclusiveByMessageId(data, messageId) {
  const index = (data.exclusiveContent || []).findIndex(
    (item) => (item.sourceMessageIds || []).includes(messageId)
  );

  if (index !== -1) {
    data.exclusiveContent.splice(index, 1);
    return true;
  }

  return false;
}
async function handleEditedPost(messages, caption) {

  const firstMsg = messages[0];
  const messageId = firstMsg.message_id;
  const mediaGroupId = firstMsg.media_group_id || null;
  const trimmed = (caption || "").trim();

  const isDelete = /^\[DELETE\]/i.test(trimmed);

  if (isDelete) {

    await db.update((data) => {

      if (deleteEpisodeByMessageId(data, messageId)) {
        console.log("Episode deleted");
        return;
      }

      if (deleteAnimeByMessageId(data, messageId)) {
        console.log("Anime deleted");
        return;
      }

      if (deleteExclusiveByMessageId(data, messageId)) {
        console.log("Exclusive deleted");
        return;
      }

    });

    return;
  }

  const trimmedCaption = (caption || "").trim();

const isAnimeInfo = /^#ANIME/i.test(trimmedCaption);

const lines = trimmedCaption
  .replace(/\[DELETE\]/i, "")
  .replace(/^#ANIME/i, "")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

if (isAnimeInfo) {

  await updateAnimeByMessageId(messageId, mediaGroupId, messages, lines);

} else if (/^\[DARK\]/i.test(trimmedCaption)) {

  await updateExclusiveByMessageId(messageId, mediaGroupId, messages, lines);

} else {

  await updateEpisodeByMessageId(messageId, mediaGroupId, messages, lines);

}

}

async function handleIncomingPost(messages, caption) {
  const trimmed = caption.trim();
  const isDark = /\[DARK\]/i.test(trimmed);
  const isAnimeInfo = /^#ANIME/i.test(trimmed);

  if (isDark) {
    // [DARK] wala post — anime series se bilkul alag, standalone Exclusive card
    const lines = trimmed
      .replace(/\[DARK\]/i, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    await addExclusiveContent(messages, lines);
    return;
  }

  const lines = trimmed
    .replace(/^#ANIME/i, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (isAnimeInfo) {
    await addAnimeInfo(messages, lines);
  } else {
    await addEpisode(messages, lines);
  }
}

// Standalone Exclusive content — Signal-style single card, koi episode-list nahi
// Caption format: Title / Episode / Duration / Category (jaisa Signal mein tha)
async function addExclusiveContent(messages, lines) {
  const [title, episode, duration, category] = lines;
  if (!title) return;

  const thumbnail = await getThumbnailUrl(messages[0]);
  const sourceMessageIds = messages.map((m) => m.message_id);

const alreadyExists = data =>
  (data.exclusiveContent || []).find(item =>
    (item.sourceMessageIds || []).some(id => sourceMessageIds.includes(id))
  );

  await db.update((data) => {
   if (alreadyExists(data)) {
  console.log("Duplicate exclusive ignored");
  return;
}
    if (!data.exclusiveContent) data.exclusiveContent = [];
    const id = "x" + String(data.exclusiveContent.length + 1).padStart(3, "0");
    data.exclusiveContent.push({
      id,
      title,
      episode: episode || String(data.exclusiveContent.length + 1),
      duration: duration || "",
      region: category || "",
      thumbnail,
      uploadDate: new Date().toISOString().slice(0, 10),
      deliveryBotIndex: data.exclusiveContent.length % (data.deliveryBots?.length || 1),
      sourceMessageIds,
      sourceType: "exclusive",
sourceMediaGroupId: messages[0].media_group_id || null,
    });
  });
  console.log(`Auto-added exclusive content: ${title}`);
}
async function updateExclusiveByMessageId(messageId, mediaGroupId, messages, lines) {

  const [title, episode, duration, category] = lines;

  const thumbnail = messages[0]
    ? await getThumbnailUrl(messages[0])
    : null;

  await db.update((data) => {

    const item = (data.exclusiveContent || []).find(x =>
      (x.sourceMessageIds || []).includes(messageId)
    );

    if (!item) return;

    item.title = title || item.title;
    item.episode = episode || item.episode;
    item.duration = duration || item.duration;
    item.region = category || item.region;

    if (thumbnail) item.thumbnail = thumbnail;

    item.sourceMessageIds = messages.map(m => m.message_id);
    item.sourceMediaGroupId =
  mediaGroupId || item.sourceMediaGroupId;

    console.log("Exclusive updated");

  });

}

// Anime info caption format (line by line):
//   #ANIME
//   Naam
//   Category line (jaise "Action • Dual Audio")
//   Age rating (jaise "16+")
//   Rating (jaise "4.5 | 1200" — star rating | kitne logon ne rate kiya)
//   Category tag(s) — Trending / Popular / New Release / Movies. Ek se zyada
//   ho to comma se separate karo, jaise "Trending, Popular"
//   Description (baaki jitni lines bachi)
async function addAnimeInfo(messages, lines) {
  const [name, meta, ageRating, ratingLine, categoryTag, ...descLines] = lines;
  if (!name) return;

  const thumbnail = await getThumbnailUrl(messages[0]);
  const sourceMessageIds = messages.map((m) => m.message_id);
  const description = descLines.join(" ").trim();

  let rating = 0;
  let ratingCount = 0;
  if (ratingLine && ratingLine.includes("|")) {
    const [r, c] = ratingLine.split("|").map((s) => s.trim());
    rating = parseFloat(r) || 0;
    ratingCount = parseInt(c) || 0;
  }

  const validTags = ["trending", "popular", "new release", "movies"];
  const tags = (categoryTag || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => validTags.includes(t));

  await db.update((data) => {
const alreadyExists = data.animeList.find(a =>
      (a.sourceMessageIds || []).some(id => sourceMessageIds.includes(id))
    );

    if (alreadyExists) {
      console.log("Duplicate anime ignored");
      return;
    }
    const id = "a" + String(data.animeList.length + 1).padStart(3, "0");
    data.animeList.push({
      id,
      name,
      meta: meta || "",
      ageRating: ageRating || "",
      rating,
      ratingCount,
      categoryTags: tags,
      description: description || "",
      thumbnail,
      uploadDate: new Date().toISOString().slice(0, 10),
      episodes: [],
      sourceMessageIds,
sourceType: "anime",
sourceMediaGroupId: messages[0].media_group_id || null,
    });
  });
  console.log(`Auto-added anime: ${name}`);
}

async function addEpisode(messages, lines) {
  const [title, ...descLines] = lines;
  if (!title) return;

  const numberMatch = title.match(/^(\d+)/);
  const episodeNumber = numberMatch ? parseInt(numberMatch[1]) : 999999;

  const durationMatch = descLines.find((l) => /^\d+h\s*\d*m?$|^\d+m$/i.test(l.trim()));
  const description = descLines.filter((l) => l !== durationMatch).join(" ").trim();

  let thumbnail;

const photoMsg = getPhotoMessage(messages);

if (photoMsg) {
  thumbnail = await getThumbnailUrl(photoMsg);
}
  const sourceMessageIds = messages.map((m) => m.message_id);

  await db.update((data) => {
    if (data.animeList.length === 0) return; // koi anime series shuru nahi hui 
   const currentAnime = data.animeList[data.animeList.length - 1]; // sabse last wale anime mein jode
if (!thumbnail) {
  thumbnail = currentAnime.thumbnail;
}
const alreadyExists = currentAnime.episodes.find(ep =>
        (ep.sourceMessageIds || []).some(id => sourceMessageIds.includes(id))
      );

      if (alreadyExists) {
        console.log("Duplicate episode ignored");
        return;
      }  
  const epId = "e" + String(currentAnime.episodes.length + 1).padStart(3, "0");
    currentAnime.episodes.push({
      id: epId,
      title,
      episodeNumber,
      description,
      duration: durationMatch || "",
      thumbnail,
      deliveryBotIndex: currentAnime.episodes.length % (data.deliveryBots?.length || 1),
      sourceMessageIds,
sourceType: "episode",
sourceMediaGroupId: messages[0].media_group_id || null,
    });
  });
  console.log(`Auto-added episode: ${title}`);
}

async function updateEpisodeByMessageId(messageId, mediaGroupId, messages, lines) {

  const [title, ...descLines] = lines;

  const numberMatch = title.match(/^(\d+)/);
  const episodeNumber = numberMatch ? parseInt(numberMatch[1]) : 999999;

  const durationMatch = descLines.find((l) => /^\d+h\s*\d*m?$|^\d+m$/i.test(l.trim()));
  const description = descLines.filter((l) => l !== durationMatch).join(" ").trim();

  const thumbnail = await getThumbnailUrl(messages[0]);

await db.update((data) => {

    for (const anime of data.animeList) {

      const ep = anime.episodes.find(e =>
        (e.sourceMessageIds || []).includes(messageId)
      );

      if (!ep) continue;

      ep.title = title;
      ep.episodeNumber = episodeNumber;
      ep.description = description;
      ep.duration = durationMatch || "";

      console.log("Episode updated");
      ep.thumbnail = thumbnail;
      ep.sourceMediaGroupId = mediaGroupId || ep.sourceMediaGroupId;
      ep.sourceMessageIds = messages.map((m) => m.message_id);
      return;

    }

  });

}
async function updateAnimeByMessageId(messageId, mediaGroupId, messages, lines) {

  const [name, meta, ageRating, ratingLine, categoryTag, ...descLines] = lines;

  let rating = 0;
  let ratingCount = 0;

  if (ratingLine && ratingLine.includes("|")) {

    const [r, c] = ratingLine.split("|").map(s => s.trim());

    rating = parseFloat(r) || 0;
    ratingCount = parseInt(c) || 0;

  }

  const validTags = [
    "trending",
    "popular",
    "new release",
    "movies"
  ];

  const tags = (categoryTag || "")
    .split(",")
    .map(t => t.trim().toLowerCase())
    .filter(t => validTags.includes(t));
const thumbnail = messages[0] ? await getThumbnailUrl(messages[0]) : null;
  await db.update((data) => {

    const anime = data.animeList.find(a =>
      (a.sourceMessageIds || []).includes(messageId)
    );

    if (!anime) return;

    anime.name = name;
    anime.meta = meta || "";
    anime.ageRating = ageRating || "";
    anime.rating = rating;
    anime.ratingCount = ratingCount;
    anime.categoryTags = tags;
    anime.description = descLines.join(" ");
anime.thumbnail = thumbnail || anime.thumbnail;
anime.sourceMediaGroupId = mediaGroupId || anime.sourceMediaGroupId;
anime.sourceMessageIds = messages.map((m) => m.message_id);
    anime.sourceMediaGroupId = messages[0]?.media_group_id || anime.sourceMediaGroupId;
anime.uploadDate = new Date().toISOString().slice(0, 10);
    console.log("Anime updated");

  });

  }
// ---------------------------------------------------------------------
// ADMIN COMMANDS
// ---------------------------------------------------------------------
bot.command("addchannel", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.reply("Access denied.");
  const args = ctx.message.text.replace("/addchannel", "").trim();
  const [name, link] = args.split("|").map((s) => s.trim());
  if (!name || !link) return ctx.reply("Format: /addchannel Name | https://t.me/link\n(Reply to a photo for the box image)");

  let photo = "";
  const replyPhoto = ctx.message.reply_to_message?.photo;
  if (replyPhoto) {
    try {
      const fileId = replyPhoto[replyPhoto.length - 1].file_id;
      const fileLink = await bot.telegram.getFileLink(fileId);
      photo = fileLink.href || fileLink.toString();
    } catch (err) {
      console.log("Channel photo fetch failed");
    }
  }

  await db.update((data) => {
    const id = "ch" + String(data.channels.length + 1).padStart(3, "0");
    data.channels.push({ id, name, link, photo });
  });
  ctx.reply("Channel added.");
});

// /addepisode <AnimeName> - reply to a video/photo with caption:
//   Episode Title
//   Description (optional)
//   Duration (optional, jaise "23m")
// Isse woh episode us specific naam wale anime mein judta hai, na ki sirf
// "sabse last wale" anime mein — weekly-episode wale ongoing anime ke liye zaroori.
bot.command("addepisode", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.reply("⛔ Access Denied\n\nYeh command sirf admin use kar sakta hai.");

  const animeName = ctx.message.text.replace("/addepisode", "").trim();
  const replyMsg = ctx.message.reply_to_message;

  if (!animeName) {
    return ctx.reply(
      "📋 Format Galat Hai\n\nSahi tareeka:\n/addepisode Anime Ka Naam\n\n(Kisi photo/video ko reply karke bhejna, uske caption mein Episode Title/Description/Duration likhna)"
    );
  }
  if (!replyMsg || !(replyMsg.photo || replyMsg.video)) {
    return ctx.reply("📋 Photo/Video Chahiye\n\nKisi photo ya video ko reply karke yeh command bhejo.");
  }
  if (!replyMsg.caption) {
    return ctx.reply("📋 Caption Chahiye\n\nReply kiye gaye message mein episode ka caption (title/description/duration) hona chahiye.");
  }

  const data = await db.read();
  const anime = data.animeList.find((a) => a.name.toLowerCase() === animeName.toLowerCase());

  if (!anime) {
    return ctx.reply(`❌ Anime Nahi Mila\n\n"${animeName}" naam ka koi anime series abhi maujood nahi hai. Naam check karke dobara try karo.`);
  }

  const lines = replyMsg.caption.split("\n").map((l) => l.trim()).filter(Boolean);
  const [title, ...descLines] = lines;
  if (!title) return ctx.reply("📋 Episode Title Chahiye\n\nCaption ki pehli line mein episode ka title likho.");

  const numberMatch = title.match(/^(\d+)/);
  const episodeNumber = numberMatch ? parseInt(numberMatch[1]) : 999999;

  const durationMatch = descLines.find((l) => /^\d+h\s*\d*m?$|^\d+m$/i.test(l.trim()));
  const description = descLines.filter((l) => l !== durationMatch).join(" ").trim();
  const thumbnail = await getThumbnailUrl(replyMsg);
  const sourceMessageIds = [replyMsg.message_id];

  await db.update((d) => {
    const targetAnime = d.animeList.find((a) => a.id === anime.id);
    const epId = "e" + String(targetAnime.episodes.length + 1).padStart(3, "0");
    targetAnime.episodes.push({
      id: epId,
      title,
      episodeNumber,
      description,
      duration: durationMatch || "",
      thumbnail,
      deliveryBotIndex: targetAnime.episodes.length % (d.deliveryBots?.length || 1),
      sourceMessageIds,
    });
  });

  ctx.reply(`✅ Episode Add Ho Gaya\n\nAnime: ${anime.name}\nEpisode: ${title}\n\nMini App mein turant dikhne lagega.`);
});

// /announce - admin only - notification bhejta hai, Mini App ke notification page mein dikhta hai
bot.command("announce", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.reply("⛔ Access Denied\n\nYeh command sirf admin use kar sakta hai.");

  const text = ctx.message.text.replace("/announce", "").trim();
  if (!text) {
    return ctx.reply("📋 Format Galat Hai\n\nSahi tareeka:\n/announce Aapka message yahan likho");
  }

  await db.update((data) => {
    if (!data.announcements) data.announcements = [];
    data.announcements.unshift({
      id: "n" + Date.now(),
      text,
      date: new Date().toISOString(),
    });
  });

  ctx.reply(`📢 Announcement Bhej Diya Gaya\n\n"${text}"\n\nYeh sabhi users ke notification page mein dikhega.`);
});

// /setdarkcode - admin only
bot.command("setdarkcode", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.reply("Access denied.");
  const code = ctx.message.text.replace("/setdarkcode", "").trim();
  if (!code) return ctx.reply("Format: /setdarkcode YOURCODE");
  await db.update((data) => {
    data.config.darkCode = code;
  });
  ctx.reply("DARK code set.");
});

bot.command("setdeliverybots", async (ctx) => {
  if (!(await isAdmin(ctx.from.id))) return ctx.reply("Access denied.");
  await db.update((data) => {
    data.deliveryBots = [
      { username: "signal_deliver_1_bot", active: true },
      { username: "signal_deliver_2_bot", active: true },
    ];
  });
  ctx.reply("✅ Delivery bots set:\n1. @signal_deliver_1_bot\n2. @signal_deliver_2_bot");
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});
bot.catch((err, ctx) => {
  console.error("Bot error:", err);
});
bot.launch();
console.log("Merged bot started (polling).");

// ---------------------------------------------------------------------
// EXPRESS API
// ---------------------------------------------------------------------
app.post("/api/check-access", async (req, res) => {
  const { initData } = req.body;
  const user = verifyInitData(initData);
  if (!user) return res.status(401).json({ unlocked: false });
  const verified = await isUserVerified(user.id);
  return res.json({ unlocked: verified });
});

async function buildDeeplink(deliveryBotIndex, contentId) {
  const data = await db.read();
  const deliveryBots = (data.deliveryBots || []).filter((b) => b.active);
  if (deliveryBots.length === 0) return "#";
  const bot = deliveryBots[deliveryBotIndex % deliveryBots.length];
  return bot ? `https://t.me/${bot.username}?start=${contentId}` : "#";
}

// Home page + Search ke liye — poora anime list
app.get("/api/anime-list", async (req, res) => {
  const data = await db.read();
  const list = data.animeList.map((a) => ({
    id: a.id,
    name: a.name,
    meta: a.meta,
    thumbnail: a.thumbnail,
    episodeCount: a.episodes.length,
    uploadDate: a.uploadDate,
  }));
  res.json(list);
});

// Point 3: category page ke liye (Trending/Popular/New Release/Movies)
app.get("/api/anime-by-category/:tag", async (req, res) => {
  const data = await db.read();
  const tag = req.params.tag.toLowerCase();
  const list = data.animeList
    .filter((a) => (a.categoryTags || []).includes(tag))
    .map((a) => ({
      id: a.id,
      name: a.name,
      meta: a.meta,
      thumbnail: a.thumbnail,
      episodeCount: a.episodes.length,
    }));
  res.json(list);
});

// Point 6: announcements list
app.get("/api/announcements", async (req, res) => {
  const data = await db.read();
  res.json(data.announcements || []);
});

// Detail page ke liye — ek anime ka poora data + episodes
app.get("/api/anime/:id", async (req, res) => {
  const data = await db.read();
  const anime = data.animeList.find((a) => a.id === req.params.id);
  if (!anime) return res.status(404).json({ error: "Not found" });

  const sortedEpisodes = [...anime.episodes].sort(
    (a, b) => (a.episodeNumber ?? 999999) - (b.episodeNumber ?? 999999)
  );

  const episodes = await Promise.all(sortedEpisodes.map(async (ep) => ({
    ...ep,
    deeplink: await buildDeeplink(ep.deliveryBotIndex, `ep_${anime.id}_${ep.id}`),
  })));

  res.json({ ...anime, episodes });
});

// "More Like This" — same category (meta tags) wale doosre anime
app.get("/api/anime/:id/similar", async (req, res) => {
  const data = await db.read();
  const anime = data.animeList.find((a) => a.id === req.params.id);
  if (!anime) return res.status(404).json({ error: "Not found" });

  const myTags = (anime.meta || "")
    .split("•")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const similar = data.animeList
    .filter((a) => a.id !== anime.id)
    .filter((a) => {
      const otherTags = (a.meta || "").split("•").map((t) => t.trim().toLowerCase());
      return otherTags.some((t) => myTags.includes(t));
    })
    .slice(0, 6)
    .map((a) => ({
      id: a.id,
      name: a.name,
      meta: a.meta,
      thumbnail: a.thumbnail,
      episodeCount: a.episodes.length,
    }));

  res.json(similar);
});

app.get("/api/channels", async (req, res) => {
  const data = await db.read();
  res.json(data.channels);
});

app.post("/api/verify-dark-code", async (req, res) => {
  const { code, initData } = req.body;
  const user = verifyInitData(initData);
  if (!user) return res.status(401).json({ valid: false });

  const data = await db.read();
  const valid = !!data.config.darkCode && code.trim().toUpperCase() === data.config.darkCode.trim().toUpperCase();
  res.json({ valid });
});

// Exclusive page ke liye — standalone content cards (anime series jaisa nahi)
app.get("/api/exclusive-content", async (req, res) => {
  const data = await db.read();
  const deliveryBots = data.deliveryBots.filter((b) => b.active);
  const list = (data.exclusiveContent || []).map((item) => {
  const bot = deliveryBots[item.deliveryBotIndex % deliveryBots.length];
    return {
      ...item,
      deeplink: bot ? `https://t.me/${bot.username}?start=${item.id}` : "#",
    };
  });
  res.json(list);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API server running on port ${PORT}`));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

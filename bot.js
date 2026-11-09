const { Telegraf, Markup } = require("telegraf");
const http = require("http");
const { PORT, BOT_TOKEN, ADMIN_ID, CAFE_INFO } = require("./config");
const { loadMenu, getNextOrderId } = require("./db");
const { getMainMenu, buildCategoryKeyboard, buildItemsGrid, fmt } = require("./keyboards");
const { setupAdminHandlers } = require("./admin");

// HTTP Server (Render 24/7)
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Bot 24/7 muvaffaqiyatli ishlamoqda! 🚀");
}).listen(PORT, () => console.log(`HTTP server ${PORT}-portda ishlamoqda.`));

const bot = new Telegraf(BOT_TOKEN);
const carts = new Map();
const userOrderSteps = new Map();

const getCart = (uid) => {
  if (!carts.has(uid)) carts.set(uid, {});
  return carts.get(uid);
};

async function cartInfo(cart) {
  const MENU = await loadMenu();
  const items = {};
  Object.values(MENU).flat().forEach((i) => (items[i.id] = i));

  let total = 0;
  const lines = Object.entries(cart).map(([id, qty]) => {
    const it = items[id];
    if (!it) return null;
    total += it.price * qty;
    return `• ${it.name} × ${qty} = ${fmt(it.price * qty)}`;
  }).filter(Boolean);

  return { empty: lines.length === 0, linesText: lines.join("\n"), totalFmt: fmt(total) };
}

// Admin panel handlerlarini ulash
setupAdminHandlers(bot, getMainMenu);

// Asosiy buyruqlar
bot.start((ctx) => ctx.reply(`Assalomu alaykum, ${ctx.from.first_name}! 👋`, getMainMenu(ctx.from.id)));
bot.command("id", (ctx) => ctx.reply(`ID: ${ctx.chat.id}`));
bot.hears("📞 Aloqa", (ctx) => ctx.reply(CAFE_INFO));

// Menyu va Savat
bot.hears("🍽 Menyu", async (ctx) => {
  const MENU = await loadMenu();
  ctx.reply("Bo‘limni tanlang:", buildCategoryKeyboard(Object.keys(MENU)));
});

bot.action(/^cat:(\d+)$/, async (ctx) => {
  const MENU = await loadMenu();
  const cat = Object.keys(MENU)[Number(ctx.match[1])];
  if (!cat) return ctx.answerCbQuery("Bo'lim topilmadi");

  await ctx.answerCbQuery();
  await ctx.reply(`${cat}\nQo‘shish uchun ustiga bosing:`, buildItemsGrid(MENU[cat]));
});

bot.action(/^add:(.+)$/, (ctx) => {
  const cart = getCart(ctx.from.id);
  cart[ctx.match[1]] = (cart[ctx.match[1]] || 0) + 1;
  return ctx.answerCbQuery("Savatga qo‘shildi ✅");
});

bot.hears("🛒 Savat", async (ctx) => {
  const info = await cartInfo(getCart(ctx.from.id));
  if (info.empty) return ctx.reply("Savat hozircha bo‘sh 🙂");
  return ctx.reply(`🛒 Savatingiz:\n\n${info.linesText}\n\nJami: ${info.totalFmt}`, Markup.inlineKeyboard([
    [Markup.button.callback("✅ Buyurtma berish", "order")],
    [Markup.button.callback("🗑 Tozalash", "clear")],
  ]));
});

bot.action("clear", async (ctx) => {
  carts.delete(ctx.from.id);
  await ctx.answerCbQuery();
  await ctx.editMessageText("Savat tozalandi 🗑");
});

// BUYURTMA OQIMI
bot.action("order", async (ctx) => {
  await ctx.answerCbQuery();
  userOrderSteps.set(ctx.from.id, { step: "WAIT_CONTACT" });
  await ctx.reply("Buyurtmani rasmiylashtirish uchun telefon raqamingizni yuboring:", Markup.keyboard([[Markup.button.contactRequest("📱 Raqamni yuborish")]]).resize().oneTime());
});

bot.on("contact", async (ctx) => {
  const state = userOrderSteps.get(ctx.from.id);
  if (!state || state.step !== "WAIT_CONTACT") return;

  state.phone = ctx.message.contact.phone_number;
  state.step = "WAIT_ADDRESS_CHOICE";
  userOrderSteps.set(ctx.from.id, state);

  await ctx.reply(
    "📍 Yetkazib berish manzilini qanday yubormoqchisiz?",
    Markup.keyboard([
      [Markup.button.locationRequest("📍 Xaritadan joylashuvni yuborish")],
      ["✍️ Qo‘lda yozib kiritaman"],
    ]).resize().oneTime()
  );
});

bot.on("location", async (ctx) => {
  const state = userOrderSteps.get(ctx.from.id);
  if (!state) return;

  const { latitude, longitude } = ctx.message.location;
  state.address = `📍 Geo-Manzil: https://maps.google.com/?q=${latitude},${longitude}`;
  state.locationCoords = { latitude, longitude };
  state.step = "WAIT_PAYMENT";
  userOrderSteps.set(ctx.from.id, state);

  await ctx.reply("Joylashuv qabul qilindi ✅\nTo'lov turini tanlang:", Markup.inlineKeyboard([
    [Markup.button.callback("💵 Naqd pul", "pay:naqd")],
    [Markup.button.callback("💳 Payme / Click", "pay:karta")],
  ]));
});

bot.on("text", async (ctx, next) => {
  const state = userOrderSteps.get(ctx.from.id);
  if (state) {
    if (state.step === "WAIT_ADDRESS_CHOICE" && ctx.message.text === "✍️ Qo‘lda yozib kiritaman") {
      state.step = "WAIT_TEXT_ADDRESS";
      userOrderSteps.set(ctx.from.id, state);
      return ctx.reply("Iltimos, manzilingizni batafsil yozib yuboring:");
    }

    if (state.step === "WAIT_TEXT_ADDRESS") {
      state.address = ctx.message.text;
      state.step = "WAIT_PAYMENT";
      userOrderSteps.set(ctx.from.id, state);

      return ctx.reply("Manzil qabul qilindi ✅\nTo'lov turini tanlang:", Markup.inlineKeyboard([
        [Markup.button.callback("💵 Naqd pul", "pay:naqd")],
        [Markup.button.callback("💳 Payme / Click", "pay:karta")],
      ]));
    }
  }
  return next();
});

bot.action(/^pay:(naqd|karta)$/, async (ctx) => {
  const payType = ctx.match[1] === "naqd" ? "💵 Naqd pul" : "💳 Payme / Click";
  const info = await cartInfo(getCart(ctx.from.id));
  if (info.empty) return ctx.reply("Savatingiz bo'sh.", getMainMenu(ctx.from.id));

  const orderId = await getNextOrderId();
  const now = new Date().toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  const clientName = ctx.from.first_name + (ctx.from.last_name ? " " + ctx.from.last_name : "");
  const state = userOrderSteps.get(ctx.from.id) || {};
  const phone = state.phone || "Kiritilmadi";
  const address = state.address || "Ko'rsatilmadi";

  const clientReceipt = `🧾 BUYURTMA CHEKI ${orderId}\n-----------------------------------\n📅 Sana: ${now}\n👤 Mijoz: ${clientName}\n📞 Tel: ${phone}\n📍 Manzil: ${address}\n💳 To'lov: ${payType}\n-----------------------------------\n🛒 TARKIBI:\n${info.linesText}\n\n-----------------------------------\n💰 JAMI: ${info.totalFmt}\n-----------------------------------\n⏳ Holati: Qabul qilindi 🟡\n\nXaridingiz uchun rahmat! 🙌`;
  const adminNotification = `🆕 YANGI BUYURTMA ${orderId}\n-----------------------------------\n👤 Mijoz: ${clientName}\n📞 Tel: ${phone}\n📍 MANZIL: ${address}\n💳 To'lov: ${payType}\n-----------------------------------\n🛒 TAOMLAR:\n${info.linesText}\n\n💰 JAMI SUMMA: ${info.totalFmt}`;

  await ctx.answerCbQuery();
  await ctx.reply(clientReceipt, getMainMenu(ctx.from.id));

  const targetAdmin = ADMIN_ID || ctx.chat.id;
  try {
    await ctx.telegram.sendMessage(targetAdmin, adminNotification);
    if (state.locationCoords) {
      await ctx.telegram.sendLocation(targetAdmin, state.locationCoords.latitude, state.locationCoords.longitude);
    }
  } catch (err) {
    console.error("Admin xabarnoma xatosi:", err);
  }

  carts.delete(ctx.from.id);
  userOrderSteps.delete(ctx.from.id);
});

bot.catch((err) => console.error("Bot xatosi:", err));
bot.launch().then(() => console.log("Bot muvaffaqiyatli ishga tushdi ✅"));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

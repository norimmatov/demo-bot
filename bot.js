require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const http = require("http");

// ---- Render.com uchun HTTP Server (Port topolmay to'xtab qolmasligi uchun) ----
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bot serverda 24/7 muvaffaqiyatli ishlamoqda! 🚀");
  })
  .listen(PORT, () => {
    console.log(`HTTP server ${PORT}-portda ishga tushdi.`);
  });

// ---- Botni retsializatsiya qilish ----
const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : null;

// ---- Menyu ma'lumotlari ----
const MENU = {
  "☕ Ichimliklar": [
    { id: "d1", name: "Americano", price: 18000 },
    { id: "d2", name: "Cappuccino", price: 22000 },
    { id: "d3", name: "Ko‘k choy", price: 8000 },
  ],
  "🍰 Shirinliklar": [
    { id: "s1", name: "Cheesecake", price: 25000 },
    { id: "s2", name: "Tiramisu", price: 28000 },
  ],
  "🍔 Taomlar": [
    { id: "t1", name: "Burger", price: 35000 },
    { id: "t2", name: "Lag‘mon", price: 30000 },
  ],
};

const CAFE_INFO =
  "📍 Samarqand, Registon ko‘chasi 1\n📞 +998 90 123 45 67\n🕙 Har kuni 09:00–23:00";

// ---- Yordamchi o'zgaruvchi va funksiyalar ----
const CATS = Object.keys(MENU);
const ITEMS = Object.fromEntries(
  Object.values(MENU).flat().map((i) => [i.id, i])
);
const carts = new Map(); // userId -> { itemId: soni }

const fmt = (n) => n.toLocaleString("ru-RU") + " so‘m";

const getCart = (uid) => {
  if (!carts.has(uid)) carts.set(uid, {});
  return carts.get(uid);
};

function cartInfo(cart) {
  let total = 0;
  const lines = Object.entries(cart)
    .map(([id, qty]) => {
      const it = ITEMS[id];
      if (!it) return null;
      total += it.price * qty;
      return `${it.name} × ${qty} = ${fmt(it.price * qty)}`;
    })
    .filter(Boolean);

  return {
    empty: lines.length === 0,
    text: lines.join("\n") + `\n\nJami: ${fmt(total)}`,
  };
}

// Asosiy tugmalar (Reply Keyboard)
const mainKeyboard = Markup.keyboard([
  ["🍽 Menyu", "🛒 Savat"],
  ["📞 Aloqa"],
]).resize();

// ---- Buyruqlar va hodisalar ----

// /start
bot.start((ctx) =>
  ctx.reply(
    `Assalomu alaykum, ${ctx.from.first_name}! 👋\nKafemizga xush kelibsiz. Menyudan tanlang va buyurtma bering.`,
    mainKeyboard
  )
);

// Admin ID sini aniqlash uchun /id buyrug'i
bot.command("id", (ctx) => ctx.reply(`Sizning Telegram ID ingiz: ${ctx.chat.id}`));

// Aloqa
bot.hears("📞 Aloqa", (ctx) => ctx.reply(CAFE_INFO));

// Menyu bo'limlarini ko'rsatish
bot.hears("🍽 Menyu", (ctx) =>
  ctx.reply(
    "Bo‘limni tanlang:",
    Markup.inlineKeyboard(
      CATS.map((c, i) => [Markup.button.callback(c, "cat:" + i)])
    )
  )
);

// Kategoriya tanlanganda mahsulotlarni chiqarish
bot.action(/^cat:(\d+)$/, async (ctx) => {
  const catIndex = Number(ctx.match[1]);
  const cat = CATS[catIndex];
  if (!cat) return ctx.answerCbQuery("Bo'lim topilmadi");

  await ctx.answerCbQuery();
  await ctx.reply(
    `${cat}\nQo‘shish uchun ustiga bosing:`,
    Markup.inlineKeyboard(
      MENU[cat].map((i) => [
        Markup.button.callback(`${i.name} — ${fmt(i.price)}`, "add:" + i.id),
      ])
    )
  );
});

// Mahsulotni savatga qo'shish
bot.action(/^add:(\w+)$/, (ctx) => {
  const id = ctx.match[1];
  if (!ITEMS[id]) return ctx.answerCbQuery("Mahsulot topilmadi");

  const cart = getCart(ctx.from.id);
  cart[id] = (cart[id] || 0) + 1;
  return ctx.answerCbQuery(`${ITEMS[id].name} savatga qo‘shildi ✅`);
});

// Savatni ko'rish
bot.hears("🛒 Savat", (ctx) => {
  const info = cartInfo(getCart(ctx.from.id));
  if (info.empty) return ctx.reply("Savat ho

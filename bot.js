const { Telegraf, Markup } = require("telegraf");
const http = require("http");
const { PORT, BOT_TOKEN, ADMIN_ID, CAFE_INFO } = require("./config");
const { loadMenu, getNextOrderId } = require("./db");
const { getMainMenu, buildCategoryKeyboard, buildItemsGrid, fmt } = require("./keyboards");
const { setupAdminHandlers } = require("./admin");

// HTTP Server (Render 24/7 ishlashi uchun)
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


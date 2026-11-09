const { Telegraf, Markup } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID; // kafe egasining chat ID si

// ---- Menyu (mijoz kafesiga qarab shu yerni o'zgartirasan) ----
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

// ---- Yordamchi qismlar ----
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
  const lines = Object.entries(cart).map(([id, qty]) => {
    const it = ITEMS[id];
    total += it.price * qty;
    return `${it.name} × ${qty} = ${fmt(it.price * qty)}`;
  });
  return {
    empty: lines.length === 0,
    text: lines.join("\n") + `\n\nJami: ${fmt(total)}`,
  };
}

const mainKeyboard = Markup.keyboard([
  ["🍽 Menyu", "🛒 Savat"],
  ["📞 Aloqa"],
]).resize();

// ---- Buyruqlar ----
bot.start((ctx) =>
  ctx.reply(
    `Assalomu alaykum, ${ctx.from.first_name}! 👋\nKafemizga xush kelibsiz. Menyudan tanlang va buyurtma bering.`,
    mainKeyboard
  )
);

// Kafe egasining ID sini bilish uchun
bot.command("id", (ctx) => ctx.reply(String(ctx.chat.id)));

bot.hears("📞 Aloqa", (ctx) => ctx.reply(CAFE_INFO));

bot.hears("🍽 Menyu", (ctx) =>
  ctx.reply(
    "Bo‘limni tanlang:",
    Markup.inlineKeyboard(
      CATS.map((c, i) => [Markup.button.callback(c, "cat:" + i)])
    )
  )
);

bot.action(/^cat:(\d+)$/, async (ctx) => {
  const cat = CATS[Number(ctx.match[1])];
  await ctx.answerCbQuery();
  await ctx.reply(
    cat + "\nQo‘shish uchun ustiga bosing:",
    Markup.inlineKeyboard(
      MENU[cat].map((i) => [
        Markup.button.callback(`${i.name} — ${fmt(i.price)}`, "add:" + i.id),
      ])
    )
  );
});

bot.action(/^add:(\w+)$/, (ctx) => {
  const id = ctx.match[1];
  const cart = getCart(ctx.from.id);
  cart[id] = (cart[id] || 0) + 1;
  return ctx.answerCbQuery(`${ITEMS[id].name} savatga qo‘shildi ✅`);
});

bot.hears("🛒 Savat", (ctx) => {
  const info = cartInfo(getCart(ctx.from.id));
  if (info.empty) return ctx.reply("Savat hozircha bo‘sh 🙂");
  return ctx.reply(
    "🛒 Sizning savatingiz:\n\n" + info.text,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Buyurtma berish", "order")],
      [Markup.button.callback("🗑 Tozalash", "clear")],
    ])
  );
});

bot.action("clear", async (ctx) => {
  carts.delete(ctx.from.id);
  await ctx.answerCbQuery();
  await ctx.editMessageText("Savat tozalandi 🗑");
});

bot.action("order", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "Buyurtmani tasdiqlash uchun telefon raqamingizni yuboring:",
    Markup.keyboard([[Markup.button.contactRequest("📱 Raqamni yuborish")]])
      .resize()
      .oneTime()
  );
});

// Telefon kelganda buyurtma kafe egasiga ketadi
bot.on("contact", async (ctx) => {
  const info = cartInfo(getCart(ctx.from.id));
  if (info.empty) return ctx.reply("Savat bo‘sh.", mainKeyboard);

  const msg =
    `🆕 Yangi buyurtma\n` +
    `👤 ${ctx.from.first_name}\n` +
    `📞 ${ctx.message.contact.phone_number}\n\n` +
    info.text;

  // ADMIN_ID yo'q bo'lsa, demo uchun buyurtma o'zingga qaytadi
  await ctx.telegram.sendMessage(ADMIN_ID || ctx.chat.id, msg);
  carts.delete(ctx.from.id);
  await ctx.reply(
    "Rahmat! Buyurtmangiz qabul qilindi ✅\nTez orada siz bilan bog‘lanamiz.",
    mainKeyboard
  );
});

bot.catch((err) => console.error("Xato:", err));
bot.launch();
console.log("Bot ishga tushdi ✅");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

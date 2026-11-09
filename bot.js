require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const http = require("http");
const fs = require("fs");
const path = require("path");

// Render.com uchun HTTP server
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bot 24/7 muvaffaqiyatli ishlamoqda! 🚀");
  })
  .listen(PORT, () => console.log(`HTTP server ${PORT}-portda ishlamoqda.`));

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : null;

// JSON fayldan menyuni o'qish va saqlash funksiyalari
const MENU_FILE = path.join(__dirname, "menu.json");

function loadMenu() {
  try {
    if (!fs.existsSync(MENU_FILE)) {
      fs.writeFileSync(MENU_FILE, JSON.stringify({}));
    }
    return JSON.parse(fs.readFileSync(MENU_FILE, "utf8"));
  } catch (e) {
    console.error("Menu o'qishda xato:", e);
    return {};
  }
}

function saveMenu(menu) {
  try {
    fs.writeFileSync(MENU_FILE, JSON.stringify(menu, null, 2), "utf8");
  } catch (e) {
    console.error("Menu saqlashda xato:", e);
  }
}

let MENU = loadMenu();
const CAFE_INFO = "📍 Samarqand, Registon ko‘chasi 1\n📞 +998 90 123 45 67\n🕙 09:00–23:00";

const carts = new Map();
const userStates = new Map(); // Admin bosqichlarini saqlash uchun

const fmt = (n) => n.toLocaleString("ru-RU") + " so‘m";
const getCart = (uid) => {
  if (!carts.has(uid)) carts.set(uid, {});
  return carts.get(uid);
};

function getFlatItems() {
  const items = {};
  Object.values(MENU).flat().forEach((i) => (items[i.id] = i));
  return items;
}

function cartInfo(cart) {
  const items = getFlatItems();
  let total = 0;
  const lines = Object.entries(cart)
    .map(([id, qty]) => {
      const it = items[id];
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

// Tugmalar
const getMainMenu = (userId) => {
  const buttons = [["🍽 Menyu", "🛒 Savat"], ["📞 Aloqa"]];
  if (userId === ADMIN_ID) {
    buttons.push(["⚙️ Admin Panel"]);
  }
  return Markup.keyboard(buttons).resize();
};

// Start
bot.start((ctx) =>
  ctx.reply(
    `Assalomu alaykum, ${ctx.from.first_name}! 👋\nKafemizga xush kelibsiz.`,
    getMainMenu(ctx.from.id)
  )
);

bot.command("id", (ctx) => ctx.reply(`Sizning ID ingiz: ${ctx.chat.id}`));
bot.hears("📞 Aloqa", (ctx) => ctx.reply(CAFE_INFO));

// ---- ADMIN PANEL MANTIQLARI ----
bot.hears("⚙️ Admin Panel", (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply("Siz admin emassiz ❌");
  return ctx.reply(
    "🛠 Admin boshqaruv paneli:",
    Markup.inlineKeyboard([
      [Markup.button.callback("➕ Yangi taom qo'shish", "admin_add")],
      [Markup.button.callback("🗑 Taomni o'chirish", "admin_delete")],
    ])
  );
});

// Taom qo'shish bosqichlari
bot.action("admin_add", async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  await ctx.answerCbQuery();
  const cats = Object.keys(MENU);
  
  userStates.set(ctx.from.id, { step: "WAIT_NAME" });
  await ctx.reply(
    "Yangi taom nomini kiriting:\n(Masalan: Lavash)"
  );
});

// Admin matn kiritganda ushlash
bot.on("text", async (ctx, next) => {
  const state = userStates.get(ctx.from.id);
  if (!state || ctx.from.id !== ADMIN_ID) return next();

  if (state.step === "WAIT_NAME") {
    state.name = ctx.message.text;
    state.step = "WAIT_PRICE";
    userStates.set(ctx.from.id, state);
    return ctx.reply(`"${state.name}" narxini faqat raqamlarda kiriting (masalan: 25000):`);
  }

  if (state.step === "WAIT_PRICE") {
    const price = Number(ctx.message.text.replace(/\D/g, ""));
    if (!price) return ctx.reply("Iltimos, faqat raqam kiriting!");
    
    state.price = price;
    state.step = "WAIT_CAT";
    userStates.set(ctx.from.id, state);

    const cats = Object.keys(MENU);
    return ctx.reply(
      "Kategoriyani tanlang:",
      Markup.inlineKeyboard(
        cats.map((c, i) => [Markup.button.callback(c, "add_cat:" + i)])
      )
    );
  }

  return next();
});

// Kategoriya tanlanganda taomni saqlash
bot.action(/^add_cat:(\d+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  const state = userStates.get(ctx.from.id);
  if (!state || state.step !== "WAIT_CAT") return;

  const cats = Object.keys(MENU);
  const cat = cats[Number(ctx.match[1])];

  const newItem = {
    id: "item_" + Date.now(),
    name: state.name,
    price: state.price,
    photo: ""
  };

  MENU[cat].push(newItem);
  saveMenu(MENU);
  userStates.delete(ctx.from.id);

  await ctx.answerCbQuery();
  await ctx.reply(`✅ "${newItem.name}" muvaffaqiyatli qo'shildi!`, getMainMenu(ctx.from.id));
});

// ---- FOYDALANUVCHILAR UCHUN MENYU ----
bot.hears("🍽 Menyu", (ctx) => {
  MENU = loadMenu();
  const cats = Object.keys(MENU);
  ctx.reply(
    "Bo‘limni tanlang:",
    Markup.inlineKeyboard(
      cats.map((c, i) => [Markup.button.callback(c, "cat:" + i)])
    )
  );
});

bot.action(/^cat:(\d+)$/, async (ctx) => {
  MENU = loadMenu();
  const cats = Object.keys(MENU);
  const cat = cats[Number(ctx.match[1])];
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

bot.action(/^add:(\w+)$/, (ctx) => {
  const items = getFlatItems();
  const id = ctx.match[1];
  if (!items[id]) return ctx.answerCbQuery("Mahsulot topilmadi");

  const cart = getCart(ctx.from.id);
  cart[id] = (cart[id] || 0) + 1;
  return ctx.answerCbQuery(`${items[id].name} savatga qo‘shildi ✅`);
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

bot.on("contact", async (ctx) => {
  const info = cartInfo(getCart(ctx.from.id));
  if (info.empty) return ctx.reply("Savat bo‘sh.", getMainMenu(ctx.from.id));

  const msg =
    `🆕 Yangi buyurtma!\n` +
    `👤 Mijoz: ${ctx.from.first_name}\n` +
    `📞 Tel: ${ctx.message.contact.phone_number}\n\n` +
    info.text;

  const targetAdmin = ADMIN_ID || ctx.chat.id;

  try {
    await ctx.telegram.sendMessage(targetAdmin, msg);
    carts.delete(ctx.from.id);
    await ctx.reply(
      "Rahmat! Buyurtmangiz qabul qilindi ✅\nTez orada siz bilan bog‘lanamiz.",
      getMainMenu(ctx.from.id)
    );
  } catch (error) {
    console.error(error);
    await ctx.reply("Xatolik yuz berdi.", getMainMenu(ctx.from.id));
  }
});

bot.catch((err) => console.error("Bot xatosi:", err));
bot.launch().then(() => console.log("Bot ishga tushdi ✅"));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

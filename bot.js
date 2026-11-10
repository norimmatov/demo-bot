const http = require("http");
const crypto = require("crypto");
const { Telegraf, Markup } = require("telegraf");

const cfg = require("./config");
const db = require("./db");
const { BTN, MAIN_BUTTONS, getMainMenu } = require("./keyboards");
const {
  fmt,
  STATUS,
  formatDate,
  calcDelivery,
  buildReceipt,
  render,
} = require("./helpers");
const { setupAdminHandlers, notifyAdmins } = require("./admin");

if (!cfg.BOT_TOKEN) {
  throw new Error("BOT_TOKEN Environment Variables ichida ko'rsatilishi shart");
}

const bot = new Telegraf(cfg.BOT_TOKEN);

const carts = new Map(); // uid -> { itemId: qty }
const orderSteps = new Map(); // uid -> buyurtma jarayoni holati
const processing = new Set(); // ikki marta bosilishdan himoya

const MAX_QTY = 50;
const ignore = () => {};
const ack = (ctx, text, alert) =>
  ctx.answerCbQuery(text, alert ? { show_alert: true } : undefined).catch(ignore);

const getCart = (uid) => {
  if (!carts.has(uid)) carts.set(uid, {});
  return carts.get(uid);
};

const clearOrder = (uid) => {
  orderSteps.delete(uid);
  processing.delete(uid);
};

const clientName = (u) =>
  [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || String(u.id);

// =====================================
// SAVAT (narxlar har safar bazadan olinadi)
// =====================================

async function cartInfo(uid) {
  const cart = getCart(uid);
  const ids = Object.keys(cart);
  const found = await db.getItemsByIds(ids);
  const map = new Map(found.map((i) => [i.id, i]));

  const list = [];
  const removed = [];
  let subtotal = 0;

  for (const id of ids) {
    const qty = cart[id];
    const item = map.get(id);

    if (!item || !item.available) {
      removed.push(item ? item.name : "O‘chirilgan taom");
      delete cart[id];
      continue;
    }

    if (!Number.isInteger(qty) || qty <= 0) {
      delete cart[id];
      continue;
    }

    subtotal += item.price * qty;
    list.push({ id, name: item.name, price: item.price, qty });
  }

  const settings = await db.getSettings();
  const delivery = calcDelivery(subtotal, settings);

  return {
    empty: list.length === 0,
    list,
    removed,
    subtotal,
    delivery,
    total: subtotal + delivery,
    settings,
  };
}

const linesText = (list) =>
  list.map((i) => `• ${i.name} × ${i.qty} = ${fmt(i.price * i.qty)}`).join("\n");

const deliveryText = (info) => (info.delivery > 0 ? fmt(info.delivery) : "Bepul");

async function showCart(ctx) {
  const info = await cartInfo(ctx.from.id);
  const note = info.removed.length
    ? `⚠️ Mavjud bo‘lmagan taomlar savatdan olib tashlandi: ${info.removed.join(", ")}\n\n`
    : "";

  if (info.empty) {
    return render(
      ctx,
      `${note}Savat hozircha bo‘sh 🙂`,
      Markup.inlineKeyboard([[Markup.button.callback("🍽 Menyuga o‘tish", "menu")]])
    );
  }

  const s = info.settings;
  let hint = "";
  if (s.freeDeliveryFrom > 0 && info.subtotal < s.freeDeliveryFrom) {
    hint = `\n💡 Yana ${fmt(s.freeDeliveryFrom - info.subtotal)} qo‘shsangiz, yetkazib berish bepul!`;
  }

  const text =
    `${note}🛒 SAVATINGIZ\n\n${linesText(info.list)}\n\n` +
    `━━━━━━━━━━━━━━\n` +
    `🍽 Taomlar: ${fmt(info.subtotal)}\n` +
    `🚚 Yetkazib berish: ${deliveryText(info)}${hint}\n` +
    `💰 Jami: ${fmt(info.total)}`;

  const rows = [];
  for (const i of info.list) {
    rows.push([
      Markup.button.callback("➖", `dec:${i.id}:c`),
      Markup.button.callback(`${i.name} × ${i.qty}`, "noop"),
      Markup.button.callback("➕", `inc:${i.id}:c`),
    ]);
  }
  rows.push([Markup.button.callback("✅ Buyurtma berish", "order")]);
  rows.push([
    Markup.button.callback("🗑 Tozalash", "clear"),
    Markup.button.callback("🍽 Menyu", "menu"),
  ]);

  return render(ctx, text, Markup.inlineKeyboard(rows));
}

// =====================================
// MENYU
// =====================================

async function showCategories(ctx) {
  const cats = await db.getMenuCategories();

  if (!cats.length) {
    return render(ctx, "Hozircha taomnoma bo‘sh 🙂");
  }

  const rows = [];
  for (let i = 0; i < cats.length; i += 2) {
    rows.push(
      cats.slice(i, i + 2).map((c) => Markup.button.callback(c.name, `cat:${c.cid}`))
    );
  }
  rows.push([Markup.button.callback("🛒 Savat", "cart")]);

  return render(ctx, "📂 Bo‘limni tanlang:", Markup.inlineKeyboard(rows));
}

async function showCategory(ctx, cid) {
  const cat = await db.getCategory(cid);
  if (!cat) return showCategories(ctx);

  const items = await db.getItemsByCategory(cat.name);
  if (!items.length) return showCategories(ctx);

  const rows = items.map((i) => [
    Markup.button.callback(
      i.available ? `${i.name} — ${fmt(i.price)}` : `❌ ${i.name} (tugagan)`,
      `item:${i.id}`
    ),
  ]);
  rows.push([
    Markup.button.callback("⬅️ Bo‘limlar", "menu"),
    Markup.button.callback("🛒 Savat", "cart"),
  ]);

  return render(ctx, `${cat.name}\n\nTaomni tanlang:`, Markup.inlineKeyboard(rows));
}

const cardText = (item) =>
  `🍽 ${item.name}\n\n💰 Narxi: ${fmt(item.price)}` +
  (item.available ? "" : "\n\n❌ Hozircha mavjud emas");

function cardKeyboard(item, qty, cid) {
  const rows = [];

  if (item.available) {
    rows.push([
      Markup.button.callback("➖", `dec:${item.id}:i`),
      Markup.button.callback(`🛒 ${qty}`, "noop"),
      Markup.button.callback("➕", `inc:${item.id}:i`),
    ]);
  }

  rows.push([Markup.button.callback("🛒 Savatni ko‘rish", "cart")]);
  rows.push([Markup.button.callback("⬅️ Orqaga", cid ? `cat:${cid}` : "menu")]);

  return Markup.inlineKeyboard(rows);
}

async function categoryIdOf(item) {
  const cat = await db.getCategoryByName(item.category);
  return cat ? cat.cid : null;
}

// =====================================
// ADMIN
// =====================================

setupAdminHandlers(bot);

// =====================================
// ASOSIY BUYRUQLAR
// =====================================

bot.start(async (ctx) => {
  clearOrder(ctx.from.id);

  await ctx.reply(
    `Assalomu alaykum, ${ctx.from.first_name}! 👋\n\n${cfg.CAFE_NAME} botiga xush kelibsiz!\nBuyurtma berish uchun "${BTN.MENU}" tugmasini bosing.`,
    getMainMenu(ctx.from.id)
  );
});

bot.command("id", (ctx) => ctx.reply(`ID: ${ctx.chat.id}`));

async function cancelOrderFlow(ctx) {
  clearOrder(ctx.from.id);
  return ctx.reply("Buyurtma jarayoni bekor qilindi ❌\nSavatingiz saqlanib qoldi.", getMainMenu(ctx.from.id));
}

bot.command("cancel", cancelOrderFlow);
bot.hears(BTN.CANCEL, cancelOrderFlow);

bot.hears(BTN.INFO, async (ctx) => {
  const s = await db.getSettings();
  await ctx.reply(s.info);
});

bot.hears(BTN.MENU, (ctx) => showCategories(ctx));
bot.hears(BTN.CART, (ctx) => showCart(ctx));

bot.hears(BTN.ORDERS, async (ctx) => {
  const orders = await db.getUserOrders(ctx.from.id, 5);

  if (!orders.length) return ctx.reply("Sizda hali buyurtmalar yo‘q 🙂");

  const text = orders
    .map((o) => {
      const st = STATUS[o.status] || STATUS.accepted;
      return `${st.icon} #${o.orderId} — ${fmt(o.total)}\n    ${formatDate(o.createdAt)} · ${st.label}`;
    })
    .join("\n\n");

  return ctx.reply(`📦 Oxirgi buyurtmalaringiz:\n\n${text}`);
});

// =====================================
// INLINE TUGMALAR: MENYU / SAVAT
// =====================================

bot.action("noop", (ctx) => ack(ctx));

bot.action("menu", async (ctx) => {
  await ack(ctx);
  return showCategories(ctx);
});

bot.action("cart", async (ctx) => {
  await ack(ctx);
  return showCart(ctx);
});

bot.action(/^cat:(.+)$/, async (ctx) => {
  await ack(ctx);
  return showCategory(ctx, ctx.match[1]);
});

bot.action(/^item:(.+)$/, async (ctx) => {
  const item = await db.getItem(ctx.match[1]);

  if (!item) {
    await ack(ctx, "Taom topilmadi!");
    return showCategories(ctx);
  }

  await ack(ctx);

  const qty = getCart(ctx.from.id)[item.id] || 0;
  const cid = await categoryIdOf(item);

  return render(ctx, cardText(item), cardKeyboard(item, qty, cid), item.photo);
});

bot.action(/^(inc|dec):([^:]+):(i|c)$/, async (ctx) => {
  const [, op, id, where] = ctx.match;
  const cart = getCart(ctx.from.id);
  const item = await db.getItem(id);

  if (op === "inc") {
    if (!item) return ack(ctx, "Taom topilmadi!");
    if (!item.available) return ack(ctx, "Bu taom hozircha tugagan ❌", true);
    if ((cart[id] || 0) >= MAX_QTY) return ack(ctx, `Maksimum ${MAX_QTY} ta`);
    cart[id] = (cart[id] || 0) + 1;
  } else {
    if (!cart[id]) return ack(ctx);
    cart[id] -= 1;
    if (cart[id] <= 0) delete cart[id];
  }

  await ack(ctx);

  if (where === "i" && item) {
    const cid = await categoryIdOf(item);
    return ctx
      .editMessageReplyMarkup(cardKeyboard(item, cart[id] || 0, cid).reply_markup)
      .catch(ignore);
  }

  return showCart(ctx);
});

bot.action("clear", async (ctx) => {
  carts.delete(ctx.from.id);
  await ack(ctx, "Savat tozalandi 🗑");
  return showCart(ctx);
});

// =====================================
// BUYURTMA BERISH
// =====================================

bot.action("order", async (ctx) => {
  const uid = ctx.from.id;
  const info = await cartInfo(uid);

  if (info.empty) return ack(ctx, "Savatingiz bo‘sh!");

  if (info.settings.minOrder > 0 && info.subtotal < info.settings.minOrder) {
    return ack(ctx, `Minimal buyurtma summasi: ${fmt(info.settings.minOrder)}`, true);
  }

  await ack(ctx);

  if (info.removed.length) {
    await ctx.reply(`⚠️ Mavjud bo‘lmagan taomlar savatdan olib tashlandi: ${info.removed.join(", ")}`);
  }

  const last = await db.getLastOrder(uid);
  orderSteps.set(uid, { step: "WAIT_CONTACT", last });

  return ctx.reply(
    "📞 Buyurtmani rasmiylashtirish uchun telefon raqamingizni yuboring:",
    Markup.keyboard([[Markup.button.contactRequest("📱 Raqamni yuborish")], [BTN.CANCEL]]).resize()
  );
});

function shortAddress(addr) {
  if (addr.startsWith("📍 Geo-Manzil")) return "xaritadagi joylashuv";
  return addr.length > 30 ? addr.slice(0, 30) + "…" : addr;
}

async function askAddress(ctx, state) {
  state.step = "WAIT_ADDRESS";

  const rows = [
    [Markup.button.locationRequest("📍 Joylashuvni yuborish")],
    [BTN.MANUAL],
  ];

  state.lastBtn = null;
  if (state.last && state.last.address) {
    state.lastBtn = `🔁 Oxirgi manzil: ${shortAddress(state.last.address)}`;
    rows.push([state.lastBtn]);
  }

  rows.push([BTN.CANCEL]);

  return ctx.reply(
    "📍 Yetkazib berish manzilini qanday yubormoqchisiz?",
    Markup.keyboard(rows).resize()
  );
}

async function goToPayment(ctx, state, intro) {
  state.step = "WAIT_PAYMENT";

  await ctx.reply(intro, Markup.removeKeyboard());

  return ctx.reply(
    "💳 To‘lov turini tanlang:",
    Markup.inlineKeyboard([
      [Markup.button.callback("💵 Naqd pul", "pay:cash")],
      [Markup.button.callback("💳 Karta orqali", "pay:card")],
      [Markup.button.callback("❌ Bekor qilish", "ord_cancel")],
    ])
  );
}

async function acceptPhone(ctx, state, rawPhone) {
  const digits = String(rawPhone).replace(/\D/g, "");
  state.phone = "+" + digits;
  return askAddress(ctx, state);
}

bot.on("contact", async (ctx) => {
  const uid = ctx.from.id;
  const state = orderSteps.get(uid);

  if (!state || state.step !== "WAIT_CONTACT") return;

  const contact = ctx.message.contact;

  if (contact.user_id && contact.user_id !== uid) {
    return ctx.reply("Iltimos, o‘zingizning telefon raqamingizni yuboring.");
  }

  return acceptPhone(ctx, state, contact.phone_number);
});

bot.on("location", async (ctx) => {
  const uid = ctx.from.id;
  const state = orderSteps.get(uid);

  if (!state || state.step !== "WAIT_ADDRESS") return;

  const { latitude, longitude } = ctx.message.location;

  state.address = `📍 Geo-Manzil: https://maps.google.com/?q=${latitude},${longitude}`;
  state.locationCoords = { latitude, longitude };

  return goToPayment(ctx, state, "Joylashuv qabul qilindi ✅");
});

bot.on("text", async (ctx, next) => {
  const uid = ctx.from.id;
  const state = orderSteps.get(uid);

  if (!state) return next();

  const text = ctx.message.text.trim();

  // Asosiy menyu tugmalari jarayon ichida manzil/telefon bo'lib ketmasin
  if (text.startsWith("/") || MAIN_BUTTONS.includes(text)) return next();

  if (state.step === "WAIT_CONTACT") {
    if (/^\+?\d[\d\s\-()]{8,16}$/.test(text)) {
      return acceptPhone(ctx, state, text);
    }
    return ctx.reply("Telefon raqamini tugma orqali yuboring yoki yozing. Masalan: +998901234567");
  }

  if (state.step === "WAIT_ADDRESS") {
    if (text === BTN.MANUAL) {
      state.step = "WAIT_TEXT_ADDRESS";
      return ctx.reply(
        "Iltimos, manzilingizni batafsil yozib yuboring (ko‘cha, uy, mo‘ljal):",
        Markup.keyboard([[BTN.CANCEL]]).resize()
      );
    }

    if (state.lastBtn && text === state.lastBtn) {
      state.address = state.last.address;
      state.locationCoords = state.last.locationCoords && state.last.locationCoords.latitude != null
        ? state.last.locationCoords
        : undefined;
      return goToPayment(ctx, state, "Manzil qabul qilindi ✅");
    }

    return ctx.reply("Iltimos, pastdagi tugmalardan birini tanlang 👇");
  }

  if (state.step === "WAIT_TEXT_ADDRESS") {
    if (text.length < 5) return ctx.reply("Iltimos, manzilni to‘liqroq yozing.");
    if (text.length > 250) return ctx.reply("Manzil juda uzun. Qisqaroq yozing.");

    state.address = text;
    state.locationCoords = undefined;

    return goToPayment(ctx, state, "Manzil qabul qilindi ✅");
  }

  return next();
});

async function showSummary(ctx, uid, state, prefix = "") {
  const info = await cartInfo(uid);

  if (info.empty) {
    clearOrder(uid);
    await ctx.reply("Savat bo‘sh.", getMainMenu(uid));
    return;
  }

  state.expectedTotal = info.total;

  const text =
    `${prefix}📋 BUYURTMANI TEKSHIRING\n\n` +
    `${linesText(info.list)}\n\n` +
    `━━━━━━━━━━━━━━\n` +
    `🍽 Taomlar: ${fmt(info.subtotal)}\n` +
    `🚚 Yetkazib berish: ${deliveryText(info)}\n` +
    `💰 Jami: ${fmt(info.total)}\n` +
    `━━━━━━━━━━━━━━\n` +
    `📞 Tel: ${state.phone}\n` +
    `📍 Manzil: ${state.address}\n` +
    `💳 To‘lov: ${state.payment}`;

  return render(
    ctx,
    text,
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Tasdiqlash", "ord_ok")],
      [Markup.button.callback("❌ Bekor qilish", "ord_cancel")],
    ])
  );
}

bot.action(/^pay:(cash|card)$/, async (ctx) => {
  const uid = ctx.from.id;
  const state = orderSteps.get(uid);

  if (
    !state ||
    !["WAIT_PAYMENT", "WAIT_CONFIRM"].includes(state.step) ||
    !state.phone ||
    !state.address
  ) {
    return ack(ctx, "Avval telefon va manzilni kiriting!", true);
  }

  await ack(ctx);

  state.paymentType = ctx.match[1];
  state.payment = state.paymentType === "cash" ? "💵 Naqd pul" : "💳 Karta orqali";
  state.step = "WAIT_CONFIRM";

  return showSummary(ctx, uid, state);
});

bot.action("ord_cancel", async (ctx) => {
  await ack(ctx, "Bekor qilindi");
  clearOrder(ctx.from.id);
  await render(ctx, "Buyurtma bekor qilindi ❌");
  return ctx.reply("Savatingiz saqlanib qoldi.", getMainMenu(ctx.from.id));
});

bot.action("ord_ok", async (ctx) => {
  const uid = ctx.from.id;

  if (processing.has(uid)) return ack(ctx, "Buyurtmangiz qayta ishlanmoqda...");

  const state = orderSteps.get(uid);
  if (!state || state.step !== "WAIT_CONFIRM") {
    return ack(ctx, "Buyurtma jarayoni topilmadi. Savatdan qayta boshlang.", true);
  }

  processing.add(uid);

  try {
    const info = await cartInfo(uid);

    if (info.empty) {
      await ack(ctx, "Savatingiz bo‘sh!");
      clearOrder(uid);
      return ctx.reply("Savat bo‘sh.", getMainMenu(uid));
    }

    // Admin narxni o'zgartirgan bo'lsa, mijoz yangi summani ko'rib tasdiqlaydi
    if (info.total !== state.expectedTotal) {
      await ack(ctx, "Narxlar yangilandi!", true);
      return showSummary(ctx, uid, state, "⚠️ Menyu o‘zgargani uchun summa yangilandi.\n\n");
    }

    const orderId = await db.getNextOrderId();

    const order = await db.saveOrder({
      orderId,
      telegramId: uid,
      clientName: clientName(ctx.from),
      phone: state.phone,
      address: state.address,
      locationCoords: state.locationCoords || undefined,
      payment: state.payment,
      paymentType: state.paymentType,
      items: info.list,
      itemsText: linesText(info.list),
      subtotal: info.subtotal,
      deliveryFee: info.delivery,
      total: info.total,
      status: "accepted",
    });

    // Buyurtma saqlandi: savatni darhol tozalaymiz (takroriy buyurtmadan himoya)
    carts.delete(uid);
    clearOrder(uid);

    await ack(ctx, "Buyurtma qabul qilindi ✅");
    await render(ctx, `✅ Buyurtmangiz #${orderId} qabul qilindi!`);
    await ctx.reply(buildReceipt(order), getMainMenu(uid));

    const sent = await notifyAdmins(ctx.telegram, order);
    if (!sent) {
      console.warn(`Buyurtma #${orderId} hech bir adminga yuborilmadi! ADMIN_ID ni tekshiring.`);
    }

    console.log(`Buyurtma #${orderId} yakunlandi. Mijoz: ${uid}`);
  } catch (err) {
    console.error("Buyurtmani yakunlash xatosi:", err);
    await ctx
      .reply("Buyurtmani rasmiylashtirishda xatolik yuz berdi. Iltimos, qayta urinib ko‘ring.")
      .catch(ignore);
  } finally {
    processing.delete(uid);
  }
});

// =====================================
// XATOLIKLAR
// =====================================

bot.catch((err, ctx) => {
  console.error(`Telegram bot xatosi (${ctx.updateType}):`, err);
});

// =====================================
// SERVER (Render uchun): webhook yoki polling
// =====================================

const secret = crypto
  .createHash("sha256")
  .update(String(cfg.BOT_TOKEN))
  .digest("hex")
  .slice(0, 40);
const hookPath = `/tg/${secret}`;

let webhookHandler = null;

const server = http.createServer((req, res) => {
  if (webhookHandler && req.method === "POST" && req.url === hookPath) {
    return webhookHandler(req, res);
  }

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Bot muvaffaqiyatli ishlamoqda! 🚀");
});

async function start() {
  server.listen(cfg.PORT, () => {
    console.log(`HTTP server ${cfg.PORT}-portda ishlamoqda.`);
  });

  await db.initDB();

  const base = cfg.WEBHOOK_URL.replace(/\/+$/, "");

  if (base && !cfg.USE_POLLING) {
    bot.botInfo = await bot.telegram.getMe();
    webhookHandler = bot.webhookCallback(hookPath, { secretToken: secret });
    await bot.telegram.setWebhook(base + hookPath, { secret_token: secret });
    console.log("Bot webhook rejimida ishga tushdi ✅");
  } else {
    bot.launch().catch((err) => {
      console.error("Botni ishga tushirishda xato:", err);
      process.exit(1);
    });
    console.log("Bot polling rejimida ishga tushdi ✅");
  }
}

async function shutdown(signal) {
  console.log(`${signal}: Bot to‘xtatilmoqda...`);

  try {
    bot.stop(signal);
  } catch (err) {
    // webhook rejimida bot.stop() xato berishi normal
  }

  server.close(() => {
    console.log("HTTP server yopildi.");
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

if (require.main === module) {
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  start().catch((err) => {
    console.error("Ishga tushirish xatosi:", err);
    process.exit(1);
  });
}

module.exports = { bot };

const { Telegraf, Markup } = require("telegraf");
const http = require("http");

const {
  PORT,
  BOT_TOKEN,
  ADMIN_ID,
  CAFE_INFO,
} = require("./config");

const {
  loadMenu,
  getNextOrderId,
  saveOrder,
} = require("./db");
const {
  getMainMenu,
  buildCategoryKeyboard,
  buildItemsGrid,
  fmt,
} = require("./keyboards");

const { setupAdminHandlers } = require("./admin");

// ================================
// HTTP SERVER
// ================================

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
  });

  res.end("Bot muvaffaqiyatli ishlamoqda! 🚀");
});

server.listen(PORT || 3000, () => {
  console.log(`HTTP server ${PORT || 3000}-portda ishlamoqda.`);
});

// ================================
// BOT
// ================================

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN config.js faylida mavjud emas!");
}

const bot = new Telegraf(BOT_TOKEN);

const carts = new Map();
const userOrderSteps = new Map();
const processingOrders = new Set();

// ================================
// SAVAT
// ================================

const getCart = (uid) => {
  if (!carts.has(uid)) {
    carts.set(uid, {});
  }

  return carts.get(uid);
};

async function cartInfo(cart) {
  const MENU = await loadMenu();

  const items = {};

  Object.values(MENU).flat().forEach((item) => {
    items[String(item.id)] = item;
  });

  let total = 0;

  const lines = Object.entries(cart)
    .map(([id, qty]) => {
      const item = items[id];

      if (!item || !Number.isInteger(qty) || qty <= 0) {
        return null;
      }

      const sum = Number(item.price) * qty;

      total += sum;

      return `• ${item.name} × ${qty} = ${fmt(sum)}`;
    })
    .filter(Boolean);

  return {
    empty: lines.length === 0,
    linesText: lines.join("\n"),
    total,
    totalFmt: fmt(total),
  };
}

// ================================
// YORDAMCHI FUNKSIYALAR
// ================================

function paymentKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("💵 Naqd pul", "pay:naqd"),
    ],
    [
      Markup.button.callback("💳 Payme / Click", "pay:karta"),
    ],
  ]);
}

function getClientName(user) {
  return [
    user.first_name,
    user.last_name,
  ]
    .filter(Boolean)
    .join(" ");
}

function clearOrderState(uid) {
  userOrderSteps.delete(uid);
  processingOrders.delete(uid);
}

// ================================
// ADMIN HANDLERLAR
// ================================

setupAdminHandlers(bot, getMainMenu);

// ================================
// ASOSIY BUYRUQLAR
// ================================

bot.start(async (ctx) => {
  try {
    clearOrderState(ctx.from.id);

    await ctx.reply(
      `Assalomu alaykum, ${ctx.from.first_name}! 👋\n\nKafemizga xush kelibsiz!`,
      getMainMenu(ctx.from.id)
    );
  } catch (err) {
    console.error("Start xatosi:", err);
  }
});

bot.command("id", async (ctx) => {
  await ctx.reply(`ID: ${ctx.chat.id}`);
});

bot.command("cancel", async (ctx) => {
  clearOrderState(ctx.from.id);

  await ctx.reply(
    "Buyurtma jarayoni bekor qilindi. ❌",
    Markup.removeKeyboard()
  );

  await ctx.reply(
    "Asosiy menyu:",
    getMainMenu(ctx.from.id)
  );
});

bot.hears("📞 Aloqa", async (ctx) => {
  await ctx.reply(CAFE_INFO);
});

// ================================
// MENYU
// ================================

bot.hears("🍽 Menyu", async (ctx) => {
  try {
    const MENU = await loadMenu();

    const categories = Object.keys(MENU || {});

    if (categories.length === 0) {
      return ctx.reply("Hozircha taomnoma bo'sh 🙂");
    }

    return ctx.reply(
      "Bo‘limni tanlang:",
      buildCategoryKeyboard(categories)
    );
  } catch (err) {
    console.error("Menyu yuklash xatosi:", err);

    return ctx.reply(
      "Menyuni yuklashda xatolik yuz berdi. Qayta urinib ko‘ring."
    );
  }
});

// ================================
// KATEGORIYA TANLASH
// ================================

bot.action(/^cat:(\d+)$/, async (ctx) => {
  try {
    const MENU = await loadMenu();

    const categories = Object.keys(MENU || {});
    const cat = categories[Number(ctx.match[1])];

    if (!cat) {
      return ctx.answerCbQuery("Bo‘lim topilmadi!");
    }

    await ctx.answerCbQuery();

    await ctx.reply(
      `${cat}\n\nQo‘shish uchun taom ustiga bosing:`,
      buildItemsGrid(MENU[cat])
    );
  } catch (err) {
    console.error("Kategoriya xatosi:", err);

    await ctx.answerCbQuery(
      "Xatolik yuz berdi. Qayta urinib ko‘ring."
    );
  }
});

// ================================
// SAVATGA QO‘SHISH
// ================================

bot.action(/^add:(.+)$/, async (ctx) => {
  try {
    const itemId = ctx.match[1];

    const MENU = await loadMenu();

    const allItems = Object.values(MENU || {}).flat();

    const item = allItems.find(
      (i) => String(i.id) === String(itemId)
    );

    if (!item) {
      return ctx.answerCbQuery("Taom topilmadi!");
    }

    const cart = getCart(ctx.from.id);

    cart[itemId] = (cart[itemId] || 0) + 1;

    await ctx.answerCbQuery("Savatga qo‘shildi ✅");
  } catch (err) {
    console.error("Savatga qo‘shish xatosi:", err);

    await ctx.answerCbQuery("Xatolik yuz berdi!");
  }
});

// ================================
// SAVATNI KO‘RISH
// ================================

bot.hears("🛒 Savat", async (ctx) => {
  try {
    const info = await cartInfo(getCart(ctx.from.id));

    if (info.empty) {
      return ctx.reply("Savat hozircha bo‘sh 🙂");
    }

    return ctx.reply(
      `🛒 SAVATINGIZ:\n\n${info.linesText}\n\n━━━━━━━━━━━━━━\n💰 Jami: ${info.totalFmt}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "✅ Buyurtma berish",
            "order"
          ),
        ],
        [
          Markup.button.callback(
            "🗑 Savatni tozalash",
            "clear"
          ),
        ],
      ])
    );
  } catch (err) {
    console.error("Savatni ko‘rish xatosi:", err);

    return ctx.reply("Savatni yuklashda xatolik yuz berdi.");
  }
});

// ================================
// SAVATNI TOZALASH
// ================================

bot.action("clear", async (ctx) => {
  try {
    carts.delete(ctx.from.id);

    await ctx.answerCbQuery();

    await ctx.editMessageText("Savat tozalandi 🗑");
  } catch (err) {
    console.error("Savatni tozalash xatosi:", err);

    await ctx.answerCbQuery("Xatolik yuz berdi!");
  }
});

// ================================
// BUYURTMA BOSHLASH
// ================================

bot.action("order", async (ctx) => {
  try {
    const info = await cartInfo(getCart(ctx.from.id));

    if (info.empty) {
      return ctx.answerCbQuery("Savatingiz bo‘sh!");
    }

    await ctx.answerCbQuery();

    userOrderSteps.set(ctx.from.id, {
      step: "WAIT_CONTACT",
    });

    await ctx.reply(
      "📞 Buyurtmani rasmiylashtirish uchun telefon raqamingizni yuboring:",
      Markup.keyboard([
        [
          Markup.button.contactRequest(
            "📱 Raqamni yuborish"
          ),
        ],
      ])
        .resize()
        .oneTime()
    );
  } catch (err) {
    console.error("Buyurtma boshlash xatosi:", err);

    await ctx.reply("Xatolik yuz berdi. Qayta urinib ko‘ring.");
  }
});

// ================================
// TELEFON RAQAMINI QABUL QILISH
// ================================

bot.on("contact", async (ctx) => {
  try {
    const uid = ctx.from.id;
    const state = userOrderSteps.get(uid);

    if (!state || state.step !== "WAIT_CONTACT") {
      return;
    }

    const contact = ctx.message.contact;

    // Boshqa odamning kontaktini qabul qilmaslik
    if (
      contact.user_id &&
      contact.user_id !== uid
    ) {
      return ctx.reply(
        "Iltimos, o‘zingizning telefon raqamingizni yuboring."
      );
    }

    state.phone = contact.phone_number;
    state.step = "WAIT_ADDRESS_CHOICE";

    userOrderSteps.set(uid, state);

    await ctx.reply(
      "📍 Yetkazib berish manzilini qanday yubormoqchisiz?",
      Markup.keyboard([
        [
          Markup.button.locationRequest(
            "📍 Xaritadan joylashuvni yuborish"
          ),
        ],
        [
          "✍️ Qo‘lda yozib kiritaman",
        ],
      ])
        .resize()
        .oneTime()
    );
  } catch (err) {
    console.error("Kontakt xatosi:", err);

    await ctx.reply("Telefon raqamini qabul qilishda xatolik yuz berdi.");
  }
});

// ================================
// GEOLOKATSIYA QABUL QILISH
// ================================

bot.on("location", async (ctx) => {
  try {
    const uid = ctx.from.id;
    const state = userOrderSteps.get(uid);

    if (!state || state.step !== "WAIT_ADDRESS_CHOICE") {
      return;
    }

    const {
      latitude,
      longitude,
    } = ctx.message.location;

    state.address =
      `📍 Geo-Manzil: https://maps.google.com/?q=${latitude},${longitude}`;

    state.locationCoords = {
      latitude,
      longitude,
    };

    state.step = "WAIT_PAYMENT";

    userOrderSteps.set(uid, state);

    await ctx.reply(
      "Joylashuv qabul qilindi ✅\n\nTo‘lov turini tanlang:",
      Markup.removeKeyboard()
    );

    await ctx.reply(
      "💳 To‘lov turini tanlang:",
      paymentKeyboard()
    );
  } catch (err) {
    console.error("Joylashuv xatosi:", err);

    await ctx.reply("Joylashuvni qabul qilishda xatolik yuz berdi.");
  }
});

// ================================
// MATNLI XABARLAR
// ================================

bot.on("text", async (ctx, next) => {
  try {
    const uid = ctx.from.id;
    const state = userOrderSteps.get(uid);

    if (!state) {
      return next();
    }

    const message = ctx.message.text.trim();

    // Qo‘lda manzil kiritish
    if (
      state.step === "WAIT_ADDRESS_CHOICE" &&
      message === "✍️ Qo‘lda yozib kiritaman"
    ) {
      state.step = "WAIT_TEXT_ADDRESS";

      userOrderSteps.set(uid, state);

      return ctx.reply(
        "Iltimos, manzilingizni batafsil yozib yuboring:",
        Markup.removeKeyboard()
      );
    }

    // Manzilni qabul qilish
    if (state.step === "WAIT_TEXT_ADDRESS") {
      if (message.length < 5) {
        return ctx.reply(
          "Iltimos, manzilni to‘liqroq yozing."
        );
      }

      state.address = message;
      state.step = "WAIT_PAYMENT";

      userOrderSteps.set(uid, state);

      await ctx.reply("Manzil qabul qilindi ✅");

      return ctx.reply(
        "💳 To‘lov turini tanlang:",
        paymentKeyboard()
      );
    }

    return next();
  } catch (err) {
    console.error("Matnni qayta ishlash xatosi:", err);

    return ctx.reply("Xatolik yuz berdi.");
  }
});

// ================================
// TO‘LOV VA BUYURTMANI YAKUNLASH
// ================================

bot.action(/^pay:(naqd|karta)$/, async (ctx) => {
  const uid = ctx.from.id;

  if (processingOrders.has(uid)) {
    return ctx.answerCbQuery(
      "Buyurtmangiz qayta ishlanmoqda..."
    );
  }

  const state = userOrderSteps.get(uid);

  if (
    !state ||
    state.step !== "WAIT_PAYMENT" ||
    !state.phone ||
    !state.address
  ) {
    return ctx.answerCbQuery(
      "Avval telefon va manzilni kiriting!"
    );
  }

  processingOrders.add(uid);

  try {
    const info = await cartInfo(getCart(uid));

    if (info.empty) {
      await ctx.answerCbQuery("Savatingiz bo‘sh!");

      clearOrderState(uid);

      return ctx.reply(
        "Savat bo‘sh. Asosiy menyu:",
        getMainMenu(uid)
      );
    }

    const payType =
      ctx.match[1] === "naqd"
        ? "💵 Naqd pul"
        : "💳 Payme / Click";

    const orderId = await getNextOrderId();

    const now = new Date().toLocaleString(
      "ru-RU",
      {
        timeZone: "Asia/Tashkent",
      }
    );

    const clientName = getClientName(ctx.from);

    const phone = state.phone;
    const address = state.address;

    // MIJOZ CHEKI

    const clientReceipt =
      `🧾 BUYURTMA CHEKI #${orderId}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📅 Sana: ${now}\n` +
      `👤 Mijoz: ${clientName}\n` +
      `📞 Tel: ${phone}\n` +
      `📍 Manzil: ${address}\n` +
      `💳 To‘lov: ${payType}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `🛒 BUYURTMA TARKIBI:\n` +
      `${info.linesText}\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💰 JAMI: ${info.totalFmt}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `⏳ Holati: Qabul qilindi 🟡\n\n` +
      `Xaridingiz uchun rahmat! 🙌`;

    // ADMIN XABARNOMASI

    const adminNotification =
      `🆕 YANGI BUYURTMA #${orderId}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `📅 Sana: ${now}\n` +
      `👤 Mijoz: ${clientName}\n` +
      `🆔 Telegram ID: ${uid}\n` +
      `📞 Telefon: ${phone}\n` +
      `📍 MANZIL: ${address}\n` +
      `💳 To‘lov: ${payType}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `🛒 TAOMLAR:\n` +
      `${info.linesText}\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💰 JAMI SUMMA: ${info.totalFmt}`;


    
    // BUYURTMANI MONGODB GA SAQLASH

    await saveOrder({
      orderId,
      telegramId: uid,
      clientName,
      phone,
      address,
      locationCoords: state.locationCoords || undefined,
      payment: payType,
      itemsText: info.linesText,
      total: info.total,
      status: "accepted",
    });

    
    await ctx.answerCbQuery();

    // Mijozga chek
    await ctx.reply(
      clientReceipt,
      Markup.removeKeyboard()
    );

    // Asosiy menyu
    await ctx.reply(
      "Asosiy menyu:",
      getMainMenu(uid)
    );

    // Admin yoki guruhga yuborish
    const targetAdmin = ADMIN_ID || ctx.chat.id;

    try {
      await ctx.telegram.sendMessage(
        targetAdmin,
        adminNotification
      );

      // Agar mijoz lokatsiya yuborgan bo‘lsa
      if (state.locationCoords) {
        const {
          latitude,
          longitude,
        } = state.locationCoords;

        // Telegram xaritasi
        await ctx.telegram.sendLocation(
          targetAdmin,
          latitude,
          longitude
        );

        // Navigatsiya tugmalari
        const navButtons = Markup.inlineKeyboard([
          [
            Markup.button.url(
              "🚕 Yandex Navigatsiyada ochish",
              `https://yandex.com/maps/?pt=${longitude},${latitude}&z=17&l=map`
            ),
          ],
          [
            Markup.button.url(
              "🗺 Google Maps'da ochish",
              `https://maps.google.com/?q=${latitude},${longitude}`
            ),
          ],
        ]);

        await ctx.telegram.sendMessage(
          targetAdmin,
          "🗺 Kuryer uchun navigatsiya havolalari:",
          navButtons
        );
      }
    } catch (adminError) {
      console.error(
        "Admin xabarnoma yuborishda xato:",
        adminError
      );
    }

    // Savat va buyurtma holatini tozalash
    carts.delete(uid);
    clearOrderState(uid);

    console.log(
      `Buyurtma #${orderId} yakunlandi. Mijoz: ${uid}`
    );

  } catch (err) {
    console.error(
      "Buyurtmani yakunlash xatosi:",
      err
    );

    await ctx.reply(
      "Buyurtmani rasmiylashtirishda xatolik yuz berdi. Iltimos, qayta urinib ko‘ring."
    );

    // Xatolikda savat va buyurtma holati saqlanadi.
  } finally {
    processingOrders.delete(uid);
  }
});

// ================================
// XATOLIKLARNI USHLASH
// ================================

bot.catch((err, ctx) => {
  console.error(
    `Telegram bot xatosi (${ctx.updateType}):`,
    err
  );
});

// ================================
// BOTNI ISHGA TUSHIRISH
// ================================

bot.launch()
  .then(() => {
    console.log("Bot muvaffaqiyatli ishga tushdi ✅");
  })
  .catch((err) => {
    console.error("Botni ishga tushirishda xato:", err);
  });

// ================================
// SERVERNI TO‘G‘RI YOPISH
// ================================

async function shutdown(signal) {
  console.log(`${signal}: Bot to‘xtatilmoqda...`);

  try {
    bot.stop(signal);
  } catch (err) {
    console.error("Botni to‘xtatish xatosi:", err);
  }

  server.close(() => {
    console.log("HTTP server yopildi.");
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

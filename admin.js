const { Markup } = require("telegraf");
const cfg = require("./config");
const db = require("./db");
const {
  fmt,
  isAdmin,
  STATUS,
  FLOW,
  ACTIVE,
  formatTime,
  startOfDay,
  buildReceipt,
  render,
} = require("./helpers");
const { BTN, MAIN_BUTTONS, getMainMenu } = require("./keyboards");

const B = Markup.button.callback;
const states = new Map();

const ack = (ctx, text, alert) =>
  ctx.answerCbQuery(text, alert ? { show_alert: true } : undefined).catch(() => {});

const SETTING_FIELDS = {
  fee: { key: "deliveryFee", label: "Yetkazib berish narxi", type: "num", hint: "so'mda. 0 = bepul" },
  free: {
    key: "freeDeliveryFrom",
    label: "Bepul yetkazish chegarasi",
    type: "num",
    hint: "shu summadan oshsa yetkazish bepul. 0 = o'chirilgan",
  },
  min: { key: "minOrder", label: "Minimal buyurtma summasi", type: "num", hint: "so'mda. 0 = cheklovsiz" },
  info: { key: "info", label: "Aloqa ma'lumoti", type: "text", hint: "manzil, telefon, ish vaqti (\"📞 Aloqa\" tugmasida chiqadi)" },
};

const cancelKb = () => Markup.inlineKeyboard([[B("❌ Bekor qilish", "a:x")]]);

function parseNumber(text, { allowZero = false } = {}) {
  const n = Number(String(text).replace(/[\s,._]/g, ""));
  if (!Number.isSafeInteger(n) || n < 0 || (!allowZero && n === 0)) {
    throw new Error("Faqat raqam kiriting. Masalan: 25000");
  }
  return n;
}

// =====================================
// BUYURTMALAR
// =====================================

function orderKeyboard(order) {
  const rows = [];
  const idx = FLOW.indexOf(order.status);

  if (idx !== -1 && order.status !== "delivered") {
    for (const s of FLOW.slice(idx + 1)) {
      rows.push([B(`${STATUS[s].icon} ${STATUS[s].label}`, `a:s:${order.orderId}:${s}`)]);
    }
    rows.push([B("❌ Buyurtmani bekor qilish", `a:cx:${order.orderId}`)]);
  }

  rows.push([B("⬅️ Buyurtmalar", "a:orders:active")]);
  return Markup.inlineKeyboard(rows);
}

function clientStatusText(o) {
  const map = {
    preparing: `👨‍🍳 Buyurtmangiz #${o.orderId} tayyorlanmoqda.`,
    on_the_way: `🚚 Buyurtmangiz #${o.orderId} yo‘lda! Kuryer tez orada yetib boradi.`,
    delivered: `✅ Buyurtmangiz #${o.orderId} yetkazildi. Yoqimli ishtaha! 🙌`,
    cancelled: `❌ Buyurtmangiz #${o.orderId} bekor qilindi.\nSavollar bo‘lsa, "📞 Aloqa" bo‘limidan bog‘laning.`,
  };
  return map[o.status];
}

// Yangi buyurtma haqida barcha adminlarga xabar
async function notifyAdmins(telegram, order) {
  let sent = 0;

  for (const adminId of cfg.ADMIN_IDS) {
    try {
      await telegram.sendMessage(
        adminId,
        buildReceipt(order, { admin: true }),
        orderKeyboard(order)
      );
      sent++;

      const c = order.locationCoords;
      if (c && c.latitude != null && c.longitude != null) {
        await telegram.sendLocation(adminId, c.latitude, c.longitude);
        await telegram.sendMessage(
          adminId,
          "🗺 Kuryer uchun navigatsiya havolalari:",
          Markup.inlineKeyboard([
            [Markup.button.url("🚕 Yandex Navigatsiyada ochish", `https://yandex.com/maps/?pt=${c.longitude},${c.latitude}&z=17&l=map`)],
            [Markup.button.url("🗺 Google Maps'da ochish", `https://maps.google.com/?q=${c.latitude},${c.longitude}`)],
          ])
        );
      }
    } catch (err) {
      console.error(`Adminga (${adminId}) xabar yuborilmadi:`, err.message);
    }
  }

  return sent;
}

async function showHome(ctx) {
  const active = (await db.getOrdersByStatus(ACTIVE, 200)).length;

  return render(
    ctx,
    `🛠 ADMIN PANEL\n\n📦 Faol buyurtmalar: ${active}\n\nKerakli bo‘limni tanlang:`,
    Markup.inlineKeyboard([
      [B("📦 Buyurtmalar", "a:orders:active"), B("📊 Statistika", "a:stats")],
      [B("🍽 Taomlar", "a:menu"), B("📂 Bo‘limlar", "a:cats")],
      [B("⚙️ Sozlamalar", "a:set")],
    ])
  );
}

async function showOrders(ctx, mode) {
  const recent = mode === "recent";
  const orders = recent ? await db.getRecentOrders(15) : await db.getOrdersByStatus(ACTIVE, 30);

  const rows = orders.map((o) => [
    B(`${(STATUS[o.status] || {}).icon || "•"} ${o.orderId} · ${fmt(o.total)} · ${formatTime(o.createdAt)}`, `a:o:${o.orderId}`),
  ]);
  rows.push([B(recent ? "🟡 Faol buyurtmalar" : "📜 Oxirgi buyurtmalar", `a:orders:${recent ? "active" : "recent"}`)]);
  rows.push([B("⬅️ Panel", "a:home")]);

  const title = recent ? "📜 OXIRGI BUYURTMALAR" : "📦 FAOL BUYURTMALAR";
  const body = orders.length ? "Batafsil ko‘rish uchun tanlang:" : "Hozircha buyurtma yo‘q 🙂";

  return render(ctx, `${title} (${orders.length})\n\n${body}`, Markup.inlineKeyboard(rows));
}

function showOrder(ctx, order) {
  return render(ctx, buildReceipt(order, { admin: true }), orderKeyboard(order));
}

async function changeStatus(ctx, orderId, status) {
  if (!STATUS[status]) return ack(ctx, "Noto‘g‘ri holat");

  const cur = await db.getOrder(orderId);
  if (!cur) return ack(ctx, "Buyurtma topilmadi", true);
  if (cur.status === status) return ack(ctx, "Allaqachon shu holatda");
  if (cur.status === "delivered" || cur.status === "cancelled") {
    return ack(ctx, "Buyurtma yakunlangan", true);
  }

  const order = await db.setOrderStatus(orderId, status);
  await ack(ctx, "Holat yangilandi ✅");

  const text = clientStatusText(order);
  if (text) {
    try {
      await ctx.telegram.sendMessage(order.telegramId, text);
    } catch (err) {
      console.error("Mijozga holat xabari yuborilmadi:", err.message);
    }
  }

  return showOrder(ctx, order);
}

async function showStats(ctx) {
  const periods = [["📅 Bugun", 0], ["🗓 Oxirgi 7 kun", 6], ["🗓 Oxirgi 30 kun", 29]];
  const results = await Promise.all([
    ...periods.map(([, d]) => db.getStats(startOfDay(d))),
    db.getStats(null),
  ]);

  const labels = [...periods.map(([l]) => l), "📚 Jami"];
  const lines = results.map(
    (r, i) =>
      `${labels[i]}\n   Buyurtma: ${r.count} ta\n   Tushum: ${fmt(r.revenue)}` +
      (r.cancelled ? `\n   Bekor qilingan: ${r.cancelled} ta` : "")
  );

  return render(
    ctx,
    `📊 STATISTIKA\n(bekor qilinganlar tushumga kirmaydi)\n\n${lines.join("\n\n")}`,
    Markup.inlineKeyboard([[B("⬅️ Panel", "a:home")]])
  );
}

// =====================================
// TAOMLAR
// =====================================

async function showMenuCats(ctx) {
  const cats = await db.getCategories();

  if (!cats.length) {
    return render(
      ctx,
      "Hali bo‘limlar yo‘q. Avval bo‘lim qo‘shing (masalan: 🍕 Pitsa).",
      Markup.inlineKeyboard([[B("➕ Yangi bo‘lim", "a:cn")], [B("⬅️ Panel", "a:home")]])
    );
  }

  const rows = [];
  for (let i = 0; i < cats.length; i += 2) {
    rows.push(cats.slice(i, i + 2).map((c) => B(c.name, `a:c:${c.cid}`)));
  }
  rows.push([B("⬅️ Panel", "a:home")]);

  return render(ctx, "🍽 TAOMLAR\n\nBo‘limni tanlang:", Markup.inlineKeyboard(rows));
}

async function showCatItems(ctx, cid) {
  const cat = await db.getCategory(cid);
  if (!cat) return showMenuCats(ctx);

  const items = await db.getItemsByCategory(cat.name);
  const rows = items.map((i) => [
    B(`${i.available ? "" : "🔴 "}${i.name} — ${fmt(i.price)}`, `a:i:${i.id}`),
  ]);
  rows.push([B("➕ Taom qo‘shish", `a:ia:${cat.cid}`)]);
  rows.push([B("⬅️ Bo‘limlar", "a:menu")]);

  return render(
    ctx,
    `${cat.name}\n\n${items.length ? "Tahrirlash uchun taomni tanlang:" : "Bu bo‘limda hali taom yo‘q."}`,
    Markup.inlineKeyboard(rows)
  );
}

async function showItem(ctx, id) {
  const item = await db.getItem(id);
  if (!item) {
    await ack(ctx, "Taom topilmadi", true);
    return showMenuCats(ctx);
  }

  const cat = await db.getCategoryByName(item.category);
  const text =
    `🍽 ${item.name}\n` +
    `📂 ${item.category}\n` +
    `💰 ${fmt(item.price)}\n` +
    `${item.available ? "🟢 Mavjud" : "🔴 Tugagan"}\n` +
    `🖼 Rasm: ${item.photo ? "bor" : "yo‘q"}`;

  return render(
    ctx,
    text,
    Markup.inlineKeyboard([
      [B("📝 Nomi", `a:ie:${id}:n`), B("💵 Narxi", `a:ie:${id}:p`)],
      [B("🖼 Rasm", `a:ie:${id}:f`), B(item.available ? "🔴 Tugadi deb belgilash" : "🟢 Mavjud qilish", `a:it:${id}`)],
      [B("🗑 O‘chirish", `a:id:${id}`)],
      [B("⬅️ Orqaga", cat ? `a:c:${cat.cid}` : "a:menu")],
    ]),
    item.photo
  );
}

// =====================================
// BO'LIMLAR
// =====================================

async function showCats(ctx) {
  const cats = await db.getCategories();
  const rows = cats.map((c) => [B(`📂 ${c.name}`, `a:cat:${c.cid}`)]);
  rows.push([B("➕ Yangi bo‘lim", "a:cn")]);
  rows.push([B("⬅️ Panel", "a:home")]);

  return render(
    ctx,
    `📂 BO‘LIMLAR\n\n${cats.length ? "Tahrirlash uchun tanlang:" : "Hali bo‘lim yo‘q."}`,
    Markup.inlineKeyboard(rows)
  );
}

async function showCat(ctx, cid) {
  const cat = await db.getCategory(cid);
  if (!cat) return showCats(ctx);

  const n = await db.countItems(cat.name);

  return render(
    ctx,
    `📂 ${cat.name}\n\nTaomlar soni: ${n}`,
    Markup.inlineKeyboard([
      [B("✏️ Nomini o‘zgartirish", `a:cr:${cat.cid}`)],
      [B("🗑 Bo‘limni o‘chirish", `a:cd:${cat.cid}`)],
      [B("⬅️ Bo‘limlar", "a:cats")],
    ])
  );
}

// =====================================
// SOZLAMALAR
// =====================================

async function showSettings(ctx) {
  const s = await db.getSettings();

  const text =
    "⚙️ SOZLAMALAR\n\n" +
    `🚚 Yetkazib berish: ${s.deliveryFee > 0 ? fmt(s.deliveryFee) : "bepul"}\n` +
    `🎁 Bepul yetkazish: ${s.freeDeliveryFrom > 0 ? fmt(s.freeDeliveryFrom) + " dan" : "o‘chirilgan"}\n` +
    `🛒 Minimal buyurtma: ${s.minOrder > 0 ? fmt(s.minOrder) : "cheklovsiz"}\n\n` +
    `📞 Aloqa ma‘lumoti:\n${s.info}`;

  return render(
    ctx,
    text,
    Markup.inlineKeyboard([
      [B("🚚 Yetkazish narxi", "a:se:fee")],
      [B("🎁 Bepul yetkazish chegarasi", "a:se:free")],
      [B("🛒 Minimal buyurtma", "a:se:min")],
      [B("📞 Aloqa ma‘lumoti", "a:se:info")],
      [B("⬅️ Panel", "a:home")],
    ])
  );
}

// =====================================
// HANDLERS
// =====================================

function setupAdminHandlers(bot) {
  bot.hears(BTN.ADMIN, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("Siz admin emassiz ❌");
    states.delete(ctx.from.id);
    return showHome(ctx);
  });

  bot.command("admin", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("Siz admin emassiz ❌");
    states.delete(ctx.from.id);
    return showHome(ctx);
  });

  // ---- Tugmalar (bitta dispatcher) ----
  bot.action(/^a:(.+)$/, async (ctx) => {
    const uid = ctx.from.id;
    if (!isAdmin(uid)) return ack(ctx);

    const [cmd, p1, p2] = ctx.match[1].split(":");

    try {
      switch (cmd) {
        case "home":
          states.delete(uid);
          await ack(ctx);
          return showHome(ctx);

        case "x":
          states.delete(uid);
          await ack(ctx, "Bekor qilindi");
          return showHome(ctx);

        // --- buyurtmalar ---
        case "orders":
          await ack(ctx);
          return showOrders(ctx, p1 === "recent" ? "recent" : "active");

        case "o": {
          const order = await db.getOrder(p1);
          if (!order) return ack(ctx, "Buyurtma topilmadi", true);
          await ack(ctx);
          return showOrder(ctx, order);
        }

        case "s":
          return changeStatus(ctx, p1, p2);

        case "cx":
          await ack(ctx);
          return render(
            ctx,
            `❌ #${p1} buyurtmani bekor qilasizmi?\nMijozga xabar yuboriladi.`,
            Markup.inlineKeyboard([
              [B("✅ Ha, bekor qilish", `a:s:${p1}:cancelled`)],
              [B("⬅️ Yo‘q", `a:o:${p1}`)],
            ])
          );

        case "stats":
          await ack(ctx);
          return showStats(ctx);

        // --- taomlar ---
        case "menu":
          await ack(ctx);
          return showMenuCats(ctx);

        case "c":
          await ack(ctx);
          return showCatItems(ctx, p1);

        case "i":
          await ack(ctx);
          return showItem(ctx, p1);

        case "ia": {
          const cat = await db.getCategory(p1);
          if (!cat) return ack(ctx, "Bo‘lim topilmadi", true);
          await ack(ctx);
          states.set(uid, { step: "ITEM_NAME", cid: cat.cid });
          return render(ctx, `${cat.name}\n\nYangi taom nomini kiriting:`, cancelKb());
        }

        case "skip": {
          const st = states.get(uid);
          if (!st || st.step !== "ITEM_PHOTO") return ack(ctx, "Sessiya tugagan", true);
          await ack(ctx);
          return saveNewItem(ctx, st, "");
        }

        case "ie": {
          const item = await db.getItem(p1);
          if (!item) return ack(ctx, "Taom topilmadi", true);
          await ack(ctx);
          const map = {
            n: ["EDIT_NAME", "Taomning yangi nomini kiriting:"],
            p: ["EDIT_PRICE", "Taomning yangi narxini kiriting (masalan: 25000):"],
            f: ["EDIT_PHOTO", "Taomning yangi rasmini yuboring 🖼"],
          };
          const [step, prompt] = map[p2] || map.n;
          states.set(uid, { step, id: p1 });
          return render(ctx, prompt, cancelKb());
        }

        case "it": {
          const item = await db.getItem(p1);
          if (!item) return ack(ctx, "Taom topilmadi", true);
          await db.updateMenuItem(p1, { available: !item.available });
          await ack(ctx, item.available ? "Tugadi deb belgilandi 🔴" : "Mavjud qilindi 🟢");
          return showItem(ctx, p1);
        }

        case "id": {
          const item = await db.getItem(p1);
          if (!item) return ack(ctx, "Taom topilmadi", true);
          await ack(ctx);
          return render(
            ctx,
            `🗑 "${item.name}" taomini o‘chirasizmi?\nBu amalni qaytarib bo‘lmaydi.`,
            Markup.inlineKeyboard([
              [B("✅ Ha, o‘chirish", `a:idc:${p1}`)],
              [B("⬅️ Yo‘q", `a:i:${p1}`)],
            ])
          );
        }

        case "idc": {
          const item = await db.getItem(p1);
          await db.deleteMenuItem(p1);
          await ack(ctx, "Taom o‘chirildi ✅");
          const cat = item && (await db.getCategoryByName(item.category));
          return cat ? showCatItems(ctx, cat.cid) : showMenuCats(ctx);
        }

        // --- bo'limlar ---
        case "cats":
          await ack(ctx);
          return showCats(ctx);

        case "cat":
          await ack(ctx);
          return showCat(ctx, p1);

        case "cn":
          await ack(ctx);
          states.set(uid, { step: "CAT_NEW" });
          return render(ctx, "Yangi bo‘lim nomini kiriting (masalan: 🍕 Pitsa):", cancelKb());

        case "cr": {
          const cat = await db.getCategory(p1);
          if (!cat) return ack(ctx, "Bo‘lim topilmadi", true);
          await ack(ctx);
          states.set(uid, { step: "CAT_RENAME", cid: p1 });
          return render(ctx, `"${cat.name}" uchun yangi nom kiriting:`, cancelKb());
        }

        case "cd": {
          const cat = await db.getCategory(p1);
          if (!cat) return ack(ctx, "Bo‘lim topilmadi", true);
          await ack(ctx);
          return render(
            ctx,
            `🗑 "${cat.name}" bo‘limini o‘chirasizmi?\n(Faqat ichi bo‘sh bo‘lsa o‘chadi)`,
            Markup.inlineKeyboard([
              [B("✅ Ha, o‘chirish", `a:cdc:${p1}`)],
              [B("⬅️ Yo‘q", `a:cat:${p1}`)],
            ])
          );
        }

        case "cdc":
          try {
            await db.deleteCategory(p1);
          } catch (err) {
            return ack(ctx, err.message, true);
          }
          await ack(ctx, "Bo‘lim o‘chirildi ✅");
          return showCats(ctx);

        // --- sozlamalar ---
        case "set":
          await ack(ctx);
          return showSettings(ctx);

        case "se": {
          const f = SETTING_FIELDS[p1];
          if (!f) return ack(ctx);
          await ack(ctx);
          states.set(uid, { step: "SETTING", field: p1 });
          return render(ctx, `${f.label}\n(${f.hint})\n\nYangi qiymatni kiriting:`, cancelKb());
        }

        default:
          return ack(ctx);
      }
    } catch (err) {
      console.error("Admin action xatosi:", err);
      return ack(ctx, `Xatolik: ${err.message}`.slice(0, 190), true);
    }
  });

  // ---- Matn kiritish ----
  bot.on("text", async (ctx, next) => {
    const uid = ctx.from.id;
    if (!isAdmin(uid)) return next();

    const st = states.get(uid);
    if (!st) return next();

    const text = ctx.message.text.trim();

    // Admin boshqa tugmani bosib ketsa, jarayon to'xtaydi
    if (text.startsWith("/") || MAIN_BUTTONS.includes(text)) {
      states.delete(uid);
      return next();
    }

    try {
      switch (st.step) {
        case "ITEM_NAME":
          if (text.length > 100) throw new Error("Nom 100 belgidan oshmasligi kerak.");
          st.name = text;
          st.step = "ITEM_PRICE";
          return ctx.reply(`"${text}" narxini kiriting (masalan: 25000):`, cancelKb());

        case "ITEM_PRICE":
          st.price = parseNumber(text);
          st.step = "ITEM_PHOTO";
          return ctx.reply(
            "🖼 Taom rasmini yuboring yoki rasmsiz saqlang:",
            Markup.inlineKeyboard([
              [B("⏭ Rasmsiz saqlash", "a:skip")],
              [B("❌ Bekor qilish", "a:x")],
            ])
          );

        case "ITEM_PHOTO":
        case "EDIT_PHOTO":
          return ctx.reply("Iltimos, rasm yuboring 🖼 (matn emas).", cancelKb());

        case "EDIT_NAME":
          await db.updateMenuItem(st.id, { name: text });
          states.delete(uid);
          await ctx.reply("✅ Nomi o‘zgartirildi!");
          return showItem(ctx, st.id);

        case "EDIT_PRICE":
          await db.updateMenuItem(st.id, { price: parseNumber(text) });
          states.delete(uid);
          await ctx.reply("✅ Narxi o‘zgartirildi!");
          return showItem(ctx, st.id);

        case "CAT_NEW":
          await db.addCategory(text);
          states.delete(uid);
          await ctx.reply("✅ Bo‘lim qo‘shildi!");
          return showCats(ctx);

        case "CAT_RENAME":
          await db.renameCategory(st.cid, text);
          states.delete(uid);
          await ctx.reply("✅ Bo‘lim nomi o‘zgartirildi!");
          return showCat(ctx, st.cid);

        case "SETTING": {
          const f = SETTING_FIELDS[st.field];
          const value =
            f.type === "num"
              ? parseNumber(text, { allowZero: true })
              : text.slice(0, 500);
          await db.updateSettings({ [f.key]: value });
          states.delete(uid);
          await ctx.reply("✅ Saqlandi!");
          return showSettings(ctx);
        }

        default:
          states.delete(uid);
          return next();
      }
    } catch (err) {
      return ctx.reply(`❌ ${err.message}`, cancelKb());
    }
  });

  // ---- Rasm qabul qilish ----
  bot.on("photo", async (ctx, next) => {
    const uid = ctx.from.id;
    if (!isAdmin(uid)) return next();

    const st = states.get(uid);
    if (!st || (st.step !== "ITEM_PHOTO" && st.step !== "EDIT_PHOTO")) return next();

    const photos = ctx.message.photo;
    const fileId = photos[photos.length - 1].file_id;

    try {
      if (st.step === "ITEM_PHOTO") {
        return await saveNewItem(ctx, st, fileId);
      }

      await db.updateMenuItem(st.id, { photo: fileId });
      states.delete(uid);
      await ctx.reply("✅ Rasm yangilandi!");
      return showItem(ctx, st.id);
    } catch (err) {
      return ctx.reply(`❌ ${err.message}`, cancelKb());
    }
  });
}

async function saveNewItem(ctx, st, photo) {
  const cat = await db.getCategory(st.cid);
  if (!cat) throw new Error("Bo'lim topilmadi!");

  const item = await db.saveMenuItem({
    category: cat.name,
    name: st.name,
    price: st.price,
    photo,
  });

  states.delete(ctx.from.id);
  await ctx.reply(`✅ "${item.name}" qo‘shildi! Mijozlarda shu zahoti ko‘rinadi.`, getMainMenu(ctx.from.id));
  return showItem(ctx, item.id);
}

module.exports = { setupAdminHandlers, notifyAdmins };

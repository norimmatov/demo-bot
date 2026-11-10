const { Markup } = require("telegraf");
const { ADMIN_ID } = require("./config");
const { loadMenu, saveMenuItem, updateMenuItem, deleteMenuItem } = require("./db");

const adminStates = new Map();

function isAdmin(userId) {
  return ADMIN_ID && Number(userId) === Number(ADMIN_ID);
}

const DEFAULT_CATEGORIES = ["☕ Ichimliklar", "🍰 Shirinliklar", "🍔 Taomlar"];

// Holatni tozalash yordamchi funksiyasi
function clearState(userId) {
  adminStates.delete(userId);
}

function setupAdminHandlers(bot, getMainMenu) {
  // Admin menyusini ko'rsatish
  bot.hears("⚙️ Admin Panel", (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("Siz admin emassiz ❌");
    clearState(ctx.from.id);

    return ctx.reply(
      "🛠 Taomnomani boshqarish paneli (CRUD):",
      Markup.inlineKeyboard([
        [Markup.button.callback("📋 Menyu ro'yxati (Read)", "admin_read")],
        [Markup.button.callback("➕ Yangi taom qo'shish (Create)", "admin_create")],
        [Markup.button.callback("✏️ Taomni tahrirlash (Update)", "admin_update")],
        [Markup.button.callback("🗑 Taomni o'chirish (Delete)", "admin_delete")],
      ])
    );
  });

  // Bekor qilish tugmasi uchun handler
  bot.action("admin_cancel", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();
    clearState(ctx.from.id);
    await ctx.answerCbQuery("Jarayon bekor qilindi");
    await ctx.reply("❌ Amallab bekor qilindi.", getMainMenu(ctx.from.id));
  });

  // READ: Menyu ro'yxati
  bot.action("admin_read", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();

    const MENU = await loadMenu();
    let text = "📋 **Hozirgi Taomnoma Ro'yxati:**\n\n";

    for (const [cat, items] of Object.entries(MENU)) {
      text += `📌 **${cat}**:\n`;
      if (!items || items.length === 0) {
        text += "  _(Bo'sh)_\n";
      } else {
        items.forEach((it) => {
          text += `  • ${it.name} — ${Number(it.price).toLocaleString("ru-RU")} so'm\n`;
        });
      }
      text += "\n";
    }

    // Uzun xabar 4096 belgidan oshib ketmasligi uchun bo'laklab yuborish
    if (text.length > 4000) {
      const chunks = text.match(/[\s\S]{1,3900}/g) || [];
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: "Markdown" });
      }
    } else {
      await ctx.reply(text, { parse_mode: "Markdown" });
    }
  });

  // CREATE: Yangi taom qo'shish
  bot.action("admin_create", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();

    adminStates.set(ctx.from.id, { step: "WAIT_NAME" });
    await ctx.reply(
      "Yangi taom nomini kiriting:",
      Markup.inlineKeyboard([[Markup.button.callback("❌ Bekor qilish", "admin_cancel")]])
    );
  });

  // UPDATE: Tahrirlash ro'yxati
  bot.action("admin_update", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();

    const MENU = await loadMenu();
    const items = Object.values(MENU).flat();

    if (items.length === 0) return ctx.reply("Taomnoma bo'sh.");

    const buttons = items.map((i) => [
      Markup.button.callback(`✏️ ${i.name} (${i.price} so'm)`, `select_item:${i.id}`),
    ]);
    buttons.push([Markup.button.callback("❌ Bekor qilish", "admin_cancel")]);

    await ctx.reply("Tahrirlamoqchi bo'lgan taomni tanlang:", Markup.inlineKeyboard(buttons));
  });

  bot.action(/^select_item:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    const itemId = ctx.match[1];

    await ctx.reply(
      "Nimani o'zgartirmoqchisiz?",
      Markup.inlineKeyboard([
        [Markup.button.callback("📝 Nomini o'zgartirish", `edit_name:${itemId}`)],
        [Markup.button.callback("💵 Narxini o'zgartirish", `edit_price:${itemId}`)],
        [Markup.button.callback("❌ Bekor qilish", "admin_cancel")],
      ])
    );
  });

  bot.action(/^edit_name:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();

    adminStates.set(ctx.from.id, { step: "WAIT_NEW_NAME", itemId: ctx.match[1] });
    await ctx.reply(
      "Taom uchun yangi nomni kiriting:",
      Markup.inlineKeyboard([[Markup.button.callback("❌ Bekor qilish", "admin_cancel")]])
    );
  });

  bot.action(/^edit_price:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();

    adminStates.set(ctx.from.id, { step: "WAIT_NEW_PRICE", itemId: ctx.match[1] });
    await ctx.reply(
      "Yangi narxni raqamlarda kiriting:",
      Markup.inlineKeyboard([[Markup.button.callback("❌ Bekor qilish", "admin_cancel")]])
    );
  });

  // DELETE: Taomni o'chirish
  bot.action("admin_delete", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();

    const MENU = await loadMenu();
    const items = Object.values(MENU).flat();

    if (items.length === 0) return ctx.reply("Taomnoma bo'sh.");

    const buttons = items.map((i) => [
      Markup.button.callback(`🗑 ${i.name}`, `del_item:${i.id}`),
    ]);
    buttons.push([Markup.button.callback("❌ Bekor qilish", "admin_cancel")]);

    await ctx.reply("O'chirmoqchi bo'lgan taomni tanlang:", Markup.inlineKeyboard(buttons));
  });

  bot.action(/^del_item:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();
    await ctx.answerCbQuery();

    const itemId = ctx.match[1];
    await deleteMenuItem(itemId);

    await ctx.reply(`❌ Taom taomnomadan o'chirildi!`, getMainMenu(ctx.from.id));
  });

  // KATEGORIYA BOSILGANDA SAQLASH
  bot.action(/^add_cat:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();

    const state = adminStates.get(ctx.from.id);
    if (!state || state.step !== "WAIT_CAT") {
      await ctx.answerCbQuery("Sessiya muddati o'tgan");
      return;
    }

    const catIndex = Number(ctx.match[1]);
    const catList = state.categoriesList || DEFAULT_CATEGORIES;
    const selectedCat = catList[catIndex];

    if (!selectedCat) {
      await ctx.answerCbQuery("Kategoriya topilmadi");
      return;
    }

    await saveMenuItem(selectedCat, state.name, state.price);
    clearState(ctx.from.id);

    await ctx.answerCbQuery();
    await ctx.reply(
      `✅ "${state.name}" (${selectedCat}) muvaffaqiyatli saqlandi!`,
      getMainMenu(ctx.from.id)
    );
  });

  // MATNLI XABARLARNI TUTIB OLISH
  bot.on("text", async (ctx, next) => {
    if (!isAdmin(ctx.from.id)) return next();

    const state = adminStates.get(ctx.from.id);
    if (!state) return next();

    // 1. Yangi nom kiritish
    if (state.step === "WAIT_NAME") {
      state.name = ctx.message.text.trim();
      state.step = "WAIT_PRICE";
      adminStates.set(ctx.from.id, state);

      return ctx.reply(
        `"${state.name}" narxini kiriting:`,
        Markup.inlineKeyboard([[Markup.button.callback("❌ Bekor qilish", "admin_cancel")]])
      );
    }

    // 2. Yangi narx kiritish va kategoriya tanlash
    if (state.step === "WAIT_PRICE") {
      const price = Number(ctx.message.text.replace(/\D/g, ""));
      if (!price || isNaN(price)) {
        return ctx.reply("Iltimos, faqat to'g'ri raqam kiriting!");
      }

      state.price = price;
      state.step = "WAIT_CAT";

      const MENU = await loadMenu();
      const dbCategories = Object.keys(MENU);
      const activeCategories = dbCategories.length > 0 ? dbCategories : DEFAULT_CATEGORIES;
      state.categoriesList = activeCategories;

      adminStates.set(ctx.from.id, state);

      const catButtons = activeCategories.map((c, i) => [
        Markup.button.callback(c, `add_cat:${i}`),
      ]);
      catButtons.push([Markup.button.callback("❌ Bekor qilish", "admin_cancel")]);

      return ctx.reply("Kategoriyani tanlang:", Markup.inlineKeyboard(catButtons));
    }

    // 3. Nomi o'zgartirish
    if (state.step === "WAIT_NEW_NAME") {
      const newName = ctx.message.text.trim();
      await updateMenuItem(state.itemId, { name: newName });
      clearState(ctx.from.id);

      return ctx.reply(
        `✅ Taom nomi "${newName}"ga o'zgartirildi!`,
        getMainMenu(ctx.from.id)
      );
    }

    // 4. Narxini o'zgartirish
    if (state.step === "WAIT_NEW_PRICE") {
      const newPrice = Number(ctx.message.text.replace(/\D/g, ""));
      if (!newPrice || isNaN(newPrice)) {
        return ctx.reply("Iltimos, faqat to'g'ri raqam kiriting!");
      }

      await updateMenuItem(state.itemId, { price: newPrice });
      clearState(ctx.from.id);

      return ctx.reply(
        `✅ Taom narxi ${newPrice.toLocaleString("ru-RU")} so'mga o'zgartirildi!`,
        getMainMenu(ctx.from.id)
      );
    }

    return next();
  });
}

module.exports = { setupAdminHandlers };

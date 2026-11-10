
const { Markup } = require("telegraf");
const { ADMIN_ID } = require("./config");
const {
  loadMenu,
  saveMenuItem,
  updateMenuItem,
  deleteMenuItem,
} = require("./db");

const adminStates = new Map();

const DEFAULT_CATEGORIES = [
  "☕ Ichimliklar",
  "🍰 Shirinliklar",
  "🍔 Taomlar",
];

function isAdmin(userId) {
  return ADMIN_ID && Number(userId) === Number(ADMIN_ID);
}

function clearState(userId) {
  adminStates.delete(userId);
}

function cancelButton() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("❌ Bekor qilish", "admin_cancel")],
  ]);
}

function setupAdminHandlers(bot, getMainMenu) {
  // ADMIN PANEL
  bot.hears("⚙️ Admin Panel", (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.reply("Siz admin emassiz ❌");
    }

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

  // CANCEL
  bot.action("admin_cancel", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();

    clearState(ctx.from.id);
    await ctx.answerCbQuery("Jarayon bekor qilindi");
    await ctx.reply("❌ Amal bekor qilindi.", getMainMenu(ctx.from.id));
  });

  // READ
  bot.action("admin_read", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();

    await ctx.answerCbQuery();

    const menu = await loadMenu();
    let message = "📋 **Hozirgi Taomnoma Ro'yxati:**\n\n";

    for (const [category, items] of Object.entries(menu)) {
      message += `📌 **${category}**:\n`;

      if (!items || items.length === 0) {
        message += "  _(Bo'sh)_\n";
      } else {
        items.forEach((item) => {
          message += `  • ${item.name} — ${Number(item.price).toLocaleString("ru-RU")} so'm\n`;
        });
      }

      message += "\n";
    }

    const chunks =
      message.length > 4000
        ? message.match(/[\s\S]{1,3900}/g) || []
        : [message];

    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: "Markdown" });
    }
  });

  // CREATE
  bot.action("admin_create", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();

    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { step: "WAIT_NAME" });

    await ctx.reply("Yangi taom nomini kiriting:", cancelButton());
  });

  // UPDATE: taom tanlash
  bot.action("admin_update", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();

    await ctx.answerCbQuery();

    const menu = await loadMenu();
    const items = Object.values(menu).flat();

    if (items.length === 0) {
      return ctx.reply("Taomnoma bo'sh.");
    }

    const buttons = items.map((item) => [
      Markup.button.callback(
        `✏️ ${item.name} (${item.price} so'm)`,
        `select_item:${item.id}`
      ),
    ]);

    buttons.push([
      Markup.button.callback("❌ Bekor qilish", "admin_cancel"),
    ]);

    await ctx.reply(
      "Tahrirlamoqchi bo'lgan taomni tanlang:",
      Markup.inlineKeyboard(buttons)
    );
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

  // Taom nomini tahrirlash
  bot.action(/^edit_name:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();

    await ctx.answerCbQuery();

    adminStates.set(ctx.from.id, {
      step: "WAIT_NEW_NAME",
      itemId: ctx.match[1],
    });

    await ctx.reply("Taom uchun yangi nomni kiriting:", cancelButton());
  });

  // Taom narxini tahrirlash
  bot.action(/^edit_price:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();

    await ctx.answerCbQuery();

    adminStates.set(ctx.from.id, {
      step: "WAIT_NEW_PRICE",
      itemId: ctx.match[1],
    });

    await ctx.reply("Yangi narxni raqamlarda kiriting:", cancelButton());
  });

  // DELETE
  bot.action("admin_delete", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();

    await ctx.answerCbQuery();

    const menu = await loadMenu();
    const items = Object.values(menu).flat();

    if (items.length === 0) {
      return ctx.reply("Taomnoma bo'sh.");
    }

    const buttons = items.map((item) => [
      Markup.button.callback(`🗑 ${item.name}`, `del_item:${item.id}`),
    ]);

    buttons.push([
      Markup.button.callback("❌ Bekor qilish", "admin_cancel"),
    ]);

    await ctx.reply(
      "O'chirmoqchi bo'lgan taomni tanlang:",
      Markup.inlineKeyboard(buttons)
    );
  });

  bot.action(/^del_item:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();

    await ctx.answerCbQuery();

    const itemId = ctx.match[1];
    await deleteMenuItem(itemId);

    await ctx.reply(
      "❌ Taom taomnomadan o'chirildi!",
      getMainMenu(ctx.from.id)
    );
  });

  // CREATE: kategoriya tanlash
  bot.action(/^add_cat:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery();

    const state = adminStates.get(ctx.from.id);

    if (!state || state.step !== "WAIT_CAT") {
      await ctx.answerCbQuery("Sessiya muddati o'tgan");
      return;
    }

    const categoryIndex = Number(ctx.match[1]);
    const categories = state.categoriesList || DEFAULT_CATEGORIES;
    const selectedCategory = categories[categoryIndex];

    if (!selectedCategory) {
      await ctx.answerCbQuery("Kategoriya topilmadi");
      return;
    }

    await saveMenuItem(selectedCategory, state.name, state.price);
    clearState(ctx.from.id);

    await ctx.answerCbQuery();

    await ctx.reply(
      `✅ "${state.name}" (${selectedCategory}) muvaffaqiyatli saqlandi!`,
      getMainMenu(ctx.from.id)
    );
  });

  // TEXT INPUTS
  bot.on("text", async (ctx, next) => {
    if (!isAdmin(ctx.from.id)) return next();

    const state = adminStates.get(ctx.from.id);
    if (!state) return next();

    const inputText = ctx.message.text.trim();

    // Yangi taom nomi
    if (state.step === "WAIT_NAME") {
      if (!inputText) {
        return ctx.reply("Taom nomini bo'sh qoldirmang.");
      }

      state.name = inputText;
      state.step = "WAIT_PRICE";
      adminStates.set(ctx.from.id, state);

      return ctx.reply(
        `"${state.name}" narxini kiriting:`,
        cancelButton()
      );
    }

    // Yangi taom narxi
    if (state.step === "WAIT_PRICE") {
      const price = Number(inputText.replace(/[^\d]/g, ""));

      if (!Number.isSafeInteger(price) || price <= 0) {
        return ctx.reply("Iltimos, to'g'ri narx kiriting. Masalan: 25000");
      }

      state.price = price;
      state.step = "WAIT_CAT";

      const menu = await loadMenu();
      const dbCategories = Object.keys(menu);
      const activeCategories =
        dbCategories.length > 0 ? dbCategories : DEFAULT_CATEGORIES;

      state.categoriesList = activeCategories;
      adminStates.set(ctx.from.id, state);

      const categoryButtons = activeCategories.map((category, index) => [
        Markup.button.callback(category, `add_cat:${index}`),
      ]);

      categoryButtons.push([
        Markup.button.callback("❌ Bekor qilish", "admin_cancel"),
      ]);

      return ctx.reply(
        "Kategoriyani tanlang:",
        Markup.inlineKeyboard(categoryButtons)
      );
    }

    // Mavjud taom nomini yangilash
    if (state.step === "WAIT_NEW_NAME") {
      const newName = inputText;

      if (!newName) {
        return ctx.reply("Taom nomini bo'sh qoldirmang.");
      }

      // db.js funksiyasi: updateMenuItem(itemId, newName, newPrice)
      await updateMenuItem(state.itemId, newName, undefined);
      clearState(ctx.from.id);

      return ctx.reply(
        `✅ Taom nomi "${newName}"ga o'zgartirildi!`,
        getMainMenu(ctx.from.id)
      );
    }

    // Mavjud taom narxini yangilash
    if (state.step === "WAIT_NEW_PRICE") {
      const newPrice = Number(inputText.replace(/[^\d]/g, ""));

      if (!Number.isSafeInteger(newPrice) || newPrice <= 0) {
        return ctx.reply("Iltimos, to'g'ri narx kiriting. Masalan: 25000");
      }

      // db.js funksiyasi: updateMenuItem(itemId, newName, newPrice)
      await updateMenuItem(state.itemId, undefined, newPrice);
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

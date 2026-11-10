
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
  return ADMIN_ID !== null &&
    Number(userId) === Number(ADMIN_ID);
}

function clearState(userId) {
  adminStates.delete(userId);
}

function cancelButton() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "❌ Bekor qilish",
        "admin_cancel"
      ),
    ],
  ]);
}

function mainAdminKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "📋 Menyu ro'yxati",
        "admin_read"
      ),
    ],
    [
      Markup.button.callback(
        "➕ Yangi taom qo'shish",
        "admin_create"
      ),
    ],
    [
      Markup.button.callback(
        "✏️ Taomni tahrirlash",
        "admin_update"
      ),
    ],
    [
      Markup.button.callback(
        "🗑 Taomni o'chirish",
        "admin_delete"
      ),
    ],
  ]);
}

function setupAdminHandlers(bot, getMainMenu) {

  // ADMIN PANEL

  bot.hears("⚙️ Admin Panel", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.reply("Siz admin emassiz ❌");
    }

    clearState(ctx.from.id);

    return ctx.reply(
      "🛠 ADMIN PANEL\n\nKerakli amalni tanlang:",
      mainAdminKeyboard()
    );
  });

  // CANCEL

  bot.action("admin_cancel", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCbQuery();
    }

    clearState(ctx.from.id);

    await ctx.answerCbQuery("Bekor qilindi");

    return ctx.reply(
      "❌ Amal bekor qilindi.",
      getMainMenu(ctx.from.id)
    );
  });

  // READ MENU

  bot.action("admin_read", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCbQuery();
    }

    await ctx.answerCbQuery();

    try {
      const menu = await loadMenu();

      if (!Object.keys(menu).length) {
        return ctx.reply("Taomnoma bo'sh.");
      }

      let message = "📋 KAFE TAOMNOMASI\n\n";

      for (const [category, items] of Object.entries(menu)) {
        message += `📌 ${category}\n`;

        for (const item of items) {
          message +=
            `• ${item.name} — ` +
            `${Number(item.price).toLocaleString("ru-RU")} so'm\n`;
        }

        message += "\n";
      }

      const chunks = message.match(/[\s\S]{1,3900}/g) || [];

      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    } catch (err) {
      console.error("Admin menu read:", err);

      await ctx.reply(
        "Menyuni yuklashda xatolik yuz berdi."
      );
    }
  });

  // CREATE MENU ITEM

  bot.action("admin_create", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCbQuery();
    }

    await ctx.answerCbQuery();

    adminStates.set(ctx.from.id, {
      step: "WAIT_NAME",
    });

    return ctx.reply(
      "Yangi taom nomini kiriting:",
      cancelButton()
    );
  });

  // UPDATE MENU

  bot.action("admin_update", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCbQuery();
    }

    await ctx.answerCbQuery();

    try {
      const menu = await loadMenu();
      const items = Object.values(menu).flat();

      if (!items.length) {
        return ctx.reply("Taomnoma bo'sh.");
      }

      const buttons = items.map((item) => [
        Markup.button.callback(
          `✏️ ${item.name} (${item.price} so'm)`,
          `select_item:${item.id}`
        ),
      ]);

      buttons.push([
        Markup.button.callback(
          "❌ Bekor qilish",
          "admin_cancel"
        ),
      ]);

      return ctx.reply(
        "Tahrirlamoqchi bo'lgan taomni tanlang:",
        Markup.inlineKeyboard(buttons)
      );
    } catch (err) {
      console.error("Admin update menu:", err);

      return ctx.reply("Taomlarni yuklashda xatolik yuz berdi.");
    }
  });

  // SELECT ITEM

  bot.action(/^select_item:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCbQuery();
    }

    await ctx.answerCbQuery();

    const itemId = ctx.match[1];

    return ctx.reply(
      "Nimani o'zgartirmoqchisiz?",
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "📝 Nomini o'zgartirish",
            `edit_name:${itemId}`
          ),
        ],
        [
          Markup.button.callback(
            "💵 Narxini o'zgartirish",
            `edit_price:${itemId}`
          ),
        ],
        [
          Markup.button.callback(
            "❌ Bekor qilish",
            "admin_cancel"
          ),
        ],
      ])
    );
  });

  // EDIT NAME

  bot.action(/^edit_name:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCbQuery();
    }

    await ctx.answerCbQuery();

    adminStates.set(ctx.from.id, {
      step: "WAIT_NEW_NAME",
      itemId: ctx.match[1],
    });

    return ctx.reply(
      "Taomning yangi nomini kiriting:",
      cancelButton()
    );
  });

  // EDIT PRICE

  bot.action(/^edit_price:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCbQuery();
    }

    await ctx.answerCbQuery();

    adminStates.set(ctx.from.id, {
      step: "WAIT_NEW_PRICE",
      itemId: ctx.match[1],
    });

    return ctx.reply(
      "Taomning yangi narxini kiriting:",
      cancelButton()
    );
  });

  // DELETE MENU

  bot.action("admin_delete", async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCbQuery();
    }

    await ctx.answerCbQuery();

    try {
      const menu = await loadMenu();
      const items = Object.values(menu).flat();

      if (!items.length) {
        return ctx.reply("Taomnoma bo'sh.");
      }

      const buttons = items.map((item) => [
        Markup.button.callback(
          `🗑 ${item.name}`,
          `del_item:${item.id}`
        ),
      ]);

      buttons.push([
        Markup.button.callback(
          "❌ Bekor qilish",
          "admin_cancel"
        ),
      ]);

      return ctx.reply(
        "O'chirmoqchi bo'lgan taomni tanlang:",
        Markup.inlineKeyboard(buttons)
      );
    } catch (err) {
      console.error("Admin delete menu:", err);

      return ctx.reply("Taomlarni yuklashda xatolik yuz berdi.");
    }
  });

  // DELETE ITEM CONFIRMATION

  bot.action(/^del_item:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCbQuery();
    }

    const itemId = ctx.match[1];

    try {
      await deleteMenuItem(itemId);

      await ctx.answerCbQuery("Taom o'chirildi ✅");

      return ctx.reply(
        "✅ Taom muvaffaqiyatli o'chirildi!",
        getMainMenu(ctx.from.id)
      );
    } catch (err) {
      console.error("Delete item:", err);

      await ctx.answerCbQuery("O'chirish amalga oshmadi!");

      return ctx.reply(
        `❌ Taom o'chirilmadi: ${err.message}`
      );
    }
  });

  // ADD CATEGORY

  bot.action(/^add_cat:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      return ctx.answerCbQuery();
    }

    const state = adminStates.get(ctx.from.id);

    if (!state || state.step !== "WAIT_CAT") {
      return ctx.answerCbQuery(
        "Sessiya tugagan. Qayta boshlang."
      );
    }

    const categoryIndex = Number(ctx.match[1]);

    const selectedCategory =
      state.categoriesList?.[categoryIndex];

    if (!selectedCategory) {
      return ctx.answerCbQuery("Kategoriya topilmadi!");
    }

    try {
      const result = await saveMenuItem(
        selectedCategory,
        state.name,
        state.price
      );

      if (!result) {
        throw new Error("Taom saqlanmadi!");
      }

      clearState(ctx.from.id);

      await ctx.answerCbQuery("Saqlandi ✅");

      return ctx.reply(
        `✅ "${state.name}" muvaffaqiyatli saqlandi!`,
        getMainMenu(ctx.from.id)
      );
    } catch (err) {
      console.error("Add item:", err);

      await ctx.answerCbQuery("Saqlash xatosi!");

      return ctx.reply(
        `❌ Taom saqlanmadi: ${err.message}`
      );
    }
  });

  // TEXT INPUTS

  bot.on("text", async (ctx, next) => {
    if (!isAdmin(ctx.from.id)) {
      return next();
    }

    const state = adminStates.get(ctx.from.id);

    if (!state) {
      return next();
    }

    const inputText = ctx.message.text.trim();

    try {

      // NEW NAME

      if (state.step === "WAIT_NAME") {
        if (!inputText || inputText.length > 100) {
          return ctx.reply(
            "Taom nomini to'g'ri kiriting (1-100 belgi)."
          );
        }

        state.name = inputText;
        state.step = "WAIT_PRICE";

        adminStates.set(ctx.from.id, state);

        return ctx.reply(
          `"${state.name}" narxini kiriting:`,
          cancelButton()
        );
      }

      // NEW PRICE

      if (state.step === "WAIT_PRICE") {
        const price = Number(
          inputText.replace(/\s/g, "")
        );

        if (!Number.isSafeInteger(price) || price <= 0) {
          return ctx.reply(
            "Narxni faqat raqamlarda kiriting. Masalan: 25000"
          );
        }

        state.price = price;
        state.step = "WAIT_CAT";

        const menu = await loadMenu();

        const categories = Object.keys(menu);

        state.categoriesList =
          categories.length > 0
            ? categories
            : DEFAULT_CATEGORIES;

        adminStates.set(ctx.from.id, state);

        const buttons = state.categoriesList.map(
          (category, index) => [
            Markup.button.callback(
              category,
              `add_cat:${index}`
            ),
          ]
        );

        buttons.push([
          Markup.button.callback(
            "❌ Bekor qilish",
            "admin_cancel"
          ),
        ]);

        return ctx.reply(
          "Kategoriyani tanlang:",
          Markup.inlineKeyboard(buttons)
        );
      }

      // UPDATE NAME

      if (state.step === "WAIT_NEW_NAME") {
        if (!inputText || inputText.length > 100) {
          return ctx.reply("Taom nomini to'g'ri kiriting.");
        }

        await updateMenuItem(
          state.itemId,
          inputText,
          undefined
        );

        clearState(ctx.from.id);

        return ctx.reply(
          `✅ Taom nomi "${inputText}"ga o'zgartirildi!`,
          getMainMenu(ctx.from.id)
        );
      }

      // UPDATE PRICE

      if (state.step === "WAIT_NEW_PRICE") {
        const price = Number(
          inputText.replace(/\s/g, "")
        );

        if (!Number.isSafeInteger(price) || price <= 0) {
          return ctx.reply(
            "To'g'ri narx kiriting. Masalan: 25000"
          );
        }

        await updateMenuItem(
          state.itemId,
          undefined,
          price
        );

        clearState(ctx.from.id);

        return ctx.reply(
          `✅ Taom narxi ${price.toLocaleString("ru-RU")} so'mga o'zgartirildi!`,
          getMainMenu(ctx.from.id)
        );
      }

      return next();

    } catch (err) {
      console.error("Admin text handler:", err);

      return ctx.reply(
        `❌ Amal bajarilmadi: ${err.message}`
      );
    }
  });
}

module.exports = {
  setupAdminHandlers,
};

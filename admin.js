const { Markup } = require("telegraf");
const { ADMIN_ID } = require("./config");
const { loadMenu, saveMenuItem, updateMenuItem, deleteMenuItem } = require("./db");

const adminStates = new Map();

function isAdmin(userId) {
  return ADMIN_ID && Number(userId) === Number(ADMIN_ID);
}

function setupAdminHandlers(bot, getMainMenu) {
  bot.hears("⚙️ Admin Panel", (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("Siz admin emassiz ❌");
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

  bot.action("admin_read", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const MENU = await loadMenu();
    let text = "📋 **Hozirgi Taomnoma Ro'yxati:**\n\n";

    for (const [cat, items] of Object.entries(MENU)) {
      text += `📌 **${cat}**:\n`;
      if (items.length === 0) {
        text += "  _(Bo'sh)_\n";
      } else {
        items.forEach((it) => {
          text += `  • ${it.name} — ${it.price.toLocaleString("ru-RU")} so'm\n`;
        });
      }
      text += "\n";
    }
    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  bot.action("admin_create", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { step: "WAIT_NAME" });
    await ctx.reply("Yangi taom nomini kiriting:");
  });

  bot.action("admin_update", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const MENU = await loadMenu();
    const items = Object.values(MENU).flat();

    if (items.length === 0) return ctx.reply("Taomnoma bo'sh.");

    await ctx.reply(
      "Tahrirlamoqchi bo'lgan taomni tanlang:",
      Markup.inlineKeyboard(
        items.map((i) => [Markup.button.callback(`✏️ ${i.name} (${i.price} so'm)`, "select_item:" + i.id)])
      )
    );
  });

  bot.action(/^select_item:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const itemId = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.reply(
      "Nimani o'zgartirmoqchisiz?",
      Markup.inlineKeyboard([
        [Markup.button.callback("📝 Nomini o'zgartirish", "edit_name:" + itemId)],
        [Markup.button.callback("💵 Narxini o'zgartirish", "edit_price:" + itemId)],
      ])
    );
  });

  bot.action(/^edit_name:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { step: "WAIT_NEW_NAME", itemId: ctx.match[1] });
    await ctx.reply("Taom uchun yangi nomni kiriting:");
  });

  bot.action(/^edit_price:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { step: "WAIT_NEW_PRICE", itemId: ctx.match[1] });
    await ctx.reply("Yangi narxni faqat raqamlarda kiriting:");
  });

  bot.action("admin_delete", async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const MENU = await loadMenu();
    const items = Object.values(MENU).flat();

    if (items.length === 0) return ctx.reply("Taomnoma bo'sh.");

    await ctx.reply(
      "O'chirmoqchi bo'lgan taomni tanlang:",
      Markup.inlineKeyboard(
        items.map((i) => [Markup.button.callback(`🗑 ${i.name}`, "del_item:" + i.id)])
      )
    );
  });

  bot.action(/^del_item:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const itemId = ctx.match[1];
    await deleteMenuItem(itemId);

    await ctx.answerCbQuery();
    await ctx.reply(`❌ Taom taomnomadan o'chirildi!`, getMainMenu(ctx.from.id));
  });

  bot.on("text", async (ctx, next) => {
    const state = adminStates.get(ctx.from.id);
    if (!state || !isAdmin(ctx.from.id)) return next();

    if (state.step === "WAIT_NAME") {
      state.name = ctx.message.text;
      state.step = "WAIT_PRICE";
      adminStates.set(ctx.from.id, state);
      return ctx.reply(`"${state.name}" narxini kiriting:`);
    }

    if (state.step === "WAIT_PRICE") {
      const price = Number(ctx.message.text.replace(/\D/g, ""));
      if (!price) return ctx.reply("Iltimos, faqat raqam kiriting!");
      state.price = price;
      state.step = "WAIT_CAT";
      adminStates.set(ctx.from.id, state);

      const MENU = await loadMenu();
      return ctx.reply(
        "Kategoriyani tanlang:",
        Markup.inlineKeyboard(Object.keys(MENU).map((c, i) => [Markup.button.callback(c, "add_cat:" + i)]))
      );
    }

    if (state.step === "WAIT_NEW_NAME") {
      const newName = ctx.message.text;
      await updateMenuItem(state.itemId, newName, null);
      adminStates.delete(ctx.from.id);
      return ctx.reply(`✅ Taom nomi "${newName}"ga o'zgartirildi!`, getMainMenu(ctx.from.id));
    }

    if (state.step === "WAIT_NEW_PRICE") {
      const newPrice = Number(ctx.message.text.replace(/\D/g, ""));
      if (!newPrice) return ctx.reply("Faqat raqam kiriting!");
      await updateMenuItem(state.itemId, null, newPrice);
      adminStates.delete(ctx.from.id);
      return ctx.reply(`✅ Taom narxi ${newPrice.toLocaleString("ru-RU")} so'mga o'zgartirildi!`, getMainMenu(ctx.from.id));
    }

    return next();
  });

  bot.action(/^add_cat:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    const state = adminStates.get(ctx.from.id);
    if (!state || state.step !== "WAIT_CAT") return;

    const MENU = await loadMenu();
    const cat = Object.keys(MENU)[Number(ctx.match[1])];
    await saveMenuItem(cat, state.name, state.price);

    adminStates.delete(ctx.from.id);
    await ctx.answerCbQuery();
    await ctx.reply(`✅ "${state.name}" taomnomaga saqlandi!`, getMainMenu(ctx.from.id));
  });
}

module.exports = { setupAdminHandlers };

const { Markup } = require("telegraf");
const { ADMIN_ID } = require("./config");
const { loadMenu, saveMenu } = require("./db");

const adminStates = new Map();

function setupAdminHandlers(bot, getMainMenu) {
  bot.hears("⚙️ Admin Panel", (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("Siz admin emassiz ❌");
    return ctx.reply(
      "🛠 Admin boshqaruv paneli:",
      Markup.inlineKeyboard([
        [Markup.button.callback("➕ Yangi taom qo'shish", "admin_add_item")],
        [Markup.button.callback("🖼 Profil rasmini o'zgartirish", "admin_set_photo")],
        [Markup.button.callback("📝 Bot tavsifini o'zgartirish", "admin_set_desc")],
      ])
    );
  });

  bot.action("admin_add_item", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { step: "WAIT_ITEM_NAME" });
    await ctx.reply("Yangi taom nomini kiriting:");
  });

  bot.action("admin_set_photo", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { step: "WAIT_BOT_PHOTO" });
    await ctx.reply("Bot uchun yangi profil rasmini yuboring:");
  });

  bot.action("admin_set_desc", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { step: "WAIT_BOT_DESC" });
    await ctx.reply("Bot uchun yangi tavsif (Description) yuboring:");
  });

  bot.on("text", async (ctx, next) => {
    const state = adminStates.get(ctx.from.id);
    if (!state || ctx.from.id !== ADMIN_ID) return next();

    if (state.step === "WAIT_ITEM_NAME") {
      state.name = ctx.message.text;
      state.step = "WAIT_ITEM_PRICE";
      adminStates.set(ctx.from.id, state);
      return ctx.reply(`"${state.name}" narxini kiriting:`);
    }

    if (state.step === "WAIT_ITEM_PRICE") {
      const price = Number(ctx.message.text.replace(/\D/g, ""));
      if (!price) return ctx.reply("Iltimos, faqat raqam kiriting!");
      state.price = price;
      state.step = "WAIT_ITEM_CAT";
      adminStates.set(ctx.from.id, state);

      const MENU = loadMenu();
      const cats = Object.keys(MENU);
      return ctx.reply(
        "Kategoriyani tanlang:",
        Markup.inlineKeyboard(cats.map((c, i) => [Markup.button.callback(c, "add_cat:" + i)]))
      );
    }

    if (state.step === "WAIT_BOT_DESC") {
      await ctx.telegram.setMyDescription(ctx.message.text);
      adminStates.delete(ctx.from.id);
      return ctx.reply("✅ Bot tavsifi yangilandi!", getMainMenu(ctx.from.id));
    }
    return next();
  });

  bot.on("photo", async (ctx, next) => {
    const state = adminStates.get(ctx.from.id);
    if (!state || ctx.from.id !== ADMIN_ID || state.step !== "WAIT_BOT_PHOTO") return next();

    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const fileLink = await ctx.telegram.getFileLink(fileId);
    await ctx.telegram.setMyProfilePhoto({ url: fileLink.href });
    adminStates.delete(ctx.from.id);
    return ctx.reply("✅ Bot profil rasmi yangilandi!", getMainMenu(ctx.from.id));
  });

  bot.action(/^add_cat:(\d+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const state = adminStates.get(ctx.from.id);
    if (!state || state.step !== "WAIT_ITEM_CAT") return;

    const MENU = loadMenu();
    const cats = Object.keys(MENU);
    const cat = cats[Number(ctx.match[1])];

    MENU[cat].push({ id: "item_" + Date.now(), name: state.name, price: state.price });
    saveMenu(MENU);
    adminStates.delete(ctx.from.id);

    await ctx.answerCbQuery();
    await ctx.reply(`✅ "${state.name}" muvaffaqiyatli qo'shildi!`, getMainMenu(ctx.from.id));
  });
}

module.exports = { setupAdminHandlers };

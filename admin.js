const { Markup } = require("telegraf");
const { ADMIN_ID } = require("./config");
const { loadMenu, saveMenu } = require("./db");

const adminStates = new Map();

function setupAdminHandlers(bot, getMainMenu) {
  // Admin Paneli menyusi (CRUD)
  bot.hears("⚙️ Admin Panel", (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("Siz admin emassiz ❌");
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

  // 1. READ — Taomnomani ko'rish
  bot.action("admin_read", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.answerCbQuery();

    const MENU = loadMenu();
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

  // 2. CREATE — Yangi taom qo'shish
  bot.action("admin_create", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { step: "WAIT_NAME" });
    await ctx.reply("Yangi taom nomini kiriting (masalan: Cheeseburger):");
  });

  // 3. UPDATE — Taomni tanlash
  bot.action("admin_update", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.answerCbQuery();
    const MENU = loadMenu();
    const items = Object.values(MENU).flat();

    if (items.length === 0) return ctx.reply("Taomnoma bo'sh.");

    await ctx.reply(
      "Tahrirlamoqchi bo'lgan taomni tanlang:",
      Markup.inlineKeyboard(
        items.map((i) => [Markup.button.callback(`✏️ ${i.name} (${i.price} so'm)`, "select_item:" + i.id)])
      )
    );
  });

  // Taom tanlangach: Nomini yoki Narxini tanlash imkoniyati
  bot.action(/^select_item:(\w+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
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

  // Nomini o'zgartirish bosqichi
  bot.action(/^edit_name:(\w+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const itemId = ctx.match[1];
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { step: "WAIT_NEW_NAME", itemId });
    await ctx.reply("Taom uchun yangi nomni kiriting:");
  });

  // Narxini o'zgartirish bosqichi
  bot.action(/^edit_price:(\w+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const itemId = ctx.match[1];
    await ctx.answerCbQuery();
    adminStates.set(ctx.from.id, { step: "WAIT_NEW_PRICE", itemId });
    await ctx.reply("Yangi narxni faqat raqamlarda kiriting:");
  });

  // 4. DELETE — Taomni o'chirish
  bot.action("admin_delete", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.answerCbQuery();
    const MENU = loadMenu();
    const items = Object.values(MENU).flat();

    if (items.length === 0) return ctx.reply("Taomnoma bo'sh.");

    await ctx.reply(
      "O'chirmoqchi bo'lgan taomni tanlang:",
      Markup.inlineKeyboard(
        items.map((i) => [Markup.button.callback(`🗑 ${i.name}`, "del_item:" + i.id)])
      )
    );
  });

  bot.action(/^del_item:(\w+)$/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const itemId = ctx.match[1];
    const MENU = loadMenu();

    let deletedName = "";
    for (const cat in MENU) {
      const idx = MENU[cat].findIndex((i) => i.id === itemId);
      if (idx !== -1) {
        deletedName = MENU[cat][idx].name;
        MENU[cat].splice(idx, 1);
        break;
      }
    }

    saveMenu(MENU);
    await ctx.answerCbQuery();
    await ctx.reply(`❌ "${deletedName}" taomnomadan o'chirildi!`, getMainMenu(ctx.from.id));
  });

  // ADMIN MATN KIRITISH HODISALARI (CREATE & UPDATE uchun)
  bot.on("text", async (ctx, next) => {
    const state = adminStates.get(ctx.from.id);
    if (!state || ctx.from.id !== ADMIN_ID) return next();

    // CREATE: Taom nomi kelganda
    if (state.step === "WAIT_NAME") {
      state.name = ctx.message.text;
      state.step = "WAIT_PRICE";
      adminStates.set(ctx.from.id, state);
      return ctx.reply(`"${state.name}" narxini kiriting:`);
    }

    // CREATE: Narx kelganda -> Kategoriya so'rash
    if (state.step === "WAIT_PRICE") {
      const price = Number(ctx.message.text.replace(/\D/g, ""));
      if (!price) return ctx.reply("Iltimos, faqat raqam kiriting!");

      state.price = price;
      state.step = "WAIT_CAT";
      adminStates.set(ctx.from.id, state);

      const MENU = loadMenu();
      const cats = Object.keys(MENU);
      return ctx.reply(
        "Kategoriyani tanlang:",
        Markup.inlineKeyboard(cats.map((c, i) => [Markup.button.callback(c, "add_cat:" + i)]))
      );
    }

    // UPDATE: Yangi NOM kelganda
    if (state.step === "WAIT_NEW_NAME") {
      const newName = ctx.message.text;
      const MENU = loadMenu();
      let oldName = "";

      for (const cat in MENU) {
        const item = MENU[cat].find((i) => i.id === state.itemId);
        if (item) {
          oldName = item.name;
          item.name = newName;
          break;
        }
      }

      saveMenu(MENU);
      adminStates.delete(ctx.from.id);
      return ctx.reply(`✅ "${oldName}" nomi "${newName}"ga o'zgartirildi!`, getMainMenu(ctx.from.id));
    }

    // UPDATE: Yangi NARX kelganda
    if (state.step === "WAIT_NEW_PRICE") {
      const newPrice = Number(ctx.message.text.replace(/\D/g, ""));
      if (!newPrice) return ctx.reply("Faqat raqam kiriting!");

      const MENU = loadMenu();
      let updatedName = "";

      for (const cat in MENU) {
        const item = MENU[cat].find((i) => i.id === state.itemId);
        if (item) {
          item.price = newPrice;
          updatedName = item.name;
          break;
        }
      }

      saveMenu(MENU);
      adminStates.delete(ctx.from.id);
      return ctx.reply(`✅ "${updatedName}" narxi ${newPrice.toLocaleString("ru-RU")} so'mga o'zgartirildi!`, getMainMenu(ctx.from.id));
    }

    return next();
  });

  // CREATE: Kategoriya tanlanganda saqlash
  bot.action(/^

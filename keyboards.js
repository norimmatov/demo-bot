const { Markup } = require("telegraf");
const { ADMIN_ID } = require("./config");

const fmt = (n) => (n ? n.toLocaleString("ru-RU") + " so‘m" : "0 so‘m");

function getMainMenu(userId) {
  const buttons = [["🍽 Menyu", "🛒 Savat"], ["📞 Aloqa"]];
  
  // Tip taqqoslashini xavfsiz qilish (Number ga o'tkaziladi)
  if (ADMIN_ID && Number(userId) === Number(ADMIN_ID)) {
    buttons.push(["⚙️ Admin Panel"]);
  }
  return Markup.keyboard(buttons).resize();
}

function buildCategoryKeyboard(categories) {
  if (!categories || categories.length === 0) return Markup.inlineKeyboard([]);
  
  return Markup.inlineKeyboard(
    categories.map((c, i) => [Markup.button.callback(c, "cat:" + i)])
  );
}

// Inline tugmalarni 2 ta ustun qilib (Grid) chiroyli joylash
function buildItemsGrid(items) {
  if (!items || items.length === 0) return Markup.inlineKeyboard([]);

  const buttons = items.map((i) =>
    Markup.button.callback(`${i.name} — ${fmt(i.price)}`, "add:" + i.id)
  );

  const grid = [];
  for (let i = 0; i < buttons.length; i += 2) {
    grid.push(buttons.slice(i, i + 2));
  }
  return Markup.inlineKeyboard(grid);
}

module.exports = {
  fmt,
  getMainMenu,
  buildCategoryKeyboard,
  buildItemsGrid,
};

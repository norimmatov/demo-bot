const { Markup } = require("telegraf");
const { isAdmin } = require("./helpers");

const BTN = {
  MENU: "🍽 Menyu",
  CART: "🛒 Savat",
  ORDERS: "📦 Buyurtmalarim",
  INFO: "📞 Aloqa",
  ADMIN: "⚙️ Admin Panel",
  CANCEL: "❌ Bekor qilish",
  MANUAL: "✍️ Qo‘lda yozib kiritaman",
};

const MAIN_BUTTONS = [BTN.MENU, BTN.CART, BTN.ORDERS, BTN.INFO, BTN.ADMIN];

function getMainMenu(userId) {
  const rows = [[BTN.MENU, BTN.CART], [BTN.ORDERS, BTN.INFO]];

  if (isAdmin(userId)) {
    rows.push([BTN.ADMIN]);
  }

  return Markup.keyboard(rows).resize();
}

module.exports = { BTN, MAIN_BUTTONS, getMainMenu };

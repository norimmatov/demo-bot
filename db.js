const fs = require("fs");
const path = require("path");

const MENU_FILE = path.join(__dirname, "menu.json");
const ORDERS_FILE = path.join(__dirname, "orders.json");

function loadMenu() {
  try {
    if (!fs.existsSync(MENU_FILE)) fs.writeFileSync(MENU_FILE, JSON.stringify({}));
    return JSON.parse(fs.readFileSync(MENU_FILE, "utf8"));
  } catch (e) {
    console.error("Menu o'qishda xato:", e);
    return {};
  }
}

function saveMenu(menu) {
  try {
    fs.writeFileSync(MENU_FILE, JSON.stringify(menu, null, 2), "utf8");
  } catch (e) {
    console.error("Menu saqlashda xato:", e);
  }
}

function getNextOrderId() {
  try {
    let data = { lastOrderId: 1000 };
    if (fs.existsSync(ORDERS_FILE)) {
      data = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
    }
    data.lastOrderId = (data.lastOrderId || 1000) + 1;
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2), "utf8");
    return `#ORD-${data.lastOrderId}`;
  } catch (e) {
    return `#ORD-${Date.now().toString().slice(-4)}`;
  }
}
// db.js faylining eng pastidagi module.exports qismini shunday o'zgartiring:
module.exports = { 
  loadMenu, 
  saveMenu: saveMenuItem, // <--- shu joyi yetishmayotgan edi
  saveMenuItem, 
  updateMenuItem, 
  deleteMenuItem, 
  getNextOrderId 
};


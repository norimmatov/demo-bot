require("dotenv").config();

const restaurantId = process.env.RESTAURANT_ID;

if (!restaurantId || !restaurantId.trim()) {
  throw new Error(
    "RESTAURANT_ID Environment Variables ichida ko'rsatilishi shart"
  );
}

// ADMIN_ID bitta yoki vergul bilan bir nechta bo'lishi mumkin: 123456,789012
const ADMIN_IDS = (process.env.ADMIN_ID || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isSafeInteger(n) && n > 0);

const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

module.exports = {
  PORT: Number(process.env.PORT) || 3000,

  BOT_TOKEN: process.env.BOT_TOKEN,

  ADMIN_IDS,

  MONGO_URI: process.env.MONGO_URI,

  RESTAURANT_ID: restaurantId.trim(),

  CAFE_NAME: process.env.CAFE_NAME || "Kafe",

  CAFE_INFO:
    process.env.CAFE_INFO ||
    "📍 Manzil kiritilmagan\n📞 Telefon kiritilmagan\n🕙 Ish vaqti kiritilmagan",

  // Standart qiymatlar. Admin paneldagi "Sozlamalar" ularni bazada o'zgartiradi.
  DELIVERY_FEE: num(process.env.DELIVERY_FEE, 0),
  FREE_DELIVERY_FROM: num(process.env.FREE_DELIVERY_FROM, 0),
  MIN_ORDER: num(process.env.MIN_ORDER, 0),

  // Chekda "Karta orqali" to'lovda ko'rsatiladi (masalan: 8600 **** **** 1234, Ism Familiya)
  CARD_INFO: process.env.CARD_INFO || "",

  // Render RENDER_EXTERNAL_URL ni o'zi beradi. Mahalliy ishga tushirishda USE_POLLING=1 qo'ying.
  WEBHOOK_URL: process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || "",
  USE_POLLING: process.env.USE_POLLING === "1",

  TIMEZONE: "Asia/Tashkent",
};

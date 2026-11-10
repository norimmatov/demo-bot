
require("dotenv").config();

const restaurantId = process.env.RESTAURANT_ID;

if (!restaurantId || !restaurantId.trim()) {
  throw new Error(
    "RESTAURANT_ID Environment Variables ichida ko'rsatilishi shart"
  );
}

module.exports = {
  PORT: Number(process.env.PORT) || 3000,

  BOT_TOKEN: process.env.BOT_TOKEN,

  ADMIN_ID: process.env.ADMIN_ID
    ? Number(process.env.ADMIN_ID)
    : null,

  MONGO_URI: process.env.MONGO_URI,

  REDIS_URL: process.env.REDIS_URL || "",

  RESTAURANT_ID: restaurantId.trim(),

  CAFE_INFO:
    process.env.CAFE_INFO ||
    "📍 Manzil kiritilmagan\n📞 Telefon kiritilmagan\n🕙 Ish vaqti kiritilmagan",
};

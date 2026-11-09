require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 3000,
  BOT_TOKEN: process.env.BOT_TOKEN,
  ADMIN_ID: process.env.ADMIN_ID ? Number(process.env.ADMIN_ID) : null,
  MONGO_URI: process.env.MONGO_URI,
  CAFE_INFO: "📍 Samarqand, Registon ko‘chasi 1\n📞 +998 90 123 45 67\n🕙 09:00–23:00",
};

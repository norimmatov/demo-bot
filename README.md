# Kafe buyurtma boti (Telegram)

Node.js + Telegraf + MongoDB. Render.com'da webhook rejimida ishlaydi.

## Render sozlamalari
- Turi: **Web Service**, Build: `npm install`, Start: `node bot.js`
- Environment Variables: `.env.example` faylidagilarni kiriting.
  - Majburiy: `BOT_TOKEN`, `MONGO_URI`, `RESTAURANT_ID`, `ADMIN_ID`
  - `ADMIN_ID` ga bir nechta adminni vergul bilan yozish mumkin: `111,222`
  - `REDIS_URL` endi kerak emas (menyu keshsiz, o'zgarish shu zahoti ko'rinadi).
- `RENDER_EXTERNAL_URL` ni Render o'zi beradi, bot shu orqali webhook'ni o'zi o'rnatadi.
- Bepul tarifda servis 15 daqiqa jim turgach uxlaydi. [UptimeRobot](https://uptimerobot.com) bilan
  bot manzilini har 5 daqiqada ping qiling yoki pullik tarifni tanlang.

## Admin
Botga admin akkauntdan /start yuboring, pastda "⚙️ Admin Panel" tugmasi chiqadi:
buyurtmalar (holatini o'zgartirish), taomlar (qo'shish, nom, narx, rasm, "tugadi", o'chirish),
bo'limlar, statistika, sozlamalar (yetkazib berish narxi, bepul yetkazish chegarasi, minimal buyurtma, aloqa).

## Mahalliy ishga tushirish
`.env` yarating, `USE_POLLING=1` qo'shing, so'ng `npm install && npm start`.

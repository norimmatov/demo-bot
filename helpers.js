const cfg = require("./config");

const fmt = (n) => Number(n || 0).toLocaleString("ru-RU") + " so‘m";

const isAdmin = (id) => cfg.ADMIN_IDS.includes(Number(id));

const STATUS = {
  accepted: { icon: "🟡", label: "Qabul qilindi" },
  preparing: { icon: "👨‍🍳", label: "Tayyorlanmoqda" },
  on_the_way: { icon: "🚚", label: "Yo‘lda" },
  delivered: { icon: "✅", label: "Yetkazildi" },
  cancelled: { icon: "❌", label: "Bekor qilindi" },
};

const FLOW = ["accepted", "preparing", "on_the_way", "delivered"];
const ACTIVE = ["accepted", "preparing", "on_the_way"];

const formatDate = (d) =>
  new Date(d).toLocaleString("ru-RU", {
    timeZone: cfg.TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatTime = (d) =>
  new Date(d).toLocaleTimeString("ru-RU", {
    timeZone: cfg.TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });

// Toshkent vaqti bo'yicha kun boshi (UTC+5, yozgi vaqt yo'q)
function startOfDay(daysAgo = 0) {
  const OFFSET = 5 * 3600 * 1000;
  const local = new Date(Date.now() + OFFSET);
  const startUtc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - daysAgo
  );
  return new Date(startUtc - OFFSET);
}

function calcDelivery(subtotal, settings) {
  if (settings.freeDeliveryFrom > 0 && subtotal >= settings.freeDeliveryFrom) {
    return 0;
  }
  return settings.deliveryFee || 0;
}

function itemLines(order) {
  if (Array.isArray(order.items) && order.items.length) {
    return order.items
      .map((i) => `• ${i.name} × ${i.qty} = ${fmt(i.price * i.qty)}`)
      .join("\n");
  }
  return order.itemsText || "";
}

const LINE = "━━━━━━━━━━━━━━━━━━";

function buildReceipt(order, { admin = false } = {}) {
  const st = STATUS[order.status] || STATUS.accepted;
  const fee = order.deliveryFee || 0;
  const sub =
    order.subtotal !== undefined && order.subtotal !== null
      ? order.subtotal
      : order.total - fee;

  const out = [];

  out.push(admin ? `🆕 BUYURTMA #${order.orderId}` : `🧾 BUYURTMA CHEKI #${order.orderId}`);
  if (!admin) out.push(`🏪 ${cfg.CAFE_NAME}`);
  out.push(LINE);
  out.push(`📅 Sana: ${formatDate(order.createdAt || new Date())}`);
  out.push(`👤 Mijoz: ${order.clientName || "—"}`);
  if (admin) out.push(`🆔 Telegram ID: ${order.telegramId}`);
  out.push(`📞 Tel: ${order.phone || "—"}`);
  out.push(`📍 Manzil: ${order.address || "—"}`);
  out.push(`💳 To‘lov: ${order.payment || "—"}`);
  out.push(LINE);
  out.push("🛒 BUYURTMA TARKIBI:");
  out.push(itemLines(order));
  out.push("");
  out.push(`🍽 Taomlar: ${fmt(sub)}`);
  out.push(`🚚 Yetkazib berish: ${fee > 0 ? fmt(fee) : "Bepul"}`);
  out.push(LINE);
  out.push(`💰 JAMI: ${fmt(order.total)}`);
  out.push(LINE);
  out.push(`${st.icon} Holati: ${st.label}`);

  if (!admin) {
    if (order.paymentType === "card" && cfg.CARD_INFO) {
      out.push("", `💳 To‘lov uchun karta:\n${cfg.CARD_INFO}`);
    }
    out.push("", "Xaridingiz uchun rahmat! 🙌");
  }

  return out.join("\n");
}

const NOT_MODIFIED = /message is not modified/i;

/**
 * Xabarni "joyida yangilaydi": oddiy matn bo'lsa tahrirlaydi,
 * rasm bilan bog'liq bo'lsa eskisini o'chirib yangisini yuboradi.
 */
async function render(ctx, text, keyboard, photo) {
  const extra = keyboard ? { ...keyboard } : {};
  const msg = ctx.callbackQuery && ctx.callbackQuery.message;

  if (msg && !photo && !msg.photo) {
    try {
      await ctx.editMessageText(text, extra);
      return;
    } catch (e) {
      if (NOT_MODIFIED.test(e.description || e.message || "")) return;
    }
  } else if (msg) {
    await ctx.deleteMessage().catch(() => {});
  }

  if (photo) {
    try {
      return await ctx.replyWithPhoto(photo, { caption: text, ...extra });
    } catch (e) {
      console.error("Rasm yuborilmadi:", e.message);
    }
  }

  return ctx.reply(text, extra);
}

module.exports = {
  fmt,
  isAdmin,
  STATUS,
  FLOW,
  ACTIVE,
  formatDate,
  formatTime,
  startOfDay,
  calcDelivery,
  buildReceipt,
  render,
};

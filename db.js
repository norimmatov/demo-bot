const mongoose = require("mongoose");

const {
  MONGO_URI,
  RESTAURANT_ID: R,
  DELIVERY_FEE,
  FREE_DELIVERY_FROM,
  MIN_ORDER,
  CAFE_INFO,
} = require("./config");

const { Schema } = mongoose;

// =====================================
// MODELS
// =====================================

const categorySchema = new Schema(
  {
    restaurantId: { type: String, required: true },
    cid: { type: String, required: true },
    name: { type: String, required: true },
    sort: { type: Number, default: 0 },
  },
  { timestamps: true }
);
categorySchema.index({ restaurantId: 1, cid: 1 }, { unique: true });
categorySchema.index({ restaurantId: 1, name: 1 }, { unique: true });

const menuSchema = new Schema(
  {
    restaurantId: { type: String, required: true },
    id: { type: String, required: true },
    category: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 1 },
    photo: { type: String, default: "" }, // Telegram file_id
    available: { type: Boolean, default: true },
  },
  { timestamps: true }
);
menuSchema.index({ restaurantId: 1, id: 1 }, { unique: true });
menuSchema.index({ restaurantId: 1, category: 1 });

const orderSchema = new Schema(
  {
    restaurantId: { type: String, required: true },
    orderId: { type: String, required: true },
    telegramId: { type: Number, required: true },
    clientName: String,
    phone: String,
    address: String,
    locationCoords: { latitude: Number, longitude: Number },
    payment: String,
    paymentType: String,
    items: [
      {
        _id: false,
        id: String,
        name: String,
        price: Number,
        qty: Number,
      },
    ],
    itemsText: String,
    subtotal: Number,
    deliveryFee: { type: Number, default: 0 },
    total: { type: Number, required: true },
    status: { type: String, default: "accepted" },
  },
  { timestamps: true }
);
orderSchema.index({ restaurantId: 1, orderId: 1 }, { unique: true });
orderSchema.index({ restaurantId: 1, telegramId: 1, createdAt: -1 });
orderSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });

const counterSchema = new Schema({
  _id: String,
  lastOrderId: { type: Number, default: 1000 },
});

const settingSchema = new Schema({
  restaurantId: { type: String, required: true, unique: true },
  deliveryFee: Number,
  freeDeliveryFrom: Number,
  minOrder: Number,
  info: String,
  seeded: Boolean,
});

const Category = mongoose.models.Category || mongoose.model("Category", categorySchema);
const MenuItem = mongoose.models.MenuItem || mongoose.model("MenuItem", menuSchema);
const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
const OrderCounter = mongoose.models.OrderCounter || mongoose.model("OrderCounter", counterSchema);
const Setting = mongoose.models.Setting || mongoose.model("Setting", settingSchema);

// =====================================
// CONNECTION
// =====================================

let mongoPromise = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (mongoPromise) return mongoPromise;

  mongoPromise = mongoose.connect(MONGO_URI, {
    maxPoolSize: 10,
    minPoolSize: 1,
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });

  try {
    await mongoPromise;
    console.log("MongoDB muvaffaqiyatli ulandi ✅");
    return mongoose.connection;
  } catch (err) {
    console.error("MongoDB ulanish xatosi:", err.message);
    throw err;
  } finally {
    mongoPromise = null;
  }
}

// =====================================
// HELPERS
// =====================================

const newId = (prefix) =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

function cleanText(value, label, max) {
  const s = String(value ?? "").trim();
  if (!s) throw new Error(`${label} bo'sh bo'lishi mumkin emas!`);
  if (s.length > max) throw new Error(`${label} ${max} belgidan oshmasligi kerak!`);
  return s;
}

function cleanPrice(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Narx noto'g'ri!");
  return n;
}

const normItem = (i) =>
  i && { ...i, photo: i.photo || "", available: i.available !== false };

const ITEM_FIELDS = "id category name price photo available -_id";

// =====================================
// INIT (kategoriyalarni sinxronlash + birinchi marta namunaviy menyu)
// =====================================

async function syncCategories() {
  const names = await MenuItem.distinct("category", { restaurantId: R });
  const existing = await Category.find({ restaurantId: R }).lean();
  const have = new Set(existing.map((c) => c.name));
  let sort = existing.reduce((m, c) => Math.max(m, c.sort || 0), 0);

  for (const name of names.sort()) {
    if (!have.has(name)) {
      await Category.create({ restaurantId: R, cid: newId("c"), name, sort: ++sort });
    }
  }
}

async function seedIfFirstRun() {
  const setting = await Setting.findOne({ restaurantId: R }).lean();
  if (setting && setting.seeded) return;

  const hasData =
    (await Category.countDocuments({ restaurantId: R })) > 0 ||
    (await MenuItem.countDocuments({ restaurantId: R })) > 0;

  if (!hasData) {
    const seed = [
      ["☕ Ichimliklar", [["Americano", 18000], ["Cappuccino", 22000]]],
      ["🍰 Shirinliklar", [["Cheesecake", 25000]]],
      ["🍔 Taomlar", [["Burger", 35000]]],
    ];

    let sort = 0;
    for (const [catName, items] of seed) {
      await Category.create({ restaurantId: R, cid: newId("c"), name: catName, sort: ++sort });
      for (const [name, price] of items) {
        await MenuItem.create({
          restaurantId: R,
          id: newId("i"),
          category: catName,
          name,
          price,
        });
      }
    }
  }

  await Setting.updateOne({ restaurantId: R }, { $set: { seeded: true } }, { upsert: true });
}

async function initDB() {
  await connectDB();
  await syncCategories();
  await seedIfFirstRun();
}

// =====================================
// SETTINGS
// =====================================

async function getSettings() {
  await connectDB();
  const doc = await Setting.findOne({ restaurantId: R }).lean();

  return {
    deliveryFee: doc?.deliveryFee ?? DELIVERY_FEE,
    freeDeliveryFrom: doc?.freeDeliveryFrom ?? FREE_DELIVERY_FROM,
    minOrder: doc?.minOrder ?? MIN_ORDER,
    info: doc?.info || CAFE_INFO,
  };
}

async function updateSettings(patch) {
  await connectDB();
  await Setting.updateOne({ restaurantId: R }, { $set: patch }, { upsert: true });
}

// =====================================
// CATEGORIES
// =====================================

async function getCategories() {
  await connectDB();
  return Category.find({ restaurantId: R })
    .sort({ sort: 1, name: 1 })
    .select("cid name -_id")
    .lean();
}

async function getCategory(cid) {
  await connectDB();
  return Category.findOne({ restaurantId: R, cid: String(cid) })
    .select("cid name -_id")
    .lean();
}

async function getCategoryByName(name) {
  await connectDB();
  return Category.findOne({ restaurantId: R, name })
    .select("cid name -_id")
    .lean();
}

// Mijozga faqat ichida taomi bor bo'limlar ko'rinadi
async function getMenuCategories() {
  const used = new Set(await MenuItem.distinct("category", { restaurantId: R }));
  return (await getCategories()).filter((c) => used.has(c.name));
}

async function addCategory(name) {
  await connectDB();
  const clean = cleanText(name, "Bo'lim nomi", 40);
  const last = await Category.findOne({ restaurantId: R }).sort({ sort: -1 }).lean();

  try {
    return await Category.create({
      restaurantId: R,
      cid: newId("c"),
      name: clean,
      sort: (last?.sort || 0) + 1,
    });
  } catch (err) {
    if (err.code === 11000) throw new Error("Bunday bo'lim allaqachon mavjud!");
    throw err;
  }
}

async function renameCategory(cid, newName) {
  await connectDB();
  const clean = cleanText(newName, "Bo'lim nomi", 40);
  const cat = await Category.findOne({ restaurantId: R, cid: String(cid) });
  if (!cat) throw new Error("Bo'lim topilmadi!");

  const dup = await Category.findOne({ restaurantId: R, name: clean, cid: { $ne: cat.cid } });
  if (dup) throw new Error("Bunday bo'lim allaqachon mavjud!");

  const oldName = cat.name;
  cat.name = clean;
  await cat.save();
  await MenuItem.updateMany({ restaurantId: R, category: oldName }, { $set: { category: clean } });
  return cat;
}

async function countItems(categoryName) {
  await connectDB();
  return MenuItem.countDocuments({ restaurantId: R, category: categoryName });
}

async function deleteCategory(cid) {
  await connectDB();
  const cat = await Category.findOne({ restaurantId: R, cid: String(cid) });
  if (!cat) throw new Error("Bo'lim topilmadi!");

  const n = await countItems(cat.name);
  if (n > 0) {
    throw new Error(`Bo'limda ${n} ta taom bor. Avval taomlarni o'chiring.`);
  }

  await cat.deleteOne();
}

// =====================================
// MENU ITEMS (keshsiz: o'zgarish mijozda shu zahoti ko'rinadi)
// =====================================

async function getItemsByCategory(categoryName) {
  await connectDB();
  const items = await MenuItem.find({ restaurantId: R, category: categoryName })
    .select(ITEM_FIELDS)
    .sort({ name: 1 })
    .lean();
  return items.map(normItem);
}

async function getItem(id) {
  await connectDB();
  const item = await MenuItem.findOne({ restaurantId: R, id: String(id) })
    .select(ITEM_FIELDS)
    .lean();
  return normItem(item) || null;
}

async function getItemsByIds(ids) {
  await connectDB();
  if (!ids.length) return [];
  const items = await MenuItem.find({ restaurantId: R, id: { $in: ids.map(String) } })
    .select(ITEM_FIELDS)
    .lean();
  return items.map(normItem);
}

async function saveMenuItem({ category, name, price, photo }) {
  await connectDB();

  const cat = await getCategoryByName(category);
  if (!cat) throw new Error("Bo'lim topilmadi!");

  return MenuItem.create({
    restaurantId: R,
    id: newId("i"),
    category: cat.name,
    name: cleanText(name, "Taom nomi", 100),
    price: cleanPrice(price),
    photo: photo || "",
  });
}

async function updateMenuItem(itemId, patch) {
  await connectDB();
  const set = {};

  if (patch.name !== undefined) set.name = cleanText(patch.name, "Taom nomi", 100);
  if (patch.price !== undefined) set.price = cleanPrice(patch.price);
  if (patch.photo !== undefined) set.photo = String(patch.photo);
  if (patch.available !== undefined) set.available = Boolean(patch.available);

  if (!Object.keys(set).length) throw new Error("Yangilanadigan ma'lumot yo'q!");

  const result = await MenuItem.updateOne({ restaurantId: R, id: String(itemId) }, { $set: set });
  if (result.matchedCount === 0) throw new Error("Taom topilmadi!");
  return result;
}

async function deleteMenuItem(itemId) {
  await connectDB();
  const result = await MenuItem.deleteOne({ restaurantId: R, id: String(itemId) });
  if (result.deletedCount === 0) throw new Error("O'chiriladigan taom topilmadi!");
  return result;
}

// =====================================
// ORDERS
// =====================================

async function getNextOrderId() {
  await connectDB();
  const counterId = `order_id:${R}`;

  try {
    await OrderCounter.updateOne(
      { _id: counterId },
      { $setOnInsert: { lastOrderId: 1000 } },
      { upsert: true }
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  const counter = await OrderCounter.findOneAndUpdate(
    { _id: counterId },
    { $inc: { lastOrderId: 1 } },
    { new: true }
  ).lean();

  if (!counter) throw new Error("Buyurtma raqamini yaratib bo'lmadi!");
  return `ORD-${counter.lastOrderId}`;
}

async function saveOrder(data) {
  await connectDB();
  const order = await Order.create({ restaurantId: R, ...data });
  console.log(`Buyurtma saqlandi: ${order.orderId}`);
  return order.toObject();
}

async function getOrder(orderId) {
  await connectDB();
  return Order.findOne({ restaurantId: R, orderId: String(orderId) }).lean();
}

async function setOrderStatus(orderId, status) {
  await connectDB();
  return Order.findOneAndUpdate(
    { restaurantId: R, orderId: String(orderId) },
    { $set: { status } },
    { new: true }
  ).lean();
}

async function getOrdersByStatus(statuses, limit = 30) {
  await connectDB();
  return Order.find({ restaurantId: R, status: { $in: statuses } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function getRecentOrders(limit = 15) {
  await connectDB();
  return Order.find({ restaurantId: R }).sort({ createdAt: -1 }).limit(limit).lean();
}

async function getUserOrders(telegramId, limit = 5) {
  await connectDB();
  return Order.find({ restaurantId: R, telegramId: Number(telegramId) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function getLastOrder(telegramId) {
  await connectDB();
  return Order.findOne({
    restaurantId: R,
    telegramId: Number(telegramId),
    address: { $exists: true, $ne: "" },
  })
    .sort({ createdAt: -1 })
    .lean();
}

async function getStats(since) {
  await connectDB();
  const match = { restaurantId: R };
  if (since) match.createdAt = { $gte: since };

  const rows = await Order.aggregate([
    { $match: match },
    { $group: { _id: "$status", count: { $sum: 1 }, sum: { $sum: "$total" } } },
  ]);

  let count = 0;
  let revenue = 0;
  let cancelled = 0;

  for (const r of rows) {
    if (r._id === "cancelled") cancelled += r.count;
    else {
      count += r.count;
      revenue += r.sum;
    }
  }

  return { count, revenue, cancelled };
}

module.exports = {
  connectDB,
  initDB,
  getSettings,
  updateSettings,
  getCategories,
  getCategory,
  getCategoryByName,
  getMenuCategories,
  addCategory,
  renameCategory,
  deleteCategory,
  countItems,
  getItemsByCategory,
  getItem,
  getItemsByIds,
  saveMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getNextOrderId,
  saveOrder,
  getOrder,
  setOrderStatus,
  getOrdersByStatus,
  getRecentOrders,
  getUserOrders,
  getLastOrder,
  getStats,
};

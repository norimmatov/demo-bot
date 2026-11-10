
const mongoose = require("mongoose");
const { createClient } = require("redis");

const {
  MONGO_URI,
  REDIS_URL,
  RESTAURANT_ID,
} = require("./config");

// =====================================
// MONGODB MODELS
// =====================================

const menuSchema = new mongoose.Schema(
  {
    restaurantId: { type: String, required: true },
    id: { type: String, required: true },
    category: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 1 },
  },
  { timestamps: true }
);

menuSchema.index(
  { restaurantId: 1, id: 1 },
  { unique: true }
);

menuSchema.index(
  { restaurantId: 1, category: 1 }
);

const orderSchema = new mongoose.Schema(
  {
    restaurantId: { type: String, required: true },
    orderId: { type: String, required: true },
    telegramId: { type: Number, required: true },
    clientName: String,
    phone: String,
    address: String,
    locationCoords: {
      latitude: Number,
      longitude: Number,
    },
    payment: String,
    itemsText: String,
    total: { type: Number, required: true },
    status: {
      type: String,
      default: "accepted",
    },
  },
  { timestamps: true }
);

orderSchema.index(
  { restaurantId: 1, orderId: 1 },
  { unique: true }
);

const counterSchema = new mongoose.Schema({
  _id: String,
  lastOrderId: {
    type: Number,
    default: 1000,
  },
});

const MenuItem =
  mongoose.models.MenuItem ||
  mongoose.model("MenuItem", menuSchema);

const Order =
  mongoose.models.Order ||
  mongoose.model("Order", orderSchema);

const OrderCounter =
  mongoose.models.OrderCounter ||
  mongoose.model("OrderCounter", counterSchema);

// =====================================
// MONGODB CONNECTION
// =====================================

let mongoPromise = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (mongoPromise) {
    return mongoPromise;
  }

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
// REDIS CONNECTION
// =====================================

let redisClient = null;
let redisPromise = null;
let redisRetryAfter = 0;

function menuCacheKey() {
  return `menu:${RESTAURANT_ID}:v2`;
}

async function getRedis() {
  if (!REDIS_URL) return null;

  if (Date.now() < redisRetryAfter) {
    return null;
  }

  if (redisClient?.isReady) {
    return redisClient;
  }

  if (redisPromise) {
    return redisPromise;
  }

  redisPromise = (async () => {
    try {
      if (!redisClient) {
        redisClient = createClient({
          url: REDIS_URL,
          socket: {
            connectTimeout: 5000,
            reconnectStrategy: (retries) => {
              if (retries > 3) {
                return new Error("Redis reconnect limit");
              }

              return Math.min(retries * 500, 2000);
            },
          },
        });

        redisClient.on("error", (err) => {
          console.error("Redis xatosi:", err.message);
        });

        redisClient.on("ready", () => {
          console.log("Redis tayyor ✅");
        });

        redisClient.on("end", () => {
          console.log("Redis aloqasi uzildi");
        });
      }

      if (!redisClient.isOpen) {
        await redisClient.connect();
      }

      return redisClient.isReady ? redisClient : null;
    } catch (err) {
      console.error("Redis ulanish xatosi:", err.message);

      redisRetryAfter = Date.now() + 30000;

      const failedClient = redisClient;
      redisClient = null;

      if (failedClient?.isOpen) {
        failedClient.destroy();
      }

      return null;
    }
  })();

  try {
    return await redisPromise;
  } finally {
    redisPromise = null;
  }
}

// =====================================
// MENU CACHE
// =====================================

async function invalidateMenuCache() {
  try {
    const redis = await getRedis();

    if (redis) {
      await redis.del(menuCacheKey());
    }
  } catch (err) {
    console.error("Redis cache tozalash xatosi:", err.message);
  }
}

// =====================================
// DEFAULT MENU
// =====================================

async function createDefaultMenu() {
  const defaults = [
    {
      id: `${RESTAURANT_ID}_d1`,
      category: "☕ Ichimliklar",
      name: "Americano",
      price: 18000,
    },
    {
      id: `${RESTAURANT_ID}_s1`,
      category: "🍰 Shirinliklar",
      name: "Cheesecake",
      price: 25000,
    },
    {
      id: `${RESTAURANT_ID}_t1`,
      category: "🍔 Taomlar",
      name: "Burger",
      price: 35000,
    },
  ];

  await MenuItem.bulkWrite(
    defaults.map((item) => ({
      updateOne: {
        filter: {
          restaurantId: RESTAURANT_ID,
          id: item.id,
        },
        update: {
          $setOnInsert: {
            restaurantId: RESTAURANT_ID,
            ...item,
          },
        },
        upsert: true,
      },
    }))
  );
}

// =====================================
// LOAD MENU
// =====================================

async function loadMenu() {
  await connectDB();

  const cacheKey = menuCacheKey();

  const redis = await getRedis();

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);

      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          await redis.del(cacheKey);
        }
      }
    } catch (err) {
      console.error("Redis o'qish xatosi:", err.message);
    }
  }

  let items = await MenuItem.find({
    restaurantId: RESTAURANT_ID,
  })
    .select("id category name price -_id")
    .sort({ category: 1, name: 1 })
    .lean();

  if (items.length === 0) {
    await createDefaultMenu();

    items = await MenuItem.find({
      restaurantId: RESTAURANT_ID,
    })
      .select("id category name price -_id")
      .sort({ category: 1, name: 1 })
      .lean();
  }

  const menu = {};

  for (const item of items) {
    if (!menu[item.category]) {
      menu[item.category] = [];
    }

    menu[item.category].push({
      id: item.id,
      name: item.name,
      price: item.price,
    });
  }

  if (redis) {
    try {
      await redis.set(
        cacheKey,
        JSON.stringify(menu),
        { EX: 600 }
      );
    } catch (err) {
      console.error("Redis yozish xatosi:", err.message);
    }
  }

  return menu;
}

// =====================================
// SAVE MENU ITEM
// =====================================

async function saveMenuItem(category, name, price) {
  await connectDB();

  if (!category || !name) {
    throw new Error("Kategoriya va taom nomi kerak!");
  }

  const numericPrice = Number(price);

  if (!Number.isSafeInteger(numericPrice) || numericPrice <= 0) {
    throw new Error("Taom narxi noto'g'ri!");
  }

  const item = await MenuItem.create({
    restaurantId: RESTAURANT_ID,
    id:
      "item_" +
      Date.now() +
      "_" +
      Math.random().toString(36).slice(2, 8),
    category,
    name,
    price: numericPrice,
  });

  await invalidateMenuCache();

  return item;
}

// =====================================
// UPDATE MENU ITEM
// =====================================

async function updateMenuItem(itemId, newName, newPrice) {
  await connectDB();

  const updateData = {};

  if (newName !== undefined && newName !== null) {
    const name = String(newName).trim();

    if (!name) {
      throw new Error("Taom nomi bo'sh bo'lishi mumkin emas!");
    }

    updateData.name = name;
  }

  if (newPrice !== undefined && newPrice !== null) {
    const price = Number(newPrice);

    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new Error("Narx noto'g'ri!");
    }

    updateData.price = price;
  }

  if (Object.keys(updateData).length === 0) {
    throw new Error("Yangilanadigan ma'lumot yo'q!");
  }

  const result = await MenuItem.updateOne(
    {
      restaurantId: RESTAURANT_ID,
      id: String(itemId),
    },
    { $set: updateData }
  );

  if (result.matchedCount === 0) {
    throw new Error("Taom topilmadi!");
  }

  await invalidateMenuCache();

  return result;
}

// =====================================
// DELETE MENU ITEM
// =====================================

async function deleteMenuItem(itemId) {
  await connectDB();

  const result = await MenuItem.deleteOne({
    restaurantId: RESTAURANT_ID,
    id: String(itemId),
  });

  if (result.deletedCount === 0) {
    throw new Error("O'chiriladigan taom topilmadi!");
  }

  await invalidateMenuCache();

  return result;
}

// =====================================
// GENERATE ORDER ID
// =====================================

async function getNextOrderId() {
  await connectDB();

  const counterId = `order_id:${RESTAURANT_ID}`;

  const counter = await OrderCounter.findOneAndUpdate(
    { _id: counterId },
    {
      $inc: { lastOrderId: 1 },
      $setOnInsert: { lastOrderId: 1000 },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: false,
    }
  ).lean();

  return `ORD-${counter.lastOrderId}`;
}

// =====================================
// SAVE ORDER
// =====================================

async function saveOrder(orderData) {
  await connectDB();

  const order = await Order.create({
    restaurantId: RESTAURANT_ID,
    ...orderData,
  });

  console.log(
    `Buyurtma MongoDB'ga saqlandi: ${order.orderId}`
  );

  return order;
}

// =====================================
// EXPORTS
// =====================================

module.exports = {
  connectDB,
  loadMenu,
  saveMenu: saveMenuItem,
  saveMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getNextOrderId,
  saveOrder,
};

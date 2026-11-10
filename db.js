
const mongoose = require("mongoose");
const { createClient } = require("redis");

const {
  MONGO_URI,
  REDIS_URL,
  RESTAURANT_ID,
} = require("./config");

// =====================================
// 1. MONGODB CONNECTION
// =====================================

let mongoConnectionPromise = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  if (mongoConnectionPromise) {
    return mongoConnectionPromise;
  }

  if (!MONGO_URI) {
    throw new Error("MONGO_URI ko'rsatilmagan!");
  }

  mongoConnectionPromise = (async () => {
    await mongoose.connect(MONGO_URI, {
      maxPoolSize: 10,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    // Har bir restoran ichida taom ID unique bo'ladi.
    await MenuItem.collection.createIndex(
      { restaurantId: 1, id: 1 },
      { unique: true, name: "restaurant_menu_item_unique" }
    );

    await MenuItem.collection.createIndex(
      { restaurantId: 1, category: 1 },
      { name: "restaurant_category_index" }
    );

    console.log(
      `MongoDB ulandi ✅ | Restaurant: ${RESTAURANT_ID}`
    );

    return true;
  })();

  try {
    return await mongoConnectionPromise;
  } finally {
    mongoConnectionPromise = null;
  }
}

// =====================================
// 2. REDIS CONNECTION
// =====================================

let redisClient = null;
let redisConnectionPromise = null;
let redisDisabledUntil = 0;

function getMenuCacheKey() {
  return `menu:${RESTAURANT_ID}:v1`;
}

async function getRedis() {
  if (!REDIS_URL) return null;

  // Redis vaqtincha ishlamasa, har bir so'rovda
  // qayta-qayta ulanishga urinmaymiz.
  if (Date.now() < redisDisabledUntil) {
    return null;
  }

  if (redisClient && redisClient.isReady) {
    return redisClient;
  }

  if (redisConnectionPromise) {
    return redisConnectionPromise;
  }

  redisConnectionPromise = (async () => {
    try {
      if (!redisClient) {
        redisClient = createClient({
          url: REDIS_URL,
          socket: {
            connectTimeout: 1500,
            reconnectStrategy: (retries) => {
              if (retries > 2) {
                return new Error("Redis ulanish qayta urinishlari tugadi");
              }

              return Math.min(retries * 250, 1000);
            },
          },
        });

        redisClient.on("error", (err) => {
          console.error("Redis xatosi:", err.message);
        });
      }

      if (!redisClient.isOpen) {
        await redisClient.connect();
      }

      return redisClient.isReady ? redisClient : null;
    } catch (err) {
      console.error(
        "Redis mavjud emas. MongoDB fallback ishlaydi:",
        err.message
      );

      redisDisabledUntil = Date.now() + 30000;
      redisClient = null;

      return null;
    }
  })();

  try {
    return await redisConnectionPromise;
  } finally {
    redisConnectionPromise = null;
  }
}

// =====================================
// 3. MONGOOSE SCHEMAS
// =====================================

const menuSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: String,
      required: true,
      index: true,
    },

    id: {
      type: String,
      required: true,
    },

    category: {
      type: String,
      required: true,
    },

    name: {
      type: String,
      required: true,
    },

    price: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
    autoIndex: false,
  }
);

menuSchema.index(
  { restaurantId: 1, id: 1 },
  { unique: true, name: "restaurant_menu_item_unique" }
);

menuSchema.index(
  { restaurantId: 1, category: 1 },
  { name: "restaurant_category_index" }
);

const orderCounterSchema = new mongoose.Schema({
  _id: String,
  lastOrderId: {
    type: Number,
    default: 1000,
  },
});

const MenuItem =
  mongoose.models.MenuItem ||
  mongoose.model("MenuItem", menuSchema);

const OrderCounter =
  mongoose.models.OrderCounter ||
  mongoose.model("OrderCounter", orderCounterSchema);

// =====================================
// 4. CACHE INVALIDATION
// =====================================

async function invalidateMenuCache() {
  try {
    const redis = await getRedis();

    if (redis) {
      await redis.del(getMenuCacheKey());
      console.log("Menu cache tozalandi ✅");
    }
  } catch (err) {
    console.error("Cache tozalash xatosi:", err.message);
  }
}

// =====================================
// 5. DEFAULT MENU
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

  for (const item of defaults) {
    await MenuItem.updateOne(
      {
        restaurantId: RESTAURANT_ID,
        id: item.id,
      },
      {
        $setOnInsert: {
          restaurantId: RESTAURANT_ID,
          ...item,
        },
      },
      { upsert: true }
    );
  }
}

// =====================================
// 6. LOAD MENU (REDIS + MONGODB)
// =====================================

async function loadMenu() {
  try {
    await connectDB();

    const cacheKey = getMenuCacheKey();

    // Avval Redis'dan tekshiramiz.
    try {
      const redis = await getRedis();

      if (redis) {
        const cachedMenu = await redis.get(cacheKey);

        if (cachedMenu) {
          try {
            return JSON.parse(cachedMenu);
          } catch {
            await redis.del(cacheKey);
          }
        }
      }
    } catch (err) {
      console.error("Redis o'qish xatosi:", err.message);
    }

    // Redis'da bo'lmasa MongoDB'dan olamiz.
    let items = await MenuItem.find({
      restaurantId: RESTAURANT_ID,
    })
      .select("id category name price -_id")
      .sort({ category: 1, name: 1 })
      .lean();

    // Yangi restoran uchun demo menyu.
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

    // Natijani Redis'ga 10 daqiqaga saqlaymiz.
    try {
      const redis = await getRedis();

      if (redis) {
        await redis.set(
          cacheKey,
          JSON.stringify(menu),
          { EX: 600 }
        );
      }
    } catch (err) {
      console.error("Redis yozish xatosi:", err.message);
    }

    return menu;
  } catch (err) {
    console.error("Menu o'qishda xato:", err);
    return {};
  }
}

// =====================================
// 7. ADD MENU ITEM
// =====================================

async function saveMenuItem(category, name, price) {
  try {
    await connectDB();

    const newItem = await MenuItem.create({
      restaurantId: RESTAURANT_ID,
      id:
        "item_" +
        Date.now() +
        "_" +
        Math.random().toString(36).slice(2, 8),
      category,
      name,
      price: Number(price),
    });

    await invalidateMenuCache();

    return newItem;
  } catch (err) {
    console.error("Taom saqlashda xato:", err);
    return null;
  }
}

// =====================================
// 8. UPDATE MENU ITEM
// =====================================

async function updateMenuItem(itemId, newName, newPrice) {
  try {
    await connectDB();

    const updateData = {};

    if (newName) {
      updateData.name = newName;
    }

    if (
      newPrice !== undefined &&
      newPrice !== null &&
      newPrice !== ""
    ) {
      const price = Number(newPrice);

      if (!Number.isFinite(price) || price < 0) {
        throw new Error("Taom narxi noto'g'ri!");
      }

      updateData.price = price;
    }

    if (Object.keys(updateData).length === 0) {
      throw new Error("Yangilanadigan ma'lumot topilmadi!");
    }

    const result = await MenuItem.updateOne(
      {
        restaurantId: RESTAURANT_ID,
        id: itemId,
      },
      {
        $set: updateData,
      }
    );

    if (result.matchedCount > 0) {
      await invalidateMenuCache();
    }

    return result;
  } catch (err) {
    console.error("Taom tahrirlashda xato:", err);
    return null;
  }
}

// =====================================
// 9. DELETE MENU ITEM
// =====================================

async function deleteMenuItem(itemId) {
  try {
    await connectDB();

    const result = await MenuItem.deleteOne({
      restaurantId: RESTAURANT_ID,
      id: itemId,
    });

    if (result.deletedCount > 0) {
      await invalidateMenuCache();
    }

    return result;
  } catch (err) {
    console.error("Taom o'chirishda xato:", err);
    return null;
  }
}

// =====================================
// 10. ORDER ID GENERATOR
// =====================================

async function getNextOrderId() {
  try {
    await connectDB();

    const counterId = `order_id:${RESTAURANT_ID}`;

    // Counter mavjud bo'lmasa, boshlang'ich qiymat beramiz.
    try {
      await OrderCounter.updateOne(
        { _id: counterId },
        {
          $setOnInsert: {
            lastOrderId: 1000,
          },
        },
        { upsert: true }
      );
    } catch (err) {
      if (err.code !== 11000) throw err;
    }

    // Atomik increment: parallel buyurtmalar bir xil raqam olmaydi.
    const counter = await OrderCounter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { lastOrderId: 1 } },
      { new: true }
    ).lean();

    return `#ORD-${counter.lastOrderId}`;
  } catch (err) {
    console.error("Order ID yaratishda xato:", err);

    // Vaqtinchalik fallback.
    return `#ORD-${Date.now()}`;
  }
}

// =====================================
// 11. EXPORTS
// =====================================

module.exports = {
  connectDB,
  loadMenu,
  saveMenu: saveMenuItem,
  saveMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getNextOrderId,
};

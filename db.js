const mongoose = require("mongoose");
const { MONGO_URI } = require("./config");

if (MONGO_URI) {
  mongoose
    .connect(MONGO_URI)
    .then(() => console.log("MongoDB ga muvaffaqiyatli ulandik ✅"))
    .catch((err) => console.error("MongoDB ulanish xatosi:", err));
} else {
  console.log("MONGO_URI topilmadi!");
}

const menuSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  category: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
});

const orderCounterSchema = new mongoose.Schema({
  _id: { type: String, default: "order_id" },
  lastOrderId: { type: Number, default: 1000 },
});

const MenuItem = mongoose.model("MenuItem", menuSchema);
const OrderCounter = mongoose.model("OrderCounter", orderCounterSchema);

async function loadMenu() {
  try {
    const items = await MenuItem.find({});
    const menu = {};
    items.forEach((it) => {
      if (!menu[it.category]) menu[it.category] = [];
      menu[it.category].push({ id: it.id, name: it.name, price: it.price });
    });

    if (Object.keys(menu).length === 0) {
      const defaultItems = [
        { id: "d1", category: "☕ Ichimliklar", name: "Americano", price: 18000 },
        { id: "s1", category: "🍰 Shirinliklar", name: "Cheesecake", price: 25000 },
        { id: "t1", category: "🍔 Taomlar", name: "Burger", price: 35000 },
      ];
      await MenuItem.insertMany(defaultItems);
      return {
        "☕ Ichimliklar": [{ id: "d1", name: "Americano", price: 18000 }],
        "🍰 Shirinliklar": [{ id: "s1", name: "Cheesecake", price: 25000 }],
        "🍔 Taomlar": [{ id: "t1", name: "Burger", price: 35000 }],
      };
    }

    return menu;
  } catch (e) {
    console.error("Menu o'qishda xato:", e);
    return {};
  }
}

async function saveMenuItem(category, name, price) {
  try {
    const newItem = new MenuItem({
      id: "item_" + Date.now(),
      category: category,
      name: name,
      price: price,
    });
    await newItem.save();
    return newItem;
  } catch (e) {
    console.error("Taom saqlashda xato:", e);
  }
}

async function updateMenuItem(itemId, newName, newPrice) {
  try {
    const updateData = {};
    if (newName) updateData.name = newName;
    if (newPrice) updateData.price = newPrice;
    await MenuItem.updateOne({ id: itemId }, { $set: updateData });
  } catch (e) {
    console.error("Taom tahrirlashda xato:", e);
  }
}

async function deleteMenuItem(itemId) {
  try {
    await MenuItem.deleteOne({ id: itemId });
  } catch (e) {
    console.error("Taom o'chirishda xato:", e);
  }
}

async function getNextOrderId() {
  try {
    let counter = await OrderCounter.findById("order_id");
    if (!counter) {
      counter = new OrderCounter({ _id: "order_id", lastOrderId: 1000 });
    }
    counter.lastOrderId += 1;
    await counter.save();
    return `#ORD-${counter.lastOrderId}`;
  } catch (e) {
    return `#ORD-${Date.now().toString().slice(-4)}`;
  }
}

module.exports = {
  loadMenu,
  saveMenu: saveMenuItem,
  saveMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getNextOrderId,
};

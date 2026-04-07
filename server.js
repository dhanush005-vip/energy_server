const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// ---------------- DB CONNECT ----------------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.log("❌ Mongo Error:", err));

mongoose.connection.on("error", err => {
  console.log("❌ DB ERROR:", err);
});

// ---------------- UTILS ----------------
function round4(val) { return Number(Number(val || 0).toFixed(4)); }
function round2(val) { return Number(Number(val || 0).toFixed(2)); }

// ---------------- SCHEMA ----------------
const energySchema = new mongoose.Schema({
  device_id: String,
  hall: { type: Number, default: 0 },
  room: { type: Number, default: 0 },
  bath: { type: Number, default: 0 },
  kitchen: { type: Number, default: 0 },
  total_energy: { type: Number, default: 0 },
  last_post: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Energy = mongoose.model("Energy", energySchema);

const historySchema = new mongoose.Schema({
  device_id: String,
  hall: Number,
  room: Number,
  bath: Number,
  kitchen: Number,
  total_energy: Number,
  timestamp: { type: Date, default: Date.now }
});

const History = mongoose.model("History", historySchema);

// ---------------- BILL ----------------
function calculateBill(kwh) {
  kwh = kwh || 0;

  let bill = 0;

  if (kwh <= 100) bill = kwh * 2.25;
  else if (kwh <= 400)
    bill = (100 * 2.25) + (kwh - 100) * 4.45;
  else
    bill = (100 * 2.25) + (300 * 4.45) + (kwh - 400) * 6;

  return round2(bill);
}

// ---------------- UPDATE API ----------------
app.post("/update-energy", async (req, res) => {
  try {
    console.log("📥 ESP32 DATA:", req.body);

    const { device_id, hall, room, bath, kitchen } = req.body;

    if (!device_id) {
      return res.status(400).json({ error: "Device ID missing" });
    }

    let data = await Energy.findOne({ device_id });

    if (!data) {
      console.log("🆕 New device created");
      data = new Energy({ device_id });
    }

    const now = new Date();

    let elapsedHours = 0;

    // Skip accumulation if gap > 10 minutes (Render sleep/restart)
if (data.last_post) {
  const diffMs = now - new Date(data.last_post);
  elapsedHours = diffMs / (1000 * 60 * 60);
  
  if (elapsedHours > (10 / 60)) {
    // Gap too large — just update last_post, don't accumulate bad data
    data.last_post = now;
    data.updatedAt = now;
    await data.save();
    return res.json({ message: "Gap skipped" });
  }
  
  elapsedHours = Math.max(elapsedHours, 0.0003);
}

    // 🔥 Convert W → kWh
    data.hall    += ((hall || 0) * elapsedHours) / 1000;
    data.room    += ((room || 0) * elapsedHours) / 1000;
    data.bath    += ((bath || 0) * elapsedHours) / 1000;
    data.kitchen += ((kitchen || 0) * elapsedHours) / 1000;

    data.total_energy = data.hall + data.room + data.bath + data.kitchen;

    data.last_post = now;
    data.updatedAt = now;

    const saved = await data.save();

    console.log("💾 SAVED:", saved.total_energy);

    // 🔥 Save history
    await History.create({
      device_id,
      hall: data.hall,
      room: data.room,
      bath: data.bath,
      kitchen: data.kitchen,
      total_energy: data.total_energy
    });

    res.json({ message: "Updated successfully" });

  } catch (err) {
    console.error("❌ SAVE ERROR:", err);
    res.status(500).json({ error: "Save failed" });
  }
});

// ---------------- LIVE DATA ----------------
app.get("/get-energy/:id", async (req, res) => {
  try {
    const data = await Energy.findOne({ device_id: req.params.id });

    if (!data) return res.json({});

    res.json({
      hall: round4(data.hall),
      room: round4(data.room),
      bath: round4(data.bath),
      kitchen: round4(data.kitchen),
      total_energy: round4(data.total_energy),
      estimated_bill: calculateBill(data.total_energy)
    });

  } catch (err) {
    res.status(500).json({ error: "Fetch error" });
  }
});

// ---------------- DASHBOARD ----------------
app.get("/dashboard/:id", async (req, res) => {
  try {
    const device_id = req.params.id;

    const current = await Energy.findOne({ device_id });

    const history = await History.find({ device_id })
      .sort({ timestamp: -1 })
      .limit(20);

    res.json({
      live: current,
      history
    });

  } catch (err) {
    res.status(500).json({ error: "Dashboard error" });
  }
});

// ---------------- PREDICTION ----------------
app.get("/predict/:id", async (req, res) => {
  try {
    const device_id = req.params.id;
    const current = await Energy.findOne({ device_id });
    if (!current) return res.json({ message: "No data" });

    const recent = await History.find({ device_id })
      .sort({ timestamp: -1 })
      .limit(20);

    let rate = 0;

    if (recent.length >= 2) {
      const newest = recent[0];
      const oldest = recent[recent.length - 1];
      const deltaKwh = newest.total_energy - oldest.total_energy;
      const deltaHrs = Math.max(
        (new Date(newest.timestamp) - new Date(oldest.timestamp)) / (1000 * 60 * 60),
        0.001
      );
      rate = Math.max(deltaKwh / deltaHrs, 0);
    }

    const perDay   = rate * 24;
    const per7days = perDay * 7;
    const per30days = perDay * 30;

    // Determine trend
    let trend = "Stable";
    if (recent.length >= 6) {
      const half  = Math.floor(recent.length / 2);
      const newer = recent.slice(0, half);
      const older = recent.slice(half);
      const newerAvg = newer.reduce((s, r) => s + r.total_energy, 0) / newer.length;
      const olderAvg = older.reduce((s, r) => s + r.total_energy, 0) / older.length;
      if (newerAvg > olderAvg * 1.05) trend = "Increasing";
      else if (newerAvg < olderAvg * 0.95) trend = "Decreasing";
    }

    // High usage area
    const areas = { hall: current.hall, room: current.room, bath: current.bath, kitchen: current.kitchen };
    const highArea = Object.entries(areas).sort((a,b) => b[1]-a[1])[0][0];

    // Suggestion
    const suggestions = {
      hall:    "Your Hall is consuming the most energy. Consider switching to LED lighting and using smart plugs.",
      room:    "Your Room leads in consumption. Check for AC or fans left running overnight.",
      bath:    "Bathroom is using the most power. Geysers/water heaters are usually the culprit — use timers.",
      kitchen: "Kitchen tops usage. Avoid keeping the fridge open and use a microwave instead of oven when possible."
    };

    res.json({
      predicted_units_7_days:  round4(per7days),
      predicted_bill_7_days:   calculateBill(per7days),
      predicted_units_30_days: round4(per30days),
      predicted_bill_30_days:  calculateBill(per30days),
      usage_rate_per_hour:     round4(rate),
      trend,
      high_usage_area: highArea.charAt(0).toUpperCase() + highArea.slice(1),
      suggestion: suggestions[highArea]
    });

  } catch (err) {
    res.status(500).json({ error: "Prediction error" });
  }
});

// ---------------- SERVER ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Running on ${PORT}`));

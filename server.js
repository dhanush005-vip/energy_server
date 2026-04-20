const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log(err));

function round4(val) { return Number(Number(val || 0).toFixed(4)); }
function round2(val) { return Number(Number(val || 0).toFixed(2)); }

const energySchema = new mongoose.Schema({
  device_id:    String,
  hall:         { type: Number, default: 0 },  // cumulative kWh
  room:         { type: Number, default: 0 },
  bath:         { type: Number, default: 0 },
  kitchen:      { type: Number, default: 0 },
  total_energy: { type: Number, default: 0 },  // cumulative kWh
  last_post:    { type: Date,   default: null },// ← tracks last POST time
  createdAt:    { type: Date,   default: Date.now },
  updatedAt:    { type: Date,   default: Date.now }
});
const Energy = mongoose.model("Energy", energySchema);

const historySchema = new mongoose.Schema({
  device_id:    String,
  hall:         { type: Number, default: 0 },
  room:         { type: Number, default: 0 },
  bath:         { type: Number, default: 0 },
  kitchen:      { type: Number, default: 0 },
  total_energy: { type: Number, default: 0 },
  timestamp:    { type: Date,   default: Date.now }
});
const History = mongoose.model("History", historySchema);

// ─── BILL CALCULATION (TANGEDCO slabs) ───────────────────────────────────────
function calculateBill(kwh) {
  kwh = kwh || 0;
  if (kwh <= 0) return 0;
  let bill = 0;
  if      (kwh <= 100) bill = kwh * 2.25;
  else if (kwh <= 400) bill = (100 * 2.25) + (kwh - 100) * 4.45;
  else                 bill = (100 * 2.25) + (300 * 4.45) + (kwh - 400) * 6.00;
  return round2(bill);
}

// ─── POST /update-energy ─────────────────────────────────────────────────────
// ESP32 sends Watts → we convert to kWh using elapsed time since last POST
app.post("/update-energy", async (req, res) => {
  console.log("📦 ESP32 sent:", req.body);
  try {
    const { device_id, hall, room, bath, kitchen } = req.body;

    let data = await Energy.findOne({ device_id });
    if (!data) data = new Energy({ device_id });

    const now = new Date();

    // Calculate elapsed hours since last POST (min 1 second to avoid spike)
  

    // Watts × hours = Wh → ÷ 1000 = kWh
    data.hall    += (hall    || 0) 
    data.room    += (room    || 0) 
    data.bath    += (bath    || 0) 
    data.kitchen += (kitchen || 0) 

    data.total_energy = data.hall + data.room + data.bath + data.kitchen;
    data.last_post    = now;
    data.updatedAt    = now;

    await data.save();

    await History.create({
      device_id,
      hall:         data.hall,
      room:         data.room,
      bath:         data.bath,
      kitchen:      data.kitchen,
      total_energy: data.total_energy
    });

    res.send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

// ─── GET /get-energy/:id ─────────────────────────────────────────────────────
app.get("/get-energy/:id", async (req, res) => {
  try {
    const data = await Energy.findOne({ device_id: req.params.id });
    if (!data) return res.json({});

    res.json({
      hall:           round4(data.hall),
      room:           round4(data.room),
      bath:           round4(data.bath),
      kitchen:        round4(data.kitchen),
      total_energy:   round4(data.total_energy),
      estimated_bill: calculateBill(data.total_energy)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching data" });
  }
});

// ─── GET /dashboard/:id ──────────────────────────────────────────────────────
app.get("/dashboard/:id", async (req, res) => {
  try {
    const device_id = req.params.id;
    const current   = await Energy.findOne({ device_id });

    const live = current ? {
      hall:           round4(current.hall),
      room:           round4(current.room),
      bath:           round4(current.bath),
      kitchen:        round4(current.kitchen),
      total_energy:   round4(current.total_energy),
      estimated_bill: calculateBill(current.total_energy)
    } : null;

    const history = await History.find({
      device_id,
      timestamp: { $gte: new Date(Date.now() - 30 * 60 * 1000) }
    }).sort({ timestamp: 1 });

    res.json({ live, history });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Dashboard error" });
  }
});

// ─── GET /predict/:id ────────────────────────────────────────────────────────
app.get("/predict/:id", async (req, res) => {
  try {
    const device_id = req.params.id;
    const current   = await Energy.findOne({ device_id });
    if (!current) return res.json({ message: "No data found" });

    const billNow = calculateBill(current.total_energy);

    const recent = await History.find({ device_id })
      .sort({ timestamp: -1 })
      .limit(10);

    let kwhPerHour = 0;
    let trend = "Stable";

    if (recent.length >= 2) {
      const newest     = recent[0];
      const oldest     = recent[recent.length - 1];
      const deltaKwh   = newest.total_energy - oldest.total_energy;
      const deltaHours = Math.max(
        (new Date(newest.timestamp) - new Date(oldest.timestamp)) / (1000 * 60 * 60),
        0.001
      );
      kwhPerHour = Math.max(deltaKwh / deltaHours, 0);

      if (newest.total_energy > oldest.total_energy * 1.02)      trend = "Increasing 📈";
      else if (newest.total_energy < oldest.total_energy * 0.98) trend = "Decreasing 📉";
    } else {
      const diffHours = Math.max(
        (new Date() - new Date(current.createdAt)) / (1000 * 60 * 60), 1
      );
      kwhPerHour = current.total_energy / diffHours;
    }

    const kwhPerDay = kwhPerHour * 24;
    const kwh7      = kwhPerDay * 7;
    const kwh30     = kwhPerDay * 30;

    const areas = {
      Hall:     current.hall,
      Room:     current.room,
      Bathroom: current.bath,
      Kitchen:  current.kitchen
    };
    const maxArea = Object.entries(areas).reduce(
      (a, b) => b[1] > a[1] ? b : a, ["Hall", 0]
    )[0];

    const suggestions = {
      Hall:     "Hall usage is highest. Turn off lights and fans when not in the room.",
      Room:     "Bedroom consumes the most energy. Optimise AC and fan schedules.",
      Bathroom: "Bathroom usage is highest. Cut down geyser run time.",
      Kitchen:  "Kitchen uses the most power. Reduce heater/microwave usage."
    };

    res.json({
      current_units:           round4(current.total_energy),
      estimated_bill_now:      round2(billNow),
      predicted_units_7_days:  round4(kwh7),
      predicted_units_30_days: round4(kwh30),
      predicted_bill_7_days:   round2(calculateBill(kwh7)),
      predicted_bill_30_days:  round2(calculateBill(kwh30)),
      usage_rate_per_hour:     round4(kwhPerHour),
      trend,
      high_usage_area:         maxArea,
      suggestion:              suggestions[maxArea]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Prediction error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
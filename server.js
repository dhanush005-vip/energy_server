const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const mongoURI = process.env.MONGO_URI;

// -------- DB CONNECT --------
mongoose.connect(mongoURI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log(err));


// -------- ROUND --------
function round4(val) { return Number(Number(val || 0).toFixed(4)); }
function round2(val) { return Number(Number(val || 0).toFixed(2)); }


// -------- SCHEMA --------
const energySchema = new mongoose.Schema({
  device_id: String,
  hall: Number,
  room: Number,
  bath: Number,
  kitchen: Number,
  total_energy: Number,   // Wh
  updatedAt: { type: Date, default: Date.now }
});

const Energy = mongoose.model("Energy", energySchema);


// -------- BILL FUNCTION --------
function calculateBill(wh) {
  const units = wh / 1000;

  let bill = 0;

  if (units <= 100) bill = 0;
  else if (units <= 200)
    bill = (units - 100) * 1.5;
  else if (units <= 500)
    bill = (100 * 1.5) + (units - 200) * 3;
  else if (units <= 1000)
    bill = (100 * 1.5) + (300 * 3) + (units - 500) * 4.5;
  else
    bill = (100 * 1.5) + (300 * 3) + (500 * 4.5) + (units - 1000) * 6;

  if (units > 100) bill += 30;

  return round2(bill);
}


// -------- UPDATE API --------
app.post("/update-energy", async (req, res) => {
  const { device_id, hall, room, bath, kitchen } = req.body;

  let data = await Energy.findOne({ device_id });

  if (!data) {
    data = new Energy({
      device_id,
      hall: 0,
      room: 0,
      bath: 0,
      kitchen: 0,
      total_energy: 0
    });
  }

  // 🔥 ADD USAGE
  const usage = (hall || 0) + (room || 0) + (bath || 0) + (kitchen || 0);

  data.hall += hall || 0;
  data.room += room || 0;
  data.bath += bath || 0;
  data.kitchen += kitchen || 0;
  data.total_energy += usage;

  data.updatedAt = new Date();

  await data.save();

  res.send("OK");
});


// -------- LIVE + ESTIMATED BILL --------
app.get("/get-energy/:id", async (req, res) => {
  const data = await Energy.findOne({ device_id: req.params.id });

  if (!data) return res.json({});

  const bill = calculateBill(data.total_energy);

  res.json({
    hall: round4(data.hall),
    room: round4(data.room),
    bath: round4(data.bath),
    kitchen: round4(data.kitchen),
    total_energy: round4(data.total_energy),
    estimated_bill: bill   // ✅ FIXED NAME
  });
});


// -------- 🔮 ENERGY-BASED PREDICTION --------
app.get("/predict/:id", async (req, res) => {
  try {
    const data = await Energy.findOne({ device_id: req.params.id });

    if (!data) {
      return res.json({ message: "No data found" });
    }

    // 🧠 Assume system started tracking from last reset (approx)
    const now = new Date();
    const start = new Date(data.updatedAt);

    const diffHours = Math.max((now - start) / (1000 * 60 * 60), 1);

    // ✅ CURRENT RATE
    const whPerHour = data.total_energy / diffHours;

    // DAILY + MONTHLY
    const whPerDay = whPerHour * 24;
    const wh30 = whPerDay * 30;

    const billNow = calculateBill(data.total_energy);
    const bill30 = calculateBill(wh30);

    res.json({
      current_units: round4(data.total_energy / 1000),
      estimated_bill_now: round2(billNow),

      predicted_units_30_days: round4(wh30 / 1000),
      predicted_bill_30_days: round2(bill30),

      usage_rate_per_hour: round4(whPerHour),

      note: "Prediction based on current usage rate (not history)"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Prediction error" });
  }
});


// -------- SERVER --------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
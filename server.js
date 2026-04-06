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


// -------- ROUND HELPERS --------
function round4(val) { return Number(Number(val || 0).toFixed(4)); }
function round2(val) { return Number(Number(val || 0).toFixed(2)); }


// -------- SCHEMAS --------

const energySchema = new mongoose.Schema({
  device_id: String,
  hall:         { type: Number, default: 0 },
  room:         { type: Number, default: 0 },
  bath:         { type: Number, default: 0 },
  kitchen:      { type: Number, default: 0 },
  total_energy: { type: Number, default: 0 }   // stored in Wh
});
const Energy = mongoose.model("Energy", energySchema);

const historySchema = new mongoose.Schema({
  device_id: String,
  hall:         Number,
  room:         Number,
  bath:         Number,
  kitchen:      Number,
  total_energy: Number,                         // Wh
  timestamp:    { type: Date, default: Date.now }
});
const History = mongoose.model("History", historySchema);


// -------- BILL CALCULATION (Tamil Nadu TANGEDCO slabs) --------
//
//  Wh  →  kWh  (divide by 1000)  →  apply slab rates
//
//  Slab (units = kWh):
//    0  – 100  : ₹0       (free for domestic)
//    101 – 200  : ₹1.50/unit
//    201 – 500  : ₹3.00/unit
//    501 – 1000 : ₹4.50/unit
//    > 1000     : ₹6.00/unit
//
//  Fixed charges: ₹30 if units > 100
//
//  Change the slab values below to match your actual utility tariff.
// ------------------------------------------------------------------
function calculateBill(wh) {
  const units = wh / 1000;           // Wh → kWh

  if (units <= 0) return 0;

  let bill = 0;

  if (units <= 100) {
    bill = 0;                         // free slab
  } else if (units <= 200) {
    bill = (units - 100) * 1.50;
  } else if (units <= 500) {
    bill = (100 * 1.50) + (units - 200) * 3.00;
  } else if (units <= 1000) {
    bill = (100 * 1.50) + (300 * 3.00) + (units - 500) * 4.50;
  } else {
    bill = (100 * 1.50) + (300 * 3.00) + (500 * 4.50) + (units - 1000) * 6.00;
  }

  // Add fixed charge if consumption exceeds free slab
  if (units > 100) bill += 30;

  return round2(bill);
}


// -------- UPDATE API (ESP32 → POST /update-energy) --------
app.post("/update-energy", async (req, res) => {
  const { device_id, hall, room, bath, kitchen } = req.body;

  let data = await Energy.findOne({ device_id });
  if (!data) data = new Energy({ device_id });

  data.hall    += (hall    || 0);
  data.room    += (room    || 0);
  data.bath    += (bath    || 0);
  data.kitchen += (kitchen || 0);
  data.total_energy = data.hall + data.room + data.bath + data.kitchen;

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
});


// -------- GET LIVE DATA (GET /get-energy/:id) --------
app.get("/get-energy/:id", async (req, res) => {
  const data = await Energy.findOne({ device_id: req.params.id });
  if (!data) return res.json({});

  const bill = calculateBill(data.total_energy);

  res.json({
    hall:         round4(data.hall),
    room:         round4(data.room),
    bath:         round4(data.bath),
    kitchen:      round4(data.kitchen),
    total_energy: round4(data.total_energy),
    bill_amount:  round2(bill)
  });
});


// -------- DASHBOARD API (GET /dashboard/:id) --------
app.get("/dashboard/:id", async (req, res) => {
  const device_id = req.params.id;

  const current = await Energy.findOne({ device_id });

  // Include estimated bill in the live snapshot
  const bill = current ? calculateBill(current.total_energy) : 0;
  const live = current ? {
    hall:         round4(current.hall),
    room:         round4(current.room),
    bath:         round4(current.bath),
    kitchen:      round4(current.kitchen),
    total_energy: round4(current.total_energy),
    bill_amount:  round2(bill)              // ← estimated bill now included
  } : null;

  const history = await History.find({
    device_id,
    timestamp: { $gte: new Date(Date.now() - 30 * 60 * 1000) }
  }).sort({ timestamp: 1 });

  res.json({ live, history });
});


// -------- PREDICTION API (GET /predict/:id) --------
app.get("/predict/:id", async (req, res) => {
  try {
    const device_id = req.params.id;

    const history = await History.find({ device_id }).sort({ timestamp: 1 });

    if (!history || history.length < 2) {
      return res.json({ message: "Not enough data for prediction" });
    }

    // ── Daily average in Wh ──────────────────────────────────────
    //
    //  Each History record is a running CUMULATIVE total (you do data.hall += hall).
    //  So the actual energy consumed is:  last record − first record.
    //  Then divide by elapsed days to get Wh/day.
    //
    const firstRecord  = history[0];
    const lastRecord   = history[history.length - 1];

    const totalWhConsumed = lastRecord.total_energy - firstRecord.total_energy;

    const firstTime = new Date(firstRecord.timestamp).getTime();
    const lastTime  = new Date(lastRecord.timestamp).getTime();
    const elapsedMs = lastTime - firstTime;

    // Fallback: if all data is within 1 minute, treat as 1 hour of data
    const elapsedHours = Math.max(elapsedMs / (1000 * 60 * 60), 1);
    const elapsedDays  = elapsedHours / 24;

    const avgWhPerDay  = totalWhConsumed / elapsedDays;   // Wh/day
    const avgKwhPerDay = avgWhPerDay / 1000;              // kWh/day  (for display)

    // ── Projected consumption ────────────────────────────────────
    const projected7Wh  = avgWhPerDay * 7;
    const projected30Wh = avgWhPerDay * 30;

    // ── Projected bills ──────────────────────────────────────────
    const bill7  = calculateBill(projected7Wh);
    const bill30 = calculateBill(projected30Wh);

    // ── Trend ────────────────────────────────────────────────────
    let trend = "Stable";
    if (lastRecord.total_energy > firstRecord.total_energy * 1.05) trend = "Increasing 📈";
    else if (lastRecord.total_energy < firstRecord.total_energy * 0.95) trend = "Decreasing 📉";

    // ── High usage area (by cumulative sum across history) ───────
    let hallSum = 0, roomSum = 0, bathSum = 0, kitchenSum = 0;
    history.forEach(h => {
      hallSum    += (h.hall    || 0);
      roomSum    += (h.room    || 0);
      bathSum    += (h.bath    || 0);
      kitchenSum += (h.kitchen || 0);
    });

    let maxArea  = "Hall";
    let maxValue = hallSum;
    if (roomSum    > maxValue) { maxArea = "Room";      maxValue = roomSum;    }
    if (bathSum    > maxValue) { maxArea = "Bathroom";  maxValue = bathSum;    }
    if (kitchenSum > maxValue) { maxArea = "Kitchen";   maxValue = kitchenSum; }

    // ── Suggestion ───────────────────────────────────────────────
    const suggestions = {
      Kitchen:  "Kitchen uses the most power. Reduce heater/microwave usage.",
      Hall:     "Hall usage is highest. Turn off lights and fans when not in the room.",
      Room:     "Bedroom consumes the most energy. Optimise AC and fan schedules.",
      Bathroom: "Bathroom usage is highest. Cut down geyser run time."
    };
    const suggestion = suggestions[maxArea] || `${maxArea} consumes the most energy. Try reducing usage.`;

    res.json({
      avg_daily_units:         round4(avgKwhPerDay),
      avg_daily_wh:            round4(avgWhPerDay),
      prediction_units_7_days: round4(projected7Wh / 1000),
      prediction_units_30_days:round4(projected30Wh / 1000),
      predicted_bill_7_days:   round2(bill7),   // ₹ with 2 decimal places
      predicted_bill_30_days:  round2(bill30),  // ₹ with 2 decimal places
      trend,
      high_usage_area: maxArea,
      suggestion
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Prediction error" });
  }
});


// -------- SERVER --------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
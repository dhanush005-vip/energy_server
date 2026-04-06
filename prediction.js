const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// -------- HISTORY SCHEMA --------
const HistorySchema = new mongoose.Schema({
  device_id: String,
  hall: Number,
  room: Number,
  bath: Number,
  kitchen: Number,
  total_energy: Number,
  timestamp: { type: Date, default: Date.now }
});

const History = mongoose.model("History", HistorySchema);


// -------- BILL FUNCTION --------
function calcBill(units) {
  let bill = 0;

  if (units <= 100) bill = units * 2.25;
  else if (units <= 200)
    bill = (100 * 2.25) + (units - 100) * 4.5;
  else if (units <= 400)
    bill = (100 * 2.25) + (100 * 4.5) + (units - 200) * 6;
  else
    bill = (100 * 2.25) + (100 * 4.5) + (200 * 6) + (units - 400) * 8;

  return Math.round(bill);
}


// -------- 🔮 PREDICTION API --------
router.get("/predict/:id", async (req, res) => {
  try {
    const device_id = req.params.id;

    // 🔥 ONLY LAST 30 DAYS DATA
    const history = await History.find({
      device_id,
      timestamp: {
        $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      }
    }).sort({ timestamp: 1 });

    // ❌ Not enough data
    if (!history || history.length < 2) {
      return res.json({
        message: "Not enough data for prediction"
      });
    }

    // -------------------------------
    // ✅ CORRECT METHOD (DIFFERENCE)
    // -------------------------------
    const first = history[0];
    const last = history[history.length - 1];

    const totalUnits = last.total_energy - first.total_energy;

    const timeDiff = last.timestamp - first.timestamp;
    const days = timeDiff / (1000 * 60 * 60 * 24);
    const safeDays = days > 0 ? days : 1;

    const dailyUnits = totalUnits / safeDays;

    // -------------------------------
    // 🔮 FUTURE PREDICTION
    // -------------------------------
    const units7 = dailyUnits * 7;
    const units30 = dailyUnits * 30;

    const bill7 = calcBill(units7);
    const bill30 = calcBill(units30);

    // -------------------------------
    // 📈 TREND
    // -------------------------------
    let trend = "Stable";

    if (last.total_energy > first.total_energy)
      trend = "Increasing 📈";
    else if (last.total_energy < first.total_energy)
      trend = "Decreasing 📉";

    // -------------------------------
    // ⚡ AREA ANALYSIS
    // -------------------------------
    let hall = 0, room = 0, bath = 0, kitchen = 0;

    history.forEach(h => {
      hall += h.hall;
      room += h.room;
      bath += h.bath;
      kitchen += h.kitchen;
    });

    let maxArea = "Hall";
    let maxValue = hall;

    if (room > maxValue) { maxArea = "Room"; maxValue = room; }
    if (bath > maxValue) { maxArea = "Bathroom"; maxValue = bath; }
    if (kitchen > maxValue) { maxArea = "Kitchen"; maxValue = kitchen; }

    // -------------------------------
    // 💡 SUGGESTION
    // -------------------------------
    let suggestion = "Optimize energy usage.";

    if (maxArea === "Kitchen")
      suggestion = "Reduce heater / microwave usage.";
    else if (maxArea === "Hall")
      suggestion = "Turn off unused lights and fans.";
    else if (maxArea === "Room")
      suggestion = "Limit AC usage.";
    else if (maxArea === "Bathroom")
      suggestion = "Reduce geyser usage.";

    // -------------------------------
    // 📤 RESPONSE
    // -------------------------------
    res.json({
      daily_units: Number(dailyUnits).toFixed(2),

      predicted_units_7_days: Number(units7).toFixed(2),
      predicted_units_30_days: Number(units30).toFixed(2),

      predicted_bill_7_days: bill7,
      predicted_bill_30_days: bill30,

      trend,
      high_usage_area: maxArea,
      suggestion
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Prediction error"
    });
  }
});

module.exports = router;
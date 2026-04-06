const express = require("express");
const router = express.Router();

// 🔥 IMPORT YOUR HISTORY MODEL
const mongoose = require("mongoose");

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

// 🔮 PREDICTION API
router.get("/predict/:id", async (req, res) => {
  try {
    const device_id = req.params.id;

    const history = await History.find({ device_id })
                                 .sort({ timestamp: 1 });

    if (!history || history.length < 2) {
      return res.json({ message: "Not enough data for prediction" });
    }

    // -------------------------------
    // 📊 DAILY AVERAGE
    // -------------------------------
    let totalEnergy = 0;

    history.forEach(h => {
      totalEnergy += h.total_energy;
    });

    const avgEnergy = totalEnergy / history.length;
    const avgUnits = avgEnergy / 1000;

    // -------------------------------
    // 🔮 FUTURE PREDICTION
    // -------------------------------
    const units7 = avgUnits * 7;
    const units30 = avgUnits * 30;

    // -------------------------------
    // 💰 BILL CALCULATION
    // -------------------------------
    function calcBill(units) {
      if (units <= 100) return 0;

      let bill = 0;

      if (units > 100) {
        let u = Math.min(units - 100, 100);
        bill += u * 2.25;
      }

      if (units > 200) {
        let u = Math.min(units - 200, 200);
        bill += u * 4.5;
      }

      if (units > 400) {
        let u = units - 400;
        bill += u * 6;
      }

      return Math.round(bill);
    }

    const bill7 = calcBill(units7);
    const bill30 = calcBill(units30);

    // -------------------------------
    // 📈 TREND
    // -------------------------------
    const first = history[0].total_energy;
    const last  = history[history.length - 1].total_energy;

    let trend = "Stable";

    if (last > first) trend = "Increasing 📈";
    else if (last < first) trend = "Decreasing 📉";

    // -------------------------------
    // ⚡ HIGH USAGE AREA
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
    let suggestion = `${maxArea} consumes more energy. Try reducing usage.`;

    if (maxArea === "Kitchen") {
      suggestion = "Kitchen uses high power. Reduce heater/microwave usage.";
    } else if (maxArea === "Hall") {
      suggestion = "Hall usage is high. Turn off lights/fans when not needed.";
    } else if (maxArea === "Room") {
      suggestion = "Room consumes more energy. Optimize AC/fan usage.";
    } else if (maxArea === "Bathroom") {
      suggestion = "Bathroom usage is high. Reduce geyser usage.";
    }

    // -------------------------------
    // 📤 RESPONSE
    // -------------------------------
    res.json({
      avg_daily_energy_wh: avgEnergy,
      avg_daily_units: avgUnits,

      prediction_units_7_days: units7,
      prediction_units_30_days: units30,

      predicted_bill_7_days: bill7,
      predicted_bill_30_days: bill30,

      trend: trend,
      high_usage_area: maxArea,
      suggestion: suggestion
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Prediction error" });
  }
});

module.exports = router;
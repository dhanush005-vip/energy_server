const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");


// -------- ENERGY SCHEMA (USE THIS INSTEAD OF HISTORY) --------
const EnergySchema = new mongoose.Schema({
  device_id: String,
  hall: Number,
  room: Number,
  bath: Number,
  kitchen: Number,
  total_energy: Number,   // Wh
  updatedAt: { type: Date, default: Date.now }
});

const Energy = mongoose.model("Energy", EnergySchema);


// -------- BILL FUNCTION --------
function calcBill(wh) {
  const units = wh / 1000; // convert Wh → kWh

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

  return Number(bill.toFixed(2));
}


// -------- 🔮 PREDICTION API (ENERGY BASED) --------
router.get("/predict/:id", async (req, res) => {
  try {
    const device_id = req.params.id;

    // 🔥 GET CURRENT ENERGY DATA
    const data = await Energy.findOne({ device_id });

    if (!data) {
      return res.json({ message: "No data found" });
    }

    // -------------------------------
    // ⏱️ TIME CALCULATION
    // -------------------------------
    const now = new Date();
    const lastUpdate = data.updatedAt || now;

    let diffHours = (now - lastUpdate) / (1000 * 60 * 60);

    if (diffHours <= 0) diffHours = 1;

    // -------------------------------
    // ⚡ USAGE CALCULATION
    // -------------------------------
    const totalWh = data.total_energy || 0;

    const whPerHour = totalWh / diffHours;
    const whPerDay = whPerHour * 24;
    const wh30Days = whPerDay * 30;

    // -------------------------------
    // 💰 BILL
    // -------------------------------
    const currentBill = calcBill(totalWh);
    const predictedBill30 = calcBill(wh30Days);

    // -------------------------------
    // 📊 AREA ANALYSIS
    // -------------------------------
    const hall = data.hall || 0;
    const room = data.room || 0;
    const bath = data.bath || 0;
    const kitchen = data.kitchen || 0;

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
      current_units: Number((totalWh / 1000).toFixed(4)),
      estimated_bill_now: currentBill,

      usage_rate_per_hour: Number(whPerHour.toFixed(4)),

      predicted_units_30_days: Number((wh30Days / 1000).toFixed(4)),
      predicted_bill_30_days: predictedBill30,

      high_usage_area: maxArea,
      suggestion,

      note: "Prediction based on Energy collection only"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Prediction error"
    });
  }
});

module.exports = router;
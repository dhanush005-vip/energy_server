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


// -------- SCHEMAS --------

// 🔴 LIVE DATA
const energySchema = new mongoose.Schema({
    device_id: String,
    hall: { type: Number, default: 0 },
    room: { type: Number, default: 0 },
    bath: { type: Number, default: 0 },
    kitchen: { type: Number, default: 0 },
    total_energy: { type: Number, default: 0 }
});

const Energy = mongoose.model("Energy", energySchema);

// 🟢 HISTORY DATA (IMPORTANT)
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


// -------- BILL FUNCTION --------
function calculateBill(units) {
    let bill = 0;

    if (units <= 100) bill = (units * 2.25);
    else if (units <= 200)
        bill = (units * 4.5);
    else if (units <= 400)
        bill = (100 * 2.25) + (units - 200) * 4.5;
    else if (units <= 500)
        bill = (100 * 2.25) + (200 * 4.5) + (units - 400) * 6;
    else
        bill = (100 * 2.25) + (200 * 4.5) + (100 * 6) + (units - 500) * 6;

    return Math.round(bill);
}


// -------- UPDATE API (ESP32) --------
app.post("/update-energy", async (req, res) => {

    const { device_id, hall, room, bath, kitchen } = req.body;

    let data = await Energy.findOne({ device_id });

    if (!data) {
        data = new Energy({ device_id });
    }

    // ✅ ADD DELTA VALUES
    data.hall += hall;
    data.room += room;
    data.bath += bath;
    data.kitchen += kitchen;

    data.total_energy =
        data.hall + data.room + data.bath + data.kitchen;

    await data.save();

    // 🔥 SAVE HISTORY (VERY IMPORTANT)
    await History.create({
        device_id,
        hall: data.hall,
        room: data.room,
        bath: data.bath,
        kitchen: data.kitchen,
        total_energy: data.total_energy
    });

    res.send("OK");
});


// -------- GET LIVE DATA --------
app.get("/get-energy/:id", async (req, res) => {

    const data = await Energy.findOne({ device_id: req.params.id });

    if (!data) return res.json({});

    const bill = calculateBill(data.total_energy);

    res.json({
        hall: data.hall,
        room: data.room,
        bath: data.bath,
        kitchen: data.kitchen,
        total_energy: data.total_energy,
        bill_amount: bill
    });
});


// -------- DASHBOARD API (LIVE + LAST 30 MIN HISTORY) --------
app.get("/dashboard/:id", async (req, res) => {

    const device_id = req.params.id;

    const current = await Energy.findOne({ device_id });

    const history = await History.find({
        device_id,
        timestamp: {
            $gte: new Date(Date.now() - 30 * 60 * 1000) // last 30 min
        }
    }).sort({ timestamp: 1 });

    res.json({
        live: current,
        history: history
    });
});


// -------- 🔮 PREDICTION API --------
app.get("/predict/:id", async (req, res) => {
  try {
    const device_id = req.params.id;

    const history = await History.find({ device_id })
                                 .sort({ timestamp: 1 });

    if (!history || history.length < 2) {
      return res.json({ message: "Not enough data for prediction" });
    }

    // 📊 Average
    let totalEnergy = 0;
    history.forEach(h => totalEnergy += h.total_energy);

    const avgEnergy = totalEnergy / history.length;
    const avgUnits = avgEnergy / 1000;

    // 🔮 Future
    const units7 = avgUnits * 7;
    const units30 = avgUnits * 30;

    const bill7 = calculateBill(units7);
    const bill30 = calculateBill(units30);

    // 📈 Trend
    const first = history[0].total_energy;
    const last  = history[history.length - 1].total_energy;

    let trend = "Stable";
    if (last > first) trend = "Increasing 📈";
    else if (last < first) trend = "Decreasing 📉";

    // ⚡ High usage
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

    // 💡 Suggestion
    let suggestion = `${maxArea} consumes more energy.`;

    if (maxArea === "Kitchen")
      suggestion = "Reduce heater/microwave usage.";
    else if (maxArea === "Hall")
      suggestion = "Turn off lights/fans when not needed.";
    else if (maxArea === "Room")
      suggestion = "Optimize AC/fan usage.";
    else if (maxArea === "Bathroom")
      suggestion = "Reduce geyser usage.";

    res.json({
      avg_daily_units: avgUnits,
      predicted_bill_7_days: bill7,
      predicted_bill_30_days: bill30,
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

app.listen(PORT, () => {
    console.log("🚀 Server running");
});
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


// -------- ROUND FUNCTION --------
function round(val, digits = 4) {
    return Number(val || 0).toFixed(digits);
}


// -------- SCHEMAS --------
const energySchema = new mongoose.Schema({
    device_id: String,
    hall: { type: Number, default: 0 },
    room: { type: Number, default: 0 },
    bath: { type: Number, default: 0 },
    kitchen: { type: Number, default: 0 },
    total_energy: { type: Number, default: 0 } // cumulative
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


// -------- BILL FUNCTION --------
function calculateBill(units) {
    let bill = 0;

    if (units <= 100) bill = units * 2.25;
    else if (units <= 200) bill = (100 * 2.25) + (units - 100) * 4.5;
    else if (units <= 400)
        bill = (100 * 2.25) + (100 * 4.5) + (units - 200) * 6;
    else if (units <= 500)
        bill = (100 * 2.25) + (100 * 4.5) + (200 * 6) + (units - 400) * 8;
    else
        bill = (100 * 2.25) + (100 * 4.5) + (200 * 6) + (100 * 8) + (units - 500) * 10;

    return Math.round(bill);
}


// -------- UPDATE API (ESP32 LIVE DATA) --------
app.post("/update-energy", async (req, res) => {
    try {
        const { device_id, hall, room, bath, kitchen } = req.body;

        let data = await Energy.findOne({ device_id });

        if (!data) {
            data = new Energy({ device_id, total_energy: 0 });
        }

        // 🔥 CURRENT USAGE
        const liveUsage = (hall || 0) + (room || 0) + (bath || 0) + (kitchen || 0);

        // ✅ ADD TO TOTAL (CUMULATIVE)
        data.total_energy += liveUsage;

        // SAVE LIVE VALUES
        data.hall = hall;
        data.room = room;
        data.bath = bath;
        data.kitchen = kitchen;

        await data.save();

        // SAVE HISTORY SNAPSHOT
        await History.create({
            device_id,
            hall,
            room,
            bath,
            kitchen,
            total_energy: data.total_energy
        });

        res.send("OK");

    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating data");
    }
});


// -------- GET LIVE DATA --------
app.get("/get-energy/:id", async (req, res) => {
    try {
        const data = await Energy.findOne({ device_id: req.params.id });

        if (!data) return res.json({});

        const bill = calculateBill(data.total_energy);

        res.json({
            hall: round(data.hall),
            room: round(data.room),
            bath: round(data.bath),
            kitchen: round(data.kitchen),
            total_energy: round(data.total_energy),
            bill_amount: round(bill, 2)
        });

    } catch (err) {
        res.status(500).json({ error: "Error fetching data" });
    }
});


// -------- DASHBOARD (LIVE + HISTORY) --------
app.get("/dashboard/:id", async (req, res) => {
    try {
        const device_id = req.params.id;

        const current = await Energy.findOne({ device_id });

        let history = await History.find({ device_id })
            .sort({ timestamp: -1 })
            .limit(50)
            .sort({ timestamp: 1 });

        // ADD CURRENT LIVE SNAPSHOT
        if (current) {
            history.push({
                hall: current.hall,
                room: current.room,
                bath: current.bath,
                kitchen: current.kitchen,
                total_energy: current.total_energy,
                timestamp: new Date()
            });
        }

        res.json({
            live: current,
            history
        });

    } catch (err) {
        res.status(500).json({ error: "Dashboard error" });
    }
});


// -------- 🔮 PREDICTION (BASED ON LAST 30 DAYS) --------
app.get("/predict/:id", async (req, res) => {
    try {
        const device_id = req.params.id;

        const history = await History.find({
            device_id,
            timestamp: {
                $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            }
        }).sort({ timestamp: 1 });

        if (!history || history.length < 2) {
            return res.json({ message: "Not enough data" });
        }

        const first = history[0];
        const last = history[history.length - 1];

        // ✅ TOTAL USED
        const unitsUsed = last.total_energy - first.total_energy;

        // ✅ DAYS DIFFERENCE
        const days = (last.timestamp - first.timestamp) / (1000 * 60 * 60 * 24);
        const safeDays = days > 0 ? days : 1;

        // ✅ DAILY AVG
        const dailyUnits = unitsUsed / safeDays;

        // FUTURE
        const units7 = dailyUnits * 7;
        const units30 = dailyUnits * 30;

        const bill7 = calculateBill(units7);
        const bill30 = calculateBill(units30);

        // 🔥 TREND
        let trend = "Stable";
        if (last.total_energy > first.total_energy) trend = "Increasing 📈";
        else if (last.total_energy < first.total_energy) trend = "Decreasing 📉";

        // 🔥 AREA ANALYSIS
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

        let suggestion = "Optimize energy usage.";

        if (maxArea === "Kitchen")
            suggestion = "Reduce heater/microwave usage.";
        else if (maxArea === "Hall")
            suggestion = "Turn off unused lights/fans.";
        else if (maxArea === "Room")
            suggestion = "Limit AC usage.";
        else if (maxArea === "Bathroom")
            suggestion = "Reduce geyser usage.";

        res.json({
            daily_units: round(dailyUnits, 2),
            predicted_units_7_days: round(units7, 2),
            predicted_units_30_days: round(units30, 2),
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
    console.log(`🚀 Server running on port ${PORT}`);
});
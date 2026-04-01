const express = require("express");
const mongoose = require("mongoose");

const app = express();
app.use(express.json());

const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI)
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.log(err));

// -------- SCHEMA --------
const energySchema = new mongoose.Schema({
    device_id: String,
    hall: { type: Number, default: 0 },
    room: { type: Number, default: 0 },
    bath: { type: Number, default: 0 },
    kitchen: { type: Number, default: 0 },
    total_energy: { type: Number, default: 0 }
});

const Energy = mongoose.model("Energy", energySchema);

// -------- BILL FUNCTION --------
function calculateBill(units) {
    let bill = 0;

    if (units <= 100) bill = (units*2.25);
    else if (units <= 200)
        bill = (units  * 4.5);
    else if (units <= 400)
        bill = (100 * 2.25) + (units - 200) * 4.5;
    else if (units <= 500)
        bill = (100 * 2.25) + (200 * 4.5) + (units - 400) * 6;
    else
        bill = (100 * 2.25) + (200 * 4.5) + (100 * 6) + (units - 500) * 6;

    return bill;
}

// -------- UPDATE API --------
app.post("/update-energy", async (req, res) => {

    const { device_id, hall, room, bath, kitchen } = req.body;

    let data = await Energy.findOne({ device_id });

    if (!data) {
        data = new Energy({ device_id });
    }

    // ✅ ADD ONLY DELTA VALUES (NOT TOTAL)
    data.hall += hall;
    data.room += room;
    data.bath += bath;
    data.kitchen += kitchen;

    data.total_energy =
        data.hall + data.room + data.bath + data.kitchen;

    await data.save();

    res.send("OK");
});

// -------- GET API --------
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("🚀 Server running");
});

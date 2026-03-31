const express = require("express");
const mongoose = require("mongoose");

const app = express();
app.use(express.json());

// ✅ Use ENV variable
const mongoURI = process.env.MONGO_URI;

// ✅ FIX: Proper connection with error handling
mongoose.connect(mongoURI)
.then(() => {
    console.log("✅ MongoDB Connected");
})
.catch(err => {
    console.log("❌ MongoDB Error:", err);
});

// Schema
const energySchema = new mongoose.Schema({
    device_id: String,
    total_energy: Number
});

const Energy = mongoose.model("Energy", energySchema);

// Route
app.post("/update-energy", async (req, res) => {
    const { device_id, energy } = req.body;

    let data = await Energy.findOne({ device_id });

    if (!data) {
        data = new Energy({ device_id, total_energy: 0 });
    }

    data.total_energy += energy;
    await data.save();

    res.send("OK");
});

// Get route
app.get("/get-energy/:id", async (req, res) => {
    const data = await Energy.findOne({ device_id: req.params.id });
    res.json(data || { total_energy: 0 });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("🚀 Server running on port", PORT);
});

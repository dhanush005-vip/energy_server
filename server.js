const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// 🔥 paste your MongoDB URL
mongoose.connect("mongodb+srv://dhanush:Dhanush@cluster0.6tvlzu2.mongodb.net/?appName=Cluster0");

const energySchema = new mongoose.Schema({
  device_id: String,
  total_energy: Number
});

const Energy = mongoose.model("Energy", energySchema);

// ✅ ADD ENERGY
app.post("/update-energy", async (req, res) => {
  const { device_id, energy } = req.body;

  let device = await Energy.findOne({ device_id });

  if (!device) {
    device = new Energy({ device_id, total_energy: energy });
  } else {
    device.total_energy += energy;
  }

  await device.save();

  res.json({ total_energy: device.total_energy });
});

// ✅ GET ENERGY
app.get("/get-energy/:id", async (req, res) => {
  const device = await Energy.findOne({ device_id: req.params.id });

  res.json({
    total_energy: device ? device.total_energy : 0
  });
});

app.listen(3000, () => console.log("Server running"));
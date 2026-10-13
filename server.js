require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const listingsRouter = require("./routes/listings");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Routes ---
app.get("/", (_req, res) => {
  res.json({ message: "SideHustle API is running" });
});

app.use("/api/listings", listingsRouter);

// --- Non-blocking MongoDB connection ---
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sidehustle";

mongoose
  .connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch((err) =>
    console.warn(
      "⚠ MongoDB connection failed — server will run without persistence.",
      err.message
    )
  );

mongoose.connection.on("connected", () =>
  console.log("✅ MongoDB reconnected")
);
mongoose.connection.on("disconnected", () =>
  console.warn("⚠ MongoDB disconnected")
);

// --- Start server immediately (do NOT wait for DB) ---
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
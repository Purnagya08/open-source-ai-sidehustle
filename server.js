require("dotenv").config();

const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const listingsRouter = require("./routes/listings");
const { checkOllamaHealth } = require("./services/ollama");
const { ACCESS_CODE_CONFIGURED } = require("./middleware/access");

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy so rate-limit IP works behind Render
app.set("trust proxy", 1);

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use(express.static(path.join(__dirname, "public")));

app.use("/api/listings", listingsRouter);

app.get("/api/health", async (_req, res) => {
  const ollama = await checkOllamaHealth();
  const mongoReady = mongoose.connection.readyState === 1;
  const ready = ollama.ollamaReachable && ollama.modelInstalled;

  res.status(ready ? 200 : 503).json({
    ok: ready,
    api: true,
    mongo: mongoReady,
    ollamaReachable: ollama.ollamaReachable,
    modelInstalled: ollama.modelInstalled,
    model: ollama.model,
    message: ollama.message,
    accessCodeRequired: ACCESS_CODE_CONFIGURED,
  });
});

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/sidehustle";

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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (ACCESS_CODE_CONFIGURED) {
    console.log("🔒 ACCESS_CODE is set — API routes require X-Access-Code");
  } else {
    console.warn("⚠ ACCESS_CODE not set — API is open");
  }
});
const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const Listing = require("../models/Listing");
const { generateListing, VALID_LANGUAGES } = require("../services/ollama");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per image
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed."));
    }
  },
});

const VALID_PLATFORMS = ["instagram", "whatsapp", "meesho", "etsy", "ebay"];

router.post(
  "/generate",
  upload.array("images", 4),
  async (req, res) => {
    try {
      // --- Validate images ---
      const images = req.files;
      if (!images || images.length < 1) {
        return res
          .status(400)
          .json({ error: "Upload between 1 and 4 images." });
      }

      // --- Validate language ---
      const { language, category, platform, currency } = req.body;
      if (!language || !VALID_LANGUAGES[language.toLowerCase()]) {
        return res.status(400).json({
          error:
            "Invalid or missing language. Choose: English, Hindi, or Bengali.",
        });
      }

      // --- Validate category ---
      if (!category || !category.trim()) {
        return res
          .status(400)
          .json({ error: "Category is required." });
      }

      // --- Validate platform (optional) ---
      let cleanPlatform = null;
      if (platform) {
        cleanPlatform = platform.trim().toLowerCase();
        if (!VALID_PLATFORMS.includes(cleanPlatform)) {
          return res.status(400).json({
            error: `Invalid platform. Choose from: ${VALID_PLATFORMS.join(", ")}.`,
          });
        }
      }

      // --- Handle currency (default: ₹) ---
      const targetCurrency = currency && currency.trim() ? currency.trim() : "₹";

      // --- Call Ollama ---
      const imageBuffers = images.map((f) => f.buffer);
      const listing = await generateListing(
        imageBuffers,
        language,
        category.trim(),
        cleanPlatform,
        targetCurrency
      );

      // --- Attempt to save (non-blocking / graceful) ---
      let savedId = null;
      if (mongoose.connection.readyState === 1) {
        try {
          const doc = await Listing.create({
            ...listing,
            language: VALID_LANGUAGES[language.toLowerCase()],
            category: category.trim(),
            platform: cleanPlatform,
          });
          savedId = doc._id;
        } catch (dbErr) {
          console.warn("⚠ MongoDB save failed:", dbErr.message);
        }
      } else {
        console.warn(
          "⚠ MongoDB not connected — listing generated but not saved."
        );
      }

      // --- Respond ---
      return res.status(201).json({
        listing,
        saved: savedId !== null,
        listingId: savedId,
      });
    } catch (err) {
      console.error("Generation error:", err.message);
      const status = err.message.includes("Ollama") ? 503 : 500;
      return res.status(status).json({ error: err.message });
    }
  }
);

// --- Retrieval endpoints ---

router.get("/", async (_req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res
      .status(503)
      .json({ error: "Database unavailable." });
  }
  const listings = await Listing.find().sort({ createdAt: -1 }).limit(50);
  res.json(listings);
});

router.get("/:id", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res
      .status(503)
      .json({ error: "Database unavailable." });
  }
  const listing = await Listing.findById(req.params.id);
  if (!listing) return res.status(404).json({ error: "Not found." });
  res.json(listing);
});

module.exports = router;
const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const Listing = require("../models/Listing");
const {
  generateListing,
  translateListing,
  VALID_LANGUAGES,
} = require("../services/ollama");
const {
  requireAccessCode,
  rateLimitGenerate,
} = require("../middleware/access");

const router = express.Router();

// All listing API routes require access code (when ACCESS_CODE is set)
router.use(requireAccessCode);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  },
});

const VALID_PLATFORMS = ["instagram", "whatsapp", "meesho", "etsy", "ebay"];

router.post(
  "/generate",
  rateLimitGenerate,
  upload.array("images", 4),
  async (req, res) => {
    try {
      if (!req.files || req.files.length < 1) {
        return res.status(400).json({ error: "Upload between 1 and 4 images." });
      }

      const { language, category, platform, currency } = req.body;
      if (!language || !VALID_LANGUAGES[language.toLowerCase()]) {
        return res.status(400).json({ error: "Invalid or missing language." });
      }
      if (!category || !category.trim()) {
        return res.status(400).json({ error: "Category is required." });
      }

      let cleanPlatform = null;
      if (platform) {
        cleanPlatform = platform.trim().toLowerCase();
        if (!VALID_PLATFORMS.includes(cleanPlatform)) {
          return res.status(400).json({ error: "Invalid platform." });
        }
      }

      const targetCurrency =
        currency && currency.trim() ? currency.trim() : "₹";

      const { listing, englishListing } = await generateListing(
        req.files.map((f) => f.buffer),
        language,
        category.trim(),
        cleanPlatform,
        targetCurrency
      );

      if (listing.isProduct === false) {
        return res
          .status(200)
          .json({ listing, saved: false, listingId: null });
      }

      let savedId = null;
      if (mongoose.connection.readyState === 1) {
        try {
          const doc = await Listing.create({
            ...listing,
            englishVersion: englishListing,
            language: VALID_LANGUAGES[language.toLowerCase()],
            category: category.trim(),
            platform: cleanPlatform,
          });
          savedId = doc._id;
        } catch (dbErr) {
          console.warn("⚠ MongoDB save failed:", dbErr.message);
        }
      }

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

router.get("/", async (_req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database unavailable." });
  }
  const listings = await Listing.find().sort({ createdAt: -1 }).limit(50);
  res.json(listings);
});

router.get("/:id", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database unavailable." });
  }
  const listing = await Listing.findById(req.params.id);
  if (!listing) return res.status(404).json({ error: "Not found." });
  res.json(listing);
});

router.put("/:id", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database unavailable." });
  }
  try {
    const {
      title,
      description,
      featureBullets,
      keywords,
      priceRange,
      questionsForSeller,
      language,
    } = req.body;
    const updated = await Listing.findByIdAndUpdate(
      req.params.id,
      {
        title,
        description,
        featureBullets,
        keywords,
        priceRange,
        questionsForSeller,
        language,
      },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Not found." });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/translate", async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Database unavailable." });
  }
  try {
    const { language, currency } = req.body;
    const targetLang = VALID_LANGUAGES[(language || "").toLowerCase()];
    if (!targetLang) {
      return res.status(400).json({ error: "Invalid language." });
    }

    const doc = await Listing.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found." });

    const baseListing = doc.englishVersion || {
      title: doc.title,
      description: doc.description,
      featureBullets: doc.featureBullets,
      keywords: doc.keywords,
      priceRange: doc.priceRange,
      questionsForSeller: doc.questionsForSeller,
    };

    const translated = await translateListing(
      baseListing,
      targetLang,
      currency || "₹"
    );
    res.json({ listing: translated, language: targetLang });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
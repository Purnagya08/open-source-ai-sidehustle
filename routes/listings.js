const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const Listing = require("../models/Listing");
const { generateListing, translateListing, VALID_LANGUAGES } = require("../services/ollama");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

const VALID_PLATFORMS = ["instagram", "whatsapp", "meesho", "etsy", "ebay"];

router.post("/generate", upload.array("images", 4), async (req, res) => {
  try {
    if (!req.files || req.files.length < 1) return res.status(400).json({ error: "Upload 1-4 images." });

    const { language, category, platform, currency } = req.body;
    if (!language || !VALID_LANGUAGES[language.toLowerCase()]) return res.status(400).json({ error: "Invalid language." });
    if (!category || !category.trim()) return res.status(400).json({ error: "Category required." });

    const cleanPlatform = platform && VALID_PLATFORMS.includes(platform.trim().toLowerCase()) ? platform.trim().toLowerCase() : null;
    const targetCurrency = currency && currency.trim() ? currency.trim() : "₹";
    
    // Call Ollama
    const { listing, englishListing } = await generateListing(
      req.files.map(f => f.buffer), language, category.trim(), cleanPlatform, targetCurrency
    );

    if (listing.isProduct === false) return res.status(200).json({ listing, saved: false, listingId: null });

    // Save to DB
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
      } catch (dbErr) { console.warn("⚠ MongoDB save failed:", dbErr.message); }
    }

    return res.status(201).json({ listing, saved: savedId !== null, listingId: savedId });
  } catch (err) {
    return res.status(err.message.includes("Ollama") ? 503 : 500).json({ error: err.message });
  }
});

router.get("/", async (_req, res) => {
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database unavailable." });
  res.json(await Listing.find().sort({ createdAt: -1 }).limit(50));
});

router.get("/:id", async (req, res) => {
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database unavailable." });
  const listing = await Listing.findById(req.params.id);
  if (!listing) return res.status(404).json({ error: "Not found." });
  res.json(listing);
});

// Update (Edit) a listing
router.put("/:id", async (req, res) => {
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database unavailable." });
  try {
    const { title, description, featureBullets, keywords, priceRange, questionsForSeller, language } = req.body;
    const updated = await Listing.findByIdAndUpdate(
      req.params.id,
      { title, description, featureBullets, keywords, priceRange, questionsForSeller, language },
      { new: true }
    );
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Translate an existing listing (using its cached English version)
router.post("/:id/translate", async (req, res) => {
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "Database unavailable." });
  try {
    const { language, currency } = req.body;
    const targetLang = VALID_LANGUAGES[language.toLowerCase()];
    if (!targetLang) return res.status(400).json({ error: "Invalid language." });

    const doc = await Listing.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found." });

    // Fallback if the listing was saved before we added englishVersion tracking
    const baseListing = doc.englishVersion || {
      title: doc.title, description: doc.description, featureBullets: doc.featureBullets,
      keywords: doc.keywords, priceRange: doc.priceRange, questionsForSeller: doc.questionsForSeller
    };

    const translated = await translateListing(baseListing, targetLang, currency || "₹");
    res.json({ listing: translated, language: targetLang });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
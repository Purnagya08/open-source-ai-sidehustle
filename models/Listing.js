const mongoose = require("mongoose");

const listingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    featureBullets: { type: [String], required: true },
    keywords: { type: [String], required: true },
    priceRange: { type: String, required: true },
    questionsForSeller: { type: [String], required: true },
    language: { type: String, required: true },
    category: { type: String, required: true },
    platform: { type: String, default: null },
    // Caches the raw English output so we can re-translate without vision
    englishVersion: { type: mongoose.Schema.Types.Mixed }, 
  },
  { timestamps: true }
);

module.exports = mongoose.model("Listing", listingSchema);
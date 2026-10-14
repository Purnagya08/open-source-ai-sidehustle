const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma3";

const VALID_LANGUAGES = {
  english: "English",
  en: "English",
  hindi: "Hindi",
  hi: "Hindi",
  bengali: "Bengali",
  bn: "Bengali",
};

const LISTING_SCHEMA = {
  type: "object",
  properties: {
    isProduct: { type: "boolean" },
    reason: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    featureBullets: {
      type: "array",
      items: { type: "string" },
    },
    keywords: {
      type: "array",
      items: { type: "string" },
    },
    priceRange: { type: "string" },
    questionsForSeller: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "isProduct",
    "title",
    "description",
    "featureBullets",
    "keywords",
    "priceRange",
    "questionsForSeller",
  ],
};

const SCRIPT_RANGES = {
  Hindi: "\u0900-\u097F",
  Bengali: "\u0980-\u09FF",
};

const COMMON_ALLOWED = "0-9\u20B9\\p{P}\\p{Z}a-zA-Z";

// Short allowlist of English terms permitted in translated outputs
const ENGLISH_ALLOWLIST = new Set([
  "home", "decor", "gift", "set", "size", "design", "style", "look", 
  "free", "cm", "mm", "inch", "g", "kg", "led", "v", "w"
]);

const GLOSSARY = {
  Hindi: `jhumka = झुमका, chain = चेन, stone = पत्थर या नग, pearl-like beads = मोती जैसे दाने, set with = जड़ा हुआ, gold-tone = सुनहरे रंग का, silver-tone = चांदी के रंग का, lighthouse = लाइटहाउस, bulb = बल्ब`,
  Bengali: `jhumka = ঝুমকা, chain = চেইন, stone = পাথর, pearl-like beads = মুক্তার মতো পুঁতি, set with = খচিত, gold-tone = সোনালী রঙের, silver-tone = রূপালী রঙের, lighthouse = লাইটহাউস, bulb = বাল্ব`
};

function buildVisionPrompt(category, platform, currency) {
  const platformLine = platform
    ? `Optimise the tone and length for the "${platform}" platform.`
    : "Write a general-purpose e-commerce listing.";

  return [
    `You are a professional e-commerce product-listing writer.`,
    `You will receive one or more photos.`,
    ``,
    `STRICT PROMPT RULES:`,
    `1. NOT-A-PRODUCT GUARD: First, verify the photo shows a sellable physical product. A product being worn or held (like earrings on an ear or a bag on a shoulder) IS a valid product. Only reject if it is solely a receipt, written document, screenshot, or a person's face with no clear sellable item. If invalid, set "isProduct" to false, provide a short "reason", and leave other fields blank. If valid, set "isProduct" to true.`,
    `2. VISUAL FIDELITY & COVERAGE: Only describe features clearly visible. The "description" MUST mention every main colour and stone visible in the photos, plus shape and approximate length (e.g., short, long, layered). NEVER guess age, brand, or if an item is "handmade" or "new". NEVER name specific precious metals or gems (gold, white gold, silver, platinum, diamond, pearl) unless text in the photo explicitly states it. Instead, use neutral words like "gold-tone", "silver-tone", "metal", "stone", and "beads".`,
    `3. FEATURE BULLETS: Every bullet must be a real, visible selling point (color, shape, style, occasion). DO NOT use filler phrases (e.g., "The design features...") and DO NOT use label-style formatting (e.g., avoid "Color: Red", write "Vibrant red color").`,
    `4. TITLE FORMAT: Make titles concise (strictly under 10 words) and sound like a natural product title.`,
    `5. KEYWORDS: Provide search terms that real buyers actually search for. Must be strictly relevant to the "${category}" category (e.g., no "home decor" for jewellery).`,
    `6. PRICE RANGE: "priceRange" MUST ALWAYS be a clear numeric range with two DIFFERENT numbers (low to high) using the requested currency symbol "${currency}" (e.g., "${currency}499 - ${currency}799 (Estimated)"). Target realistic pricing for small online sellers.`,
    `7. QUESTIONS FOR SELLER: MUST include questions about critical unseen details. For jewellery/metal items, ALWAYS add a question asking the seller to confirm the exact metal, stones, and whether it is plated. NEVER ask care or maintenance questions.`,
    `8. CATEGORY & PLATFORM: The product category is "${category}". ${platformLine}`,
    ``,
    `Generate the listing in English. Return valid JSON matching the schema.`,
  ].join("\n");
}

function buildTranslationPrompt(targetLanguage, currency) {
  const glossary = GLOSSARY[targetLanguage] || "";
  return [
    `You are a professional native translator.`,
    `Translate the provided English e-commerce product listing JSON into ${targetLanguage}.`,
    ``,
    `STRICT TRANSLATION RULES:`,
    `1. SCRIPT & NATIVE LANGUAGE: Write ONLY in the ${targetLanguage} language's own script. DO NOT mix scripts inside words.`,
    `2. FAITHFUL & NATURAL TONE: Use natural, common shopkeeper-style ${targetLanguage}. Avoid unusual or literal dictionary words. If you are not sure of the exact ${targetLanguage} word for a style or product term, use a simple everyday description or keep the English word as a whole word. Never invent or transliterate rare words.`,
    `3. GLOSSARY: Use these standard terms: ${glossary}.`,
    `4. KEYWORDS: Keep common English terms ONLY if online shoppers commonly use them in ${targetLanguage} searches.`,
    `5. PRICE RANGE: Keep the "${currency}" symbol and the exact numbers. Translate the word "Estimated" into ${targetLanguage} (e.g. "${currency}499 - ${currency}799 (अनुमानित)").`,
    `6. JSON STRUCTURE: Maintain the exact same JSON keys and structure.`,
    ``,
    `Return valid JSON matching the provided schema.`,
  ].join("\n");
}

function buildCleanupPrompt(targetLanguage, currency) {
  return [
    `You are a script-cleanup editor for ${targetLanguage} product listings.`,
    `Fix the JSON so every text field uses ONLY the correct script.`,
    `Allowed extras: digits, the ${currency} symbol, punctuation, whitespace, and basic Latin letters a-z / A-Z for common English search terms.`,
    `Remove or replace any character from any other script. Do not mix scripts inside a single word. Keep the same JSON structure. Return valid JSON only.`,
  ].join("\n");
}

function getAllowedRegex(language) {
  const range = SCRIPT_RANGES[language];
  if (!range) return null;
  return new RegExp(`^[${range}${COMMON_ALLOWED}]+$`, "u");
}

function validateTranslationScript(json, language) {
  if (language === "English") return true;

  const texts = [
    json.title,
    json.description,
    json.priceRange,
    ...(json.featureBullets || []),
    ...(json.keywords || []),
    ...(json.questionsForSeller || []),
  ].filter((t) => typeof t === "string" && t.trim().length > 0);

  const targetRegex = language === "Hindi" ? /[\u0900-\u097F]/ : /[\u0980-\u09FF]/;
  const latinRegex = /[a-zA-Z]/;
  const englishInParensRegex = /\([^)]*[a-zA-Z][^)]*\)/;
  
  // Basic global script check
  const allowed = getAllowedRegex(language);

  for (const text of texts) {
    if (allowed && !allowed.test(text)) {
      console.warn(`⚠ Global invalid script char found: "${text.slice(0, 50)}…"`);
      return false;
    }

    // No English words inside parentheses
    if (englishInParensRegex.test(text)) {
      console.warn(`⚠ English inside parentheses found: "${text.slice(0, 50)}…"`);
      return false;
    }

    // Tokenize into words to check mixed-script and allowlist
    const words = text.split(/[\s,.;:!?\"'”’“‘(){}\[\]]+/);
    for (const word of words) {
      if (!word) continue;
      const hasLatin = latinRegex.test(word);
      const hasTarget = targetRegex.test(word);

      // 1. Mixed script inside a SINGLE word (e.g. "होमdecor" or "gold-टोंग")
      if (hasLatin && hasTarget) {
        console.warn(`⚠ Mixed-script word found: "${word}"`);
        return false;
      }

      // 2. Standalone Latin word must be in the short allowlist
      if (hasLatin && !hasTarget) {
        const pureWord = word.replace(/[^a-zA-Z]/g, "").toLowerCase();
        if (pureWord && !ENGLISH_ALLOWLIST.has(pureWord)) {
          console.warn(`⚠ Unauthorized English word used: "${pureWord}"`);
          return false;
        }
      }
    }
  }
  return true;
}

function fallbackInvalidFieldsToEnglish(translated, english, language) {
  const out = { ...translated };
  
  // Create a safe single-field checker
  const checkField = (val, engVal) => {
    if (typeof val !== "string" || val.trim().length === 0) return engVal ?? val;
    // We run the full validator against an isolated mock JSON to see if THIS field fails
    const mockJson = { title: val };
    const isValid = validateTranslationScript(mockJson, language);
    return isValid ? val : engVal ?? val;
  };

  out.title = checkField(out.title, english.title);
  out.description = checkField(out.description, english.description);
  out.priceRange = checkField(out.priceRange, english.priceRange);
  out.featureBullets = (out.featureBullets || []).map((b, i) => checkField(b, (english.featureBullets || [])[i]));
  out.keywords = (out.keywords || []).map((k, i) => checkField(k, (english.keywords || [])[i]));
  out.questionsForSeller = (out.questionsForSeller || []).map((q, i) => checkField(q, (english.questionsForSeller || [])[i]));

  return out;
}

// Removes empty strings, deduplicates exactly, and deduplicates keywords case-insensitively
function cleanArrays(json) {
  const cleanAndDedupe = (arr) => [
    ...new Set((arr || []).map((s) => s.trim()).filter((s) => s.length > 0))
  ];
  
  json.featureBullets = cleanAndDedupe(json.featureBullets);
  json.questionsForSeller = cleanAndDedupe(json.questionsForSeller);
  
  // Keywords need lowercasing to prevent "Decor" and "decor" from repeating
  if (json.keywords) {
    const seen = new Set();
    const uniqueKw = [];
    for (let k of json.keywords) {
      k = k.trim();
      if (!k) continue;
      const lower = k.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        uniqueKw.push(k);
      }
    }
    json.keywords = uniqueKw;
  }
  return json;
}

// Ensures the price is a valid range. If numbers are equal or missing, it widens them by 20%.
function fixPriceRange(priceStr, currency) {
  const defaultRange = `${currency}499 - ${currency}799 (Estimated)`;
  if (!priceStr) return defaultRange;

  const cleanStr = priceStr.replace(/,/g, "");
  const matches = cleanStr.match(/\d+(\.\d+)?/g);
  if (!matches || matches.length === 0) return defaultRange;

  let low = parseFloat(matches[0]);
  let high = matches.length > 1 ? parseFloat(matches[1]) : low;

  if (low === high) {
    low = Math.floor(low * 0.8);
    high = Math.ceil(high * 1.2);
    if (low === high) {
      low -= 1;
      high += 1;
    }
  } else if (low > high) {
    const temp = low;
    low = high;
    high = temp;
  }

  return `${currency}${low} - ${currency}${high} (Estimated)`;
}

async function callOllama(body) {
  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  try {
    return JSON.parse(data.message.content);
  } catch {
    throw new Error("Ollama returned invalid JSON despite structured-output format.");
  }
}

async function generateListing(imageBuffers, language, category, platform, currency = "₹") {
  const lang = VALID_LANGUAGES[language.toLowerCase()];
  if (!lang) {
    throw new Error(`Unsupported language "${language}".`);
  }

  const base64Images = imageBuffers.map((buf) => buf.toString("base64"));
  const visionBody = {
    model: OLLAMA_MODEL,
    options: { temperature: 0.3 },
    messages: [
      { role: "system", content: buildVisionPrompt(category, platform, currency) },
      { role: "user", content: "Here are the photos. Generate the listing.", images: base64Images },
    ],
    format: LISTING_SCHEMA,
    stream: false,
  };

  let englishListing = null;
  let attempts = 0;

  // STEP 1: VISION GENERATION
  while (attempts < 2) {
    attempts++;
    englishListing = await callOllama(visionBody);

    if (englishListing.isProduct === false) {
      return englishListing;
    }

    englishListing = cleanArrays(englishListing);

    if (englishListing.featureBullets.length < 3) {
      console.warn(`[Retry] Only ${englishListing.featureBullets.length} bullets found. Retrying vision...`);
      if (attempts < 2) continue;
    }

    englishListing.priceRange = fixPriceRange(englishListing.priceRange, currency);
    break;
  }

  if (lang === "English") return englishListing;

  // STEP 2: TRANSLATION
  const translationBody = {
    model: OLLAMA_MODEL,
    options: { temperature: 0.3 },
    messages: [
      { role: "system", content: buildTranslationPrompt(lang, currency) },
      { role: "user", content: `Translate this listing to ${lang}:\n\n${JSON.stringify(englishListing, null, 2)}` },
    ],
    format: LISTING_SCHEMA,
    stream: false,
  };

  let finalListing = await callOllama(translationBody);
  finalListing = cleanArrays(finalListing);
  let isValid = validateTranslationScript(finalListing, lang);

  // STEP 3: RETRY TRANSLATION
  if (!isValid) {
    console.log(`[Retry] Translation validation failed for ${lang}. Retrying once...`);
    finalListing = await callOllama(translationBody);
    finalListing = cleanArrays(finalListing);
    isValid = validateTranslationScript(finalListing, lang);
  }

  // STEP 4: CLEANUP CALL
  if (!isValid) {
    console.log(`[Cleanup] Still invalid after retry. Running script-cleanup pass...`);
    try {
      const cleanResponse = await callOllama({
        ...translationBody,
        options: { temperature: 0.2 },
        messages: [
          { role: "system", content: buildCleanupPrompt(lang, currency) },
          { role: "user", content: `Clean this JSON:\n\n${JSON.stringify(finalListing, null, 2)}` },
        ],
      });
      finalListing = cleanArrays(cleanResponse);
      isValid = validateTranslationScript(finalListing, lang);
    } catch (e) {
      console.warn("⚠ Cleanup failed:", e.message);
    }
  }

  // STEP 5: ENGLISH FALLBACK
  if (!isValid) {
    console.warn(`[Fallback] Replacing bad fields with English.`);
    finalListing = fallbackInvalidFieldsToEnglish(finalListing, englishListing, lang);
  }

  return finalListing;
}

module.exports = { generateListing, VALID_LANGUAGES };
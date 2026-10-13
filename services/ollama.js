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
    title: { type: "string" },
    description: { type: "string" },
    featureBullets: {
      type: "array",
      items: { type: "string" },
      minItems: 5,
      maxItems: 5,
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
    "title",
    "description",
    "featureBullets",
    "keywords",
    "priceRange",
    "questionsForSeller",
  ],
};

// Allowed: target script + digits + ₹ + punctuation + whitespace + basic Latin (a-zA-Z)
const SCRIPT_RANGES = {
  Hindi: "\u0900-\u097F", // Devanagari only
  Bengali: "\u0980-\u09FF", // Bengali only
};

const COMMON_ALLOWED = "0-9\u20B9\\p{P}\\p{Z}a-zA-Z";

function buildVisionPrompt(category, platform, currency) {
  const platformLine = platform
    ? `Optimise the tone and length for the "${platform}" platform.`
    : "Write a general-purpose e-commerce listing.";

  return [
    `You are a professional e-commerce product-listing writer.`,
    `You will receive one or more photos of a product.`,
    `Generate a complete listing in English based ONLY on what is clearly visible in the photos.`,
    ``,
    `STRICT PROMPT RULES:`,
    `1. VISUAL FIDELITY: Only describe features clearly visible in the photos. NEVER guess, assume, or fabricate the item's age, brand, or material. NEVER guess if an item is "handmade", "new", or "unused".`,
    `2. TITLE FORMAT: Make titles concise (strictly under 10 words) and sound like a natural product title created by an active e-commerce seller.`,
    `3. KEYWORDS: Provide search terms that real buyers actually search for (including common English terms like "home decor" where Indian shoppers use them).`,
    `4. PRICE RANGE: "priceRange" MUST ALWAYS be a clear numeric range using the requested currency symbol "${currency}" (e.g., "${currency}499 - ${currency}799 (Estimated)"). Target realistic pricing for small online sellers in India. NEVER output words like "negotiable", "contact seller", or non-numeric placeholders.`,
    `5. QUESTIONS FOR SELLER: "questionsForSeller" MUST ONLY include questions about details critical for a buyer to make a purchase decision (e.g., exact dimensions/size, weight, specific material details, customization options, or delivery). NEVER ask care, cleaning, or maintenance questions.`,
    `6. CATEGORY & PLATFORM: The product category is "${category}". ${platformLine}`,
    ``,
    `Return valid JSON matching the provided schema.`,
  ].join("\n");
}

function buildTranslationPrompt(targetLanguage, currency) {
  return [
    `You are a professional native translator.`,
    `Translate the provided English e-commerce product listing JSON into ${targetLanguage}.`,
    ``,
    `STRICT TRANSLATION RULES:`,
    `1. SCRIPT & NATIVE LANGUAGE: Write ONLY in the ${targetLanguage} language's own script. For Hindi use only Devanagari. For Bengali use only Bengali script. DO NOT use Chinese characters, Gujarati, or any other scripts. DO NOT mix scripts inside words.`,
    `2. FAITHFUL TRANSLATION: Translate exactly. Do not add, remove, or generalize any detail. If the English says lighthouse, use the exact word for lighthouse, not landmark. Do not add words like LED, handmade, or new. Use simple, natural wording that everyday shopkeepers use, and correct grammar.`,
    `3. KEYWORDS EXCEPTION: The "keywords" array may keep common English terms (like "home decor") ONLY if online shoppers commonly use them in ${targetLanguage} searches.`,
    `4. PRICE RANGE: Keep the "${currency}" symbol exactly as is. Translate the word "Estimated" into ${targetLanguage}, keeping the exact numeric range formatting (e.g. "${currency}499 - ${currency}799 (अनुमानित)").`,
    `5. JSON STRUCTURE: Maintain the exact same JSON keys and structure as the original input.`,
    ``,
    `Return valid JSON matching the provided schema.`,
  ].join("\n");
}

function buildCleanupPrompt(targetLanguage, currency) {
  return [
    `You are a script-cleanup editor for ${targetLanguage} product listings.`,
    `Fix the JSON so every text field uses ONLY the correct script.`,
    ``,
    `RULES:`,
    `1. Hindi → Devanagari only (U+0900–U+097F). Bengali → Bengali script only (U+0980–U+09FF).`,
    `2. Allowed extras: digits, the ${currency} symbol, punctuation, whitespace, and basic Latin letters a-z / A-Z for common English search terms.`,
    `3. Remove or replace any character from any other script (Chinese, Gujarati, Arabic, etc.).`,
    `4. Do not add, remove, or invent product details. Keep meaning faithful.`,
    `5. Keep the same JSON structure and keys.`,
    ``,
    `Return valid JSON only.`,
  ].join("\n");
}

function getAllowedRegex(language) {
  const range = SCRIPT_RANGES[language];
  if (!range) return null;
  // Target script + digits + ₹ + punctuation + whitespace + basic Latin
  return new RegExp(`^[${range}${COMMON_ALLOWED}]+$`, "u");
}

/**
 * Returns true if every text field uses only the allowed character set.
 * Latin letters are allowed (for English keywords/terms); other scripts are not.
 */
function validateTranslationScript(json, language) {
  if (language === "English") return true;

  const allowed = getAllowedRegex(language);
  if (!allowed) return true;

  const texts = [
    json.title,
    json.description,
    json.priceRange,
    ...(json.featureBullets || []),
    ...(json.keywords || []),
    ...(json.questionsForSeller || []),
  ].filter((t) => typeof t === "string" && t.length > 0);

  for (const text of texts) {
    if (!allowed.test(text)) {
      console.warn(
        `⚠ Invalid script in field value: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`
      );
      return false;
    }
  }
  return true;
}

/**
 * For each field that still has disallowed script chars, fall back to English.
 */
function fallbackInvalidFieldsToEnglish(translated, english, language) {
  const allowed = getAllowedRegex(language);
  if (!allowed) return translated;

  const out = { ...translated };

  const check = (val, engVal) => {
    if (typeof val !== "string" || val.length === 0) return engVal ?? val;
    return allowed.test(val) ? val : engVal ?? val;
  };

  out.title = check(out.title, english.title);
  out.description = check(out.description, english.description);
  out.priceRange = check(out.priceRange, english.priceRange);

  out.featureBullets = (out.featureBullets || []).map((b, i) =>
    check(b, (english.featureBullets || [])[i])
  );
  out.keywords = (out.keywords || []).map((k, i) =>
    check(k, (english.keywords || [])[i])
  );
  out.questionsForSeller = (out.questionsForSeller || []).map((q, i) =>
    check(q, (english.questionsForSeller || [])[i])
  );

  return out;
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
    throw new Error(
      "Ollama returned invalid JSON despite structured-output format."
    );
  }
}

/**
 * @param {Buffer[]} imageBuffers - 1-4 raw image buffers
 * @param {string} language - "English" | "Hindi" | "Bengali"
 * @param {string} category
 * @param {string|null} platform
 * @param {string} currency - default "₹"
 * @returns {Promise<object>} parsed listing object
 */
async function generateListing(
  imageBuffers,
  language,
  category,
  platform,
  currency = "₹"
) {
  const lang = VALID_LANGUAGES[language.toLowerCase()];
  if (!lang) {
    throw new Error(
      `Unsupported language "${language}". Use English, Hindi, or Bengali.`
    );
  }

  const base64Images = imageBuffers.map((buf) => buf.toString("base64"));

  // ==========================================
  // STEP 1: VISION GENERATION (ENGLISH)
  // ==========================================
  const visionBody = {
    model: OLLAMA_MODEL,
    options: { temperature: 0.3 },
    messages: [
      {
        role: "system",
        content: buildVisionPrompt(category, platform, currency),
      },
      {
        role: "user",
        content:
          "Here are the product photos. Generate the listing in English now.",
        images: base64Images,
      },
    ],
    format: LISTING_SCHEMA,
    stream: false,
  };

  const englishListing = await callOllama(visionBody);

  if (lang === "English") {
    return englishListing;
  }

  // ==========================================
  // STEP 2: TEXT TRANSLATION
  // ==========================================
  const translationBody = {
    model: OLLAMA_MODEL,
    options: { temperature: 0.3 },
    messages: [
      {
        role: "system",
        content: buildTranslationPrompt(lang, currency),
      },
      {
        role: "user",
        content: `Translate this e-commerce listing JSON to ${lang}:\n\n${JSON.stringify(
          englishListing,
          null,
          2
        )}`,
      },
    ],
    format: LISTING_SCHEMA,
    stream: false,
  };

  let finalListing = await callOllama(translationBody);
  let isValid = validateTranslationScript(finalListing, lang);

  // ==========================================
  // STEP 3: RETRY TRANSLATION ONCE
  // ==========================================
  if (!isValid) {
    console.log(
      `[Retry] Translation validation failed for ${lang}. Retrying once...`
    );
    finalListing = await callOllama(translationBody);
    isValid = validateTranslationScript(finalListing, lang);
  }

  // ==========================================
  // STEP 4: CLEANUP CALL (if still invalid)
  // ==========================================
  if (!isValid) {
    console.log(
      `[Cleanup] Still invalid after retry. Running script-cleanup pass...`
    );
    const cleanupBody = {
      model: OLLAMA_MODEL,
      options: { temperature: 0.2 },
      messages: [
        {
          role: "system",
          content: buildCleanupPrompt(lang, currency),
        },
        {
          role: "user",
          content: `Clean this ${lang} listing JSON:\n\n${JSON.stringify(
            finalListing,
            null,
            2
          )}`,
        },
      ],
      format: LISTING_SCHEMA,
      stream: false,
    };

    try {
      finalListing = await callOllama(cleanupBody);
      isValid = validateTranslationScript(finalListing, lang);
    } catch (cleanupErr) {
      console.warn("⚠ Cleanup call failed:", cleanupErr.message);
    }
  }

  // ==========================================
  // STEP 5: FIELD-LEVEL ENGLISH FALLBACK
  // ==========================================
  if (!isValid) {
    console.warn(
      `[Fallback] Cleanup still invalid. Replacing bad fields with English.`
    );
    finalListing = fallbackInvalidFieldsToEnglish(
      finalListing,
      englishListing,
      lang
    );
  }

  return finalListing;
}

module.exports = { generateListing, VALID_LANGUAGES };
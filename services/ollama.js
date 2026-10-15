const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma3";
const OLLAMA_TIMEOUT_MS = 3 * 60 * 1000;

const VALID_LANGUAGES = {
  english: "English", en: "English",
  hindi: "Hindi", hi: "Hindi",
  bengali: "Bengali", bn: "Bengali",
};

const LISTING_SCHEMA = {
  type: "object",
  properties: {
    isProduct: { type: "boolean" },
    reason: { type: "string" },
    title: { type: "string" },
    description: { type: "string" },
    featureBullets: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" } },
    priceRange: { type: "string" },
    questionsForSeller: { type: "array", items: { type: "string" } },
  },
  required: ["isProduct", "title", "description", "featureBullets", "keywords", "priceRange", "questionsForSeller"],
};

const SCRIPT_RANGES = { Hindi: "\u0900-\u097F", Bengali: "\u0980-\u09FF" };
const COMMON_ALLOWED = "0-9\u20B9\\p{P}\\p{Z}a-zA-Z";
const ENGLISH_ALLOWLIST = new Set(["home", "decor", "gift", "set", "size", "design", "style", "look", "free", "cm", "mm", "inch", "g", "kg", "led", "v", "w"]);

const GLOSSARY = {
  Hindi: `jhumka = झुमका, chain = चेन, stone = पत्थर या नग, pearl-like beads = मोती जैसे दाने, set with = जड़ा हुआ, gold-tone = सुनहरे रंग का, silver-tone = चांदी के रंग का, lighthouse = लाइटहाउस, bulb = बल्ब`,
  Bengali: `jhumka = ঝুমকা, chain = চেইন, stone = পাথর, pearl-like beads = মুক্তার মতো পুঁতি, set with = খচিত, gold-tone = সোনালী রঙের, silver-tone = রূপালী রঙের, lighthouse = লাইটহাউস, bulb = বাল্ব`,
};

function buildVisionPrompt(category, platform, currency) {
  const platformLine = platform ? `Optimise tone for "${platform}".` : "Write a general-purpose e-commerce listing.";
  return [
    `You are a professional e-commerce product-listing writer.`,
    `STRICT PROMPT RULES:`,
    `1. NOT-A-PRODUCT GUARD: Verify the photo shows a sellable physical product (worn/held items are valid). Reject if solely a receipt, document, screenshot, or face. If invalid, set "isProduct" to false and provide a "reason". If valid, set to true.`,
    `2. VISUAL FIDELITY & PARTS: Describe ONLY what is clearly visible. NEVER mention unseen attachments, clasps, ear hooks, or backs unless explicitly visible in the photo.`,
    `3. MATERIALS & PRICING: NEVER state a metal or gem as fact (e.g., gold, silver, platinum, diamond, pearl) unless text in the photo explicitly says so. ALWAYS use "gold-tone", "silver-tone", "pearl-like beads", and "stone" in the title, description, bullets, and keywords. Base the "priceRange" on a fashion-jewellery (imitation) assumption unless text proves otherwise.`,
    `4. MEASUREMENTS: NEVER state exact sizes, lengths, or weights (no cm, mm, inch, grams). Use relative terms only (e.g., short, long, large, small, layered). ALWAYS ask the seller for exact dimensions in "questionsForSeller".`,
    `5. DESCRIPTION FORMAT: Write the "description" as a short, flowing paragraph. DO NOT put bullets or lists in the description.`,
    `6. FEATURE BULLETS: Must be real, visible selling points. No filler phrases.`,
    `7. TITLE FORMAT: Concise, strictly under 10 words.`,
    `8. KEYWORDS: Search terms real buyers use. Must fit the "${category}" category.`,
    `9. PRICE RANGE: Clear numeric range with two DIFFERENT numbers using "${currency}".`,
    `10. QUESTIONS FOR SELLER: Ask about critical unseen details (exact metal, plating, dimensions, weight). Never ask care questions.`,
    `11. CATEGORY: "${category}". ${platformLine}`,
    `Generate in English. Return valid JSON.`
  ].join("\n");
}

function buildTranslationPrompt(targetLanguage, currency) {
  return [
    `You are a professional native translator. Translate this English e-commerce JSON into ${targetLanguage}.`,
    `STRICT RULES:`,
    `1. SCRIPT: Write ONLY in the ${targetLanguage} script. DO NOT mix scripts inside words.`,
    `2. FAITHFUL & MATERIALS: Natural shopkeeper-style ${targetLanguage}. Do not convert "gold-tone" into real gold, use the glossary terms. Keep English words whole if translation is rare.`,
    `3. GLOSSARY: Use these standard terms: ${GLOSSARY[targetLanguage] || ""}.`,
    `4. KEYWORDS: Keep common English terms ONLY if commonly searched.`,
    `5. PRICE RANGE: Keep the "${currency}" symbol exactly. Translate "Estimated".`,
    `6. JSON STRUCTURE: Maintain exact keys. Return valid JSON.`
  ].join("\n");
}

function buildCleanupPrompt(targetLanguage, currency) {
  return [
    `You are a script-cleanup editor for ${targetLanguage} listings. Fix the JSON so every text field uses ONLY the correct script.`,
    `Allowed extras: digits, ${currency}, punctuation, whitespace, basic Latin for English search terms.`,
    `Return valid JSON only.`
  ].join("\n");
}

function getAllowedRegex(language) {
  const range = SCRIPT_RANGES[language];
  return range ? new RegExp(`^[${range}${COMMON_ALLOWED}]+$`, "u") : null;
}

function validateTranslationScript(json, language) {
  if (language === "English") return true;
  const texts = [
    json.title, json.description, json.priceRange,
    ...(json.featureBullets || []), ...(json.keywords || []), ...(json.questionsForSeller || []),
  ].filter(t => typeof t === "string" && t.trim());

  const targetRegex = language === "Hindi" ? /[\u0900-\u097F]/ : /[\u0980-\u09FF]/;
  const allowed = getAllowedRegex(language);

  for (const text of texts) {
    if (allowed && !allowed.test(text)) return false;
    if (/\([^)]*[a-zA-Z][^)]*\)/.test(text)) return false; // English in parens
    
    const words = text.split(/[\s,.;:!?\"'”’“‘(){}\[\]]+/);
    for (const word of words) {
      if (!word) continue;
      const hasLatin = /[a-zA-Z]/.test(word);
      const hasTarget = targetRegex.test(word);
      if (hasLatin && hasTarget) return false;
      if (hasLatin && !hasTarget) {
        const pureWord = word.replace(/[^a-zA-Z]/g, "").toLowerCase();
        if (pureWord && !ENGLISH_ALLOWLIST.has(pureWord)) return false;
      }
    }
  }
  return true;
}

function fallbackInvalidFieldsToEnglish(translated, english, language) {
  const out = { ...translated };
  const checkField = (val, engVal) => {
    if (typeof val !== "string" || !val.trim()) return engVal ?? val;
    return validateTranslationScript({ title: val }, language) ? val : (engVal ?? val);
  };
  out.title = checkField(out.title, english.title);
  out.description = checkField(out.description, english.description);
  out.priceRange = checkField(out.priceRange, english.priceRange);
  out.featureBullets = (out.featureBullets || []).map((b, i) => checkField(b, (english.featureBullets || [])[i]));
  out.keywords = (out.keywords || []).map((k, i) => checkField(k, (english.keywords || [])[i]));
  out.questionsForSeller = (out.questionsForSeller || []).map((q, i) => checkField(q, (english.questionsForSeller || [])[i]));
  return out;
}

function cleanArrays(json) {
  const cleanAndDedupe = (arr) => [...new Set((arr || []).map(s => s.trim()).filter(Boolean))];
  json.featureBullets = cleanAndDedupe(json.featureBullets);
  json.questionsForSeller = cleanAndDedupe(json.questionsForSeller);
  if (json.keywords) {
    const seen = new Set();
    const uniqueKw = [];
    for (let k of json.keywords) {
      k = k.trim();
      if (!k || seen.has(k.toLowerCase())) continue;
      seen.add(k.toLowerCase());
      uniqueKw.push(k);
    }
    json.keywords = uniqueKw;
  }
  return json;
}

function fixPriceRange(priceStr, currency) {
  const defaultRange = `${currency}499 - ${currency}799 (Estimated)`;
  if (!priceStr) return defaultRange;
  const matches = priceStr.replace(/,/g, "").match(/\d+(\.\d+)?/g);
  if (!matches) return defaultRange;
  let low = parseFloat(matches[0]);
  let high = matches.length > 1 ? parseFloat(matches[1]) : low;
  if (low === high) {
    low = Math.floor(low * 0.8);
    high = Math.ceil(high * 1.2);
    if (low === high) { low -= 1; high += 1; }
  } else if (low > high) {
    const temp = low; low = high; high = temp;
  }
  return `${currency}${low} - ${currency}${high} (Estimated)`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = OLLAMA_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Ollama timed out. Wait a bit and try again.");
    throw new Error("Cannot reach Ollama. Start the Ollama app.");
  } finally {
    clearTimeout(timer);
  }
}

async function callOllama(body) {
  const response = await fetchWithTimeout(`${OLLAMA_HOST}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Ollama error (${response.status})`);
  const data = await response.json();
  try { return JSON.parse(data.message.content); } 
  catch { throw new Error("Ollama returned invalid JSON."); }
}

async function checkOllamaHealth() {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_HOST}/api/tags`, { method: "GET" }, 8000);
    if (!res.ok) return { ollamaReachable: false, modelInstalled: false, model: OLLAMA_MODEL, message: "Error" };
    const data = await res.json();
    const installed = (data.models || []).some(m => m.name.startsWith(OLLAMA_MODEL.split(":")[0]));
    if (!installed) return { ollamaReachable: true, modelInstalled: false, model: OLLAMA_MODEL, message: `Run: ollama pull ${OLLAMA_MODEL}` };
    return { ollamaReachable: true, modelInstalled: true, model: OLLAMA_MODEL, message: "Model ready" };
  } catch (err) {
    return { ollamaReachable: false, modelInstalled: false, model: OLLAMA_MODEL, message: err.message };
  }
}

async function translateListing(englishListing, language, currency = "₹") {
  const lang = VALID_LANGUAGES[language.toLowerCase()];
  if (!lang) throw new Error(`Unsupported language "${language}".`);
  if (lang === "English") return englishListing;

  const body = {
    model: OLLAMA_MODEL, options: { temperature: 0.3 }, format: LISTING_SCHEMA, stream: false,
    messages: [
      { role: "system", content: buildTranslationPrompt(lang, currency) },
      { role: "user", content: `Translate this listing to ${lang}:\n\n${JSON.stringify(englishListing, null, 2)}` },
    ],
  };

  let finalListing = cleanArrays(await callOllama(body));
  if (validateTranslationScript(finalListing, lang)) return finalListing;

  finalListing = cleanArrays(await callOllama(body)); // Retry
  if (validateTranslationScript(finalListing, lang)) return finalListing;

  try {
    const cleanBody = { ...body, options: { temperature: 0.2 }, messages: [
      { role: "system", content: buildCleanupPrompt(lang, currency) },
      { role: "user", content: `Clean this JSON:\n\n${JSON.stringify(finalListing, null, 2)}` },
    ]};
    finalListing = cleanArrays(await callOllama(cleanBody));
  } catch (e) { /* ignore cleanup fail */ }

  if (!validateTranslationScript(finalListing, lang)) {
    finalListing = fallbackInvalidFieldsToEnglish(finalListing, englishListing, lang);
  }
  return finalListing;
}

async function generateListing(imageBuffers, language, category, platform, currency = "₹") {
  const base64Images = imageBuffers.map(buf => buf.toString("base64"));
  const visionBody = {
    model: OLLAMA_MODEL, options: { temperature: 0.3 }, format: LISTING_SCHEMA, stream: false,
    messages: [
      { role: "system", content: buildVisionPrompt(category, platform, currency) },
      { role: "user", content: "Generate the listing.", images: base64Images },
    ],
  };

  let englishListing = null;
  let attempts = 0;
  while (attempts++ < 2) {
    englishListing = cleanArrays(await callOllama(visionBody));
    if (englishListing.isProduct === false) return { listing: englishListing, englishListing: null };
    if (englishListing.featureBullets.length >= 3) break;
  }
  englishListing.priceRange = fixPriceRange(englishListing.priceRange, currency);

  const finalListing = await translateListing(englishListing, language, currency);
  return { listing: finalListing, englishListing };
}

module.exports = { generateListing, translateListing, VALID_LANGUAGES, checkOllamaHealth, OLLAMA_MODEL };
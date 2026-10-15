// ======================= STATE =======================
let selectedFiles = [];
const MAX_FILES = 4;
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.8;
let ollamaReady = false;
let healthTimer = null;

// ======================= TAB NAV =======================
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

function switchView(view) {
  document.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );
  document.querySelectorAll(".view").forEach((v) =>
    v.classList.toggle("active", v.id === `view-${view}`)
  );
  if (view === "history") loadHistory();
}

// ======================= OLLAMA HEALTH =======================
async function refreshHealth() {
  const chip = document.getElementById("status-chip");
  const text = document.getElementById("status-text");
  const hint = document.getElementById("ollama-hint");
  const btn = document.getElementById("generate-btn");

  try {
    const res = await fetch("/api/health");
    const data = await res.json();

    ollamaReady = !!(data.ollamaReachable && data.modelInstalled);

    chip.classList.remove("checking", "ready", "down");
    if (ollamaReady) {
      chip.classList.add("ready");
      text.textContent = "Model ready";
      chip.title = data.message || "Model ready";
      hint.classList.add("hidden");
      hint.textContent = "";
    } else {
      chip.classList.add("down");
      if (!data.ollamaReachable) {
        text.textContent = "Ollama off";
        hint.textContent =
          "Ollama is not running. Open the Ollama app (or run ollama serve), then wait a few seconds.";
      } else {
        text.textContent = "Model missing";
        hint.textContent =
          data.message ||
          `Run: ollama pull ${data.model || "gemma3"}`;
      }
      hint.classList.remove("hidden");
      chip.title = data.message || "Ollama not ready";
    }
  } catch {
    ollamaReady = false;
    chip.classList.remove("checking", "ready");
    chip.classList.add("down");
    text.textContent = "Server off";
    hint.textContent =
      "Cannot reach the API. Is npm run dev still running?";
    hint.classList.remove("hidden");
  }

  // Don't enable while a generation is in progress (btn already disabled then)
  const loading = document.getElementById("loading");
  const busy = loading && !loading.classList.contains("hidden");
  btn.disabled = !ollamaReady || busy;
}

function startHealthPolling() {
  refreshHealth();
  if (healthTimer) clearInterval(healthTimer);
  // Re-check every 15s so the dot turns green after user starts Ollama
  healthTimer = setInterval(refreshHealth, 15000);
}

startHealthPolling();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshHealth();
});

// ======================= IMAGE COMPRESSION =======================
function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith("image/")) {
      reject(new Error("Only image files are allowed."));
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;
      const longest = Math.max(width, height);

      if (longest > MAX_EDGE) {
        const scale = MAX_EDGE / longest;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not process this image. Try another photo."));
        return;
      }

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(
              new Error("Could not compress this image. Try another photo.")
            );
            return;
          }
          const base =
            (file.name || "photo").replace(/\.[^.]+$/, "") || "photo";
          resolve(
            new File([blob], `${base}.jpg`, {
              type: "image/jpeg",
              lastModified: Date.now(),
            })
          );
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error("This file is not a valid image. Please choose a photo.")
      );
    };

    img.src = url;
  });
}

// ======================= FILE PICKER =======================
document.getElementById("camera-input").addEventListener("change", handleFiles);
document.getElementById("gallery-input").addEventListener("change", handleFiles);

async function handleFiles(e) {
  const incoming = Array.from(e.target.files || []);
  e.target.value = "";

  if (!incoming.length) return;

  document.getElementById("error").classList.add("hidden");

  for (const file of incoming) {
    if (selectedFiles.length >= MAX_FILES) break;

    if (!file.type || !file.type.startsWith("image/")) {
      showError(
        "Only image files are allowed. Please choose a photo from camera or gallery."
      );
      continue;
    }

    try {
      selectedFiles.push(await compressImage(file));
    } catch (err) {
      showError(err.message || "Could not read that image. Try another photo.");
    }
  }

  renderPreviews();
}

function renderPreviews() {
  const container = document.getElementById("previews");
  container.innerHTML = "";
  selectedFiles.forEach((file, idx) => {
    const url = URL.createObjectURL(file);
    const div = document.createElement("div");
    div.className = "preview-item";
    div.innerHTML = `
      <img src="${url}" alt="preview" />
      <button type="button" class="remove" data-idx="${idx}" aria-label="Remove">✕</button>
    `;
    container.appendChild(div);
  });
  container.querySelectorAll(".remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.currentTarget.dataset.idx, 10);
      selectedFiles.splice(idx, 1);
      renderPreviews();
    });
  });
  document.getElementById("photo-count").textContent =
    `${selectedFiles.length} / ${MAX_FILES} photos selected`;
}

// ======================= GENERATE =======================
document.getElementById("generate-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!ollamaReady) {
    showError(
      "Ollama is not ready. Start Ollama and wait until the status dot turns green."
    );
    refreshHealth();
    return;
  }

  if (selectedFiles.length === 0) {
    showError("Please add at least one photo.");
    return;
  }

  const btn = document.getElementById("generate-btn");
  const loading = document.getElementById("loading");
  const errorBox = document.getElementById("error");
  const resultBox = document.getElementById("result");

  errorBox.classList.add("hidden");
  resultBox.classList.add("hidden");
  resultBox.innerHTML = "";
  loading.classList.remove("hidden");
  btn.disabled = true;

  const fd = new FormData();
  selectedFiles.forEach((f) => fd.append("images", f));
  fd.append("language", document.getElementById("language").value);
  fd.append("category", document.getElementById("category").value);
  const platform = document.getElementById("platform").value;
  if (platform) fd.append("platform", platform);

  try {
    const res = await fetch("/api/listings/generate", {
      method: "POST",
      body: fd,
    });

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("Server returned an unexpected response. Please try again.");
    }

    if (!res.ok) {
      if (res.status === 503) {
        throw new Error(
          data.error ||
            "Ollama is not responding or timed out. Make sure Ollama is running and try again."
        );
      }
      throw new Error(data.error || "Something went wrong. Please try again.");
    }

    if (data.listing && data.listing.isProduct === false) {
      showError(
        `This doesn't look like a product photo. Please upload a clear photo of the item you want to sell.${
          data.listing.reason ? ` (${data.listing.reason})` : ""
        }`
      );
      return;
    }

    renderResult(data.listing, resultBox);
    resultBox.classList.remove("hidden");
  } catch (err) {
    showError(err.message || "Request failed. Please try again.");
    refreshHealth();
  } finally {
    loading.classList.add("hidden");
    btn.disabled = !ollamaReady;
  }
});

function showError(msg) {
  const box = document.getElementById("error");
  box.textContent = msg;
  box.classList.remove("hidden");
}

// ======================= RENDER RESULT =======================
function renderResult(listing, container) {
  container.innerHTML = "";

  if (listing.title && listing.title.trim()) {
    container.appendChild(makeCard("Title", listing.title, listing.title));
  }

  if (listing.description && listing.description.trim()) {
    container.appendChild(
      makeCard("Description", listing.description, listing.description)
    );
  }

  const bulletsRaw = (listing.featureBullets || []).filter((b) => b.trim());
  if (bulletsRaw.length > 0) {
    const bulletsHtml =
      "<ul>" +
      bulletsRaw.map((b) => `<li>${escapeHtml(b)}</li>`).join("") +
      "</ul>";
    const bulletsText = bulletsRaw.map((b) => `• ${b}`).join("\n");
    container.appendChild(
      makeCard("Feature Bullets", bulletsHtml, bulletsText, true)
    );
  }

  const kwRaw = (listing.keywords || []).filter((k) => k.trim());
  if (kwRaw.length > 0) {
    const kwHtml =
      `<div class="chip-row">` +
      kwRaw.map((k) => `<span class="chip">${escapeHtml(k)}</span>`).join("") +
      `</div>`;
    container.appendChild(makeCard("Keywords", kwHtml, kwRaw.join(", "), true));
  }

  if (listing.priceRange && listing.priceRange.trim()) {
    const priceHtml = `${escapeHtml(
      listing.priceRange
    )}<span class="price-estimate">This is an estimate — adjust based on your costs.</span>`;
    container.appendChild(
      makeCard("Price Range", priceHtml, listing.priceRange, true)
    );
  }

  const qRaw = (listing.questionsForSeller || []).filter((q) => q.trim());
  if (qRaw.length > 0) {
    const qHtml =
      "<ol>" + qRaw.map((q) => `<li>${escapeHtml(q)}</li>`).join("") + "</ol>";
    const qText = qRaw.map((q, i) => `${i + 1}. ${q}`).join("\n");
    container.appendChild(
      makeCard("Questions For Seller", qHtml, qText, true)
    );
  }

  // --- WhatsApp & Copy Action Row ---
  const actions = document.createElement("div");
  actions.className = "result-actions";

  const shareBtn = document.createElement("a");
  shareBtn.className = "whatsapp-btn";
  shareBtn.textContent = "Share on WhatsApp";
  shareBtn.href = buildWhatsAppShareUrl(listing);
  shareBtn.target = "_blank";
  shareBtn.rel = "noopener noreferrer";
  shareBtn.setAttribute("role", "button");
  actions.appendChild(shareBtn);

  const copyAll = document.createElement("button");
  copyAll.type = "button";
  copyAll.className = "copy-all-btn";
  copyAll.textContent = "Copy Full Listing";
  copyAll.addEventListener("click", () => {
    copyToClipboard(buildFullText(listing), copyAll, "✓ Copied Full Listing");
  });
  actions.appendChild(copyAll);

  container.appendChild(actions);
}

function makeCard(label, bodyContent, copyText, isHtml = false) {
  const card = document.createElement("div");
  card.className = "card";
  const body = isHtml ? bodyContent : escapeHtml(bodyContent);
  card.innerHTML = `
    <div class="card-header">
      <h3>${label}</h3>
      <button class="copy-btn" type="button">Copy</button>
    </div>
    <div class="card-body">${body}</div>
  `;
  card
    .querySelector(".copy-btn")
    .addEventListener("click", (e) =>
      copyToClipboard(copyText, e.currentTarget, "✓ Copied")
    );
  return card;
}

// --- WhatsApp & Copy Text Builders ---
function buildFullText(l) {
  const parts = [];
  if (l.title) parts.push(l.title, "");
  if (l.description) parts.push(l.description, "");
  
  const bulletsRaw = (l.featureBullets || []).filter((b) => b.trim());
  if (bulletsRaw.length) parts.push("FEATURES:", ...bulletsRaw.map((b) => `• ${b}`), "");
  
  if (l.priceRange) parts.push(`PRICE: ${l.priceRange}`, "");
  
  const kwRaw = (l.keywords || []).filter((k) => k.trim());
  if (kwRaw.length) parts.push("KEYWORDS: " + kwRaw.join(", "), "");
  
  const qRaw = (l.questionsForSeller || []).filter((q) => q.trim());
  if (qRaw.length) parts.push("QUESTIONS FOR SELLER:", ...qRaw.map((q, i) => `${i + 1}. ${q}`));
  
  return parts.join("\n").trim();
}

function buildWhatsAppShareText(l) {
  const parts = [];
  if (l.title) parts.push(`*${l.title}*`, "");
  if (l.description) parts.push(l.description, "");

  const bulletsRaw = (l.featureBullets || []).filter((b) => b.trim());
  if (bulletsRaw.length > 0) {
    parts.push(...bulletsRaw.map((b) => `• ${b}`), "");
  }

  if (l.priceRange) {
    parts.push(`💰 ${l.priceRange}`);
  }

  return parts.join("\n").trim();
}

function buildWhatsAppShareUrl(listing) {
  const text = buildWhatsAppShareText(listing);
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// --- Clipboard Helper ---
async function copyToClipboard(text, btn, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {}
    document.body.removeChild(ta);
  }
  const original = btn.textContent;
  btn.textContent = successMsg;
  btn.classList.add("copied");
  setTimeout(() => {
    btn.textContent = original;
    btn.classList.remove("copied");
  }, 1600);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ======================= HISTORY =======================
async function loadHistory() {
  const listEl = document.getElementById("history-list");
  const statusEl = document.getElementById("history-status");
  const detailEl = document.getElementById("history-detail");
  detailEl.classList.add("hidden");
  detailEl.innerHTML = "";
  listEl.innerHTML = "";
  statusEl.textContent = "Loading...";

  try {
    const res = await fetch("/api/listings");
    if (!res.ok) {
      statusEl.textContent =
        res.status === 503
          ? "Database is not available. Saved listings cannot be shown right now."
          : "Could not load history.";
      return;
    }
    const items = await res.json();
    if (!items.length) {
      statusEl.textContent =
        "No saved listings yet. Generate one to see it here.";
      return;
    }
    statusEl.textContent = "";
    items.forEach((item) => {
      const div = document.createElement("div");
      div.className = "history-item";
      const date = new Date(item.createdAt).toLocaleString();
      div.innerHTML = `
        <div class="title">${escapeHtml(item.title)}</div>
        <div class="meta">
          ${escapeHtml(item.language)} · ${escapeHtml(item.category)}
          ${item.platform ? "· " + escapeHtml(item.platform) : ""}
          · ${escapeHtml(date)}
        </div>
      `;
      div.addEventListener("click", () => showHistoryDetail(item));
      listEl.appendChild(div);
    });
  } catch {
    statusEl.textContent = "Could not load history. Is the server running?";
  }
}

function showHistoryDetail(listing) {
  document.getElementById("history-list").innerHTML = "";
  document.getElementById("history-status").textContent = "";
  const detailEl = document.getElementById("history-detail");
  detailEl.innerHTML = "";

  const back = document.createElement("button");
  back.className = "back-btn";
  back.textContent = "← Back to list";
  back.addEventListener("click", loadHistory);
  detailEl.appendChild(back);

  // 1. Language Translation Bar
  const transBar = document.createElement("div");
  transBar.className = "translate-bar";
  transBar.innerHTML = `
    <select id="hist-lang">
      <option value="English" ${listing.language === 'English' ? 'selected' : ''}>English</option>
      <option value="Hindi" ${listing.language === 'Hindi' ? 'selected' : ''}>Hindi</option>
      <option value="Bengali" ${listing.language === 'Bengali' ? 'selected' : ''}>Bengali (experimental)</option>
    </select>
    <button id="hist-trans-btn" class="secondary-btn">Regenerate Language</button>
  `;
  detailEl.appendChild(transBar);

  // 2. Editable Form
  const form = document.createElement("form");
  form.className = "edit-form";
  form.innerHTML = `
    <div class="field"><label>Title</label>
      <input type="text" id="edit-title" value="${escapeHtml(listing.title)}" required>
    </div>
    <div class="field"><label>Description</label>
      <textarea id="edit-desc" rows="4" required>${escapeHtml(listing.description)}</textarea>
    </div>
    <div class="field"><label>Feature Bullets (one per line)</label>
      <textarea id="edit-bullets" rows="5">${escapeHtml((listing.featureBullets||[]).join('\n'))}</textarea>
    </div>
    <div class="field"><label>Keywords (comma separated)</label>
      <textarea id="edit-keywords" rows="3">${escapeHtml((listing.keywords||[]).join(', '))}</textarea>
    </div>
    <div class="field"><label>Price Range</label>
      <input type="text" id="edit-price" value="${escapeHtml(listing.priceRange)}" required>
    </div>
    <div class="field"><label>Questions For Seller (one per line)</label>
      <textarea id="edit-questions" rows="3">${escapeHtml((listing.questionsForSeller||[]).join('\n'))}</textarea>
    </div>
    <input type="hidden" id="edit-language" value="${escapeHtml(listing.language)}">
    <button type="submit" id="hist-save-btn" class="primary-btn">Save Changes</button>
    <p id="hist-msg" class="hint"></p>
  `;
  detailEl.appendChild(form);

  // 3. Action Row (WhatsApp + Copy)
  const actions = document.createElement("div");
  actions.className = "result-actions history-actions";
  actions.innerHTML = `
    <button type="button" id="hist-wa-btn" class="whatsapp-btn">Share on WhatsApp</button>
    <button type="button" id="hist-copy-btn" class="copy-all-btn">Copy Full Listing</button>
  `;
  detailEl.appendChild(actions);
  detailEl.classList.remove("hidden");

  // Helper to get current form data
  const getFormListing = () => ({
    title: document.getElementById("edit-title").value,
    description: document.getElementById("edit-desc").value,
    featureBullets: document.getElementById("edit-bullets").value.split('\n').map(x=>x.trim()).filter(Boolean),
    keywords: document.getElementById("edit-keywords").value.split(',').map(x=>x.trim()).filter(Boolean),
    priceRange: document.getElementById("edit-price").value,
    questionsForSeller: document.getElementById("edit-questions").value.split('\n').map(x=>x.trim()).filter(Boolean),
    language: document.getElementById("edit-language").value
  });

  const msg = document.getElementById("hist-msg");

  // Translate handler
  const tBtn = document.getElementById("hist-trans-btn");
  tBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    tBtn.disabled = true;
    tBtn.textContent = "Translating...";
    msg.textContent = "";
    try {
      const lang = document.getElementById("hist-lang").value;
      const res = await fetch(`/api/listings/${listing._id}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang })
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || "Translation failed");

      document.getElementById("edit-title").value = data.listing.title;
      document.getElementById("edit-desc").value = data.listing.description;
      document.getElementById("edit-bullets").value = (data.listing.featureBullets||[]).join('\n');
      document.getElementById("edit-keywords").value = (data.listing.keywords||[]).join(', ');
      document.getElementById("edit-price").value = data.listing.priceRange;
      document.getElementById("edit-questions").value = (data.listing.questionsForSeller||[]).join('\n');
      document.getElementById("edit-language").value = data.language;

      msg.textContent = "✓ Translation done. Click 'Save Changes' to update.";
      msg.style.color = "var(--success)";
    } catch(err) {
      msg.textContent = "Error: " + err.message;
      msg.style.color = "var(--error-text)";
    } finally {
      tBtn.disabled = false;
      tBtn.textContent = "Regenerate Language";
    }
  });

  // Save handler
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const sBtn = document.getElementById("hist-save-btn");
    sBtn.disabled = true;
    sBtn.textContent = "Saving...";
    try {
      const res = await fetch(`/api/listings/${listing._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getFormListing())
      });
      if(!res.ok) throw new Error("Failed to save to database");
      msg.textContent = "✓ Saved successfully.";
      msg.style.color = "var(--success)";
    } catch(err) {
      msg.textContent = "Error: " + err.message;
      msg.style.color = "var(--error-text)";
    } finally {
      sBtn.disabled = false;
      sBtn.textContent = "Save Changes";
    }
  });

  // Action buttons
  document.getElementById("hist-wa-btn").addEventListener("click", () => {
    window.open(buildWhatsAppShareUrl(getFormListing()), "_blank", "noopener,noreferrer");
  });

  document.getElementById("hist-copy-btn").addEventListener("click", (e) => {
    copyToClipboard(buildFullText(getFormListing()), e.currentTarget, "✓ Copied Full Listing");
  });
}
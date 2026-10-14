// ======================= STATE =======================
let selectedFiles = []; // Array<File>
const MAX_FILES = 4;

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

// ======================= FILE PICKER =======================
document.getElementById("camera-input").addEventListener("change", handleFiles);
document.getElementById("gallery-input").addEventListener("change", handleFiles);

function handleFiles(e) {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    if (selectedFiles.length >= MAX_FILES) break;
    if (!f.type.startsWith("image/")) continue;
    selectedFiles.push(f);
  }
  e.target.value = ""; // allow re-select same file
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
  document.getElementById("photo-count").textContent = `${selectedFiles.length} / ${MAX_FILES} photos selected`;
}

// ======================= GENERATE =======================
document.getElementById("generate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
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

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 503) {
        throw new Error("Ollama is not responding. Make sure Ollama is running and the model is pulled.");
      }
      throw new Error(data.error || "Something went wrong. Please try again.");
    }

    // Intercept if Gemma decides this isn't a valid product photo
    if (data.listing.isProduct === false) {
      showError(`This doesn't look like a product photo. Please upload a clear photo of the item you want to sell. (Model thought: ${data.listing.reason || "Not a product"})`);
      return;
    }

    renderResult(data.listing, resultBox);
    resultBox.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  } finally {
    loading.classList.add("hidden");
    btn.disabled = false;
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
    container.appendChild(makeCard("Description", listing.description, listing.description));
  }

  const bulletsRaw = (listing.featureBullets || []).filter((b) => b.trim());
  if (bulletsRaw.length > 0) {
    const bulletsHtml = "<ul>" + bulletsRaw.map((b) => `<li>${escapeHtml(b)}</li>`).join("") + "</ul>";
    const bulletsText = bulletsRaw.map((b) => `• ${b}`).join("\n");
    container.appendChild(makeCard("Feature Bullets", bulletsHtml, bulletsText, true));
  }

  const kwRaw = (listing.keywords || []).filter((k) => k.trim());
  if (kwRaw.length > 0) {
    const kwHtml = `<div class="chip-row">` + kwRaw.map((k) => `<span class="chip">${escapeHtml(k)}</span>`).join("") + `</div>`;
    const kwText = kwRaw.join(", ");
    container.appendChild(makeCard("Keywords", kwHtml, kwText, true));
  }

  if (listing.priceRange && listing.priceRange.trim()) {
    const priceHtml = `${escapeHtml(listing.priceRange)}<span class="price-estimate">This is an estimate — adjust based on your costs.</span>`;
    container.appendChild(makeCard("Price Range", priceHtml, listing.priceRange, true));
  }

  const qRaw = (listing.questionsForSeller || []).filter((q) => q.trim());
  if (qRaw.length > 0) {
    const qHtml = "<ol>" + qRaw.map((q) => `<li>${escapeHtml(q)}</li>`).join("") + "</ol>";
    const qText = qRaw.map((q, i) => `${i + 1}. ${q}`).join("\n");
    container.appendChild(makeCard("Questions For Seller", qHtml, qText, true));
  }

  // Copy full listing
  const copyAll = document.createElement("button");
  copyAll.className = "copy-all-btn";
  copyAll.textContent = "📋 Copy Full Listing";
  copyAll.addEventListener("click", () => {
    const full = buildFullText(listing);
    copyToClipboard(full, copyAll, "✓ Copied Full Listing");
  });
  container.appendChild(copyAll);
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
  const btn = card.querySelector(".copy-btn");
  btn.addEventListener("click", () => copyToClipboard(copyText, btn, "✓ Copied"));
  return card;
}

function buildFullText(l) {
  const parts = [];
  if (l.title) parts.push(l.title, "");
  if (l.description) parts.push(l.description, "");
  
  const bulletsRaw = (l.featureBullets || []).filter(b => b.trim());
  if (bulletsRaw.length > 0) {
    parts.push("FEATURES:", ...bulletsRaw.map(b => `• ${b}`), "");
  }

  if (l.priceRange) parts.push(`PRICE: ${l.priceRange}`, "");
  
  const kwRaw = (l.keywords || []).filter(k => k.trim());
  if (kwRaw.length > 0) {
    parts.push("KEYWORDS: " + kwRaw.join(", "), "");
  }

  const qRaw = (l.questionsForSeller || []).filter(q => q.trim());
  if (qRaw.length > 0) {
    parts.push("QUESTIONS FOR SELLER:", ...qRaw.map((q, i) => `${i + 1}. ${q}`));
  }
  return parts.join("\n").trim();
}

async function copyToClipboard(text, btn, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
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
      if (res.status === 503) {
        statusEl.textContent = "Database is not available. Saved listings cannot be shown right now.";
      } else {
        statusEl.textContent = "Could not load history.";
      }
      return;
    }
    const items = await res.json();
    if (!items.length) {
      statusEl.textContent = "No saved listings yet. Generate one to see it here.";
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
  const listEl = document.getElementById("history-list");
  const statusEl = document.getElementById("history-status");
  const detailEl = document.getElementById("history-detail");

  listEl.innerHTML = "";
  statusEl.textContent = "";

  const back = document.createElement("button");
  back.className = "back-btn";
  back.textContent = "← Back to list";
  back.addEventListener("click", loadHistory);
  detailEl.innerHTML = "";
  detailEl.appendChild(back);

  const inner = document.createElement("div");
  inner.className = "result";
  renderResult(listing, inner);
  detailEl.appendChild(inner);
  detailEl.classList.remove("hidden");
}
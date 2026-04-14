const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ── State ──────────────────────────────────────────────────────────
let serverUrl = "";
let connected = false;
let serverProps = {};
let playgroundMode = "completion";
let slotPollTimer = null;
let detectedBinary = "";
let runningServers = []; // [{port, model, name, status}]

// ── DOM refs ───────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const urlInput = $("#server-url");
const btnRefresh = $("#btn-refresh");
const statusDot = $("#status-indicator");
const statusText = $("#status-text");

// ── Tabs ───────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`#tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// ── Parameter slider <-> number sync ──────────────────────────────
const paramPairs = [
  "temperature", "top-k", "top-p", "min-p",
  "repeat-penalty", "presence-penalty", "frequency-penalty", "n-predict",
];

paramPairs.forEach((name) => {
  const slider = $(`#p-${name}`);
  const num = $(`#p-${name}-val`);
  if (!slider || !num) return;
  slider.addEventListener("input", () => { num.value = slider.value; });
  num.addEventListener("input", () => { slider.value = num.value; });
});

// ── Presets ────────────────────────────────────────────────────────
const PRESETS = {
  creative:      { temperature: 1.2, top_k: 80,  top_p: 0.98, min_p: 0.02, repeat_penalty: 1.05, presence_penalty: 0.2,  frequency_penalty: 0.2 },
  balanced:      { temperature: 0.8, top_k: 40,  top_p: 0.95, min_p: 0.05, repeat_penalty: 1.1,  presence_penalty: 0,    frequency_penalty: 0 },
  precise:       { temperature: 0.3, top_k: 20,  top_p: 0.85, min_p: 0.1,  repeat_penalty: 1.15, presence_penalty: 0,    frequency_penalty: 0 },
  deterministic: { temperature: 0,   top_k: 1,   top_p: 1,    min_p: 0,    repeat_penalty: 1.0,  presence_penalty: 0,    frequency_penalty: 0 },
};

document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => applyPreset(PRESETS[btn.dataset.preset]));
});

function applyPreset(p) {
  setParam("temperature", p.temperature);
  setParam("top-k", p.top_k);
  setParam("top-p", p.top_p);
  setParam("min-p", p.min_p);
  setParam("repeat-penalty", p.repeat_penalty);
  setParam("presence-penalty", p.presence_penalty);
  setParam("frequency-penalty", p.frequency_penalty);
}

function setParam(name, value) {
  const slider = $(`#p-${name}`);
  const num = $(`#p-${name}-val`);
  if (slider) slider.value = value;
  if (num) num.value = value;
}

function getParams() {
  const val = (id) => {
    const el = $(`#p-${id}-val`) || $(`#p-${id}`);
    return el ? parseFloat(el.value) : undefined;
  };

  const params = {
    temperature: val("temperature"),
    top_k: val("top-k"),
    top_p: val("top-p"),
    min_p: val("min-p"),
    repeat_penalty: val("repeat-penalty"),
    presence_penalty: val("presence-penalty"),
    frequency_penalty: val("frequency-penalty"),
    n_predict: val("n-predict"),
    seed: val("seed"),
    cache_prompt: $("#p-cache-prompt").checked,
  };

  const stopRaw = $("#p-stop").value.trim();
  if (stopRaw) {
    try { params.stop = JSON.parse(stopRaw); } catch { /* ignore */ }
  }

  return params;
}

// ── Internal Connection (no UI — managed by start/stop) ───────────
async function connectToServer(url) {
  serverUrl = url;

  try {
    const result = await invoke("connect", { url: serverUrl });
    connected = true;
    serverProps = result.props || {};
    const port = new URL(serverUrl).port;
    setStatus("connected", `Connected to port ${port}`);
    btnRefresh.disabled = false;
    $("#btn-send").disabled = false;

    renderHealthStatus(result.health);
    renderModels(result.models);
    renderProps(result.props);
    syncServerSettings(result.props);
    startSlotPolling();
    renderRunningServers();
  } catch (e) {
    connected = false;
    setStatus("disconnected", `Failed: ${e}`);
    btnRefresh.disabled = true;
    $("#btn-send").disabled = true;
  }
}

function setStatus(state, text) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = text;
}

// ── Server Launch (from Server tab — advanced) ────────────────────
function buildServerArgs() {
  const args = [];
  const ctxSize = $("#opt-ctx-size").value.trim();
  const ngl = $("#opt-ngl").value.trim();
  const batchSize = $("#opt-batch-size").value.trim();
  const ubatchSize = $("#opt-ubatch-size").value.trim();
  const parallel = $("#opt-parallel").value.trim();
  const host = $("#opt-host").value.trim();

  if (ctxSize) { args.push("--ctx-size", ctxSize); }
  if (ngl) { args.push("-ngl", ngl); }
  if (batchSize) { args.push("--batch-size", batchSize); }
  if (ubatchSize) { args.push("--ubatch-size", ubatchSize); }
  if (parallel && parallel !== "1") { args.push("--parallel", parallel); }
  if (host && host !== "127.0.0.1") { args.push("--host", host); }
  if ($("#opt-flash-attn").checked) { args.push("--flash-attn", "on"); }
  if ($("#opt-slots").checked) { args.push("--slots"); }
  if ($("#opt-cont-batch").checked) { args.push("--cont-batching"); }
  if ($("#opt-props").checked) { args.push("--props"); }
  if ($("#opt-metrics").checked) { args.push("--metrics"); }

  const extra = $("#server-extra-args").value.trim();
  if (extra) { args.push(extra); }

  return args.join(" ");
}

// ── Refresh ────────────────────────────────────────────────────────
btnRefresh.addEventListener("click", async () => {
  if (!serverUrl) return;
  try {
    const [health, models, props] = await Promise.all([
      invoke("get_health", { url: serverUrl }),
      invoke("get_models", { url: serverUrl }),
      invoke("get_props", { url: serverUrl }).catch(() => ({})),
    ]);
    renderHealthStatus(health);
    renderModels(models);
    renderProps(props);
    refreshSlotBar();
  } catch (e) {
    setStatus("disconnected", `Error: ${e}`);
  }
});

// ── Render helpers ─────────────────────────────────────────────────
function infoRow(label, value) {
  return `<span class="label">${label}</span><span class="value">${value ?? "N/A"}</span>`;
}

function renderHealthStatus(h) {
  if (!h || typeof h !== "object") return;
  const parts = [h.status || "ok"];
  if (h.slots_idle !== undefined) parts.push(`${h.slots_idle} idle`);
  if (h.slots_processing !== undefined) parts.push(`${h.slots_processing} busy`);
  setStatus("connected", parts.join(" / "));
}

function renderModels(m) {
  const el = $("#model-info");
  const data = m?.data;
  if (!data || !data.length) {
    el.innerHTML = `<p class="muted">No models loaded</p>`;
    return;
  }

  const model = data[0];
  const meta = model.meta || {};
  const sizeGB = meta.size ? (meta.size / 1e9).toFixed(2) + " GB" : "N/A";
  const params = meta.n_params ? (meta.n_params / 1e9).toFixed(2) + "B" : "N/A";

  el.innerHTML = [
    infoRow("Model ID", model.id),
    infoRow("Architecture", meta["general.architecture"] || "N/A"),
    infoRow("Name", meta["general.name"] || "N/A"),
    infoRow("Parameters", params),
    infoRow("Size", sizeGB),
    infoRow("Context (train)", meta.n_ctx_train ?? "N/A"),
    infoRow("Embedding dim", meta.n_embd ?? "N/A"),
    infoRow("Vocab size", meta.n_vocab ?? "N/A"),
  ].join("");
}

function renderProps(p) {
  const el = $("#props-info");
  if (!p || Object.keys(p).length === 0) {
    el.innerHTML = `<p class="muted">No properties (server may need --props flag)</p>`;
    return;
  }

  const defaults = p.default_generation_settings || {};

  const sampling = ["temperature", "top_k", "top_p", "min_p", "typical_p", "top_n_sigma"];
  const penalties = ["repeat_penalty", "repeat_last_n", "presence_penalty", "frequency_penalty",
    "dry_multiplier", "dry_base", "dry_allowed_length", "dry_penalty_last_n"];
  const generation = ["n_predict", "max_tokens", "n_ctx", "seed", "stream", "cache_prompt"];
  const speculative = Object.keys(defaults).filter((k) => k.startsWith("speculative."));

  function categorize(key) {
    if (sampling.includes(key)) return "sampling";
    if (penalties.includes(key)) return "penalties";
    if (generation.includes(key)) return "generation";
    if (speculative.includes(key)) return "speculative";
    return "other";
  }

  function formatVal(v) {
    if (v === null || v === undefined) return "N/A";
    if (typeof v === "boolean") return v ? "yes" : "no";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
    if (Array.isArray(v)) return v.length === 0 ? "[]" : v.join(", ");
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  function prettyKey(k) {
    return k.replace(/^speculative\./, "spec. ").replace(/_/g, " ");
  }

  let html = `<div class="props-overview">`;
  html += `<span class="props-k">Total Slots</span><span class="props-v">${p.total_slots ?? "N/A"}</span>`;
  html += `<span class="props-k">Build</span><span class="props-v">${escapeHtml(p.build_info ?? "N/A")}</span>`;
  if (p.chat_template) {
    html += `<span class="props-k">Chat Template</span><span class="props-v"><button class="template-view-btn" id="btn-view-template">View / Edit</button></span>`;
  }
  html += `</div>`;

  if (Object.keys(defaults).length > 0) {
    const grouped = {};
    for (const [k, v] of Object.entries(defaults)) {
      if (["samplers", "grammar", "generation_prompt", "chat_format", "params",
           "lora", "ignore_eos", "post_sampling_probs", "reasoning_in_content",
           "reasoning_format", "timings_per_token", "backend_sampling"].includes(k)) continue;
      const cat = categorize(k);
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push([k, v]);
    }

    const order = ["sampling", "penalties", "generation", "speculative", "other"];
    const titles = { sampling: "Sampling", penalties: "Penalties", generation: "Generation", speculative: "Speculative", other: "Other" };

    html += `<div class="props-defaults-grid">`;
    for (const cat of order) {
      if (!grouped[cat] || grouped[cat].length === 0) continue;
      html += `<div class="props-category">`;
      html += `<div class="props-cat-title">${titles[cat]}</div>`;
      for (const [k, v] of grouped[cat]) {
        html += `<div class="props-param"><span class="props-pk">${prettyKey(k)}</span><span class="props-pv">${formatVal(v)}</span></div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }

  el.innerHTML = html;

  const templateBtn = $("#btn-view-template");
  if (templateBtn && p.chat_template) {
    templateBtn.addEventListener("click", () => openTemplateModal(p.chat_template));
  }
}

// ── Chat Template Modal ──────────────────────────────────────────
function openTemplateModal(template) {
  const modal = $("#template-modal");
  const editor = $("#template-editor");
  editor.value = template;
  modal.style.display = "flex";
  editor.focus();
}

function closeTemplateModal() {
  $("#template-modal").style.display = "none";
}

$("#template-modal-close").addEventListener("click", closeTemplateModal);

$("#template-modal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeTemplateModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#template-modal").style.display === "flex") {
    closeTemplateModal();
  }
});

// ── Sync server settings into UI controls ─────────────────────────
function syncServerSettings(props) {
  if (!props || Object.keys(props).length === 0) return;

  const defaults = props.default_generation_settings || {};

  if (defaults.temperature !== undefined) setParam("temperature", defaults.temperature);
  if (defaults.top_k !== undefined) setParam("top-k", defaults.top_k);
  if (defaults.top_p !== undefined) setParam("top-p", defaults.top_p);
  if (defaults.min_p !== undefined) setParam("min-p", defaults.min_p);
  if (defaults.repeat_penalty !== undefined) setParam("repeat-penalty", defaults.repeat_penalty);
  if (defaults.presence_penalty !== undefined) setParam("presence-penalty", defaults.presence_penalty);
  if (defaults.frequency_penalty !== undefined) setParam("frequency-penalty", defaults.frequency_penalty);
  if (defaults.n_predict !== undefined && defaults.n_predict > 0) setParam("n-predict", defaults.n_predict);

  if (defaults.n_ctx !== undefined) $("#opt-ctx-size").value = defaults.n_ctx;
  if (props.total_slots !== undefined) $("#opt-parallel").value = props.total_slots;
}

// ── Load Defaults button ───────────────────────────────────────────
$("#btn-load-defaults").addEventListener("click", () => {
  const d = serverProps?.default_generation_settings;
  if (!d) return alert("No server defaults available. Make sure server has --props flag.");

  if (d.temp !== undefined) setParam("temperature", d.temp);
  if (d.temperature !== undefined) setParam("temperature", d.temperature);
  if (d.top_k !== undefined) setParam("top-k", d.top_k);
  if (d.top_p !== undefined) setParam("top-p", d.top_p);
  if (d.min_p !== undefined) setParam("min-p", d.min_p);
  if (d.repeat_penalty !== undefined) setParam("repeat-penalty", d.repeat_penalty);
  if (d.presence_penalty !== undefined) setParam("presence-penalty", d.presence_penalty);
  if (d.frequency_penalty !== undefined) setParam("frequency-penalty", d.frequency_penalty);
  if (d.n_predict !== undefined) setParam("n-predict", d.n_predict);
});

$("#btn-reset-params").addEventListener("click", () => applyPreset(PRESETS.balanced));

// ── HF Live Search ────────────────────────────────────────────────
let hfSearchTimer = null;
const hfInput = $("#hf-repo-input");
const hfDropdown = $("#hf-search-results");

hfInput.addEventListener("input", () => {
  clearTimeout(hfSearchTimer);
  const query = hfInput.value.trim();
  if (query.length < 2) {
    hfDropdown.innerHTML = "";
    hfDropdown.style.display = "none";
    return;
  }
  hfSearchTimer = setTimeout(() => searchHfModels(query), 300);
});

hfInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hfDropdown.style.display = "none";
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".hf-search-wrapper")) {
    hfDropdown.style.display = "none";
  }
});

async function searchHfModels(query) {
  try {
    const results = await invoke("search_hf_models", { query });
    if (!Array.isArray(results) || results.length === 0) {
      hfDropdown.innerHTML = `<div class="hf-search-empty">No GGUF models found</div>`;
      hfDropdown.style.display = "block";
      return;
    }

    hfDropdown.innerHTML = results.map((m) => {
      const id = m.id || m.modelId;
      const downloads = m.downloads ? formatCount(m.downloads) : "0";
      const likes = m.likes || 0;
      const tag = m.pipeline_tag || "";
      return `<div class="hf-search-item" data-repo="${escapeHtml(id)}">
        <div class="hf-search-item-name">${escapeHtml(id)}</div>
        <div class="hf-search-item-meta">
          <span title="Downloads">${downloads} DL</span>
          <span title="Likes">${likes} ♥</span>
          ${tag ? `<span>${tag}</span>` : ""}
        </div>
      </div>`;
    }).join("");

    hfDropdown.style.display = "block";

    hfDropdown.querySelectorAll(".hf-search-item").forEach((item) => {
      item.addEventListener("click", () => {
        const repo = item.dataset.repo;
        hfInput.value = repo;
        hfDropdown.style.display = "none";
        loadHfFiles(repo);
      });
    });
  } catch {
    hfDropdown.innerHTML = `<div class="hf-search-empty">Search failed</div>`;
    hfDropdown.style.display = "block";
  }
}

function formatCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

function formatSize(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + " KB";
  return bytes + " B";
}

// Suggestion chips
document.querySelectorAll(".hf-suggestion-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const repo = btn.dataset.repo;
    hfInput.value = repo;
    hfDropdown.style.display = "none";
    // Handle repo:quant format
    const colonIdx = repo.indexOf(":");
    const baseRepo = colonIdx > -1 ? repo.substring(0, colonIdx) : repo;
    loadHfFiles(baseRepo, colonIdx > -1 ? repo.substring(colonIdx + 1) : null);
  });
});

// ── HF File Picker ────────────────────────────────────────────────
async function loadHfFiles(repo, quantFilter) {
  const container = $("#hf-files-list");
  const statusEl = $("#hf-download-status");
  container.style.display = "block";
  container.innerHTML = `<p class="muted">Loading files from ${escapeHtml(repo)}...</p>`;
  statusEl.textContent = "";

  try {
    const result = await invoke("list_hf_files", { repo });
    const commit = result.commit;
    const bundles = result.bundles || [];
    if (bundles.length === 0) {
      container.innerHTML = `<p class="muted">No GGUF files found in this repo</p>`;
      return;
    }

    // Sort by size descending
    bundles.sort((a, b) => (b.total_size || 0) - (a.total_size || 0));

    // If quantFilter, try to auto-select matching bundle
    if (quantFilter) {
      const match = bundles.find((b) => b.name.toLowerCase().includes(quantFilter.toLowerCase()));
      if (match) {
        container.style.display = "none";
        downloadModel(repo, commit, match.files, match.name);
        return;
      }
    }

    container.innerHTML = `<div class="hf-files-header muted">Select a model to download:</div>` +
      bundles.map((b, idx) => {
        const parts = b.file_count > 1 ? ` (${b.file_count} parts)` : "";
        return `<div class="hf-file-row">
          <span class="hf-file-name">${escapeHtml(b.name)}${parts}</span>
          <span class="hf-file-size muted">${formatSize(b.total_size)}</span>
          <button class="secondary-btn hf-file-dl-btn" data-idx="${idx}">Download</button>
        </div>`;
      }).join("");

    container.querySelectorAll(".hf-file-dl-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const bundle = bundles[parseInt(btn.dataset.idx)];
        downloadModel(repo, commit, bundle.files, bundle.name);
      });
    });
  } catch (e) {
    container.innerHTML = `<p class="muted">Error: ${e}</p>`;
  }
}

// ── Download Banner ───────────────────────────────────────────────
let downloadStartTime = null;
let downloadUnlisten = null;

function setDownloadBanner(text, state = "active") {
  const banner = $("#download-banner");
  banner.classList.remove("hidden", "success", "error", "paused");
  if (state === "success") banner.classList.add("success");
  else if (state === "error") banner.classList.add("error");
  else if (state === "paused") banner.classList.add("paused");
  $("#download-banner-text").textContent = text;
  if (state === "error") {
    $("#download-banner-bar-wrap").classList.add("hidden");
    $("#download-banner-eta").textContent = "";
  }
}

function setDownloadProgress(pct, etaText) {
  const barWrap = $("#download-banner-bar-wrap");
  barWrap.classList.remove("hidden");
  $("#download-banner-bar").style.width = `${pct}%`;
  $("#download-banner-pct").textContent = `${pct.toFixed(1)}%`;
  $("#download-banner-eta").textContent = etaText || "";
}

function hideDownloadBanner() {
  $("#download-banner").classList.add("hidden");
  $("#download-banner-bar-wrap").classList.add("hidden");
  $("#download-banner-eta").textContent = "";
}

function formatEta(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `ETA ${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  if (m < 60) return `ETA ${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `ETA ${h}h ${m % 60}m`;
}

// ── Model Download ────────────────────────────────────────────────
let downloadPaused = false;

// Track current download info for resume
let currentDownload = null;

function showDownloadControls(show) {
  $("#download-controls").classList.toggle("hidden", !show);
  $("#btn-dl-pause").classList.toggle("hidden", downloadPaused);
  $("#btn-dl-resume").classList.toggle("hidden", !downloadPaused);
}

$("#btn-dl-pause").addEventListener("click", async () => {
  downloadPaused = true;
  await invoke("pause_download");
  $("#btn-dl-pause").classList.add("hidden");
  $("#btn-dl-resume").classList.remove("hidden");
  $("#download-banner").classList.add("paused");
});

$("#btn-dl-resume").addEventListener("click", async () => {
  downloadPaused = false;
  await invoke("resume_download");
  $("#btn-dl-resume").classList.add("hidden");
  $("#btn-dl-pause").classList.remove("hidden");
  $("#download-banner").classList.remove("paused");
});

$("#btn-dl-cancel").addEventListener("click", async () => {
  downloadPaused = false;
  await invoke("cancel_download");
  $("#download-banner").classList.remove("paused");
});

// Resume a cancelled download
async function resumeCancelledDownload() {
  if (!currentDownload) return;
  const { repo, commit, files, displayName } = currentDownload;
  downloadModel(repo, commit, files, displayName);
}

async function downloadModel(repo, commit, files, displayName) {
  const statusEl = $("#hf-download-status");
  const label = displayName || files[0]?.path || "model";
  const parts = files.length > 1 ? ` (${files.length} files)` : "";
  statusEl.textContent = `Downloading ${label}${parts}...`;
  setDownloadBanner(`Downloading ${label}${parts}...`);
  downloadStartTime = Date.now();
  downloadPaused = false;
  currentDownload = { repo, commit, files, displayName };
  showDownloadControls(true);

  // Listen for download progress events
  if (downloadUnlisten) downloadUnlisten();
  downloadUnlisten = await listen("download-progress", (event) => {
    const { pct, downloaded, total, file, paused } = event.payload;
    if (pct >= 100) return;
    const elapsed = (Date.now() - downloadStartTime) / 1000;
    const fileLabel = file ? ` (${file})` : "";
    const pauseLabel = paused ? " — PAUSED" : "";
    if (total > 0) {
      const etaSec = (!paused && pct > 0) ? (elapsed / pct) * (100 - pct) : 0;
      setDownloadProgress(pct, `${formatSize(downloaded)} / ${formatSize(total)}  ${paused ? "Paused" : formatEta(etaSec)}`);
      statusEl.textContent = `Downloading${fileLabel}... ${pct.toFixed(1)}%${pauseLabel}`;
    } else {
      setDownloadBanner(`Downloading${fileLabel}... ${formatSize(downloaded)}${pauseLabel}`);
      statusEl.textContent = `Downloading${fileLabel}... ${formatSize(downloaded)}${pauseLabel}`;
    }
  });

  try {
    const localPath = await invoke("download_hf_model", { repo, commit, files });
    if (downloadUnlisten) { downloadUnlisten(); downloadUnlisten = null; }

    showDownloadControls(false);
    currentDownload = null;
    setDownloadProgress(100, "");
    const elapsed = ((Date.now() - downloadStartTime) / 1000).toFixed(0);
    const msg = `Downloaded ${label}${parts} (${elapsed}s)`;
    statusEl.textContent = msg;
    setDownloadBanner(msg, "success");
    setTimeout(hideDownloadBanner, 5000);

    $("#hf-files-list").style.display = "none";
    refreshLocalModels();
  } catch (e) {
    if (downloadUnlisten) { downloadUnlisten(); downloadUnlisten = null; }
    showDownloadControls(false);
    currentDownload = null;
    const cancelled = String(e).includes("cancelled");
    if (cancelled) {
      statusEl.textContent = "Download paused — click Resume to continue";
      setDownloadBanner("Download paused", "paused");
      // Show only resume and cancel
      $("#download-controls").classList.remove("hidden");
      $("#btn-dl-pause").classList.add("hidden");
      $("#btn-dl-resume").classList.remove("hidden");
      // Re-wire resume to restart the download (will pick up from partial file)
      $("#btn-dl-resume").onclick = () => {
        $("#btn-dl-resume").onclick = null;
        resumeCancelledDownload();
      };
      // Keep currentDownload so resume works
      return;
    }
    currentDownload = null;
    statusEl.textContent = `Download failed: ${e}`;
    setDownloadBanner(`Download failed: ${e}`, "error");
  }
}

// ── Local Models List ─────────────────────────────────────────────
$("#btn-refresh-local").addEventListener("click", refreshLocalModels);

async function refreshLocalModels() {
  const container = $("#local-models-list");

  try {
    const models = await invoke("list_local_models");
    if (!models || models.length === 0) {
      container.innerHTML = `<p class="muted">No downloaded models. Search HuggingFace above to download one.</p>`;
      return;
    }

    container.innerHTML = models.map((m) => {
      const runningSrv = runningServers.find((s) => s.model === m.path);
      const isRunning = !!runningSrv;
      const runBadge = isRunning
        ? `<span class="model-status-badge loaded">PORT ${runningSrv.port}</span>`
        : "";
      return `<div class="model-card">
        <div class="model-card-info">
          <div class="model-card-name" title="${escapeHtml(m.path)}">${escapeHtml(m.name)}</div>
          <div class="model-card-meta">${formatSize(m.size)}</div>
        </div>
        ${runBadge}
        <button class="primary-btn model-start-btn" data-path="${escapeHtml(m.path)}" data-name="${escapeHtml(m.name)}">${isRunning ? "Start Another" : "Start"}</button>
        <button class="danger-btn model-delete-btn" data-path="${escapeHtml(m.path)}" data-name="${escapeHtml(m.name)}" ${isRunning ? "disabled" : ""}>Delete</button>
      </div>`;
    }).join("");

    container.querySelectorAll(".model-start-btn").forEach((btn) => {
      btn.addEventListener("click", () => startLocalModel(btn.dataset.path, btn.dataset.name));
    });

    container.querySelectorAll(".model-delete-btn").forEach((btn) => {
      btn.addEventListener("click", () => deleteLocalModel(btn.dataset.path, btn.dataset.name));
    });
  } catch (e) {
    container.innerHTML = `<p class="muted">Error: ${e}</p>`;
  }
}

async function deleteLocalModel(path, name) {
  try {
    await invoke("delete_local_model", { path });
    refreshLocalModels();
  } catch (e) {
    alert(`Failed to delete ${name}: ${e}`);
  }
}

// ── Server Log ────────────────────────────────────────────────────
let serverLogUnlisten = null;
const MAX_LOG_LINES = 500;

function clearServerLog() {
  const el = $("#server-log");
  el.textContent = "";
}

function appendServerLog(line) {
  const el = $("#server-log");
  // Clear placeholder
  if (el.querySelector(".muted")) el.textContent = "";

  el.textContent += line + "\n";

  // Trim if too long
  const lines = el.textContent.split("\n");
  if (lines.length > MAX_LOG_LINES) {
    el.textContent = lines.slice(-MAX_LOG_LINES).join("\n");
  }

  // Auto-scroll
  el.scrollTop = el.scrollHeight;
}

async function startServerLogListener(filterPort) {
  if (serverLogUnlisten) serverLogUnlisten();
  serverLogUnlisten = await listen("server-log", (event) => {
    const { port, line } = event.payload;
    // Only show logs for the server we're currently loading
    if (filterPort && port !== filterPort) return;

    appendServerLog(line);

    // Update banner with meaningful loading progress
    if (line.includes("llama_model_load") || line.includes("loading model") ||
        line.includes("llm_load") || line.includes("GGML_METAL") ||
        line.includes("offloaded")) {
      const short = line.length > 80 ? line.substring(0, 80) + "..." : line;
      $("#download-banner-text").textContent = short;
    }
  });
}

function stopServerLogListener() {
  if (serverLogUnlisten) {
    serverLogUnlisten();
    serverLogUnlisten = null;
  }
}

// ── Start Local Model ─────────────────────────────────────────────
async function startLocalModel(modelPath, modelName) {
  const binary = getResolvedBinary();
  if (!binary) { showBinaryModal(); return; }

  clearServerLog();
  setDownloadBanner(`Loading ${modelName}...`);

  try {
    const port = await invoke("pick_random_port");
    await startServerLogListener(port);
    const extraArgs = buildServerArgs();

    await invoke("start_server", { binary, port: String(port), extraArgs, modelPath });

    runningServers.push({ port, model: modelPath, name: modelName, status: "loading" });
    renderRunningServers();

    setDownloadBanner(`Loading ${modelName} on port ${port}...`);

    const srvUrl = `http://localhost:${port}`;

    // Poll for health === "ok"
    let attempts = 0;
    const tryConnect = setInterval(async () => {
      attempts++;
      try {
        const health = await invoke("get_health", { url: srvUrl });
        const st = health?.status;
        if (st === "ok" || st === "no slot available") {
          clearInterval(tryConnect);
          stopServerLogListener();
          // Mark as ready
          const srv = runningServers.find((s) => s.port === port);
          if (srv) srv.status = "ready";
          renderRunningServers();
          // Auto-connect to this server for playground
          await connectToServer(srvUrl);
          const msg = `${modelName} running on port ${port}`;
          setDownloadBanner(msg, "success");
          setTimeout(hideDownloadBanner, 5000);
          refreshLocalModels();
        }
      } catch {
        // server not up yet
      }
      if (attempts > 300) { // 10 minutes
        clearInterval(tryConnect);
        stopServerLogListener();
        setDownloadBanner("Server start timed out", "error");
      }
    }, 2000);
  } catch (e) {
    stopServerLogListener();
    setDownloadBanner(`Error: ${e}`, "error");
  }
}

// ── Running Servers Management ────────────────────────────────────
function renderRunningServers() {
  const containers = [$("#running-servers"), $("#server-tab-servers")];

  if (runningServers.length === 0) {
    containers[0].innerHTML = "";
    containers[1].innerHTML = `<p class="muted">No servers running. Start a model from the Models tab.</p>`;
    setStatus("disconnected", "No server running");
    return;
  }

  const html = runningServers.map((srv) => {
    const isActive = serverUrl === `http://localhost:${srv.port}`;
    const dotClass = srv.status === "ready" ? "connected" : "loading";
    const statusLabel = srv.status === "ready" ? "" : " (loading...)";
    const activeClass = isActive ? " active-server" : "";
    const activeLabel = isActive ? `<span class="active-server-badge">ACTIVE</span>` : "";
    const openBtn = srv.status === "ready"
      ? `<button class="open-btn srv-open" data-port="${srv.port}">Open UI</button>`
      : "";
    const connectBtn = srv.status === "ready" && !isActive
      ? `<button class="secondary-btn srv-connect" data-port="${srv.port}" style="font-size:0.75rem;padding:0.3rem 0.6rem">Connect</button>`
      : "";
    return `<div class="running-server-card${activeClass}">
      <div class="running-server-info">
        <span class="status-dot ${dotClass}"></span>
        <span class="running-server-model" title="${escapeHtml(srv.name)}">${escapeHtml(srv.name)}${statusLabel}</span>
        <span class="running-server-port">port ${srv.port}</span>
        ${activeLabel}
      </div>
      <div class="running-server-actions">
        ${connectBtn}
        ${openBtn}
        <button class="danger-btn srv-stop" data-port="${srv.port}">Stop</button>
      </div>
    </div>`;
  }).join("");

  for (const c of containers) {
    c.innerHTML = html;
    c.querySelectorAll(".srv-stop").forEach((btn) => {
      btn.addEventListener("click", () => stopOneServer(parseInt(btn.dataset.port)));
    });
    c.querySelectorAll(".srv-open").forEach((btn) => {
      btn.addEventListener("click", () => {
        invoke("open_in_browser", { url: `http://localhost:${btn.dataset.port}` });
      });
    });
    c.querySelectorAll(".srv-connect").forEach((btn) => {
      btn.addEventListener("click", () => {
        connectToServer(`http://localhost:${btn.dataset.port}`);
      });
    });
  }

  // Update header status
  const readyCount = runningServers.filter((s) => s.status === "ready").length;
  const loadingCount = runningServers.length - readyCount;
  const parts = [];
  if (readyCount) parts.push(`${readyCount} running`);
  if (loadingCount) parts.push(`${loadingCount} loading`);
  setStatus(readyCount > 0 ? "connected" : "loading", parts.join(", "));
}

async function stopOneServer(port) {
  try {
    stopServerLogListener();
    await invoke("stop_server", { port });
    runningServers = runningServers.filter((s) => s.port !== port);
    // If we were connected to this one, disconnect
    if (serverUrl === `http://localhost:${port}`) {
      serverUrl = "";
      connected = false;
      btnRefresh.disabled = true;
      $("#btn-send").disabled = true;
      stopSlotPolling();
      // Auto-connect to another ready server if available
      const ready = runningServers.find((s) => s.status === "ready");
      if (ready) {
        await connectToServer(`http://localhost:${ready.port}`);
      }
    }
    renderRunningServers();
    refreshLocalModels();
  } catch (e) {
    alert(`Error: ${e}`);
  }
}

$("#btn-stop-all").addEventListener("click", async () => {
  try {
    stopServerLogListener();
    await invoke("stop_all_servers");
    runningServers = [];
    serverUrl = "";
    connected = false;
    btnRefresh.disabled = true;
    $("#btn-send").disabled = true;
    stopSlotPolling();
    renderRunningServers();
    refreshLocalModels();
  } catch (e) {
    alert(`Error: ${e}`);
  }
});

// Sync manual binary path edits into detectedBinary
$("#server-bin-path").addEventListener("change", () => {
  const val = $("#server-bin-path").value.trim();
  if (val) detectedBinary = val;
});

// ── Persistent Slot Bar ────────────────────────────────────────────
$("#slot-auto-poll").addEventListener("change", (e) => {
  if (e.target.checked) {
    startSlotPolling();
  } else {
    stopSlotPolling();
  }
});

function startSlotPolling() {
  stopSlotPolling();
  refreshSlotBar();
  slotPollTimer = setInterval(refreshSlotBar, 2000);
}

function stopSlotPolling() {
  if (slotPollTimer) {
    clearInterval(slotPollTimer);
    slotPollTimer = null;
  }
}

async function refreshSlotBar() {
  if (!serverUrl || !connected) return;
  const container = $("#slot-bar-slots");
  const detailPane = $("#slot-details");

  try {
    const slots = await invoke("get_slots", { url: serverUrl });

    if (!Array.isArray(slots) || slots.length === 0) {
      container.innerHTML = `<span class="muted">No slots (--slots flag needed)</span>`;
      if (detailPane) detailPane.innerHTML = `<p class="muted">No slots (server may need --slots flag)</p>`;
      return;
    }

    container.innerHTML = slots.map((s) => {
      const processing = s.is_processing;
      const state = processing ? "processing" : "idle";
      const decoded = s.next_token?.n_decoded ?? s.n_decoded ?? 0;
      const ctx = s.n_ctx ?? "?";

      return `
        <div class="slot-pill ${state}">
          <span class="slot-pill-dot ${state}"></span>
          <span class="slot-pill-label">${s.id}</span>
          <span class="slot-pill-detail">${decoded}/${ctx}</span>
        </div>`;
    }).join("");

    if (!detailPane) return;

    const totalSlots = slots.length;
    const busySlots = slots.filter((s) => s.is_processing).length;
    const idleSlots = totalSlots - busySlots;

    let html = `<div class="slot-detail-summary">
      <div class="slot-summary-item"><span class="slot-summary-label">Total</span><span class="slot-summary-val">${totalSlots}</span></div>
      <div class="slot-summary-item"><span class="slot-summary-label">Idle</span><span class="slot-summary-val" style="color:var(--green)">${idleSlots}</span></div>
      <div class="slot-summary-item"><span class="slot-summary-label">Busy</span><span class="slot-summary-val" style="color:var(--yellow)">${busySlots}</span></div>
    </div>`;

    html += slots.map((s) => {
      const processing = s.is_processing;
      const state = processing ? "processing" : "idle";
      const decoded = s.next_token?.n_decoded ?? s.n_decoded ?? 0;
      const ctx = s.n_ctx ?? 0;
      const nPast = s.n_past ?? 0;
      const nRemaining = s.n_remaining ?? 0;
      const tps = s.tokens_per_second ?? s.t_token_generation_per_second ?? null;
      const promptTps = s.prompt_tokens_per_second ?? s.t_prompt_processing_per_second ?? null;
      const kvPct = ctx > 0 ? ((nPast / ctx) * 100) : 0;
      const kvClass = kvPct > 90 ? "crit" : kvPct > 70 ? "warn" : "";

      let statsHtml = "";
      statsHtml += slotStat("Decoded", decoded);
      statsHtml += slotStat("Remaining", nRemaining || "-");
      statsHtml += slotStat("KV cache", ctx > 0 ? `${nPast}/${ctx}` : "-");
      if (promptTps != null) statsHtml += slotStat("Prompt", `${promptTps.toFixed(1)} t/s`);

      const tGen = s.t_token_generation ?? null;
      const tPrompt = s.t_prompt_processing ?? null;
      if (tGen != null) statsHtml += slotStat("Gen time", `${(tGen / 1000).toFixed(1)}s`);
      if (tPrompt != null) statsHtml += slotStat("Prompt time", `${(tPrompt / 1000).toFixed(1)}s`);

      const tpsDisplay = tps != null ? `${tps.toFixed(1)} t/s` : (processing ? "..." : "-");

      return `<div class="slot-detail-card ${state}">
        <div class="slot-detail-header">
          <span class="slot-detail-id">Slot ${s.id}</span>
          <span class="slot-detail-state ${state}">${state}</span>
          <span class="slot-detail-tps">${tpsDisplay}</span>
        </div>
        <div class="slot-detail-stats">${statsHtml}</div>
        <div class="slot-kv-bar"><div class="slot-kv-fill ${kvClass}" style="width:${kvPct.toFixed(1)}%"></div></div>
      </div>`;
    }).join("");

    detailPane.innerHTML = html;
  } catch {
    container.innerHTML = `<span class="muted">Slots unavailable</span>`;
    if (detailPane) detailPane.innerHTML = `<p class="muted">Slots unavailable</p>`;
  }
}

function slotStat(label, value) {
  return `<div class="slot-stat"><span class="slot-stat-key">${label}</span><span class="slot-stat-val">${value}</span></div>`;
}

// ── Playground ─────────────────────────────────────────────────────
document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    playgroundMode = btn.dataset.mode;
    $("#chat-system-row").style.display = playgroundMode === "chat" ? "block" : "none";
  });
});

$("#btn-send").addEventListener("click", sendPrompt);

let abortGeneration = false;

async function sendPrompt() {
  if (!serverUrl || !connected) return;

  const promptText = $("#prompt-input").value.trim();
  if (!promptText) return;

  const btnSend = $("#btn-send");
  const btnCancel = $("#btn-cancel");
  const output = $("#response-output");
  const meta = $("#response-meta");

  btnSend.style.display = "none";
  btnCancel.style.display = "inline-block";
  abortGeneration = false;
  output.textContent = "";
  meta.textContent = "Waiting for server...";

  const params = getParams();
  const startTime = performance.now();

  try {
    let result;

    if (playgroundMode === "completion") {
      result = await invoke("send_completion", {
        url: serverUrl,
        body: { prompt: promptText, ...params },
      });
      output.textContent = result.content || JSON.stringify(result, null, 2);
    } else {
      const messages = [];
      const sysPrompt = $("#system-prompt").value.trim();
      if (sysPrompt) messages.push({ role: "system", content: sysPrompt });
      messages.push({ role: "user", content: promptText });

      const chatBody = {
        messages,
        temperature: params.temperature,
        top_p: params.top_p,
        max_tokens: params.n_predict > 0 ? params.n_predict : 512,
        seed: params.seed >= 0 ? params.seed : undefined,
        stream: false,
      };
      if (params.presence_penalty) chatBody.presence_penalty = params.presence_penalty;
      if (params.frequency_penalty) chatBody.frequency_penalty = params.frequency_penalty;

      result = await invoke("send_chat_completion", {
        url: serverUrl,
        body: chatBody,
      });

      const choice = result.choices?.[0];
      output.textContent = choice?.message?.content || JSON.stringify(result, null, 2);
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    const timings = result.timings || result.usage || {};

    const parts = [`${elapsed}s`];
    if (timings.predicted_per_second) parts.push(`${timings.predicted_per_second.toFixed(1)} tok/s`);
    if (timings.prompt_tokens || timings.tokens_evaluated) {
      parts.push(`prompt: ${timings.prompt_tokens || timings.tokens_evaluated} tok`);
    }
    if (timings.completion_tokens || timings.tokens_predicted) {
      parts.push(`completion: ${timings.completion_tokens || timings.tokens_predicted} tok`);
    }
    if (result.stop_type) parts.push(`stop: ${result.stop_type}`);

    meta.textContent = parts.join("  |  ");
  } catch (e) {
    output.textContent = `Error: ${e}`;
  } finally {
    btnSend.style.display = "inline-block";
    btnCancel.style.display = "none";
  }
}

$("#btn-cancel").addEventListener("click", () => {
  abortGeneration = true;
  $("#response-meta").textContent = "Cancelled";
  $("#btn-send").style.display = "inline-block";
  $("#btn-cancel").style.display = "none";
});

// Ctrl+Enter to send
$("#prompt-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendPrompt();
  }
});

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ── Binary Auto-Detection ─────────────────────────────────────────
function getResolvedBinary() {
  return $("#server-bin-path").value.trim() || detectedBinary;
}

function showBinaryModal() {
  const modal = $("#binary-modal");
  const input = $("#binary-modal-input");
  const status = $("#binary-modal-status");
  modal.style.display = "flex";
  input.value = "";
  status.textContent = "";
  input.focus();
}

$("#binary-modal-save").addEventListener("click", () => {
  const path = $("#binary-modal-input").value.trim();
  if (!path) {
    $("#binary-modal-status").textContent = "Please enter a path";
    return;
  }
  detectedBinary = path;
  $("#server-bin-path").value = path;
  $("#binary-modal").style.display = "none";
});

$("#binary-modal-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#binary-modal-save").click();
});

// ── Init ──────────────────────────────────────────────────────────
(async () => {
  try {
    detectedBinary = await invoke("detect_binary");
    if (!$("#server-bin-path").value) {
      $("#server-bin-path").value = detectedBinary;
    }
  } catch {
    // not found — modal will show when user tries to start
  }

  refreshLocalModels();
})();

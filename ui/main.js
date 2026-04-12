const { invoke } = window.__TAURI__.core;

// ── State ──────────────────────────────────────────────────────────
let serverUrl = "";
let connected = false;
let serverProps = {};
let playgroundMode = "completion";
let slotPollTimer = null;

// ── DOM refs ───────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const urlInput = $("#server-url");
const btnConnect = $("#btn-connect");
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

// ── Connection ─────────────────────────────────────────────────────
btnConnect.addEventListener("click", doConnect);
urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doConnect(); });

async function doConnect() {
  serverUrl = urlInput.value.trim().replace(/\/+$/, "");
  if (!serverUrl) return;

  setStatus("loading", "Connecting...");
  btnConnect.disabled = true;

  try {
    const result = await invoke("connect", { url: serverUrl });
    connected = true;
    serverProps = result.props || {};
    setStatus("connected", "Connected");
    btnRefresh.disabled = false;
    $("#btn-send").disabled = false;

    renderHealthStatus(result.health);
    renderModels(result.models);
    renderProps(result.props);
    startSlotPolling();
    refreshModelsList();
  } catch (e) {
    connected = false;
    setStatus("disconnected", `Failed: ${e}`);
    btnRefresh.disabled = true;
    $("#btn-send").disabled = true;
  } finally {
    btnConnect.disabled = false;
  }
}

function setStatus(state, text) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = text;
}

// ── Server Launch ──────────────────────────────────────────────────
function buildServerArgs() {
  const args = [];
  const ctxSize = $("#opt-ctx-size").value.trim();
  const ngl = $("#opt-ngl").value.trim();
  const batchSize = $("#opt-batch-size").value.trim();
  const ubatchSize = $("#opt-ubatch-size").value.trim();
  const parallel = $("#opt-parallel").value.trim();
  const host = $("#opt-host").value.trim();

  if (ctxSize) { args.push("--ctx-size", ctxSize); }
  if (ngl) { args.push("--ngl", ngl); }
  if (batchSize) { args.push("--batch-size", batchSize); }
  if (ubatchSize) { args.push("--ubatch-size", ubatchSize); }
  if (parallel && parallel !== "1") { args.push("--parallel", parallel); }
  if (host && host !== "127.0.0.1") { args.push("--host", host); }
  if ($("#opt-flash-attn").checked) { args.push("--flash-attn"); }
  if ($("#opt-slots").checked) { args.push("--slots"); }
  if ($("#opt-cont-batch").checked) { args.push("--cont-batching"); }
  if ($("#opt-props").checked) { args.push("--props"); }
  if ($("#opt-metrics").checked) { args.push("--metrics"); }

  const extra = $("#server-extra-args").value.trim();
  if (extra) { args.push(extra); }

  return args.join(" ");
}

$("#btn-start-server").addEventListener("click", async () => {
  const bin = $("#server-bin-path").value.trim();
  const port = $("#server-port").value.trim() || "8080";
  const extraArgs = buildServerArgs();

  if (!bin) {
    $("#server-launch-status").textContent = "Please enter the path to llama-server binary";
    return;
  }

  const statusEl = $("#server-launch-status");
  statusEl.textContent = "Starting server...";

  try {
    await invoke("start_server", { binary: bin, port, extraArgs });
    statusEl.textContent = `Server started on port ${port}`;
    // Auto-connect
    urlInput.value = `http://localhost:${port}`;
    // Wait a moment for server to be ready
    setTimeout(doConnect, 2000);
  } catch (e) {
    statusEl.textContent = `Error: ${e}`;
  }
});

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

  // Group generation settings into categories for readability
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
    html += `<span class="props-k">Chat Template</span><span class="props-v props-template" title="${escapeHtml(p.chat_template)}">${escapeHtml(truncate(p.chat_template, 200))}</span>`;
  }
  html += `</div>`;

  if (Object.keys(defaults).length > 0) {
    const grouped = {};
    for (const [k, v] of Object.entries(defaults)) {
      // Skip noisy/internal keys
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
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "..." : s;
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

// ── HuggingFace Download & Start ──────────────────────────────────
$("#btn-hf-download").addEventListener("click", startHfModel);
$("#hf-repo-input").addEventListener("keydown", (e) => { if (e.key === "Enter") startHfModel(); });

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

// Close dropdown on outside click
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

    // Click to select
    hfDropdown.querySelectorAll(".hf-search-item").forEach((item) => {
      item.addEventListener("click", () => {
        hfInput.value = item.dataset.repo;
        hfDropdown.style.display = "none";
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

// Suggestion chips fill the repo input
document.querySelectorAll(".hf-suggestion-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    hfInput.value = btn.dataset.repo;
    hfDropdown.style.display = "none";
  });
});

// Sync binary path between Server tab and HF section
$("#hf-binary-path").addEventListener("change", () => {
  if (!$("#server-bin-path").value) $("#server-bin-path").value = $("#hf-binary-path").value;
});
$("#server-bin-path").addEventListener("change", () => {
  if (!$("#hf-binary-path").value) $("#hf-binary-path").value = $("#server-bin-path").value;
});

async function startHfModel() {
  const binary = $("#hf-binary-path").value.trim();
  const hfRepo = $("#hf-repo-input").value.trim();
  const port = $("#hf-port").value.trim() || "8080";
  const extraArgs = $("#hf-extra-args").value.trim();
  const statusEl = $("#hf-download-status");

  if (!binary) {
    statusEl.textContent = "Please enter the path to llama-server binary";
    return;
  }
  if (!hfRepo) {
    statusEl.textContent = "Please enter a HuggingFace model identifier";
    return;
  }

  statusEl.textContent = "Starting server & downloading model...";
  $("#btn-hf-download").disabled = true;

  try {
    await invoke("start_server_hf", { binary, port, hfRepo, extraArgs });
    statusEl.textContent = `Server started on port ${port} — downloading ${hfRepo}...`;

    // Auto-connect after a delay to let the download start
    urlInput.value = `http://localhost:${port}`;
    // Poll for connection since HF download can take time
    let attempts = 0;
    const tryConnect = setInterval(async () => {
      attempts++;
      try {
        await doConnect();
        if (connected) {
          clearInterval(tryConnect);
          statusEl.textContent = `Model ${hfRepo} ready on port ${port}`;
        }
      } catch {
        // still downloading
      }
      if (attempts > 120) { // give up after 4 minutes
        clearInterval(tryConnect);
        statusEl.textContent = "Server started but auto-connect timed out. Try connecting manually.";
      }
    }, 2000);
  } catch (e) {
    statusEl.textContent = `Error: ${e}`;
  } finally {
    $("#btn-hf-download").disabled = false;
  }
}

// ── Models Management ──────────────────────────────────────────────
$("#btn-load-model").addEventListener("click", loadModel);
$("#model-load-input").addEventListener("keydown", (e) => { if (e.key === "Enter") loadModel(); });
$("#btn-refresh-models").addEventListener("click", refreshModelsList);

async function loadModel() {
  if (!serverUrl || !connected) return;

  const modelId = $("#model-load-input").value.trim();
  if (!modelId) return;

  const statusEl = $("#model-load-status");
  statusEl.textContent = "Loading model... (this may take a while for HF downloads)";
  $("#btn-load-model").disabled = true;

  try {
    await invoke("load_model", { url: serverUrl, model: modelId });
    statusEl.textContent = `Model "${modelId}" loaded successfully`;
    $("#model-load-input").value = "";
    refreshModelsList();
    // Refresh server tab too
    const [models, props] = await Promise.all([
      invoke("get_models", { url: serverUrl }),
      invoke("get_props", { url: serverUrl }).catch(() => ({})),
    ]);
    renderModels(models);
    renderProps(props);
  } catch (e) {
    statusEl.textContent = `Error: ${e}`;
  } finally {
    $("#btn-load-model").disabled = false;
  }
}

async function refreshModelsList() {
  if (!serverUrl || !connected) return;
  const container = $("#models-list");

  // Try router-mode /models first, fall back to /v1/models
  let models = [];
  let isRouterMode = false;

  try {
    const result = await invoke("list_available_models", { url: serverUrl });
    if (Array.isArray(result)) {
      models = result;
      isRouterMode = true;
    } else if (result?.data) {
      models = result.data;
    }
  } catch {
    // Router mode not available, try /v1/models
    try {
      const result = await invoke("get_models", { url: serverUrl });
      models = result?.data || [];
    } catch {
      container.innerHTML = `<p class="muted">Could not fetch models</p>`;
      return;
    }
  }

  if (models.length === 0) {
    container.innerHTML = `<p class="muted">No models found. Load one above or start server with a model.</p>`;
    return;
  }

  container.innerHTML = models.map((m) => {
    const id = m.id || m.model || m;
    const meta = m.meta || {};
    const status = m.status || (m.object === "model" ? "loaded" : "available");
    const badgeClass = status === "loaded" ? "loaded" : status === "loading" ? "loading" : "available";
    const params = meta.n_params ? (meta.n_params / 1e9).toFixed(1) + "B" : "";
    const arch = meta["general.architecture"] || "";
    const metaStr = [arch, params].filter(Boolean).join(" / ");

    const unloadBtn = isRouterMode && status === "loaded"
      ? `<button class="danger-btn" onclick="unloadModel('${escapeHtml(id)}')">Unload</button>`
      : "";
    const loadBtn = isRouterMode && status !== "loaded"
      ? `<button class="secondary-btn" onclick="loadModelById('${escapeHtml(id)}')">Load</button>`
      : "";

    return `
      <div class="model-card">
        <div class="model-card-info">
          <div class="model-card-name" title="${escapeHtml(id)}">${escapeHtml(id)}</div>
          ${metaStr ? `<div class="model-card-meta">${metaStr}</div>` : ""}
        </div>
        <span class="model-status-badge ${badgeClass}">${status}</span>
        ${loadBtn}${unloadBtn}
      </div>`;
  }).join("");
}

// Global handlers for inline onclick (model cards)
window.loadModelById = async (id) => {
  if (!serverUrl) return;
  try {
    await invoke("load_model", { url: serverUrl, model: id });
    refreshModelsList();
    const models = await invoke("get_models", { url: serverUrl });
    renderModels(models);
  } catch (e) {
    alert(`Failed to load model: ${e}`);
  }
};

window.unloadModel = async (id) => {
  if (!serverUrl) return;
  try {
    await invoke("unload_model", { url: serverUrl, model: id });
    refreshModelsList();
    const models = await invoke("get_models", { url: serverUrl });
    renderModels(models);
  } catch (e) {
    alert(`Failed to unload model: ${e}`);
  }
};

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

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

  try {
    const slots = await invoke("get_slots", { url: serverUrl });
    if (!Array.isArray(slots) || slots.length === 0) {
      container.innerHTML = `<span class="muted">No slots (--slots flag needed)</span>`;
      return;
    }

    container.innerHTML = slots.map((s) => {
      const processing = s.is_processing;
      const state = processing ? "processing" : "idle";
      const decoded = s.next_token?.n_decoded ?? 0;
      const ctx = s.n_ctx ?? "?";

      return `
        <div class="slot-pill ${state}">
          <span class="slot-pill-dot ${state}"></span>
          <span class="slot-pill-label">${s.id}</span>
          <span class="slot-pill-detail">${decoded}/${ctx}</span>
        </div>`;
    }).join("");
  } catch {
    container.innerHTML = `<span class="muted">Slots unavailable</span>`;
  }
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

      // Build OAI-compatible body — use max_tokens instead of n_predict
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

const form = document.getElementById("enhanceForm");
const fileInput = document.getElementById("image");
const enhanceButton = document.getElementById("enhanceButton");
const errorMsg = document.getElementById("errorMsg");

const inputPreview = document.getElementById("inputPreview");
const inputPlaceholder = document.getElementById("inputPlaceholder");
const outputPreview = document.getElementById("outputPreview");
const outputPlaceholder = document.getElementById("outputPlaceholder");

const progressText = document.getElementById("progressText");
const progressPercent = document.getElementById("progressPercent");
const progressBarInner = document.getElementById("progressBarInner");

const compareButton = document.getElementById("compareButton");

const metricsSection = document.getElementById("metricsSection");
const metricsResolution = document.getElementById("metricsResolution");
const metricsUpsscale = document.getElementById("metricsUpsscale");
const metricsPixels = document.getElementById("metricsPixels");
const metricsSharpness = document.getElementById("metricsSharpness");
const metricsPSNR = document.getElementById("metricsPSNR");
const metricsSSIM = document.getElementById("metricsSSIM");
const metricsQuality = document.getElementById("metricsQuality");

const labelPSNR = document.getElementById("labelPSNR");
const labelSSIM = document.getElementById("labelSSIM");
const labelQuality = document.getElementById("labelQuality");
const metricHelpText = document.getElementById("metricHelpText");
const improvementStoryText = document.getElementById("improvementStoryText");

const downloadImageBtn = document.getElementById("downloadImageBtn");
const downloadReportBtn = document.getElementById("downloadReportBtn");

const historySection = document.getElementById("historySection");
const historyList = document.getElementById("historyList");

const sessionStatsSection = document.getElementById("sessionStatsSection");
const statsTotalImages = document.getElementById("statsTotalImages");
const statsAvgPSNR = document.getElementById("statsAvgPSNR");
const statsAvgSSIM = document.getElementById("statsAvgSSIM");
const statsBestQuality = document.getElementById("statsBestQuality");

// Pipeline
const pipelineSteps = document.querySelectorAll("[data-pipeline-step]");

// Circle reveal elements
const circleSection = document.getElementById("circleSection");
const circleContainer = document.getElementById("circleContainer");
const circleBefore = document.getElementById("circleBefore");
const circleAfter = document.getElementById("circleAfter");
const circleOverlay = document.getElementById("circleOverlay");

// Model comparison elements
const modelComparisonSection = document.getElementById("modelComparisonSection");
const mcInput = document.getElementById("mcInput");
const mcInputPlaceholder = document.getElementById("mcInputPlaceholder");
const mcBaseline = document.getElementById("mcBaseline");
const mcBaselinePlaceholder = document.getElementById("mcBaselinePlaceholder");
const mcEnhanced = document.getElementById("mcEnhanced");
const mcEnhancedPlaceholder = document.getElementById("mcEnhancedPlaceholder");

// Viewer elements
const imageViewer = document.getElementById("imageViewer");
const viewerCloseBtn = document.getElementById("viewerCloseBtn");

const viewerInputContainer = document.getElementById("viewerInputContainer");
const viewerInputImage = document.getElementById("viewerInputImage");
const viewerInputZoomInBtn = document.getElementById("viewerInputZoomInBtn");
const viewerInputZoomOutBtn = document.getElementById("viewerInputZoomOutBtn");
const viewerInputResetBtn = document.getElementById("viewerInputResetBtn");

const viewerOutputContainer = document.getElementById("viewerOutputContainer");
const viewerOutputImage = document.getElementById("viewerOutputImage");
const viewerOutputZoomInBtn = document.getElementById("viewerOutputZoomInBtn");
const viewerOutputZoomOutBtn = document.getElementById("viewerOutputZoomOutBtn");
const viewerOutputResetBtn = document.getElementById("viewerOutputResetBtn");

let polling = false;
let currentOutputUrl = null;
let currentInputUrl = null;
let currentBaselineUrl = null;
let currentMetrics = null;
let historyItems = []; // { input, output, baseline, metrics }

// --- Dual viewer panes state ---
const panes = {
  input: {
    container: viewerInputContainer,
    img: viewerInputImage,
    scale: 1,
    tx: 0,
    ty: 0,
  },
  output: {
    container: viewerOutputContainer,
    img: viewerOutputImage,
    scale: 1,
    tx: 0,
    ty: 0,
  },
};

let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartTx = 0;
let panStartTy = 0;
let activePane = null;

// ---- Pipeline helpers ----
function setPipelineStepState(el, state) {
  // Reset base style
  let base =
    "pipeline-step rounded-xl border px-3 py-2 transition-colors duration-200";
  if (state === "active") {
    el.className =
      base +
      " border-indigo-400 bg-slate-900 text-slate-100 shadow-[0_0_15px_rgba(129,140,248,0.5)]";
  } else if (state === "complete") {
    el.className =
      base +
      " border-emerald-400 bg-slate-900 text-emerald-100";
  } else {
    el.className =
      base +
      " border-slate-800 bg-slate-950 text-slate-500 opacity-70";
  }
}

function resetPipeline() {
  pipelineSteps.forEach((step) => setPipelineStepState(step, "pending"));
}

function updatePipeline(progressValue, running) {
  if (!running && !currentOutputUrl) {
    resetPipeline();
    return;
  }

  const p = Math.max(0, Math.min(1, progressValue || 0));
  let activeIndex = 1;

  if (p <= 0.05) activeIndex = 1;
  else if (p <= 0.25) activeIndex = 2;
  else if (p <= 0.6) activeIndex = 3;
  else if (p <= 0.85) activeIndex = 4;
  else activeIndex = 5;

  pipelineSteps.forEach((step) => {
    const idx = parseInt(step.getAttribute("data-pipeline-step"), 10);
    if (idx < activeIndex) setPipelineStepState(step, "complete");
    else if (idx === activeIndex) setPipelineStepState(step, "active");
    else setPipelineStepState(step, "pending");
  });
}

// ---- Circle helper ----
function refreshCircle() {
  if (currentInputUrl && currentOutputUrl) {
    circleBefore.src = currentInputUrl;
    circleAfter.src = currentOutputUrl;
    circleSection.classList.remove("hidden");

    const rect = circleContainer.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const RADIUS = 110;
    circleAfter.style.clipPath = `circle(${RADIUS}px at ${centerX}px ${centerY}px)`;
    circleAfter.style.webkitClipPath = `circle(${RADIUS}px at ${centerX}px ${centerY}px)`;
    circleOverlay.style.left = centerX - RADIUS + "px";
    circleOverlay.style.top = centerY - RADIUS + "px";
  } else {
    circleSection.classList.add("hidden");
  }
}

if (circleContainer) {
  const RADIUS = 110;

  function moveCircle(clientX, clientY) {
    const rect = circleContainer.getBoundingClientRect();
    let x = clientX - rect.left;
    let y = clientY - rect.top;

    x = Math.max(RADIUS, Math.min(rect.width - RADIUS, x));
    y = Math.max(RADIUS, Math.min(rect.height - RADIUS, y));

    circleAfter.style.clipPath = `circle(${RADIUS}px at ${x}px ${y}px)`;
    circleAfter.style.webkitClipPath = `circle(${RADIUS}px at ${x}px ${y}px)`;
    circleOverlay.style.left = x - RADIUS + "px";
    circleOverlay.style.top = y - RADIUS + "px";
  }

  circleContainer.addEventListener("mousemove", (e) => {
    moveCircle(e.clientX, e.clientY);
  });

  circleContainer.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    moveCircle(t.clientX, t.clientY);
  });
}

// ---- Model Comparison helper ----
function refreshModelComparison() {
  if (currentInputUrl) {
    mcInput.src = currentInputUrl;
    mcInput.classList.remove("hidden");
    mcInputPlaceholder.classList.add("hidden");
  }

  if (currentBaselineUrl) {
    mcBaseline.src = currentBaselineUrl;
    mcBaseline.classList.remove("hidden");
    mcBaselinePlaceholder.classList.add("hidden");
  }

  if (currentOutputUrl) {
    mcEnhanced.src = currentOutputUrl;
    mcEnhanced.classList.remove("hidden");
    mcEnhancedPlaceholder.classList.add("hidden");
  }

  if (currentBaselineUrl && currentOutputUrl) {
    modelComparisonSection.classList.remove("hidden");
  } else {
    modelComparisonSection.classList.add("hidden");
  }
}

// ---- Viewer helpers ----

function updatePaneTransform(pane) {
  pane.img.style.transform =
    "translate(" + pane.tx + "px, " + pane.ty + "px) scale(" + pane.scale + ")";
}

function resetPane(pane) {
  pane.scale = 1;
  pane.tx = 0;
  pane.ty = 0;
  updatePaneTransform(pane);
}

function zoomPane(pane, factor) {
  pane.scale = Math.min(Math.max(pane.scale * factor, 0.25), 10);
  updatePaneTransform(pane);
}

function openViewer() {
  if (!currentInputUrl && !currentOutputUrl) return;

  if (currentInputUrl) viewerInputImage.src = currentInputUrl;
  if (currentOutputUrl) viewerOutputImage.src = currentOutputUrl;

  resetPane(panes.input);
  resetPane(panes.output);

  imageViewer.classList.remove("hidden");
  imageViewer.classList.add("flex");
}

function closeViewer() {
  imageViewer.classList.add("hidden");
  imageViewer.classList.remove("flex");
  activePane = null;
  isPanning = false;
}

viewerCloseBtn.addEventListener("click", closeViewer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeViewer();
});

function startPan(e, paneKey) {
  const pane = panes[paneKey];
  activePane = pane;
  isPanning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panStartTx = pane.tx;
  panStartTy = pane.ty;
  panes.input.container.classList.remove("cursor-grabbing");
  panes.output.container.classList.remove("cursor-grabbing");
  pane.container.classList.add("cursor-grabbing");
}

viewerInputContainer.addEventListener("mousedown", (e) => {
  e.preventDefault();
  startPan(e, "input");
});

viewerOutputContainer.addEventListener("mousedown", (e) => {
  e.preventDefault();
  startPan(e, "output");
});

document.addEventListener("mousemove", (e) => {
  if (!isPanning || !activePane) return;
  const dx = e.clientX - panStartX;
  const dy = e.clientY - panStartY;
  activePane.tx = panStartTx + dx;
  activePane.ty = panStartTy + dy;
  updatePaneTransform(activePane);
});

document.addEventListener("mouseup", () => {
  isPanning = false;
  activePane = null;
  panes.input.container.classList.remove("cursor-grabbing");
  panes.output.container.classList.remove("cursor-grabbing");
});

viewerInputContainer.addEventListener("mouseleave", () => {
  isPanning = false;
  activePane = null;
  viewerInputContainer.classList.remove("cursor-grabbing");
});

viewerOutputContainer.addEventListener("mouseleave", () => {
  isPanning = false;
  activePane = null;
  viewerOutputContainer.classList.remove("cursor-grabbing");
});

function handleWheel(e, paneKey) {
  e.preventDefault();
  const pane = panes[paneKey];
  const delta = e.deltaY < 0 ? 1.1 : 0.9;
  zoomPane(pane, delta);
}

viewerInputContainer.addEventListener("wheel", (e) =>
  handleWheel(e, "input")
);
viewerOutputContainer.addEventListener("wheel", (e) =>
  handleWheel(e, "output")
);

viewerInputZoomInBtn.addEventListener("click", () =>
  zoomPane(panes.input, 1.25)
);
viewerInputZoomOutBtn.addEventListener("click", () =>
  zoomPane(panes.input, 1 / 1.25)
);
viewerInputResetBtn.addEventListener("click", () =>
  resetPane(panes.input)
);

viewerOutputZoomInBtn.addEventListener("click", () =>
  zoomPane(panes.output, 1.25)
);
viewerOutputZoomOutBtn.addEventListener("click", () =>
  zoomPane(panes.output, 1 / 1.25)
);
viewerOutputResetBtn.addEventListener("click", () =>
  resetPane(panes.output)
);

compareButton.addEventListener("click", () => {
  if (!compareButton.disabled) openViewer();
});

// ---- Metrics UI & Improvement Story ----

function applyMetricsToUI(m) {
  if (!m) {
    metricsSection.classList.add("hidden");
    metricsResolution.textContent = "–";
    metricsUpsscale.textContent = "–";
    metricsPixels.textContent = "–";
    metricsSharpness.textContent = "–";
    metricsPSNR.textContent = "–";
    metricsSSIM.textContent = "–";
    metricsQuality.textContent = "–";
    improvementStoryText.textContent =
      "Once an image is enhanced, a short explanation of how much it improved will appear here.";
    downloadReportBtn.disabled = true;
    return;
  }

  metricsResolution.textContent =
    (m.input_resolution || "?") + " → " + (m.output_resolution || "?");

  metricsUpsscale.textContent =
    m.upscale_factor != null ? m.upscale_factor + "×" : "–";

  metricsPixels.textContent =
    m.pixel_increase_pct != null ? "+" + m.pixel_increase_pct + "% pixels" : "–";

  metricsSharpness.textContent =
    m.sharpness_gain_pct != null
      ? (m.sharpness_gain_pct >= 0 ? "+" : "") +
        m.sharpness_gain_pct +
        "% (estimated)"
      : "–";

  metricsPSNR.textContent =
    m.psnr_db != null ? m.psnr_db + " dB" : "–";

  metricsSSIM.textContent =
    m.ssim != null ? m.ssim : "–";

  metricsQuality.textContent =
    m.quality_score_pct != null ? m.quality_score_pct + " / 100" : "–";

  metricsSection.classList.remove("hidden");
  downloadReportBtn.disabled = false;

  // Improvement Story
  const inRes = m.input_resolution || "?";
  const outRes = m.output_resolution || "?";
  const sharpGain = m.sharpness_gain_pct;
  const psnr = m.psnr_db;
  const ssim = m.ssim;
  const q = m.quality_score_pct;

  let lines = [];
  lines.push(
    `The original CCTV frame started at ${inRes}, and after Real-ESRGAN enhancement it was upscaled to ${outRes}.`
  );

  if (typeof sharpGain === "number") {
    if (sharpGain > 0) {
      lines.push(
        `Estimated sharpness increased by about ${sharpGain}% compared to the input, making edges like faces, plates or text more readable.`
      );
    } else {
      lines.push(
        `The enhancement kept sharpness almost unchanged (${sharpGain}% change), focusing more on stabilizing noise and structure.`
      );
    }
  }

  if (typeof psnr === "number") {
    lines.push(
      `The PSNR against a simple bicubic baseline is around ${psnr} dB, indicating that the enhanced frame has noticeably better signal quality than a basic zoom.`
    );
  }

  if (typeof ssim === "number") {
    lines.push(
      `SSIM is about ${ssim}, which means the enhanced image still preserves the same overall shapes and structures as the baseline without distorting the scene.`
    );
  }

  if (typeof q === "number") {
    lines.push(
      `We summarise these into an approximate quality / accuracy score of ${q}/100 for this frame. Higher scores indicate that the enhancement is suitable for CCTV analysis and investigation.`
    );
  }

  improvementStoryText.textContent = lines.join(" ");
}

// Metric explanation clicks
labelPSNR.addEventListener("click", () => {
  metricHelpText.textContent =
    "PSNR (Peak Signal-to-Noise Ratio) compares the enhanced image to a simple bicubic upscaled baseline. Higher PSNR (in dB) usually means the enhancement has less distortion and cleaner details compared to traditional zoom.";
});

labelSSIM.addEventListener("click", () => {
  metricHelpText.textContent =
    "SSIM (Structural Similarity Index) measures how similar the structure of the enhanced image is to the baseline. Values close to 1.0 mean the key shapes and edges of the CCTV scene are preserved while details are improved.";
});

labelQuality.addEventListener("click", () => {
  metricHelpText.textContent =
    "The Quality / Accuracy Score is a simple combined score derived from PSNR, SSIM and sharpness gain. It gives a single number (0–100) to quickly judge whether the enhancement is good enough for CCTV investigation.";
});

// ---- Session Stats ----
function updateSessionStats() {
  if (!historyItems.length) {
    sessionStatsSection.classList.add("hidden");
    statsTotalImages.textContent = "0";
    statsAvgPSNR.textContent = "–";
    statsAvgSSIM.textContent = "–";
    statsBestQuality.textContent = "–";
    return;
  }

  sessionStatsSection.classList.remove("hidden");

  let total = historyItems.length;
  let sumPSNR = 0;
  let sumSSIM = 0;
  let countPSNR = 0;
  let countSSIM = 0;
  let bestQuality = null;

  historyItems.forEach((item) => {
    const m = item.metrics;
    if (!m) return;

    if (typeof m.psnr_db === "number") {
      sumPSNR += m.psnr_db;
      countPSNR++;
    }
    if (typeof m.ssim === "number") {
      sumSSIM += m.ssim;
      countSSIM++;
    }
    if (typeof m.quality_score_pct === "number") {
      if (bestQuality === null || m.quality_score_pct > bestQuality) {
        bestQuality = m.quality_score_pct;
      }
    }
  });

  statsTotalImages.textContent = String(total);
  statsAvgPSNR.textContent = countPSNR ? (sumPSNR / countPSNR).toFixed(2) : "–";
  statsAvgSSIM.textContent = countSSIM ? (sumSSIM / countSSIM).toFixed(4) : "–";
  statsBestQuality.textContent =
    bestQuality !== null ? bestQuality.toFixed(1) + " / 100" : "–";
}

// ---- History Rendering ----

function renderHistory() {
  historyList.innerHTML = "";

  if (historyItems.length === 0) {
    historySection.classList.add("hidden");
    updateSessionStats();
    return;
  }

  historySection.classList.remove("hidden");

  historyItems.forEach((item, idx) => {
    const wrapper = document.createElement("button");
    wrapper.type = "button";
    wrapper.className =
      "group relative w-28 h-28 rounded-xl overflow-hidden border border-slate-700 " +
      "bg-slate-900 hover:border-indigo-500/70 focus:outline-none " +
      "focus:ring-2 focus:ring-indigo-500/70 transition";

    const img = document.createElement("img");
    img.src = item.output;
    img.alt = "Enhanced thumbnail " + (idx + 1);
    img.className = "w-full h-full object-cover opacity-90 group-hover:opacity-100";

    const overlay = document.createElement("div");
    overlay.className =
      "absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 " +
      "flex items-center justify-center text-[10px] text-slate-100 font-medium transition";
    overlay.textContent = "Load";

    wrapper.appendChild(img);
    wrapper.appendChild(overlay);

    wrapper.addEventListener("click", () => {
      inputPreview.src = item.input;
      inputPreview.classList.remove("hidden");
      inputPlaceholder.classList.add("hidden");

      outputPreview.src = item.output;
      outputPreview.classList.remove("hidden");
      outputPlaceholder.classList.add("hidden");

      currentInputUrl = item.input;
      currentOutputUrl = item.output;
      currentBaselineUrl = item.baseline || null;
      compareButton.disabled = false;
      downloadImageBtn.disabled = false;

      currentMetrics = item.metrics || null;
      applyMetricsToUI(currentMetrics);
      refreshCircle();
      refreshModelComparison();

      errorMsg.classList.add("hidden");
      errorMsg.textContent = "";
    });

    historyList.appendChild(wrapper);
  });

  updateSessionStats();
}

// ---- Input change ----

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    inputPreview.src = ev.target.result;
    currentInputUrl = ev.target.result;
    inputPreview.classList.remove("hidden");
    inputPlaceholder.classList.add("hidden");

    mcInput.src = ev.target.result;
    mcInput.classList.remove("hidden");
    mcInputPlaceholder.classList.add("hidden");

    refreshCircle();
    refreshModelComparison();
  };
  reader.readAsDataURL(file);

  outputPreview.classList.add("hidden");
  outputPlaceholder.classList.remove("hidden");

  progressText.textContent = "Progress: waiting...";
  progressPercent.textContent = "";
  progressBarInner.style.width = "0%";

  currentOutputUrl = null;
  currentBaselineUrl = null;
  currentMetrics = null;
  compareButton.disabled = true;
  downloadImageBtn.disabled = true;
  downloadReportBtn.disabled = true;
  modelComparisonSection.classList.add("hidden");
  applyMetricsToUI(null);
  refreshCircle();
  refreshModelComparison();
  resetPipeline();
});

// ---- Form submit ----

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  errorMsg.classList.add("hidden");
  errorMsg.textContent = "";

  const file = fileInput.files[0];
  if (!file) {
    errorMsg.textContent = "Please choose an image first.";
    errorMsg.classList.remove("hidden");
    return;
  }

  enhanceButton.disabled = true;
  enhanceButton.textContent = "Enhancing...";
  outputPreview.classList.add("hidden");
  outputPlaceholder.classList.remove("hidden");
  progressText.textContent = "Progress: starting...";
  progressPercent.textContent = "";
  progressBarInner.style.width = "0%";

  currentOutputUrl = null;
  currentBaselineUrl = null;
  currentMetrics = null;
  compareButton.disabled = true;
  downloadImageBtn.disabled = true;
  downloadReportBtn.disabled = true;
  modelComparisonSection.classList.add("hidden");
  applyMetricsToUI(null);
  refreshCircle();
  refreshModelComparison();
  resetPipeline();

  const formData = new FormData();
  formData.append("image", file);

  try {
    const res = await fetch("/start", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error || "Unknown error.");
    }

    if (data.input_url) {
      inputPreview.src = data.input_url;
      currentInputUrl = data.input_url;
      inputPreview.classList.remove("hidden");
      inputPlaceholder.classList.add("hidden");

      mcInput.src = data.input_url;
      mcInput.classList.remove("hidden");
      mcInputPlaceholder.classList.add("hidden");
    }

    polling = true;
    pollStatus();
  } catch (err) {
    errorMsg.textContent = err.message;
    errorMsg.classList.remove("hidden");
    enhanceButton.disabled = false;
    enhanceButton.textContent = "Enhance (Real-ESRGAN x4)";
  }
});

// ---- Poll status ----

async function pollStatus() {
  if (!polling) return;

  try {
    const res = await fetch("/status");
    const data = await res.json();

    if (data.progress_text) {
      progressText.textContent = "Progress: " + data.progress_text;
    }

    if (typeof data.progress_value === "number") {
      const pct = Math.round(data.progress_value * 100);
      progressPercent.textContent = pct + "%";
      progressBarInner.style.width = pct + "%";
      updatePipeline(data.progress_value, data.running);
    }

    if (data.error) {
      errorMsg.textContent = data.error;
      errorMsg.classList.remove("hidden");
      polling = false;
      enhanceButton.disabled = false;
      enhanceButton.textContent = "Enhance (Real-ESRGAN x4)";
      resetPipeline();
      return;
    }

    if (data.input_url) {
      currentInputUrl = data.input_url;
      inputPreview.src = data.input_url;
      inputPreview.classList.remove("hidden");
      inputPlaceholder.classList.add("hidden");

      mcInput.src = data.input_url;
      mcInput.classList.remove("hidden");
      mcInputPlaceholder.classList.add("hidden");
    }

    if (data.output_url) {
      currentOutputUrl = data.output_url;
      outputPreview.src = data.output_url;
      outputPreview.classList.remove("hidden");
      outputPlaceholder.classList.add("hidden");
      downloadImageBtn.disabled = false;
      compareButton.disabled = false;
    }

    if (data.baseline_url) {
      currentBaselineUrl = data.baseline_url;
    }

    refreshCircle();
    refreshModelComparison();

    if (data.metrics) {
      currentMetrics = data.metrics;
      applyMetricsToUI(currentMetrics);
    }

    if (!data.running && data.output_url && data.input_url && !data.error) {
      historyItems.unshift({
        input: data.input_url,
        output: data.output_url,
        baseline: data.baseline_url || null,
        metrics: data.metrics || null,
      });
      historyItems = historyItems.slice(0, 5);
      renderHistory();
    }

    if (!data.running) {
      enhanceButton.disabled = false;
      enhanceButton.textContent = "Enhance (Real-ESRGAN x4)";
      polling = false;
      // Final stage pipeline should show "complete"
      updatePipeline(1.0, true);
      return;
    }

    setTimeout(pollStatus, 500);
  } catch (err) {
    console.error(err);
    polling = false;
    enhanceButton.disabled = false;
    enhanceButton.textContent = "Enhance (Real-ESRGAN x4)";
    resetPipeline();
  }
}

// ---- Download buttons ----

downloadImageBtn.addEventListener("click", () => {
  if (!currentOutputUrl) return;
  const link = document.createElement("a");
  link.href = currentOutputUrl;
  link.download = "enhanced_image.png";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

downloadReportBtn.addEventListener("click", () => {
  if (!currentMetrics) return;

  const m = currentMetrics;
  const lines = [
    "CCTV Image Enhancement Quality & Accuracy Report",
    "----------------------------------------------",
    "",
    `Input resolution:   ${m.input_resolution || "?"}`,
    `Output resolution:  ${m.output_resolution || "?"}`,
    "",
    `Upscale factor:     ${m.upscale_factor != null ? m.upscale_factor + "x" : "?"}`,
    `Pixel increase:     ${m.pixel_increase_pct != null ? "+" + m.pixel_increase_pct + "%" : "?"}`,
    "",
    `Estimated sharpness (input):   ${m.sharpness_input}`,
    `Estimated sharpness (output):  ${m.sharpness_output}`,
    `Sharpness gain (approx):       ${
      m.sharpness_gain_pct != null ? m.sharpness_gain_pct + "%" : "?"
    }`,
    "",
    `PSNR vs. simple upscaled baseline: ${m.psnr_db != null ? m.psnr_db + " dB" : "?"}`,
    `SSIM vs. simple upscaled baseline: ${m.ssim != null ? m.ssim : "?"}`,
    `Approx. quality / accuracy score:  ${
      m.quality_score_pct != null ? m.quality_score_pct + " / 100" : "?"
    }`,
    "",
    "Note:",
    "- In real CCTV scenarios, there is usually no perfect ground-truth high-resolution image.",
    "- Here, we create a simple upscaled baseline (just interpolation) and compare the Real-ESRGAN",
    "  output to that baseline using PSNR and SSIM.",
    "- Higher values indicate that the enhanced image preserves structure while adding detail."
  ];

  const text = lines.join("\n");
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "cctv_enhancement_quality_report.txt";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
});

// Initial pipeline state
resetPipeline();

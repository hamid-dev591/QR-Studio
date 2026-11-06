/** QR Scanner: camera + image decoding, all processed locally. */
import { LIMITS } from './config.js';
import { getLanguage, t } from './i18n.js';
import { byteLength, detectContentType, openableUrl } from './payloads.js';
import { typeIcon, typeLabel } from './records.js';
import { addScan, clearScans, getScans } from './storage.js';
import { applyIcons, confirmDialog, emptyState, toast } from './ui.js';
import {
  copyText, escapeHtml, formatBytes, formatDate, loadScript, relativeTime, truncate
} from './utils.js';

const MAX_CONTENT = 4000;
const CAMERA_INTERVAL = 320;

/**
 * Scanner work survives a language refresh: the current result, upload preview
 * and camera selection live at module scope.
 */
const state = {
  mode: 'camera',
  result: null,
  upload: null,
  uploadError: null,
  deviceId: '',
  devices: [],
  cameraError: null,
  status: { kind: 'ready', key: 'scanner.status.ready' },
  torch: false
};

let view = null;
let dom = null;
let stream = null;
let scanTimer = null;
let statusTimer = null;
let detecting = false;
let frameSkip = 0;
let runId = 0;
let uploadToken = 0;
let jsqrPromise = null;
let detectorPromise = null;
let workCanvas = null;
let lastHit = { content: '', at: 0 };
let visibilityHandler = null;
let unbind = null;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function currentLang() {
  return getLanguage();
}

function timeLabel(timestamp) {
  return formatDate(timestamp, currentLang(), { dateStyle: undefined, timeStyle: 'short' });
}

function scansForDisplay() {
  return getScans().map((scan) => ({
    ...scan,
    type: scan.type || detectContentType(scan.content)
  }));
}

function findScan(id) {
  return scansForDisplay().find((scan) => scan.id === id) || null;
}

function statusIcon(kind) {
  if (kind === 'found') return 'circle-check';
  if (kind === 'stopped') return 'camera-off';
  if (kind === 'error') return 'alert-triangle';
  if (kind === 'starting') return 'loader-circle';
  return 'scan-line';
}

function statusClass(kind) {
  if (kind === 'error') return 'scan-status is-error';
  if (kind === 'starting' || kind === 'scanning' || kind === 'found') return 'scan-status is-live';
  return 'scan-status';
}

/* ------------------------------------------------------------------ */
/* Markup                                                              */
/* ------------------------------------------------------------------ */

function statusMarkup() {
  const { kind, key } = state.status;
  const icon = kind === 'starting'
    ? '<span class="spinner" aria-hidden="true"></span>'
    : `<i class="icon" data-lucide="${statusIcon(kind)}"></i>`;
  return `<div class="${statusClass(kind)}" data-scan-status role="status">
    ${icon}
    <span>${escapeHtml(t(key))}</span>
  </div>`;
}

function cameraErrorMarkup() {
  if (!state.cameraError) return '';
  return `<div class="camera-error" role="alert">
    <i class="icon" data-lucide="alert-triangle"></i>
    <div>
      <strong>${escapeHtml(t('scanner.status.error'))}</strong>
      <p>${escapeHtml(t(state.cameraError))}</p>
    </div>
  </div>`;
}

function deviceOptionsMarkup() {
  const options = [`<option value="" ${state.deviceId ? '' : 'selected'}>${escapeHtml(t('scanner.camera.defaultDevice'))}</option>`];
  state.devices.forEach((device, index) => {
    options.push(`<option value="${escapeHtml(device.deviceId)}" ${state.deviceId === device.deviceId ? 'selected' : ''}>${escapeHtml(
      device.label || t('scanner.camera.device', { index: index + 1 })
    )}</option>`);
  });
  return options.join('');
}

function tabsMarkup() {
  const tab = (mode, icon) => {
    const active = state.mode === mode;
    return `<button type="button" class="tab ${active ? 'is-active' : ''}" data-scan-mode="${mode}"
      role="tab" aria-selected="${active}">
      <i class="icon" data-lucide="${icon}"></i>
      <span>${escapeHtml(t(`scanner.tabs.${mode}`))}</span>
    </button>`;
  };
  return `<div class="tabs" role="tablist" aria-label="${escapeHtml(t('scanner.title'))}">
    ${tab('camera', 'camera')}
    ${tab('upload', 'image')}
  </div>`;
}

function cameraBodyMarkup() {
  return `<div class="scan-stage" data-scan-stage>
    <video data-scan-video playsinline muted autoplay aria-label="${escapeHtml(t('scanner.camera.select'))}"></video>
    <canvas data-scan-canvas aria-hidden="true"></canvas>
    <div class="scan-overlay" aria-hidden="true">
      <div class="scan-frame"><span></span><span class="scan-line"></span></div>
    </div>
    <div class="scan-placeholder" data-scan-placeholder>
      <span class="scan-placeholder-icon"><i class="icon" data-lucide="qr-code"></i></span>
      <strong>${escapeHtml(t('scanner.placeholder.title'))}</strong>
      <p>${escapeHtml(t('scanner.placeholder.desc'))}</p>
      <button type="button" class="btn btn-primary btn-sm" data-camera-start>
        <i class="icon" data-lucide="camera"></i>
        <span>${escapeHtml(t('scanner.placeholder.start'))}</span>
      </button>
    </div>
  </div>
  <div data-camera-error-slot>${cameraErrorMarkup()}</div>
  <div class="scan-controls">
    <div class="select-wrap">
      <select class="select" data-camera-select aria-label="${escapeHtml(t('scanner.camera.select'))}">
        ${deviceOptionsMarkup()}
      </select>
      <i class="icon" data-lucide="chevrons-up-down"></i>
    </div>
    <button type="button" class="btn btn-primary" data-camera-toggle>
      <i class="icon" data-lucide="camera"></i>
      <span data-camera-label>${escapeHtml(t('scanner.camera.start'))}</span>
    </button>
  </div>
  ${statusMarkup()}`;
}

function uploadPreviewMarkup() {
  if (!state.upload) return '';
  return `<div class="upload-preview" data-upload-preview>
    <img src="${escapeHtml(state.upload.url)}" alt="${escapeHtml(t('scanner.upload.preview'))}">
    <div class="upload-preview-info">
      <div class="upload-preview-name">${escapeHtml(state.upload.name)}</div>
      <div class="upload-preview-meta">${escapeHtml(formatBytes(state.upload.size))}</div>
    </div>
    <button type="button" class="btn btn-icon btn-ghost" data-upload-clear
      aria-label="${escapeHtml(t('common.remove'))}" title="${escapeHtml(t('common.remove'))}">
      <i class="icon" data-lucide="x"></i>
    </button>
  </div>`;
}

function uploadErrorMarkup() {
  if (!state.uploadError) return '';
  return `<div class="scan-warning-note upload-feedback" role="alert">
    <i class="icon" data-lucide="alert-triangle"></i>
    <span>${escapeHtml(t(state.uploadError))}</span>
  </div>`;
}

function uploadBodyMarkup() {
  return `<div class="upload-stage">
    <div class="upload-drop" data-upload-drop role="button" tabindex="0"
      aria-label="${escapeHtml(t('scanner.upload.browse'))}">
      <span class="scan-placeholder-icon"><i class="icon" data-lucide="image-plus"></i></span>
      <strong>${escapeHtml(t('scanner.upload.title'))}</strong>
      <p>${escapeHtml(t('scanner.upload.desc'))}</p>
      <small>${escapeHtml(t('scanner.upload.hint'))}</small>
      <input class="sr-only" type="file" accept="image/*" data-upload-input>
    </div>
    ${uploadPreviewMarkup()}
    ${uploadErrorMarkup()}
  </div>
  ${statusMarkup()}`;
}

function panelBodyMarkup() {
  return state.mode === 'upload' ? uploadBodyMarkup() : cameraBodyMarkup();
}

function resultMarkup() {
  const result = state.result;
  if (!result) {
    return `<div class="scan-result-head">
      <span class="preview-meta-icon"><i class="icon" data-lucide="scan-line"></i></span>
      <div class="scan-result-title">
        <h3>${escapeHtml(t('scanner.result.title'))}</h3>
        <p>${escapeHtml(t('scanner.result.empty'))}</p>
      </div>
    </div>
    <div class="scan-result-body">
      ${emptyState({
        icon: 'scan-line',
        title: t('scanner.result.empty'),
        description: t('scanner.result.emptyDesc')
      })}
    </div>`;
  }

  const url = openableUrl(result.content);
  const bytes = byteLength(result.content);
  return `<div class="scan-result-head">
    <span class="preview-meta-icon"><i class="icon" data-lucide="${typeIcon(result.type)}"></i></span>
    <div class="scan-result-title">
      <h3>${escapeHtml(t('scanner.result.title'))}</h3>
      <p>${escapeHtml(t('scanner.result.scannedAt', { time: timeLabel(result.at) }))}</p>
    </div>
    <span class="badge badge-accent">${escapeHtml(typeLabel(result.type))}</span>
  </div>
  <div class="scan-result-body">
    <pre class="scan-result-content" data-result-content>${escapeHtml(result.content)}</pre>
    <div class="scan-result-meta">
      <span class="badge badge-neutral">${escapeHtml(t('scanner.result.type'))}: ${escapeHtml(typeLabel(result.type))}</span>
      <span class="badge badge-neutral">${formatBytes(bytes)}</span>
      <span class="badge badge-success"><i class="icon" data-lucide="shield-check"></i>${escapeHtml(t('common.local'))}</span>
    </div>
    <div class="${url ? 'scan-warning-note' : 'scan-safe-note'}">
      <i class="icon" data-lucide="${url ? 'alert-triangle' : 'shield-check'}"></i>
      <span>${escapeHtml(t(url ? 'scanner.result.openWarning' : 'scanner.privacy.body'))}</span>
    </div>
    <div class="scan-result-actions">
      <button type="button" class="btn btn-secondary btn-sm" data-result-copy>
        <i class="icon" data-lucide="copy"></i>
        <span>${escapeHtml(t('scanner.result.copy'))}</span>
      </button>
      ${url ? `<button type="button" class="btn btn-secondary btn-sm" data-result-open>
        <i class="icon" data-lucide="external-link"></i>
        <span>${escapeHtml(t('scanner.result.open'))}</span>
      </button>` : ''}
      <span class="spacer"></span>
      <button type="button" class="btn btn-ghost btn-sm" data-result-again>
        <i class="icon" data-lucide="refresh-cw"></i>
        <span>${escapeHtml(t('scanner.result.again'))}</span>
      </button>
      <button type="button" class="btn btn-ghost btn-sm" data-result-clear>
        <i class="icon" data-lucide="x"></i>
        <span>${escapeHtml(t('scanner.result.clear'))}</span>
      </button>
    </div>
  </div>`;
}

function historyItemMarkup(scan) {
  const url = openableUrl(scan.content);
  return `<div class="scan-item">
    <span class="scan-item-icon"><i class="icon" data-lucide="${typeIcon(scan.type)}"></i></span>
    <button type="button" class="scan-item-body" data-scan-use="${escapeHtml(scan.id)}">
      <span class="scan-item-content">${escapeHtml(truncate(scan.content.replace(/\s+/g, ' ').trim(), 150))}</span>
      <span class="scan-item-meta">
        <span>${escapeHtml(typeLabel(scan.type))}</span>
        <span aria-hidden="true">·</span>
        <span>${escapeHtml(relativeTime(scan.at, currentLang()))}</span>
      </span>
    </button>
    <div class="scan-item-actions">
      <button type="button" class="record-action" data-scan-copy="${escapeHtml(scan.id)}"
        aria-label="${escapeHtml(t('scanner.history.copy'))}" title="${escapeHtml(t('scanner.history.copy'))}">
        <i class="icon" data-lucide="copy"></i>
      </button>
      ${url ? `<button type="button" class="record-action" data-scan-open="${escapeHtml(scan.id)}"
        aria-label="${escapeHtml(t('scanner.history.open'))}" title="${escapeHtml(t('scanner.history.open'))}">
        <i class="icon" data-lucide="external-link"></i>
      </button>` : ''}
    </div>
  </div>`;
}

function historyItemsMarkup() {
  const scans = scansForDisplay();
  if (!scans.length) {
    return `<div class="scan-history-empty">
      <i class="icon" data-lucide="history"></i>
      <strong>${escapeHtml(t('scanner.history.empty'))}</strong>
      <span>${escapeHtml(t('scanner.history.emptyDesc'))}</span>
    </div>`;
  }
  return scans.map(historyItemMarkup).join('');
}

function historyCardMarkup() {
  const hasScans = getScans().length > 0;
  return `<section class="card">
    <div class="card-header">
      <div>
        <h3 class="card-title">${escapeHtml(t('scanner.history.title'))}</h3>
        <p class="card-subtitle">${escapeHtml(t('scanner.history.desc'))}</p>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-scans-clear ${hasScans ? '' : 'hidden'}>
        <i class="icon" data-lucide="trash-2"></i>
        <span>${escapeHtml(t('scanner.history.clear'))}</span>
      </button>
    </div>
    <div class="card-body">
      <div class="scan-history-list" data-scan-history>${historyItemsMarkup()}</div>
    </div>
  </section>`;
}

function shellMarkup() {
  return `<div class="scanner-page view-enter">
    <div class="page-intro">
      <div>
        <h2>${escapeHtml(t('scanner.title'))}</h2>
        <p>${escapeHtml(t('scanner.subtitle'))}</p>
      </div>
      <span class="badge badge-accent">
        <i class="icon" data-lucide="shield-check"></i>
        <span>${escapeHtml(t('scanner.cameraNote'))}</span>
      </span>
    </div>
    <div class="scanner-layout">
      <div class="scanner-main">
        <section class="card scan-panel">
          <div class="scan-panel-head">
            ${tabsMarkup()}
            <button type="button" class="btn btn-icon btn-secondary torch-btn" data-torch
              aria-pressed="false" title="${escapeHtml(t('scanner.camera.torchOff'))}" hidden>
              <i class="icon" data-lucide="flashlight"></i>
            </button>
          </div>
          <div data-scan-panel>${panelBodyMarkup()}</div>
        </section>
        <section class="card scan-result" data-scan-result>${resultMarkup()}</section>
      </div>
      <aside class="scanner-side">
        <section class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">${escapeHtml(t('scanner.privacy.title'))}</h3>
            </div>
          </div>
          <div class="card-body stack">
            <div class="scan-safe-note">
              <i class="icon" data-lucide="shield-check"></i>
              <span>${escapeHtml(t('scanner.privacy.body'))}</span>
            </div>
            <div class="scan-tips">
              <div class="scan-tip"><i class="icon" data-lucide="scan-line"></i><span>${escapeHtml(t('scanner.tips.one'))}</span></div>
              <div class="scan-tip"><i class="icon" data-lucide="sun"></i><span>${escapeHtml(t('scanner.tips.two'))}</span></div>
              <div class="scan-tip"><i class="icon" data-lucide="image-plus"></i><span>${escapeHtml(t('scanner.tips.three'))}</span></div>
            </div>
          </div>
        </section>
        ${historyCardMarkup()}
        <div class="banner banner-info">
          <i class="icon" data-lucide="info"></i>
          <div>${escapeHtml(t('scanner.cameraNote'))}</div>
        </div>
      </aside>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function paintStatus() {
  if (!dom?.status) return;
  const { kind, key } = state.status;
  const icon = kind === 'starting'
    ? '<span class="spinner" aria-hidden="true"></span>'
    : `<i class="icon" data-lucide="${statusIcon(kind)}"></i>`;
  dom.status.className = statusClass(kind);
  dom.status.innerHTML = `${icon}<span>${escapeHtml(t(key))}</span>`;
  applyIcons(dom.status);
}

function setStatus(kind, key, { autoReset = false } = {}) {
  clearTimeout(statusTimer);
  state.status = { kind, key };
  paintStatus();
  if (autoReset) {
    statusTimer = setTimeout(() => {
      if (!dom) return;
      if (stream) setStatus('scanning', 'scanner.status.scanning');
      else setStatus('ready', 'scanner.status.ready');
    }, 1600);
  }
}

function paintCameraError() {
  if (!dom?.errorSlot) return;
  dom.errorSlot.innerHTML = cameraErrorMarkup();
  applyIcons(dom.errorSlot);
}

function renderDeviceSelect() {
  if (!dom?.deviceSelect) return;
  dom.deviceSelect.innerHTML = deviceOptionsMarkup();
  dom.deviceSelect.disabled = state.devices.length === 0;
}

function supportsTorch() {
  if (!stream) return false;
  const track = stream.getVideoTracks?.()[0];
  if (!track || typeof track.getCapabilities !== 'function') return false;
  try {
    return Boolean(track.getCapabilities().torch);
  } catch {
    return false;
  }
}

function syncTorchButton() {
  if (!dom?.torch) return;
  const supported = supportsTorch();
  dom.torch.hidden = !supported;
  dom.torch.classList.toggle('is-active', state.torch && supported);
  dom.torch.setAttribute('aria-pressed', state.torch ? 'true' : 'false');
  dom.torch.setAttribute('title', t(state.torch ? 'scanner.camera.torchOn' : 'scanner.camera.torchOff'));
  dom.torch.setAttribute('aria-label', t(state.torch ? 'scanner.camera.torchOn' : 'scanner.camera.torchOff'));
}

function syncCameraUi() {
  if (!dom) return;
  const live = Boolean(stream);
  const starting = state.status.kind === 'starting';
  dom.stage?.classList.toggle('is-live', live);
  if (dom.placeholder) dom.placeholder.hidden = live;
  if (dom.toggle) {
    dom.toggle.disabled = starting;
    const label = dom.toggle.querySelector('[data-camera-label]');
    if (label) label.textContent = t(live ? 'scanner.camera.stop' : 'scanner.camera.start');
    const icon = dom.toggle.querySelector('.icon');
    if (icon) icon.setAttribute('data-lucide', live ? 'square' : 'camera');
    applyIcons(dom.toggle);
  }
  dom.startButtons?.forEach((button) => { button.disabled = starting || live; });
  if (dom.deviceSelect) dom.deviceSelect.disabled = state.devices.length === 0 || starting;
  syncTorchButton();
  paintCameraError();
}

function cachePanelDom() {
  if (!dom?.panel) return;
  dom.video = dom.panel.querySelector('[data-scan-video]');
  dom.canvas = dom.panel.querySelector('[data-scan-canvas]');
  dom.stage = dom.panel.querySelector('[data-scan-stage]');
  dom.placeholder = dom.panel.querySelector('[data-scan-placeholder]');
  dom.toggle = dom.panel.querySelector('[data-camera-toggle]');
  dom.startButtons = Array.from(dom.panel.querySelectorAll('[data-camera-start]'));
  dom.deviceSelect = dom.panel.querySelector('[data-camera-select]');
  dom.status = dom.panel.querySelector('[data-scan-status]');
  dom.errorSlot = dom.panel.querySelector('[data-camera-error-slot]');
  dom.uploadInput = dom.panel.querySelector('[data-upload-input]');
  dom.uploadDrop = dom.panel.querySelector('[data-upload-drop]');
}

function renderPanel() {
  if (!dom?.panel) return;
  dom.panel.innerHTML = panelBodyMarkup();
  applyIcons(dom.panel);
  cachePanelDom();
  paintStatus();
  syncCameraUi();
}

function renderTabs() {
  if (!view) return;
  view.querySelectorAll('[data-scan-mode]').forEach((button) => {
    const active = button.getAttribute('data-scan-mode') === state.mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
}

function renderResult() {
  const container = view?.querySelector('[data-scan-result]');
  if (!container) return;
  container.innerHTML = resultMarkup();
  applyIcons(container);
}

function renderHistory() {
  const list = view?.querySelector('[data-scan-history]');
  if (list) {
    list.innerHTML = historyItemsMarkup();
    applyIcons(list);
  }
  const clear = view?.querySelector('[data-scans-clear]');
  if (clear) clear.hidden = getScans().length === 0;
}

function renderDynamic() {
  renderResult();
  renderHistory();
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

function getWorkCanvas() {
  if (!workCanvas) {
    workCanvas = document.createElement('canvas');
  }
  return workCanvas;
}

async function loadJsQr() {
  if (typeof window.jsQR === 'function') return window.jsQR;
  if (!jsqrPromise) {
    jsqrPromise = loadScript('./lib/jsqr/jsQR.js', 'jsQR').catch((error) => {
      jsqrPromise = null;
      throw error;
    });
  }
  return jsqrPromise;
}

async function getDetector() {
  if (typeof window.BarcodeDetector !== 'function') return null;
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
          const formats = await window.BarcodeDetector.getSupportedFormats();
          if (!Array.isArray(formats) || !formats.includes('qr_code')) return null;
        }
        return new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        return null;
      }
    })();
  }
  return detectorPromise;
}

function decodeWithJsQr(source) {
  return loadJsQr().then((jsQR) => {
    const width = Number(source.videoWidth || source.naturalWidth || source.width) || 0;
    const height = Number(source.videoHeight || source.naturalHeight || source.height) || 0;
    if (!width || !height) return null;
    const isVideo = source.tagName === 'VIDEO';
    const maxSide = isVideo ? 720 : 1800;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));
    const canvas = getWorkCanvas();
    canvas.width = targetW;
    canvas.height = targetH;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.clearRect(0, 0, targetW, targetH);
    context.drawImage(source, 0, 0, targetW, targetH);
    const pixels = context.getImageData(0, 0, targetW, targetH);
    const code = jsQR(pixels.data, targetW, targetH, { inversionAttempts: 'attemptBoth' });
    return code?.data || null;
  });
}

async function decodeSource(source) {
  const detector = await getDetector();
  if (detector) {
    try {
      const codes = await detector.detect(source);
      const raw = codes?.find((code) => code?.rawValue)?.rawValue;
      if (raw) return raw;
      // BarcodeDetector is fast but can miss difficult symbols; try the local
      // jsQR fallback occasionally rather than paying that cost every frame.
      const isVideo = source.tagName === 'VIDEO';
      if (isVideo) {
        frameSkip += 1;
        if (frameSkip % 4 !== 0) return null;
      }
    } catch {
      // Fall through to jsQR.
    }
  }
  return decodeWithJsQr(source);
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

function releaseStream() {
  runId += 1;
  clearInterval(scanTimer);
  scanTimer = null;
  detecting = false;
  if (stream) {
    stream.getTracks().forEach((track) => {
      try { track.stop(); } catch { /* already stopped */ }
    });
    stream = null;
  }
  if (dom?.video) {
    try { dom.video.pause(); } catch { /* ignore */ }
    try { dom.video.srcObject = null; } catch { /* ignore */ }
  }
  state.torch = false;
}

function stopCamera({ silent = false, key = 'scanner.status.stopped' } = {}) {
  releaseStream();
  clearTimeout(statusTimer);
  syncCameraUi();
  if (!silent) setStatus('stopped', key);
}

function cameraErrorKey(error) {
  const name = String(error?.name || '');
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'scanner.errors.denied';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'scanner.errors.notFound';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'scanner.errors.busy';
  return 'scanner.errors.generic';
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    state.devices = list
      .filter((device) => device.kind === 'videoinput')
      .map((device) => ({ deviceId: device.deviceId, label: String(device.label || '') }));
    if (state.deviceId && !state.devices.some((device) => device.deviceId === state.deviceId)) {
      state.deviceId = '';
    }
    renderDeviceSelect();
  } catch (error) {
    console.warn('[scanner] could not enumerate cameras', error);
  }
}

function startLoop(token) {
  clearInterval(scanTimer);
  frameSkip = 0;
  scanTimer = setInterval(() => {
    detectFrame(token);
  }, CAMERA_INTERVAL);
}

async function detectFrame(token) {
  if (token !== runId || !stream || detecting || !dom?.video) return;
  const video = dom.video;
  if (video.readyState < 2 || !video.videoWidth) return;
  detecting = true;
  try {
    const content = await decodeSource(video);
    if (content && token === runId) handleDetection(content, 'camera');
  } catch (error) {
    // Keep the camera alive; a single undecodable frame is not fatal.
    console.warn('[scanner] frame decode failed', error);
  } finally {
    detecting = false;
  }
}

async function startCamera() {
  if (stream) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    state.cameraError = window.isSecureContext ? 'scanner.errors.unsupported' : 'scanner.errors.insecure';
    setStatus('error', 'scanner.status.error');
    syncCameraUi();
    return;
  }

  stopCamera({ silent: true });
  const token = ++runId;
  state.cameraError = null;
  setStatus('starting', 'scanner.status.starting');
  syncCameraUi();

  const videoConstraints = state.deviceId
    ? {
      deviceId: { exact: state.deviceId },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
    : {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    };

  try {
    const nextStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints
    });
    if (token !== runId || state.mode !== 'camera' || !dom?.video) {
      nextStream.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = nextStream;
    dom.video.srcObject = stream;
    try {
      await dom.video.play();
    } catch {
      // Autoplay is muted; some browsers still resolve on the next frame.
    }
    if (token !== runId) {
      releaseStream();
      return;
    }
    await refreshDevices();
    setStatus('scanning', 'scanner.status.scanning');
    syncCameraUi();
    startLoop(token);
  } catch (error) {
    if (token !== runId) return;
    releaseStream();
    const key = cameraErrorKey(error);
    state.cameraError = key;
    setStatus('error', 'scanner.status.error');
    syncCameraUi();
    toast(t(key), { type: 'error', duration: 5500 });
  }
}

async function toggleTorch() {
  if (!stream) return;
  const track = stream.getVideoTracks?.()[0];
  if (!track || typeof track.applyConstraints !== 'function') {
    toast(t('scanner.errors.torch'), { type: 'warning' });
    return;
  }
  const next = !state.torch;
  try {
    await track.applyConstraints({ advanced: [{ torch: next }] });
    state.torch = next;
    syncTorchButton();
  } catch (error) {
    console.warn('[scanner] torch failed', error);
    state.torch = false;
    syncTorchButton();
    toast(t('scanner.errors.torch'), { type: 'warning' });
  }
}

/* ------------------------------------------------------------------ */
/* Detection results                                                   */
/* ------------------------------------------------------------------ */

function handleDetection(rawContent, source) {
  const text = String(rawContent || '').trim();
  if (!text) return;
  const now = Date.now();
  if (lastHit.content === text && now - lastHit.at < 2200) return;
  lastHit = { content: text, at: now };

  const content = text.slice(0, MAX_CONTENT);
  state.result = {
    content,
    type: detectContentType(content),
    at: now,
    source
  };
  try {
    addScan({ content, type: state.result.type });
    toast(t('toast.scanSaved'), { type: 'success', duration: 2400 });
  } catch (error) {
    console.error('[scanner] could not save scan', error);
    toast(t('toast.storageFull'), { type: 'warning' });
  }
  renderResult();
  renderHistory();

  if (source === 'camera') {
    if (stream) setStatus('found', 'scanner.status.found', { autoReset: true });
  } else {
    setStatus('found', 'scanner.status.found');
  }
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

function releaseUpload() {
  uploadToken += 1;
  if (state.upload?.url) {
    try { URL.revokeObjectURL(state.upload.url); } catch { /* ignore */ }
  }
  state.upload = null;
  state.uploadError = null;
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'));
    image.src = url;
  });
}

async function handleUpload(file) {
  if (!file) return;
  const looksImage = /^image\//i.test(file.type || '') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || '');
  if (!looksImage) {
    toast(t('scanner.upload.invalid'), { type: 'error' });
    return;
  }
  if (file.size > LIMITS.imageBytes) {
    toast(t('scanner.upload.tooLarge'), { type: 'error' });
    return;
  }

  releaseUpload();
  const token = uploadToken;
  state.upload = {
    name: file.name || 'image',
    size: file.size,
    url: URL.createObjectURL(file)
  };
  state.uploadError = null;
  setStatus('starting', 'scanner.upload.analyzing');
  renderPanel();

  try {
    const image = await loadImageElement(state.upload.url);
    if (token !== uploadToken || !view) return;
    const content = await decodeSource(image);
    if (token !== uploadToken || !view) return;
    if (!content) {
      state.uploadError = 'scanner.upload.decodeFailed';
      setStatus('error', 'scanner.upload.decodeFailed');
      renderPanel();
      toast(t('scanner.upload.decodeFailed'), { type: 'warning' });
      return;
    }
    state.uploadError = null;
    handleDetection(content, 'upload');
  } catch (error) {
    if (token !== uploadToken || !view) return;
    console.error('[scanner] image decode failed', error);
    state.uploadError = 'scanner.errors.decode';
    setStatus('error', 'scanner.errors.decode');
    renderPanel();
    toast(t('scanner.errors.decode'), { type: 'error' });
  }
}

/* ------------------------------------------------------------------ */
/* Shared actions                                                      */
/* ------------------------------------------------------------------ */

async function copyContent(text) {
  try {
    await copyText(text);
    toast(t('toast.copyPayload'), { type: 'success' });
  } catch {
    toast(t('toast.copyFailed'), { type: 'error' });
  }
}

function openContent(text) {
  const url = openableUrl(text);
  if (!url) {
    toast(t('scanner.history.noLink'), { type: 'info' });
    return;
  }
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (error) {
    console.warn('[scanner] open failed', error);
    toast(t('scanner.history.noLink'), { type: 'warning' });
  }
}

function showScan(scan) {
  if (!scan) return;
  state.result = {
    content: String(scan.content || '').slice(0, MAX_CONTENT),
    type: scan.type || detectContentType(scan.content),
    at: Number(scan.at) || Date.now(),
    source: 'history'
  };
  renderResult();
  view?.querySelector('[data-scan-result]')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function switchMode(mode) {
  const next = mode === 'upload' ? 'upload' : 'camera';
  if (next === state.mode) return;
  if (state.mode === 'camera') stopCamera({ silent: true });
  state.mode = next;
  clearTimeout(statusTimer);
  setStatus('ready', 'scanner.status.ready');
  renderTabs();
  renderPanel();
}

function scanAgain() {
  state.result = null;
  renderResult();
  if (state.mode === 'camera') {
    if (!stream) startCamera();
    else setStatus('scanning', 'scanner.status.scanning');
  } else {
    dom?.uploadInput?.click();
  }
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

async function onViewClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const modeButton = target.closest('[data-scan-mode]');
  if (modeButton) {
    switchMode(modeButton.getAttribute('data-scan-mode'));
    return;
  }

  if (target.closest('[data-camera-start], [data-camera-toggle]')) {
    if (stream) stopCamera();
    else startCamera();
    return;
  }

  if (target.closest('[data-torch]')) {
    toggleTorch();
    return;
  }

  const uploadDrop = target.closest('[data-upload-drop]');
  if (uploadDrop && !target.closest('[data-upload-input]')) {
    dom?.uploadInput?.click();
    return;
  }

  if (target.closest('[data-upload-clear]')) {
    releaseUpload();
    setStatus('ready', 'scanner.status.ready');
    renderPanel();
    return;
  }

  if (target.closest('[data-result-copy]') && state.result) {
    copyContent(state.result.content);
    return;
  }

  if (target.closest('[data-result-open]') && state.result) {
    openContent(state.result.content);
    return;
  }

  if (target.closest('[data-result-clear]')) {
    state.result = null;
    renderResult();
    return;
  }

  if (target.closest('[data-result-again]')) {
    scanAgain();
    return;
  }

  const historyCopy = target.closest('[data-scan-copy]');
  if (historyCopy) {
    const scan = findScan(historyCopy.getAttribute('data-scan-copy'));
    if (scan) copyContent(scan.content);
    return;
  }

  const historyOpen = target.closest('[data-scan-open]');
  if (historyOpen) {
    const scan = findScan(historyOpen.getAttribute('data-scan-open'));
    if (scan) openContent(scan.content);
    return;
  }

  const historyUse = target.closest('[data-scan-use]');
  if (historyUse) {
    showScan(findScan(historyUse.getAttribute('data-scan-use')));
    return;
  }

  if (target.closest('[data-scans-clear]')) {
    if (!getScans().length) return;
    const confirmed = await confirmDialog({
      title: t('scanner.history.clearTitle'),
      message: t('scanner.history.clearMessage'),
      confirmLabel: t('scanner.history.clear'),
      cancelLabel: t('common.cancel'),
      danger: true,
      icon: 'trash-2',
      checkboxLabel: t('history.clearCheck')
    });
    if (!confirmed) return;
    clearScans();
    renderHistory();
    toast(t('scanner.history.cleared'), { type: 'success' });
  }
}

function onViewChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.matches('[data-camera-select]')) {
    state.deviceId = target.value || '';
    if (stream) {
      // startCamera() intentionally refuses to run while a stream exists, so
      // release the current device before switching to the selected one.
      stopCamera({ silent: true });
      startCamera();
    }
    return;
  }

  if (target.matches('[data-upload-input]')) {
    const file = target.files?.[0];
    target.value = '';
    if (file) handleUpload(file);
  }
}

function onDragOver(event) {
  const drop = event.target instanceof Element ? event.target.closest('[data-upload-drop]') : null;
  if (!drop) return;
  event.preventDefault();
  drop.classList.add('is-drag');
}

function onDragLeave(event) {
  const drop = event.target instanceof Element ? event.target.closest('[data-upload-drop]') : null;
  if (drop) drop.classList.remove('is-drag');
}

function onDrop(event) {
  const drop = event.target instanceof Element ? event.target.closest('[data-upload-drop]') : null;
  if (!drop) return;
  event.preventDefault();
  drop.classList.remove('is-drag');
  const file = event.dataTransfer?.files?.[0];
  if (file) handleUpload(file);
}

function onKeyDown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const drop = event.target instanceof Element ? event.target.closest('[data-upload-drop]') : null;
  if (!drop) return;
  event.preventDefault();
  dom?.uploadInput?.click();
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export default function scannerView(viewEl, ctx) {
  view = viewEl;
  detecting = false;
  viewEl.innerHTML = shellMarkup();
  applyIcons(viewEl);

  dom = {
    panel: viewEl.querySelector('[data-scan-panel]'),
    torch: viewEl.querySelector('[data-torch]'),
    status: null,
    errorSlot: null,
    video: null,
    canvas: null,
    stage: null,
    placeholder: null,
    toggle: null,
    startButtons: [],
    deviceSelect: null,
    uploadInput: null,
    uploadDrop: null
  };
  cachePanelDom();

  // A language refresh remounts the view without a live camera. Keep the scan
  // result and upload preview, but never leave a stale "scanning" indicator.
  if (state.mode === 'camera' && (state.status.kind === 'scanning' || state.status.kind === 'starting')) {
    state.status = { kind: 'ready', key: 'scanner.status.ready' };
  }
  paintStatus();
  syncCameraUi();
  renderTabs();
  renderDynamic();

  viewEl.addEventListener('click', onViewClick);
  viewEl.addEventListener('change', onViewChange);
  viewEl.addEventListener('dragover', onDragOver);
  viewEl.addEventListener('dragleave', onDragLeave);
  viewEl.addEventListener('drop', onDrop);
  viewEl.addEventListener('keydown', onKeyDown);

  visibilityHandler = () => {
    if (document.hidden && stream) stopCamera({ key: 'scanner.status.stopped' });
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  unbind = () => {
    viewEl.removeEventListener('click', onViewClick);
    viewEl.removeEventListener('change', onViewChange);
    viewEl.removeEventListener('dragover', onDragOver);
    viewEl.removeEventListener('dragleave', onDragLeave);
    viewEl.removeEventListener('drop', onDrop);
    viewEl.removeEventListener('keydown', onKeyDown);
    unbind = null;
  };

  const abort = () => {
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
    uploadToken += 1;
    releaseStream();
    clearTimeout(statusTimer);
    unbind?.();
    dom = null;
    view = null;
  };
  ctx.signal?.addEventListener('abort', abort, { once: true });
  return () => {
    abort();
    ctx.signal?.removeEventListener('abort', abort);
  };
}

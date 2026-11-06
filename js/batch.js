/** Batch generator: paste lines or import CSV, validate, render and ZIP. */
import {
  BATCH_TYPES, EXPORT_SIZES, LIMITS, MAX_QR_BYTES, normalizeStyle
} from './config.js';
import { getLanguage, t } from './i18n.js';
import { buildPayload, byteLength } from './payloads.js';
import { qrErrorMessage, renderQrBlob } from './qr-engine.js';
import { getSettings, recordBatch } from './storage.js';
import { applyIcons, confirmDialog, setBusy, toast } from './ui.js';
import {
  cssEscape, downloadBlob, escapeHtml, formatBytes, formatNumber, loadScript,
  readFileAsText, sanitizeFilename, truncate, uid, uniqueFilename, yieldToMain
} from './utils.js';

const PAGE_SIZE = 25;

/**
 * Batch work survives a language refresh: rows, options and the finished
 * archive live at module scope.
 */
const state = {
  initialized: false,
  mode: 'manual',
  type: 'text',
  manualText: '',
  rows: [],
  page: 1,
  csvFile: null,
  options: {
    format: 'png',
    size: 1024,
    prefix: 'qr-code',
    manifest: true
  },
  running: false,
  cancelling: false,
  progress: { done: 0, total: 0, failed: 0, current: '' },
  result: null
};

let runToken = 0;
let activeRun = null;

/* ------------------------------------------------------------------ */
/* Row helpers                                                         */
/* ------------------------------------------------------------------ */

function currentStyle() {
  try {
    return normalizeStyle(getSettings().generatorPrefs);
  } catch {
    return normalizeStyle({});
  }
}

function makeRow(value, type = state.type, label = '') {
  const row = {
    id: uid('row'),
    label: String(label || '').trim().slice(0, 120),
    value: String(value || ''),
    type: BATCH_TYPES.includes(type) ? type : 'text'
  };
  validateRow(row);
  return row;
}

function validateRow(row) {
  const value = String(row.value || '').trim();
  if (!value) {
    row.valid = false;
    row.errorKey = 'generator.errors.required';
    row.payload = '';
    return row;
  }
  const type = BATCH_TYPES.includes(row.type) ? row.type : 'text';
  const build = type === 'url'
    ? buildPayload('url', { url: value })
    : buildPayload('text', { text: String(row.value) });
  if (!build.ok) {
    row.valid = false;
    row.errorKey = build.error?.key || 'generator.errors.generic';
    row.payload = '';
    return row;
  }
  const style = currentStyle();
  const max = MAX_QR_BYTES[style.errorCorrection] || MAX_QR_BYTES.M;
  if (byteLength(build.payload) > max) {
    row.valid = false;
    row.errorKey = 'generator.errors.tooLong';
    row.payload = '';
    return row;
  }
  row.valid = true;
  row.errorKey = null;
  row.payload = build.payload;
  row.resolvedLabel = row.label || build.label || truncate(value, 60);
  return row;
}

function revalidateAll() {
  state.rows.forEach(validateRow);
}

function validRows() {
  return state.rows.filter((row) => row.valid);
}

function counts() {
  let valid = 0;
  let invalid = 0;
  state.rows.forEach((row) => {
    if (row.valid) valid += 1;
    else invalid += 1;
  });
  return { valid, invalid, total: state.rows.length };
}

function clampPage() {
  const pages = Math.max(1, Math.ceil(state.rows.length / PAGE_SIZE));
  state.page = Math.min(pages, Math.max(1, state.page));
}

function appendRows(entries) {
  const remaining = LIMITS.batch - state.rows.length;
  const accepted = entries.slice(0, Math.max(0, remaining));
  if (!accepted.length) return { added: 0, skipped: entries.length };
  state.rows.push(...accepted);
  clampPage();
  return { added: accepted.length, skipped: entries.length - accepted.length };
}

function manifestRow(row, { filename = '', status = 'ok', error = '' } = {}) {
  return {
    label: row.resolvedLabel || row.label || truncate(row.value, 60),
    value: row.value,
    type: row.type,
    filename,
    status,
    error
  };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

function escapeCsvCell(value) {
  let text = String(value ?? '');
  // Neutralise spreadsheet formula injection in labels imported/generated.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function buildManifest(entries) {
  const header = ['index', 'label', 'value', 'type', 'filename', 'status', 'error'];
  const lines = [header.map(escapeCsvCell).join(',')];
  entries.forEach((entry, index) => {
    lines.push([
      index + 1,
      entry.label,
      entry.value,
      entry.type,
      entry.filename,
      entry.status,
      entry.error
    ].map(escapeCsvCell).join(','));
  });
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function normalizeCsvType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'url' || raw === 'link' || raw === 'website') return 'url';
  if (raw === 'text' || raw === 'plain') return 'text';
  return null;
}

function csvToRows(data) {
  if (!Array.isArray(data) || !data.length) return [];
  const first = (data[0] || []).map((cell) => String(cell || '').trim().toLowerCase());
  const headerKeywords = ['value', 'content', 'text', 'url', 'link', 'label', 'type'];
  const hasHeader = first.some((cell) => headerKeywords.includes(cell));
  let valueIndex = 0;
  let labelIndex = -1;
  let typeIndex = -1;
  let start = 0;

  if (hasHeader) {
    const find = (...names) => first.findIndex((cell) => names.includes(cell));
    valueIndex = find('value', 'content', 'url', 'link', 'text');
    labelIndex = find('label', 'name', 'title');
    typeIndex = find('type', 'kind');
    if (valueIndex < 0) valueIndex = 0;
    start = 1;
  } else {
    labelIndex = 1;
    typeIndex = 2;
  }

  const rows = [];
  for (let i = start; i < data.length; i += 1) {
    const cells = data[i] || [];
    const value = String(cells[valueIndex] ?? '').trim();
    if (!value) continue;
    const label = labelIndex >= 0 ? String(cells[labelIndex] ?? '').trim() : '';
    const csvType = typeIndex >= 0 ? normalizeCsvType(cells[typeIndex]) : null;
    rows.push(makeRow(value, csvType || state.type, label));
  }
  return rows;
}

async function handleCsvFile(file) {
  if (!file || state.running) return;
  const looksCsv = /\.csv$/i.test(file.name || '')
    || /^(text\/csv|application\/vnd\.ms-excel|text\/plain)$/i.test(file.type || '');
  if (!looksCsv) {
    toast(t('errors.invalidFile'), { type: 'error' });
    return;
  }
  if (file.size > LIMITS.csvBytes) {
    toast(t('batch.csv.tooLarge'), { type: 'error' });
    return;
  }
  try {
    const text = await readFileAsText(file);
    const Papa = await loadScript('./lib/papaparse/papaparse.min.js', 'Papa');
    const parsed = Papa.parse(text, { skipEmptyLines: 'greedy' });
    const entries = csvToRows(parsed?.data || []);
    if (!entries.length) {
      toast(t('batch.csv.emptyFile'), { type: 'warning' });
      state.csvFile = { name: file.name, size: file.size, count: 0 };
      renderInput();
      return;
    }
    const { added, skipped } = appendRows(entries);
    state.csvFile = { name: file.name, size: file.size, count: added };
    state.mode = 'csv';
    state.result = null;
    renderInput();
    renderReview();
    renderGenerate();
    toast(t('batch.csv.imported', { count: formatNumber(added) }), { type: 'success' });
    if (skipped > 0) {
      toast(t('batch.csv.skipped', { count: formatNumber(skipped) }), { type: 'warning' });
    }
  } catch (error) {
    console.error('[batch] CSV import failed', error);
    toast(t('batch.csv.parseError'), { type: 'error' });
  }
}

function downloadTemplate() {
  const csv = [
    'label,value,type',
    '"Homepage","https://example.com",url',
    '"Welcome","Hello from QR Studio",text',
    ''
  ].join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, 'qr-studio-batch-template.csv');
  toast(t('toast.downloadStarted'), { type: 'success' });
}

/* ------------------------------------------------------------------ */
/* Markup                                                              */
/* ------------------------------------------------------------------ */

function stepHead(number, titleKey, descKey, extra = '') {
  return `<div class="step-head">
    <span class="step-number">${number}</span>
    <div class="step-head-text">
      <div class="step-title">${escapeHtml(t(titleKey))}</div>
      <div class="step-desc">${escapeHtml(t(descKey))}</div>
    </div>
    ${extra}
  </div>`;
}

function modeTabs() {
  return `<div class="segmented" role="tablist" aria-label="${escapeHtml(t('batch.steps.input.title'))}">
    <button type="button" data-batch-mode="manual" role="tab" aria-selected="${state.mode === 'manual'}"
      class="${state.mode === 'manual' ? 'is-active' : ''}">
      <i class="icon" data-lucide="type"></i>
      ${escapeHtml(t('batch.mode.manual'))}
    </button>
    <button type="button" data-batch-mode="csv" role="tab" aria-selected="${state.mode === 'csv'}"
      class="${state.mode === 'csv' ? 'is-active' : ''}">
      <i class="icon" data-lucide="file-spreadsheet"></i>
      ${escapeHtml(t('batch.mode.csv'))}
    </button>
  </div>`;
}

function typeSelect() {
  return `<div class="select-wrap">
    <select class="select" data-batch-type aria-label="${escapeHtml(t('batch.type.label'))}">
      ${BATCH_TYPES.map((type) => `<option value="${type}" ${state.type === type ? 'selected' : ''}>${escapeHtml(t(`batch.type.${type}`))}</option>`).join('')}
    </select>
    <i class="icon" data-lucide="chevrons-up-down"></i>
  </div>`;
}

function manualMarkup() {
  return `<label class="field">
    <span class="field-label">${escapeHtml(t('batch.manual.label'))}</span>
    <textarea class="textarea" rows="7" data-batch-manual data-batch-lock
      placeholder="${escapeHtml(t('batch.manual.placeholder'))}">${escapeHtml(state.manualText)}</textarea>
    <span class="field-hint">${escapeHtml(t('batch.manual.hint'))}</span>
  </label>
  <div class="form-actions">
    <span class="field-hint">${escapeHtml(t('batch.type.hint'))}</span>
    <button type="button" class="btn btn-primary btn-sm" data-batch-add data-batch-lock>
      <i class="icon" data-lucide="plus"></i>
      <span>${escapeHtml(t('batch.manual.add'))}</span>
    </button>
  </div>`;
}

function csvMarkup() {
  const meta = state.csvFile
    ? `<div class="file-meta">
        <i class="icon" data-lucide="file-spreadsheet"></i>
        <div class="file-meta-text">
          <div class="file-meta-name">${escapeHtml(state.csvFile.name)}</div>
          <div class="file-meta-sub">${escapeHtml(formatBytes(state.csvFile.size))} · ${escapeHtml(t('batch.csv.parsed', { count: formatNumber(state.csvFile.count) }))}</div>
        </div>
        <button type="button" class="btn btn-icon btn-ghost" data-csv-clear
          aria-label="${escapeHtml(t('common.remove'))}" title="${escapeHtml(t('common.remove'))}" data-batch-lock>
          <i class="icon" data-lucide="x"></i>
        </button>
      </div>`
    : '';
  return `<div class="csv-drop" data-csv-drop role="button" tabindex="0" aria-label="${escapeHtml(t('batch.csv.drop'))}">
      <span class="scan-placeholder-icon"><i class="icon" data-lucide="file-spreadsheet"></i></span>
      <div class="csv-drop-text">
        <strong>${escapeHtml(t('batch.csv.drop'))}</strong>
        <p>${escapeHtml(t('batch.csv.hint'))}</p>
      </div>
      <input class="sr-only" type="file" accept=".csv,text/csv,text/plain" data-csv-input data-batch-lock>
    </div>
    <div class="csv-help">
      <span>${escapeHtml(t('batch.csv.hint'))}</span>
      <code>label,value,type</code>
    </div>
    ${meta}
    <div class="form-actions">
      <span class="field-hint">${escapeHtml(t('batch.type.hint'))}</span>
      <button type="button" class="btn btn-secondary btn-sm" data-csv-template data-batch-lock>
        <i class="icon" data-lucide="file-down"></i>
        <span>${escapeHtml(t('batch.csv.template'))}</span>
      </button>
    </div>`;
}

function inputBodyMarkup() {
  return state.mode === 'csv' ? csvMarkup() : manualMarkup();
}

function summaryMarkup() {
  const { total, valid, invalid } = counts();
  return `<span class="summary-pill">${escapeHtml(t('batch.summary.total', { count: formatNumber(total) }))}</span>
    <span class="summary-pill is-ok">${escapeHtml(t('batch.summary.valid', { count: formatNumber(valid) }))}</span>
    ${invalid ? `<span class="summary-pill is-bad">${escapeHtml(t('batch.summary.invalid', { count: formatNumber(invalid) }))}</span>` : ''}
    <span class="summary-pill">${escapeHtml(t('batch.summary.limit', { count: formatNumber(total) }))}</span>`;
}

function pageNumbers(pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const set = new Set([1, pages, state.page - 1, state.page, state.page + 1]);
  const list = Array.from(set).filter((page) => page >= 1 && page <= pages).sort((a, b) => a - b);
  const output = [];
  list.forEach((page, index) => {
    if (index > 0 && page - list[index - 1] > 1) output.push('…');
    output.push(page);
  });
  return output;
}

function paginationMarkup() {
  const pages = Math.max(1, Math.ceil(state.rows.length / PAGE_SIZE));
  return `<div class="pagination" aria-label="${escapeHtml(t('common.page'))}">
    <button type="button" class="page-btn" data-batch-page="prev" data-page-prev
      ${state.page <= 1 ? 'disabled' : ''} aria-label="${escapeHtml(t('common.previous'))}">
      <i class="icon" data-lucide="chevron-left"></i>
    </button>
    ${pageNumbers(pages).map((page) => (
      page === '…'
        ? `<span class="page-btn" aria-hidden="true">…</span>`
        : `<button type="button" class="page-btn ${page === state.page ? 'is-active' : ''}"
            data-batch-page="${page}" ${page === state.page ? 'aria-current="page"' : ''}>${formatNumber(page)}</button>`
    )).join('')}
    <button type="button" class="page-btn" data-batch-page="next" data-page-next
      ${state.page >= pages ? 'disabled' : ''} aria-label="${escapeHtml(t('common.next'))}">
      <i class="icon" data-lucide="chevron-right"></i>
    </button>
  </div>`;
}

function rowStatusMarkup(row) {
  if (row.valid) {
    return `<span class="row-ok"><i class="icon" data-lucide="circle-check"></i>${escapeHtml(t('batch.table.ok'))}</span>`;
  }
  return `<span class="row-error-text">${escapeHtml(t(row.errorKey || 'generator.errors.generic'))}</span>`;
}

function tableMarkup() {
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = state.rows.slice(start, start + PAGE_SIZE);
  return `<div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th scope="col">${escapeHtml(t('batch.table.index'))}</th>
          <th scope="col">${escapeHtml(t('batch.table.label'))}</th>
          <th scope="col">${escapeHtml(t('batch.table.value'))}</th>
          <th scope="col">${escapeHtml(t('batch.table.type'))}</th>
          <th scope="col">${escapeHtml(t('batch.table.status'))}</th>
          <th scope="col"><span class="sr-only">${escapeHtml(t('batch.table.actions'))}</span></th>
        </tr>
      </thead>
      <tbody>
        ${pageRows.map((row, index) => `<tr data-row="${escapeHtml(row.id)}" class="${row.valid ? '' : 'is-invalid'}">
          <td class="row-index">${formatNumber(start + index + 1)}</td>
          <td><input class="table-input" type="text" maxlength="120" dir="auto"
            data-row-label="${escapeHtml(row.id)}" value="${escapeHtml(row.label)}"
            placeholder="${escapeHtml(t('batch.table.label'))}" data-batch-lock></td>
          <td><input class="table-input is-value" type="text" maxlength="4000"
            data-row-value="${escapeHtml(row.id)}" value="${escapeHtml(row.value)}"
            placeholder="${escapeHtml(t('batch.table.value'))}" data-batch-lock></td>
          <td>
            <div class="select-wrap table-select">
              <select class="select" data-row-type="${escapeHtml(row.id)}"
                aria-label="${escapeHtml(t('batch.table.type'))}" data-batch-lock>
                ${BATCH_TYPES.map((type) => `<option value="${type}" ${row.type === type ? 'selected' : ''}>${escapeHtml(t(`batch.type.${type}`))}</option>`).join('')}
              </select>
              <i class="icon" data-lucide="chevrons-up-down"></i>
            </div>
          </td>
          <td data-row-status="${escapeHtml(row.id)}">${rowStatusMarkup(row)}</td>
          <td>
            <button type="button" class="row-remove" data-row-remove="${escapeHtml(row.id)}"
              aria-label="${escapeHtml(t('batch.table.remove'))}" title="${escapeHtml(t('batch.table.remove'))}" data-batch-lock>
              <i class="icon" data-lucide="trash-2"></i>
            </button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <div class="table-toolbar">
    <div class="batch-input-controls">
      <button type="button" class="btn btn-ghost btn-sm" data-batch-remove-invalid data-batch-lock>
        <i class="icon" data-lucide="filter"></i>
        <span>${escapeHtml(t('batch.rows.removeInvalid'))}</span>
      </button>
      <button type="button" class="btn btn-ghost btn-sm" data-batch-clear data-batch-lock>
        <i class="icon" data-lucide="trash-2"></i>
        <span>${escapeHtml(t('batch.rows.clear'))}</span>
      </button>
    </div>
    ${paginationMarkup()}
  </div>`;
}

function reviewBodyMarkup() {
  if (!state.rows.length) {
    return `<div class="batch-empty">
      <i class="icon" data-lucide="table-2"></i>
      <strong>${escapeHtml(t('batch.empty'))}</strong>
      <span>${escapeHtml(t('batch.emptyDesc'))}</span>
    </div>`;
  }
  return `<div class="batch-summary" data-batch-summary>${summaryMarkup()}</div>
    ${tableMarkup()}`;
}

function optionsMarkup() {
  return `<div class="batch-options">
    <div class="field">
      <span class="field-label">${escapeHtml(t('batch.options.format'))}</span>
      <div class="select-wrap">
        <select class="select" data-batch-option="format" data-batch-lock>
          <option value="png" ${state.options.format === 'png' ? 'selected' : ''}>PNG</option>
          <option value="svg" ${state.options.format === 'svg' ? 'selected' : ''}>SVG</option>
        </select>
        <i class="icon" data-lucide="chevrons-up-down"></i>
      </div>
    </div>
    <div class="field">
      <span class="field-label">${escapeHtml(t('batch.options.size'))}</span>
      <div class="select-wrap">
        <select class="select" data-batch-option="size" data-batch-lock>
          ${EXPORT_SIZES.map((size) => `<option value="${size}" ${state.options.size === size ? 'selected' : ''}>${formatNumber(size)} × ${formatNumber(size)}</option>`).join('')}
        </select>
        <i class="icon" data-lucide="chevrons-up-down"></i>
      </div>
    </div>
    <div class="field">
      <span class="field-label">${escapeHtml(t('batch.options.prefix'))}</span>
      <input class="input input-mono" type="text" maxlength="60" data-batch-option="prefix"
        value="${escapeHtml(state.options.prefix)}"
        placeholder="${escapeHtml(t('batch.options.prefixPlaceholder'))}" data-batch-lock>
    </div>
    <div class="field">
      <span class="field-label">${escapeHtml(t('batch.options.manifest'))}</span>
      <label class="check-row">
        <input type="checkbox" data-batch-option="manifest" ${state.options.manifest ? 'checked' : ''} data-batch-lock>
        <span>${escapeHtml(t('batch.options.manifestHint'))}</span>
      </label>
    </div>
  </div>
  <div class="design-note">
    <i class="icon" data-lucide="palette"></i>
    <span>${escapeHtml(t('batch.options.designHint'))}</span>
  </div>`;
}

function resultMarkup() {
  const result = state.result;
  const warn = result.cancelled || result.failed > 0;
  const title = result.cancelled
    ? t('batch.cancelled')
    : warn
      ? t('batch.result.warn')
      : t('batch.result.success');
  const desc = result.cancelled
    ? t('batch.cancelledDesc', { count: formatNumber(result.count), total: formatNumber(result.total) })
    : warn
      ? t('batch.result.warnDesc', { count: formatNumber(result.count), failed: formatNumber(result.failed) })
      : t('batch.result.successDesc', { count: formatNumber(result.count) });
  return `<div class="batch-result">
      <div class="batch-result-icon ${warn ? 'is-warn' : ''}">
        <i class="icon" data-lucide="${warn ? 'alert-triangle' : 'file-check'}"></i>
      </div>
      <div class="batch-result-text">
        <div class="batch-result-title">${escapeHtml(title)}</div>
        <div class="batch-result-desc">${escapeHtml(desc)}</div>
      </div>
      <button type="button" class="btn btn-primary btn-sm" data-batch-download-again>
        <i class="icon" data-lucide="download"></i>
        <span>${escapeHtml(t(result.cancelled ? 'batch.partial' : 'batch.result.download'))}</span>
      </button>
    </div>
    <div class="design-note">
      <i class="icon" data-lucide="info"></i>
      <span>${escapeHtml(t('batch.result.auto'))}${result.manifest ? ` ${escapeHtml(t('batch.result.manifest'))}` : ''}</span>
    </div>
    ${result.failures?.length ? `<ul class="failed-list">
      ${result.failures.map((failure) => `<li>${escapeHtml(truncate(failure.label, 60))}: ${escapeHtml(failure.reason)}</li>`).join('')}
    </ul>` : ''}
    <div class="form-actions">
      <span></span>
      <button type="button" class="btn btn-secondary btn-sm" data-batch-new>
        <i class="icon" data-lucide="rotate-ccw"></i>
        <span>${escapeHtml(t('batch.result.new'))}</span>
      </button>
    </div>`;
}

function progressMarkup() {
  const { done, total, failed, current } = state.progress;
  const processed = done + failed;
  const percent = total ? Math.round((processed / total) * 100) : 0;
  return `<div class="batch-progress">
    <div class="batch-progress-head">
      <div class="batch-progress-title">
        <span class="spinner"></span>
        <span>${escapeHtml(t('batch.progress.title'))}</span>
      </div>
      <span class="batch-progress-count" data-progress-count>${formatNumber(processed)} / ${formatNumber(total)}</span>
    </div>
    <div class="progress"><div class="progress-bar" data-progress-bar style="width:${percent}%"></div></div>
    <div class="batch-result-desc" data-progress-current>
      ${escapeHtml(t('batch.progress.current', { label: truncate(current || '—', 70) }))}
    </div>
    <div class="batch-progress-head">
      <span class="summary-pill ${failed ? 'is-bad' : ''}" data-progress-failed>${escapeHtml(t('batch.summary.invalid', { count: formatNumber(failed) }))}</span>
      <button type="button" class="btn btn-secondary btn-sm" data-batch-cancel ${state.cancelling ? 'disabled' : ''}>
        <i class="icon" data-lucide="x"></i>
        <span>${escapeHtml(t(state.cancelling ? 'batch.cancelling' : 'batch.cancel'))}</span>
      </button>
    </div>
  </div>`;
}

function generateBodyMarkup() {
  if (state.running) return progressMarkup();
  if (state.result) return resultMarkup();
  return `<div class="batch-result">
      <div class="batch-result-icon"><i class="icon" data-lucide="layers"></i></div>
      <div class="batch-result-text">
        <div class="batch-result-title">${escapeHtml(t('batch.steps.generate.title'))}</div>
        <div class="batch-result-desc">${escapeHtml(t('batch.steps.generate.desc'))}</div>
      </div>
      <button type="button" class="btn btn-primary" data-batch-run>
        <i class="icon" data-lucide="zap"></i>
        <span>${escapeHtml(t('batch.generate'))}</span>
      </button>
    </div>`;
}

function shellMarkup() {
  return `<div class="batch-layout view-enter" data-batch-layout>
    <div class="page-intro">
      <div>
        <h2>${escapeHtml(t('batch.title'))}</h2>
        <p>${escapeHtml(t('batch.subtitle'))}</p>
      </div>
      <span class="badge badge-accent">
        <i class="icon" data-lucide="layers"></i>
        <span data-batch-limit>${escapeHtml(t('batch.summary.limit', { count: formatNumber(state.rows.length) }))}</span>
      </span>
    </div>

    <section class="card step-card">
      ${stepHead(1, 'batch.steps.input.title', 'batch.steps.input.desc')}
      <div class="step-body">
        <div class="batch-mode-row">
          ${modeTabs()}
          <div class="batch-input-controls">${typeSelect()}</div>
        </div>
        <div data-batch-input>${inputBodyMarkup()}</div>
      </div>
    </section>

    <section class="card step-card">
      ${stepHead(2, 'batch.steps.review.title', 'batch.steps.review.desc')}
      <div class="step-body" data-batch-review>${reviewBodyMarkup()}</div>
    </section>

    <section class="card step-card">
      ${stepHead(3, 'batch.steps.options.title', 'batch.steps.options.desc')}
      <div class="step-body">${optionsMarkup()}</div>
    </section>

    <section class="card step-card">
      ${stepHead(4, 'batch.steps.generate.title', 'batch.steps.generate.desc')}
      <div class="step-body" data-batch-generate>${generateBodyMarkup()}</div>
    </section>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

let view = null;

function setLocked(locked) {
  if (!view) return;
  view.querySelectorAll('[data-batch-lock]').forEach((node) => {
    node.disabled = locked;
  });
}

function renderInput() {
  if (!view) return;
  view.querySelectorAll('[data-batch-mode]').forEach((button) => {
    const active = button.getAttribute('data-batch-mode') === state.mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const body = view.querySelector('[data-batch-input]');
  if (body) {
    body.innerHTML = inputBodyMarkup();
    applyIcons(body);
  }
  if (state.running) setLocked(true);
}

function updateSummary() {
  const summary = view?.querySelector('[data-batch-summary]');
  if (summary) summary.innerHTML = summaryMarkup();
  updateLimitBadge();
}

function updateLimitBadge() {
  const badge = view?.querySelector('[data-batch-limit]');
  if (!badge) return;
  badge.textContent = t('batch.summary.limit', { count: formatNumber(state.rows.length) });
}

function renderReview() {
  if (!view) return;
  clampPage();
  const body = view.querySelector('[data-batch-review]');
  if (!body) return;
  body.innerHTML = reviewBodyMarkup();
  applyIcons(body);
  updateLimitBadge();
  if (state.running) setLocked(true);
}

function renderGenerate() {
  if (!view) return;
  const body = view.querySelector('[data-batch-generate]');
  if (!body) return;
  body.innerHTML = generateBodyMarkup();
  applyIcons(body);
}

function updateProgressUI() {
  if (!view) return;
  const { done, total, failed, current } = state.progress;
  const processed = done + failed;
  const percent = total ? Math.round((processed / total) * 100) : 0;
  const count = view.querySelector('[data-progress-count]');
  if (count) count.textContent = `${formatNumber(processed)} / ${formatNumber(total)}`;
  const bar = view.querySelector('[data-progress-bar]');
  if (bar) bar.style.width = `${percent}%`;
  const currentEl = view.querySelector('[data-progress-current]');
  if (currentEl) {
    currentEl.textContent = t('batch.progress.current', { label: truncate(current || '—', 70) });
  }
  const failedEl = view.querySelector('[data-progress-failed]');
  if (failedEl) {
    failedEl.textContent = t('batch.summary.invalid', { count: formatNumber(failed) });
    failedEl.classList.toggle('is-bad', failed > 0);
  }
}

function updateRowStatus(row) {
  if (!view) return;
  const cell = view.querySelector(`[data-row-status="${cssEscape(row.id)}"]`);
  const tr = view.querySelector(`[data-row="${cssEscape(row.id)}"]`);
  if (cell) {
    cell.innerHTML = rowStatusMarkup(row);
    applyIcons(cell);
  }
  if (tr) tr.classList.toggle('is-invalid', !row.valid);
  updateSummary();
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

function invalidateFinishedRun() {
  if (!state.result) return;
  state.result = null;
  renderGenerate();
}

function finishRun(archive, meta) {
  state.running = false;
  state.cancelling = false;
  state.progress = { done: 0, total: 0, failed: 0, current: '' };
  state.result = {
    blob: archive.blob,
    filename: archive.filename,
    count: meta.count,
    failed: meta.failures.length,
    failures: meta.failures,
    total: meta.total,
    cancelled: meta.cancelled,
    manifest: meta.manifest
  };
  activeRun = null;
  renderReview();
  renderGenerate();
  setLocked(false);
  if (meta.count > 0) {
    try { recordBatch(meta.count, meta.failures.length); } catch { /* storage may be full */ }
  }
  if (meta.cancelled) {
    toast(t('toast.batchCancelled'), { type: 'warning' });
  } else if (meta.failures.length) {
    toast(t('toast.batchFailed', { count: formatNumber(meta.failures.length) }), { type: 'warning' });
  } else {
    toast(t('toast.batchDone', { count: formatNumber(meta.count) }), { type: 'success' });
  }
}

async function runBatch() {
  if (state.running) return;
  if (!state.rows.length) {
    toast(t('batch.errors.noRows'), { type: 'warning' });
    return;
  }
  revalidateAll();
  renderReview();
  const queue = validRows();
  if (!queue.length) {
    toast(t('batch.errors.noValid'), { type: 'error' });
    return;
  }

  const token = ++runToken;
  activeRun = { token, cancelled: false };
  state.running = true;
  state.cancelling = false;
  state.result = null;
  state.progress = { done: 0, total: queue.length, failed: 0, current: '' };
  renderGenerate();
  setLocked(true);

  const failures = [];
  const manifest = [];
  const usedNames = new Set();
  const style = currentStyle();
  const format = state.options.format === 'svg' ? 'svg' : 'png';
  const extension = format;
  const prefix = sanitizeFilename(state.options.prefix || 'qr-code', 'qr-code');
  let zip = null;
  let count = 0;
  let cancelled = false;

  const finishQueued = async (done, failureList, wasCancelled, extraManifest = []) => {
    if (!done) {
      state.running = false;
      state.cancelling = false;
      state.progress = { done: 0, total: 0, failed: 0, current: '' };
      state.result = null;
      activeRun = null;
      if (view) {
        renderGenerate();
        setLocked(false);
      }
      if (failureList.length) {
        toast(t('toast.batchFailed', { count: formatNumber(failureList.length) }), { type: 'error' });
      } else if (wasCancelled) {
        toast(t('toast.batchCancelled'), { type: 'info' });
      } else {
        toast(t('batch.errors.noValid'), { type: 'error' });
      }
      return;
    }
    if (state.options.manifest) {
      zip.file('manifest.csv', buildManifest([...manifest, ...extraManifest]));
    }
    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 5 }
    });
    if (token !== runToken || !view) {
      // The view was left (route change or language refresh) while the archive
      // was being compressed; abandon it without triggering a download.
      state.running = false;
      state.cancelling = false;
      state.progress = { done: 0, total: 0, failed: 0, current: '' };
      activeRun = null;
      return;
    }
    const filename = `qr-studio-batch-${timestamp()}.zip`;
    try {
      downloadBlob(blob, filename);
    } catch (error) {
      console.error('[batch] download failed', error);
    }
    finishRun({ blob, filename }, {
      count: done,
      failures: failureList,
      cancelled: wasCancelled,
      total: queue.length,
      manifest: state.options.manifest
    });
  };

  try {
    const JSZip = await loadScript('./lib/jszip/jszip.min.js', 'JSZip');
    if (token !== runToken) return;
    zip = new JSZip();

    for (let index = 0; index < queue.length; index += 1) {
      if (activeRun?.cancelled || token !== runToken) {
        cancelled = true;
        break;
      }
      const row = queue[index];
      state.progress.current = row.resolvedLabel || row.value;
      updateProgressUI();
      try {
        const blob = await renderQrBlob({
          data: row.payload || validateRow(row).payload,
          style,
          size: state.options.size,
          format
        });
        const base = sanitizeFilename(`${prefix}-${String(index + 1).padStart(4, '0')}`, 'qr-code');
        const filename = uniqueFilename(base, extension, usedNames);
        zip.file(filename, blob);
        manifest.push(manifestRow(row, { filename, status: 'ok' }));
        count += 1;
      } catch (error) {
        console.error('[batch] render failed', error);
        const reason = qrErrorMessage(error, t);
        failures.push({ label: row.resolvedLabel || row.value, reason });
        manifest.push(manifestRow(row, { status: 'failed', error: reason }));
      }
      state.progress.done = count;
      state.progress.failed = failures.length;
      updateProgressUI();
      if (index % 3 === 2) await yieldToMain();
      if (token !== runToken) {
        cancelled = true;
        break;
      }
    }

    if (token !== runToken) {
      // Route changed or a new language refresh replaced this view: abandon
      // the archive quietly, but never leave the running flag stuck.
      state.running = false;
      state.cancelling = false;
      state.progress = { done: 0, total: 0, failed: 0, current: '' };
      activeRun = null;
      return;
    }

    if (cancelled) state.cancelling = true;
    const attempted = new Set(queue.slice(0, queue.length).map((row) => row.id));
    const remainingInvalid = state.rows
      .filter((row) => !attempted.has(row.id))
      .map((row) => manifestRow(row, {
        status: 'invalid',
        error: t(row.errorKey || 'generator.errors.generic')
      }));

    await finishQueued(count, failures, cancelled, remainingInvalid);
  } catch (error) {
    console.error('[batch] run failed', error);
    state.running = false;
    state.cancelling = false;
    state.progress = { done: 0, total: 0, failed: 0, current: '' };
    activeRun = null;
    if (view) {
      renderGenerate();
      setLocked(false);
    }
    toast(t('batch.errors.zip'), { type: 'error' });
  }
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

let handlers = null;

function bind(viewEl) {
  const onInput = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || state.running) return;
    if (target.matches('[data-batch-manual]')) {
      state.manualText = target.value;
      return;
    }
    const option = target.getAttribute('data-batch-option');
    if (option === 'prefix') {
      state.options.prefix = target.value.slice(0, 60);
      invalidateFinishedRun();
      return;
    }
    const labelId = target.getAttribute('data-row-label');
    if (labelId) {
      const row = state.rows.find((item) => item.id === labelId);
      if (row) {
        row.label = target.value.slice(0, 120);
        validateRow(row);
        updateRowStatus(row);
        invalidateFinishedRun();
      }
      return;
    }
    const valueId = target.getAttribute('data-row-value');
    if (valueId) {
      const row = state.rows.find((item) => item.id === valueId);
      if (row) {
        row.value = target.value.slice(0, 4000);
        validateRow(row);
        updateRowStatus(row);
        invalidateFinishedRun();
      }
    }
  };

  const onChange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || state.running) return;
    if (target.matches('[data-batch-type]')) {
      state.type = BATCH_TYPES.includes(target.value) ? target.value : 'text';
      return;
    }
    const option = target.getAttribute('data-batch-option');
    if (option === 'format' || option === 'size') {
      state.options[option] = option === 'size' ? Number(target.value) : target.value;
      invalidateFinishedRun();
      return;
    }
    if (option === 'manifest') {
      state.options.manifest = target.checked;
      invalidateFinishedRun();
      return;
    }
    const typeId = target.getAttribute('data-row-type');
    if (typeId) {
      const row = state.rows.find((item) => item.id === typeId);
      if (row) {
        row.type = BATCH_TYPES.includes(target.value) ? target.value : 'text';
        validateRow(row);
        updateRowStatus(row);
        invalidateFinishedRun();
      }
      return;
    }
    if (target.matches('[data-csv-input]')) {
      const file = target.files?.[0];
      target.value = '';
      if (file) handleCsvFile(file);
      return;
    }
  };

  const onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const mode = target.closest('[data-batch-mode]');
    if (mode && !state.running) {
      const next = mode.getAttribute('data-batch-mode');
      if (next !== state.mode) {
        const manual = viewEl.querySelector('[data-batch-manual]');
        if (manual) state.manualText = manual.value;
        state.mode = next === 'csv' ? 'csv' : 'manual';
        renderInput();
      }
      return;
    }

    if (target.closest('[data-batch-add]') && !state.running) {
      const textarea = viewEl.querySelector('[data-batch-manual]');
      const lines = String(textarea?.value || state.manualText || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length) {
        toast(t('batch.manual.empty'), { type: 'info' });
        return;
      }
      const entries = lines.map((line) => makeRow(line, state.type));
      const { added, skipped } = appendRows(entries);
      state.result = null;
      state.manualText = '';
      if (textarea) textarea.value = '';
      renderReview();
      renderGenerate();
      toast(t('batch.manual.added', { count: formatNumber(added) }), { type: 'success' });
      if (skipped > 0) {
        toast(t('batch.csv.skipped', { count: formatNumber(skipped) }), { type: 'warning' });
      }
      return;
    }

    const csvBrowse = target.closest('[data-csv-drop]');
    if (csvBrowse && !state.running && !target.closest('[data-csv-input]')) {
      viewEl.querySelector('[data-csv-input]')?.click();
      return;
    }

    if (target.closest('[data-csv-template]') && !state.running) {
      downloadTemplate();
      return;
    }

    if (target.closest('[data-csv-clear]') && !state.running) {
      state.csvFile = null;
      renderInput();
      return;
    }

    const removeId = target.closest('[data-row-remove]')?.getAttribute('data-row-remove');
    if (removeId && !state.running) {
      state.rows = state.rows.filter((row) => row.id !== removeId);
      state.result = null;
      clampPage();
      renderReview();
      renderGenerate();
      toast(t('batch.rows.removed'), { type: 'success' });
      return;
    }

    const pageTarget = target.closest('[data-batch-page]');
    if (pageTarget) {
      const value = pageTarget.getAttribute('data-batch-page');
      const pages = Math.max(1, Math.ceil(state.rows.length / PAGE_SIZE));
      if (value === 'prev') state.page = Math.max(1, state.page - 1);
      else if (value === 'next') state.page = Math.min(pages, state.page + 1);
      else state.page = Math.min(pages, Math.max(1, Number(value) || 1));
      renderReview();
      return;
    }

    if (target.closest('[data-batch-remove-invalid]') && !state.running) {
      const before = state.rows.length;
      state.rows = state.rows.filter((row) => row.valid);
      const removed = before - state.rows.length;
      state.result = null;
      clampPage();
      renderReview();
      renderGenerate();
      if (removed) toast(t('batch.rows.invalidRemoved', { count: formatNumber(removed) }), { type: 'success' });
      return;
    }

    if (target.closest('[data-batch-clear]') && !state.running) {
      if (!state.rows.length) return;
      const confirmed = await confirmDialog({
        title: t('batch.rows.clearTitle'),
        message: t('batch.rows.clearMessage'),
        confirmLabel: t('batch.rows.clearConfirm'),
        cancelLabel: t('common.cancel'),
        danger: true,
        icon: 'trash-2',
        checkboxLabel: t('batch.rows.clearCheck')
      });
      if (!confirmed) return;
      state.rows = [];
      state.page = 1;
      state.result = null;
      state.csvFile = null;
      renderInput();
      renderReview();
      renderGenerate();
      toast(t('batch.rows.cleared'), { type: 'success' });
      return;
    }

    if (target.closest('[data-batch-run]')) {
      runBatch();
      return;
    }

    if (target.closest('[data-batch-cancel]')) {
      if (!activeRun) return;
      activeRun.cancelled = true;
      state.cancelling = true;
      renderGenerate();
      return;
    }

    if (target.closest('[data-batch-download-again]')) {
      if (!state.result) return;
      try {
        downloadBlob(state.result.blob, state.result.filename);
        toast(t('toast.downloadStarted'), { type: 'success' });
      } catch (error) {
        console.error('[batch] download failed', error);
        toast(t('toast.downloadFailed'), { type: 'error' });
      }
      return;
    }

    if (target.closest('[data-batch-new]')) {
      state.result = null;
      renderReview();
      renderGenerate();
      return;
    }
  };

  const onDragOver = (event) => {
    const drop = event.target instanceof Element ? event.target.closest('[data-csv-drop]') : null;
    if (!drop || state.running) return;
    event.preventDefault();
    drop.classList.add('is-drag');
  };

  const onDragLeave = (event) => {
    const drop = event.target instanceof Element ? event.target.closest('[data-csv-drop]') : null;
    if (drop) drop.classList.remove('is-drag');
  };

  const onDrop = (event) => {
    const drop = event.target instanceof Element ? event.target.closest('[data-csv-drop]') : null;
    if (!drop || state.running) return;
    event.preventDefault();
    drop.classList.remove('is-drag');
    const file = event.dataTransfer?.files?.[0];
    if (file) handleCsvFile(file);
  };

  const onKeyDown = (event) => {
    const drop = event.target instanceof Element ? event.target.closest('[data-csv-drop]') : null;
    if (!drop) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      viewEl.querySelector('[data-csv-input]')?.click();
    }
  };

  viewEl.addEventListener('input', onInput);
  viewEl.addEventListener('change', onChange);
  viewEl.addEventListener('click', onClick);
  viewEl.addEventListener('dragover', onDragOver);
  viewEl.addEventListener('dragleave', onDragLeave);
  viewEl.addEventListener('drop', onDrop);
  viewEl.addEventListener('keydown', onKeyDown);
  return () => {
    viewEl.removeEventListener('input', onInput);
    viewEl.removeEventListener('change', onChange);
    viewEl.removeEventListener('click', onClick);
    viewEl.removeEventListener('dragover', onDragOver);
    viewEl.removeEventListener('dragleave', onDragLeave);
    viewEl.removeEventListener('drop', onDrop);
    viewEl.removeEventListener('keydown', onKeyDown);
  };
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export default function batchView(viewEl, ctx) {
  view = viewEl;
  revalidateAll();
  if (!state.initialized) {
    state.initialized = true;
    state.options.prefix = 'qr-code';
  }
  view.innerHTML = shellMarkup();
  applyIcons(view);
  if (state.running) setLocked(true);
  handlers = bind(view);
  const abort = () => {
    if (activeRun) {
      activeRun.cancelled = true;
      runToken += 1;
    }
    state.running = false;
    state.cancelling = false;
    handlers?.();
    handlers = null;
    view = null;
  };
  ctx.signal?.addEventListener('abort', abort, { once: true });
  return () => {
    abort();
    ctx.signal?.removeEventListener('abort', abort);
  };
}

/** QR generator: eight content types, live preview, design, logo, export and saving. */
import {
  CORNER_DOT_STYLES, CORNER_SQUARE_STYLES, DEFAULT_STYLE, DOT_STYLES,
  ERROR_LEVELS, EXPORT_SIZES, MAX_QR_BYTES, PRESETS, QR_TYPES,
  normalizeStyle
} from './config.js';
import { getLogo, putLogo } from './db.js';
import { downloadRecord, copyQrAsImage, recordDataUrl } from './export.js';
import { getLanguage, hasKey, t } from './i18n.js';
import { buildPayload, defaultFields, validateLength } from './payloads.js';
import {
  createQr, processLogoFile, qrErrorMessage, updateQr
} from './qr-engine.js';
import {
  takeEditRecord, takeNewType, toggleFavoriteWithToast, typeIcon
} from './records.js';
import {
  getSettings, isFavorite, saveRecord, saveSettings, updateRecord
} from './storage.js';
import { applyIcons, printQr, setBusy, toast } from './ui.js';
import {
  contrastRatio, copyText, debounce, escapeHtml, formatBytes, formatNumber,
  sanitizeFilename, uid
} from './utils.js';

const PREVIEW_SIZE = 512;

const FIELD_DEFS = {
  url: [
    { name: 'url', kind: 'url', required: true, ltr: true, autocomplete: 'url', inputmode: 'url' }
  ],
  text: [
    { name: 'text', kind: 'textarea', required: true, rows: 7 }
  ],
  wifi: [
    { name: 'ssid', required: true, autocomplete: 'off' },
    { name: 'encryption', kind: 'select' },
    { name: 'password', kind: 'password', autocomplete: 'off' },
    { name: 'hidden', kind: 'switch' }
  ],
  email: [
    { name: 'email', kind: 'email', required: true, ltr: true, autocomplete: 'email', inputmode: 'email' },
    { name: 'subject', autocomplete: 'off' },
    { name: 'body', kind: 'textarea', rows: 5 }
  ],
  phone: [
    { name: 'phone', kind: 'tel', required: true, ltr: true, autocomplete: 'tel', inputmode: 'tel' }
  ],
  sms: [
    { name: 'phone', kind: 'tel', required: true, ltr: true, autocomplete: 'tel', inputmode: 'tel' },
    { name: 'message', kind: 'textarea', rows: 5 }
  ],
  vcard: [
    { name: 'firstName', autocomplete: 'given-name' },
    { name: 'lastName', autocomplete: 'family-name' },
    { name: 'organization', autocomplete: 'organization' },
    { name: 'jobTitle', autocomplete: 'organization-title' },
    { name: 'phone', kind: 'tel', ltr: true, autocomplete: 'tel', inputmode: 'tel' },
    { name: 'email', kind: 'email', ltr: true, autocomplete: 'email', inputmode: 'email' },
    { name: 'website', kind: 'url', ltr: true, autocomplete: 'url', inputmode: 'url' },
    { name: 'address', autocomplete: 'street-address' },
    { name: 'note', kind: 'textarea', rows: 3, span: true }
  ],
  location: [
    { name: 'lat', ltr: true, inputmode: 'decimal', autocomplete: 'off' },
    { name: 'lng', ltr: true, inputmode: 'decimal', autocomplete: 'off' },
    { name: 'label', autocomplete: 'off', span: true }
  ]
};

const WIFI_ENCRYPTIONS = [
  ['WPA', 'wpa'],
  ['WEP', 'wep'],
  ['nopass', 'nopass']
];

/**
 * Draft state intentionally lives at module scope so a language refresh can
 * rebuild the view without losing the current work.
 */
const state = {
  initialized: false,
  type: 'url',
  tab: 'content',
  fields: null,
  style: normalizeStyle(DEFAULT_STYLE),
  logo: null,
  logoId: null,
  editingId: null,
  localId: uid('qr'),
  filename: '',
  favorite: false,
  touched: new Set(),
  submitted: false,
  build: null,
  renderError: null
};

function blankFields() {
  const fields = {};
  QR_TYPES.forEach((type) => { fields[type] = defaultFields(type); });
  return fields;
}

function ensureFields() {
  if (!state.fields) state.fields = blankFields();
  QR_TYPES.forEach((type) => {
    state.fields[type] = { ...defaultFields(type), ...(state.fields[type] || {}) };
  });
}

function resetDraft(type = state.type) {
  state.type = QR_TYPES.includes(type) ? type : 'url';
  state.fields = blankFields();
  state.style = normalizeStyle(getSettings().generatorPrefs);
  state.logo = null;
  state.logoId = null;
  state.editingId = null;
  state.localId = uid('qr');
  state.filename = '';
  state.favorite = false;
  state.touched = new Set();
  state.submitted = false;
  state.tab = 'content';
  state.build = null;
  state.renderError = null;
}

async function applyEditRecord(record) {
  state.type = record.type;
  state.fields = blankFields();
  state.fields[record.type] = { ...defaultFields(record.type), ...(record.fields || {}) };
  state.style = normalizeStyle(record.settings);
  state.logo = null;
  state.logoId = record.logoId || null;
  state.editingId = record.id;
  state.localId = record.id;
  state.filename = '';
  state.favorite = isFavorite(record);
  state.touched = new Set();
  state.submitted = false;
  state.tab = 'content';
  state.build = null;
  state.renderError = null;
  if (record.logoId) {
    try {
      const logo = await getLogo(record.logoId);
      if (logo?.dataUrl) state.logo = { ...logo, storedId: logo.id };
      else state.logoId = null;
    } catch {
      state.logoId = null;
    }
  }
}

function fieldLabel(type, name) {
  return t(`generator.fields.${type}.${name}.label`);
}

function fieldHint(type, name) {
  const key = `generator.fields.${type}.${name}.hint`;
  return hasKey(key) ? t(key) : '';
}

function fieldPlaceholder(type, name) {
  const key = `generator.fields.${type}.${name}.placeholder`;
  return hasKey(key) ? t(key) : '';
}

function isBlank(type, fields) {
  const keys = type === 'wifi'
    ? ['ssid', 'password']
    : Object.keys(fields || {}).filter((key) => key !== 'encryption' && typeof fields[key] !== 'boolean');
  return keys.every((key) => !String(fields?.[key] ?? '').trim());
}

function currentBuild() {
  ensureFields();
  const fields = state.fields[state.type];
  const result = buildPayload(state.type, fields);
  if (!result.ok) {
    return {
      ok: false,
      empty: isBlank(state.type, fields),
      errorKey: result.error.key,
      field: result.field || null,
      payload: '',
      label: '',
      bytes: 0
    };
  }
  const length = validateLength(result.payload, state.style.errorCorrection);
  if (!length.ok) {
    return {
      ok: false,
      empty: false,
      tooLong: true,
      errorKey: 'generator.errors.tooLong',
      field: null,
      payload: result.payload,
      label: result.label,
      bytes: length.bytes
    };
  }
  return {
    ok: true,
    empty: false,
    errorKey: null,
    field: null,
    payload: result.payload,
    label: result.label,
    fields: result.fields,
    bytes: length.bytes
  };
}

function buildRecord(build, { logoId = state.logoId } = {}) {
  return {
    id: state.editingId || state.localId,
    type: state.type,
    payload: build.payload,
    label: build.label || t(`types.${state.type}`),
    fields: { ...(state.fields[state.type] || {}) },
    settings: normalizeStyle(state.style),
    logoId: logoId || null,
    createdAt: Date.now()
  };
}

async function persistLogo() {
  if (!state.logo) return null;
  if (state.logoId && state.logo.storedId === state.logoId) return state.logoId;
  const id = uid('logo');
  await putLogo({
    id,
    name: state.logo.name,
    mime: state.logo.mime,
    dataUrl: state.logo.dataUrl,
    createdAt: Date.now()
  });
  state.logoId = id;
  state.logo.storedId = id;
  return id;
}

/* ------------------------------------------------------------------ */
/* Markup helpers                                                      */
/* ------------------------------------------------------------------ */

function selectMarkup({ attr, label, value, options, extraClass = '' }) {
  return `<div class="select-wrap ${extraClass}">
    <select class="select" ${attr} aria-label="${escapeHtml(label)}">
      ${options.map((option) => `<option value="${escapeHtml(option[0])}" ${option[0] === value ? 'selected' : ''}>${escapeHtml(option[1])}</option>`).join('')}
    </select>
    <i class="icon" data-lucide="chevrons-up-down"></i>
  </div>`;
}

function colorMarkup(key, label) {
  const value = state.style[key];
  return `<div class="field">
    <span class="field-label">${escapeHtml(label)}</span>
    <label class="color-field">
      <input type="color" value="${value}" data-color-picker="${key}" aria-label="${escapeHtml(label)}">
      <input type="text" value="${value}" maxlength="7" spellcheck="false" data-color-text="${key}"
        aria-label="${escapeHtml(label)}" autocomplete="off">
    </label>
  </div>`;
}

function controlMarkup(type, def) {
  const value = state.fields[type]?.[def.name] ?? '';
  const id = `gen-field-${def.name}`;
  const label = fieldLabel(type, def.name);
  const hint = fieldHint(type, def.name);
  const placeholder = fieldPlaceholder(type, def.name);
  const required = def.required ? '<span class="required-dot" aria-hidden="true"></span>' : '';
  const hintMarkup = hint ? `<p class="field-hint">${escapeHtml(hint)}</p>` : '';

  if (def.kind === 'switch') {
    return `<div class="field" data-field="${def.name}">
      <div class="field-row">
        <div class="field-row-text">
          <label class="field-row-title" for="${id}">${escapeHtml(label)}</label>
          ${hint ? `<span class="field-row-desc">${escapeHtml(hint)}</span>` : ''}
        </div>
        <label class="switch">
          <input type="checkbox" id="${id}" data-field-input="${def.name}" ${value ? 'checked' : ''}>
          <span class="switch-track"></span>
        </label>
      </div>
    </div>`;
  }

  let control;
  if (def.kind === 'textarea') {
    control = `<textarea class="textarea" id="${id}" rows="${def.rows || 4}" data-field-input="${def.name}"
      placeholder="${escapeHtml(placeholder)}" autocomplete="${def.autocomplete || 'off'}">${escapeHtml(value)}</textarea>`;
  } else if (def.kind === 'select') {
    const options = WIFI_ENCRYPTIONS.map(([value, key]) => [value, t(`generator.fields.wifi.encryption.${key}`)]);
    control = selectMarkup({
      attr: `id="${id}" data-field-input="${def.name}"`,
      label,
      value: value || 'WPA',
      options
    });
  } else {
    control = `<input class="input ${def.ltr ? 'input-ltr' : ''}" id="${id}" type="${def.kind || 'text'}"
      data-field-input="${def.name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"
      autocomplete="${def.autocomplete || 'off'}" ${def.inputmode ? `inputmode="${def.inputmode}"` : ''}>`;
  }

  return `<div class="field ${def.span ? 'span-2' : ''}" data-field="${def.name}">
    <label class="field-label" for="${id}">${escapeHtml(label)}${required}</label>
    ${control}
    ${hintMarkup}
    <p class="field-error"><i class="icon" data-lucide="alert-circle"></i><span></span></p>
  </div>`;
}

function contentMarkup() {
  const type = state.type;
  const defs = FIELD_DEFS[type] || FIELD_DEFS.text;
  const tiles = QR_TYPES.map((item) => `<button type="button" class="type-tile ${item === type ? 'is-active' : ''}"
    data-type="${item}" role="tab" aria-selected="${item === type}">
    <i class="icon" data-lucide="${typeIcon(item)}"></i>
    <span class="type-tile-label">${escapeHtml(t(`types.${item}`))}</span>
  </button>`).join('');

  const fields = defs.map((def) => controlMarkup(type, def)).join('');
  const grid = type === 'vcard' || type === 'location';

  return `<div class="type-selector" role="tablist" aria-label="${escapeHtml(t('generator.typeHeading'))}">${tiles}</div>
    <div class="form-section">
      <div class="form-section-head">
        <div>
          <div class="form-section-title"><i class="icon" data-lucide="pencil"></i>${escapeHtml(t(`types.${type}`))}</div>
          <p class="form-section-desc">${escapeHtml(t('generator.typeHint'))}</p>
        </div>
      </div>
      <div class="${grid ? 'field-grid' : 'stack'}">${fields}</div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-gen-reset>
        <i class="icon" data-lucide="rotate-ccw"></i>
        <span>${escapeHtml(t('generator.actions.reset'))}</span>
      </button>
      <button type="button" class="btn btn-primary" data-gen-save>
        <i class="icon" data-lucide="save"></i>
        <span data-save-label>${escapeHtml(t(state.editingId ? 'generator.actions.update' : 'generator.actions.save'))}</span>
      </button>
    </div>`;
}

function presetMarkup() {
  return `<div class="preset-grid">
    ${PRESETS.map((preset) => {
      const style = normalizeStyle({ ...state.style, ...preset.style });
      return `<button type="button" class="preset-card ${state.style.preset === preset.id ? 'is-active' : ''}" data-preset="${preset.id}"
        title="${escapeHtml(t(`generator.presets.${preset.id}`))}"
        style="--swatch-bg:${style.background};--swatch-fg:${style.foreground};--swatch-g1:${style.gradientColor1};--swatch-g2:${style.gradientColor2}">
        <span class="preset-swatch ${style.useGradient ? 'has-gradient' : ''}"></span>
        <span class="preset-name">${escapeHtml(t(`generator.presets.${preset.id}`))}</span>
      </button>`;
    }).join('')}
  </div>`;
}

function logoMarkup() {
  if (!state.logo) {
    return `<label class="logo-drop" data-logo-drop>
      <i class="icon" data-lucide="image-plus"></i>
      <span class="logo-drop-text">
        <span class="logo-drop-title">${escapeHtml(t('generator.design.logoUpload'))}</span>
        <span class="logo-drop-hint">${escapeHtml(t('generator.design.logoHint'))}</span>
      </span>
      <input type="file" class="sr-only" data-logo-input accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg">
    </label>`;
  }
  return `<div class="logo-panel">
    <span class="logo-thumb"><img src="${escapeHtml(state.logo.dataUrl)}" alt=""></span>
    <span class="logo-info">
      <span class="logo-name">${escapeHtml(state.logo.name || 'logo')}</span>
      <span class="logo-size">${escapeHtml(formatBytes(state.logo.size || 0))} · ${escapeHtml(state.logo.mime || 'image/png')}</span>
    </span>
    <span class="logo-actions">
      <label class="btn btn-icon btn-ghost btn-sm" title="${escapeHtml(t('generator.design.logoReplace'))}" aria-label="${escapeHtml(t('generator.design.logoReplace'))}">
        <i class="icon" data-lucide="refresh-cw"></i>
        <input type="file" class="sr-only" data-logo-input accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg">
      </label>
      <button type="button" class="btn btn-icon btn-ghost btn-sm" data-logo-remove title="${escapeHtml(t('generator.design.logoRemove'))}" aria-label="${escapeHtml(t('generator.design.logoRemove'))}">
        <i class="icon" data-lucide="trash-2"></i>
      </button>
    </span>
  </div>`;
}

function designMarkup() {
  const style = state.style;
  const dotOptions = DOT_STYLES.map((item) => [item, t(`generator.dotStyles.${item}`)]);
  const squareOptions = CORNER_SQUARE_STYLES.map((item) => [item, t(`generator.cornerSquareStyles.${item}`)]);
  const dotCornerOptions = CORNER_DOT_STYLES.map((item) => [item, t(`generator.cornerDotStyles.${item}`)]);
  const sizeOptions = EXPORT_SIZES.map((size) => [String(size), `${formatNumber(size, getLanguage())} × ${formatNumber(size, getLanguage())}`]);

  return `<div class="stack">
    <div class="form-section">
      <div class="form-section-head">
        <div class="form-section-title"><i class="icon" data-lucide="palette"></i>${escapeHtml(t('generator.design.presets'))}</div>
      </div>
      <div data-preset-grid>${presetMarkup()}</div>
    </div>

    <div class="form-section">
      <div class="form-section-head">
        <div class="form-section-title"><i class="icon" data-lucide="fill"></i>${escapeHtml(t('generator.design.colors'))}</div>
      </div>
      <div class="field-grid">
        ${colorMarkup('foreground', t('generator.design.foreground'))}
        ${colorMarkup('background', t('generator.design.background'))}
      </div>
      <div class="field" style="margin-top:12px">
        <div class="field-row">
          <span class="field-row-text">
            <span class="field-row-title">${escapeHtml(t('generator.design.gradient'))}</span>
            <span class="field-row-desc">${escapeHtml(t('generator.design.gradientFrom'))} → ${escapeHtml(t('generator.design.gradientTo'))}</span>
          </span>
          <label class="switch">
            <input type="checkbox" data-style-toggle="gradient" ${style.useGradient ? 'checked' : ''}>
            <span class="switch-track"></span>
          </label>
        </div>
      </div>
      <div class="field-grid" data-gradient-fields>
        ${colorMarkup('gradientColor1', t('generator.design.gradientFrom'))}
        ${colorMarkup('gradientColor2', t('generator.design.gradientTo'))}
        <div class="field span-2">
          <span class="field-label">${escapeHtml(t('generator.design.gradientType'))}</span>
          <div class="segmented" data-gradient-types>
            <button type="button" data-gradient-type="linear" class="${style.gradientType === 'linear' ? 'is-active' : ''}">${escapeHtml(t('generator.design.gradientLinear'))}</button>
            <button type="button" data-gradient-type="radial" class="${style.gradientType === 'radial' ? 'is-active' : ''}">${escapeHtml(t('generator.design.gradientRadial'))}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-head">
        <div class="form-section-title"><i class="icon" data-lucide="sparkles"></i>${escapeHtml(t('generator.design.dots'))}</div>
      </div>
      <div class="field-grid">
        <div class="field">
          <span class="field-label">${escapeHtml(t('generator.design.dotStyle'))}</span>
          ${selectMarkup({ attr: 'data-style-select="dotStyle"', label: t('generator.design.dotStyle'), value: style.dotStyle, options: dotOptions })}
        </div>
        <div class="field">
          <span class="field-label">${escapeHtml(t('generator.design.cornerSquare'))}</span>
          ${selectMarkup({ attr: 'data-style-select="cornerSquareStyle"', label: t('generator.design.cornerSquare'), value: style.cornerSquareStyle, options: squareOptions })}
        </div>
        <div class="field">
          <span class="field-label">${escapeHtml(t('generator.design.cornerDot'))}</span>
          ${selectMarkup({ attr: 'data-style-select="cornerDotStyle"', label: t('generator.design.cornerDot'), value: style.cornerDotStyle, options: dotCornerOptions })}
        </div>
        <div class="field">
          <span class="field-label">${escapeHtml(t('generator.design.exportSize'))}</span>
          ${selectMarkup({ attr: 'data-export-size', label: t('generator.design.exportSize'), value: String(style.exportSize), options: sizeOptions })}
        </div>
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-head">
        <div>
          <div class="form-section-title"><i class="icon" data-lucide="shield-check"></i>${escapeHtml(t('generator.design.ecc'))}</div>
          <p class="form-section-desc">${escapeHtml(t('generator.design.eccHint'))}</p>
        </div>
      </div>
      <div class="ecc-grid" data-ecc-grid>
        ${ERROR_LEVELS.map((level) => `<button type="button" class="ecc-option ${style.errorCorrection === level ? 'is-active' : ''}"
          data-ecc="${level}" title="${escapeHtml(t('generator.ecc.capacity', { bytes: formatNumber(MAX_QR_BYTES[level], getLanguage()) }))}">
          <strong>${level}</strong>
          <span>${escapeHtml(t(`generator.ecc.${level}`))}</span>
        </button>`).join('')}
      </div>
      <div class="field" style="margin-top:14px">
        <div class="control-row">
          <span class="field-label">${escapeHtml(t('generator.design.margin'))}</span>
          <span class="range-value" data-range-value="marginPercent">${formatNumber(style.marginPercent, getLanguage())}%</span>
        </div>
        <input type="range" min="0" max="10" step="1" value="${style.marginPercent}" data-style-range="marginPercent"
          aria-label="${escapeHtml(t('generator.design.margin'))}">
      </div>
    </div>

    <div class="form-section">
      <div class="form-section-head">
        <div class="form-section-title"><i class="icon" data-lucide="image"></i>${escapeHtml(t('generator.design.logo'))}</div>
      </div>
      <div data-logo-block>${logoMarkup()}</div>
      <div class="stack" data-logo-sliders style="margin-top:12px">
        <div class="field">
          <div class="control-row">
            <span class="field-label">${escapeHtml(t('generator.design.logoScale'))}</span>
            <span class="range-value" data-range-value="logoScale">${formatNumber(Math.round(style.logoScale * 100), getLanguage())}%</span>
          </div>
          <input type="range" min="10" max="30" step="1" value="${Math.round(style.logoScale * 100)}" data-style-range="logoScale"
            aria-label="${escapeHtml(t('generator.design.logoScale'))}">
        </div>
        <div class="field">
          <div class="control-row">
            <span class="field-label">${escapeHtml(t('generator.design.logoMargin'))}</span>
            <span class="range-value" data-range-value="logoMargin">${formatNumber(Math.round(style.logoMargin * 100), getLanguage())}%</span>
          </div>
          <input type="range" min="0" max="6" step="1" value="${Math.round(style.logoMargin * 100)}" data-style-range="logoMargin"
            aria-label="${escapeHtml(t('generator.design.logoMargin'))}">
        </div>
      </div>
      <div class="design-note" data-readability><i class="icon" data-lucide="shield-check"></i><span></span></div>
      <div class="design-note" data-logo-note hidden><i class="icon" data-lucide="alert-triangle"></i><span>${escapeHtml(t('generator.design.logoWarn'))}</span></div>
    </div>
  </div>`;
}

function shellMarkup() {
  const formatOptions = [['png', 'PNG'], ['svg', 'SVG'], ['jpg', 'JPG']]
    .map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  return `<div class="generator-layout view-enter">
    <div class="generator-column">
      <div class="page-intro">
        <div>
          <h2>${escapeHtml(t('generator.title'))}</h2>
          <p>${escapeHtml(t('generator.subtitle'))}</p>
        </div>
      </div>

      <section class="card generator-card">
        <div class="generator-card-head">
          <div class="tabs" role="tablist" aria-label="${escapeHtml(t('generator.title'))}">
            <button type="button" class="tab ${state.tab === 'content' ? 'is-active' : ''}" data-gen-tab="content" role="tab"
              aria-selected="${state.tab === 'content'}">
              <i class="icon" data-lucide="pencil"></i>
              <span>${escapeHtml(t('generator.tabs.content'))}</span>
            </button>
            <button type="button" class="tab ${state.tab === 'design' ? 'is-active' : ''}" data-gen-tab="design" role="tab"
              aria-selected="${state.tab === 'design'}">
              <i class="icon" data-lucide="palette"></i>
              <span>${escapeHtml(t('generator.tabs.design'))}</span>
            </button>
          </div>
          <span class="badge badge-accent" data-edit-badge ${state.editingId ? '' : 'hidden'}>
            <i class="icon" data-lucide="pencil"></i>
            <span>${escapeHtml(t('generator.actions.update'))}</span>
          </span>
        </div>
        <div class="generator-card-body">
          <div data-panel="content" ${state.tab === 'content' ? '' : 'hidden'}>${contentMarkup()}</div>
          <div data-panel="design" ${state.tab === 'design' ? '' : 'hidden'}>${designMarkup()}</div>
        </div>
      </section>
    </div>

    <aside class="preview-column">
      <section class="card preview-card">
        <div class="preview-head">
          <span class="preview-head-title"><i class="icon" data-lucide="qr-code"></i>${escapeHtml(t('generator.preview.title'))}</span>
          <span class="preview-status" data-preview-status>${escapeHtml(t('generator.status.empty'))}</span>
        </div>

        <div class="qr-stage">
          <div class="qr-sheet is-empty" data-qr-sheet></div>
          <div class="preview-empty" data-preview-empty>
            <i class="icon" data-lucide="qr-code"></i>
            <strong data-preview-empty-title>${escapeHtml(t('generator.preview.emptyTitle'))}</strong>
            <span data-preview-empty-desc>${escapeHtml(t('generator.preview.emptyDesc'))}</span>
          </div>
        </div>

        <div class="preview-body">
          <div class="preview-meta">
            <span class="preview-meta-icon"><i class="icon" data-lucide="${typeIcon(state.type)}"></i></span>
            <div class="preview-meta-body">
              <div class="preview-label" data-preview-label>${escapeHtml(t(`types.${state.type}`))}</div>
              <div class="preview-payload" data-preview-payload dir="ltr">—</div>
              <div class="preview-meta-row">
                <span class="badge badge-neutral" data-preview-bytes hidden></span>
                <span class="badge badge-neutral" data-preview-ecc></span>
                <span class="badge badge-info" data-preview-logo hidden>
                  <i class="icon" data-lucide="image"></i>${escapeHtml(t('generator.preview.logo'))}
                </span>
              </div>
            </div>
          </div>

          <div class="download-panel">
            <div class="download-label">
              <span>${escapeHtml(t('generator.preview.export'))}</span>
              <span>${escapeHtml(t('generator.preview.format'))}</span>
            </div>
            <div class="download-row">
              <div class="select-wrap">
                <select class="select" data-export-format aria-label="${escapeHtml(t('generator.preview.format'))}">
                  ${formatOptions}
                </select>
                <i class="icon" data-lucide="chevrons-up-down"></i>
              </div>
              <button type="button" class="btn btn-primary btn-sm" data-gen-download>
                <i class="icon" data-lucide="download"></i>
                <span>${escapeHtml(t('generator.actions.download'))}</span>
              </button>
            </div>
            <div class="filename-row">
              <input class="input input-mono" type="text" maxlength="80" data-filename
                value="${escapeHtml(state.filename)}"
                placeholder="${escapeHtml(t('generator.preview.filenamePlaceholder'))}"
                aria-label="${escapeHtml(t('generator.preview.filename'))}" autocomplete="off">
            </div>
            <p class="field-hint">${escapeHtml(t('generator.preview.filenameHint'))}</p>
          </div>

          <div class="preview-actions">
            <button type="button" class="preview-action" data-gen-favorite aria-pressed="${state.favorite}">
              <i class="icon" data-lucide="star"></i>
              <span data-favorite-label>${escapeHtml(t(state.favorite ? 'generator.actions.favorited' : 'generator.actions.favorite'))}</span>
            </button>
            <button type="button" class="preview-action" data-gen-copy-image>
              <i class="icon" data-lucide="copy"></i>
              <span>${escapeHtml(t('generator.actions.copyImage'))}</span>
            </button>
            <button type="button" class="preview-action" data-gen-copy-text>
              <i class="icon" data-lucide="type"></i>
              <span>${escapeHtml(t('generator.actions.copyText'))}</span>
            </button>
            <button type="button" class="preview-action" data-gen-print>
              <i class="icon" data-lucide="printer"></i>
              <span>${escapeHtml(t('generator.actions.print'))}</span>
            </button>
          </div>

          <div class="preview-footer">
            <i class="icon" data-lucide="lock"></i>
            <span>${escapeHtml(t('generator.preview.local'))}</span>
          </div>
        </div>
      </section>
    </aside>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export default async function generatorView(view, ctx) {
  const mountId = uid('gen');
  let mounted = true;
  let qr = null;
  let renderTimer = null;
  let renderBusy = false;
  let renderPending = false;
  let previewEmptyEl = null;
  let sheetEl = null;
  let statusEl = null;
  let contentPanel = null;
  let designPanel = null;

  ensureFields();

  if (!state.initialized) {
    state.initialized = true;
    state.fields = blankFields();
    state.style = normalizeStyle(getSettings().generatorPrefs);
  }

  const editRecord = takeEditRecord();
  const newType = takeNewType();
  if (editRecord) {
    await applyEditRecord(editRecord);
  } else if (newType && QR_TYPES.includes(newType)) {
    resetDraft(newType);
  }

  const persistStyle = debounce(() => {
    if (state.editingId) return;
    try {
      saveSettings({ generatorPrefs: normalizeStyle(state.style) });
    } catch { /* storage can be full; the design still works for this session */ }
  }, 450);

  view.innerHTML = shellMarkup();
  applyIcons(view);

  contentPanel = view.querySelector('[data-panel="content"]');
  designPanel = view.querySelector('[data-panel="design"]');
  previewEmptyEl = view.querySelector('[data-preview-empty]');
  sheetEl = view.querySelector('[data-qr-sheet]');
  statusEl = view.querySelector('[data-preview-status]');

  if (editRecord) {
    toast(t('toast.editLoaded', { label: editRecord.label }), { type: 'info' });
  }

  function selectedBuild() {
    return state.build || currentBuild();
  }

  function paintFormErrors(build) {
    if (!contentPanel) return;
    contentPanel.querySelectorAll('[data-field]').forEach((field) => {
      const name = field.getAttribute('data-field');
      const invalid = !build.ok && build.field === name && (state.touched.has(name) || state.submitted);
      field.classList.toggle('is-invalid', Boolean(invalid));
      const error = field.querySelector('.field-error span');
      if (error) error.textContent = invalid ? t(build.errorKey) : '';
    });
    const password = contentPanel.querySelector('[data-field-input="password"]');
    if (password) password.disabled = state.fields.wifi.encryption === 'nopass';
  }

  function paintEmpty(build) {
    if (!previewEmptyEl || !sheetEl) return;
    const error = state.renderError;
    const show = !build.ok || Boolean(error);
    previewEmptyEl.hidden = !show;
    sheetEl.classList.toggle('is-empty', show);
    if (!show) return;

    const title = previewEmptyEl.querySelector('[data-preview-empty-title]');
    const desc = previewEmptyEl.querySelector('[data-preview-empty-desc]');
    if (build.empty) {
      if (title) title.textContent = t('generator.preview.emptyTitle');
      if (desc) desc.textContent = t('generator.preview.emptyDesc');
    } else {
      if (title) title.textContent = t('generator.preview.invalid');
      if (desc) desc.textContent = error || t(build.errorKey || 'generator.errors.generic');
    }
  }

  function paintStatus(build) {
    if (!statusEl) return;
    const error = state.renderError;
    let label = t('generator.preview.ready');
    let variant = 'is-ready';
    if (error) {
      label = t('generator.status.invalid');
      variant = 'is-error';
    } else if (!build.ok) {
      label = build.empty ? t('generator.status.empty') : build.tooLong ? t('generator.status.tooLong') : t('generator.status.invalid');
      variant = build.empty ? '' : 'is-error';
    }
    statusEl.className = `preview-status ${variant}`.trim();
    statusEl.textContent = label;
    statusEl.title = !build.ok && !build.empty ? t(build.errorKey || 'generator.errors.generic') : '';
  }

  function paintMeta(build) {
    const labelEl = view.querySelector('[data-preview-label]');
    const payloadEl = view.querySelector('[data-preview-payload]');
    const bytesEl = view.querySelector('[data-preview-bytes]');
    const eccEl = view.querySelector('[data-preview-ecc]');
    const logoEl = view.querySelector('[data-preview-logo]');
    const editBadge = view.querySelector('[data-edit-badge]');
    const favoriteBtn = view.querySelector('[data-gen-favorite]');
    const favoriteLabel = view.querySelector('[data-favorite-label]');

    const fallbackLabel = t(`types.${state.type}`);
    if (labelEl) labelEl.textContent = build.ok ? build.label : fallbackLabel;
    if (payloadEl) payloadEl.textContent = build.payload || '—';
    if (bytesEl) {
      bytesEl.hidden = !build.bytes;
      bytesEl.textContent = build.bytes ? t('generator.preview.bytes', { count: formatNumber(build.bytes, getLanguage()) }) : '';
    }
    if (eccEl) eccEl.textContent = t('generator.preview.ecc', { level: state.style.errorCorrection });
    if (logoEl) logoEl.hidden = !state.logo;
    if (editBadge) editBadge.hidden = !state.editingId;
    const saveLabel = view.querySelector('[data-save-label]');
    if (saveLabel) saveLabel.textContent = t(state.editingId ? 'generator.actions.update' : 'generator.actions.save');
    if (favoriteBtn) {
      favoriteBtn.classList.toggle('is-active', state.favorite);
      favoriteBtn.setAttribute('aria-pressed', String(state.favorite));
    }
    if (favoriteLabel) {
      favoriteLabel.textContent = t(state.favorite ? 'generator.actions.favorited' : 'generator.actions.favorite');
    }
  }

  function paintEcc(build) {
    if (!designPanel) return;
    const bytes = build.bytes || 0;
    designPanel.querySelectorAll('[data-ecc]').forEach((button) => {
      const level = button.getAttribute('data-ecc');
      button.classList.toggle('is-active', level === state.style.errorCorrection);
      const overCapacity = bytes > 0 && bytes > MAX_QR_BYTES[level];
      button.disabled = overCapacity && level !== state.style.errorCorrection;
    });
  }

  function fitRange(key, value, max) {
    const clamped = Math.max(0, Math.min(max, Number(value) || 0));
    if (key === 'logoScale') return Math.max(0.1, Math.min(0.3, clamped / 100));
    if (key === 'logoMargin') return Math.max(0, Math.min(0.06, clamped / 100));
    return clamped;
  }

  function paintDesign(build) {
    if (!designPanel) return;
    const style = state.style;
    designPanel.querySelectorAll('[data-color-picker]').forEach((input) => {
      const key = input.getAttribute('data-color-picker');
      if (input.value !== style[key]) input.value = style[key];
      const text = input.parentElement?.querySelector(`[data-color-text="${key}"]`);
      if (text && text !== document.activeElement) text.value = style[key];
    });
    designPanel.querySelectorAll('[data-style-select]').forEach((select) => {
      const key = select.getAttribute('data-style-select');
      if (select.value !== style[key]) select.value = style[key];
    });
    designPanel.querySelectorAll('[data-style-toggle]').forEach((input) => {
      const key = input.getAttribute('data-style-toggle');
      input.checked = key === 'gradient' ? style.useGradient : Boolean(style[key]);
    });
    designPanel.querySelectorAll('[data-gradient-type]').forEach((button) => {
      button.classList.toggle('is-active', button.getAttribute('data-gradient-type') === style.gradientType);
    });
    designPanel.querySelectorAll('[data-range-value]').forEach((node) => {
      const key = node.getAttribute('data-range-value');
      const value = key === 'logoScale' || key === 'logoMargin'
        ? Math.round(style[key] * 100)
        : style[key];
      node.textContent = `${formatNumber(value, getLanguage())}%`;
    });
    designPanel.querySelectorAll('[data-style-range]').forEach((input) => {
      const key = input.getAttribute('data-style-range');
      const value = key === 'logoScale' || key === 'logoMargin'
        ? Math.round(style[key] * 100)
        : style[key];
      if (input.value !== String(value)) input.value = String(value);
    });
    const gradientFields = designPanel.querySelector('[data-gradient-fields]');
    if (gradientFields) gradientFields.style.display = style.useGradient ? '' : 'none';
    const presetGrid = designPanel.querySelector('[data-preset-grid]');
    if (presetGrid) presetGrid.innerHTML = presetMarkup();
    const logoBlock = designPanel.querySelector('[data-logo-block]');
    if (logoBlock) logoBlock.innerHTML = logoMarkup();
    const logoSliders = designPanel.querySelector('[data-logo-sliders]');
    if (logoSliders) logoSliders.style.display = state.logo ? '' : 'none';

    const readability = designPanel.querySelector('[data-readability]');
    if (readability) {
      const backgrounds = [style.foreground];
      if (style.useGradient) backgrounds.push(style.gradientColor1, style.gradientColor2);
      let level = 'good';
      let text = t('generator.design.contrastGood');
      const worst = Math.min(...backgrounds.map((fg) => contrastRatioSafe(fg, style.background)));
      if (worst < 3) {
        level = 'bad';
        text = t('generator.design.contrastBad');
      } else if (worst < 4.5) {
        level = 'warn';
        text = t('generator.design.contrastLow');
      }
      readability.classList.remove('is-good', 'is-warn', 'is-bad');
      readability.classList.add(`is-${level}`);
      const span = readability.querySelector('span');
      if (span) span.textContent = text;
    }
    const logoNote = designPanel.querySelector('[data-logo-note]');
    if (logoNote) logoNote.hidden = !state.logo || style.errorCorrection === 'H';

    paintEcc(build);
    applyIcons(designPanel);
  }

  function paint() {
    const build = currentBuild();
    state.build = build;
    if (!build.ok) state.renderError = null;
    paintFormErrors(build);
    paintStatus(build);
    paintMeta(build);
    paintDesign(build);
    paintEmpty(build);
    if (build.ok && !state.renderError) scheduleRender();
    return build;
  }

  function showRenderError(error) {
    state.renderError = qrErrorMessage(error, t);
    paintStatus(selectedBuild());
    paintEmpty(selectedBuild());
  }

  async function flushRender() {
    if (!mounted) return;
    if (renderBusy) {
      renderPending = true;
      return;
    }
    renderBusy = true;
    try {
      do {
        renderPending = false;
        const build = currentBuild();
        if (!build.ok) break;
        const myMount = mountId;
        sheetEl?.classList.add('is-rendering');
        try {
          if (!qr) {
            sheetEl.replaceChildren();
            qr = await createQr(sheetEl, {
              data: build.payload,
              style: state.style,
              size: PREVIEW_SIZE,
              logoDataUrl: state.logo?.dataUrl || null
            });
          } else {
            await updateQr(qr, {
              data: build.payload,
              style: state.style,
              size: PREVIEW_SIZE,
              logoDataUrl: state.logo?.dataUrl || null
            });
          }
          if (!mounted || myMount !== mountId) return;
          state.renderError = null;
          paintStatus(build);
          paintEmpty(build);
        } catch (error) {
          if (!mounted || myMount !== mountId) return;
          console.error('[generator] preview failed', error);
          showRenderError(error);
        } finally {
          sheetEl?.classList.remove('is-rendering');
        }
      } while (renderPending && mounted);
    } finally {
      renderBusy = false;
    }
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      flushRender();
    }, 140);
  }

  function setStyle(patch, { sync = false } = {}) {
    state.style = normalizeStyle({ ...state.style, ...patch });
    if (sync) paintDesign(state.build || currentBuild());
    paint();
    persistStyle();
  }

  function switchTab(tab) {
    state.tab = tab === 'design' ? 'design' : 'content';
    view.querySelectorAll('[data-gen-tab]').forEach((button) => {
      const active = button.getAttribute('data-gen-tab') === state.tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const content = view.querySelector('[data-panel="content"]');
    const design = view.querySelector('[data-panel="design"]');
    if (content) content.hidden = state.tab !== 'content';
    if (design) design.hidden = state.tab !== 'design';
  }

  function selectType(type) {
    if (!QR_TYPES.includes(type) || type === state.type) return;
    state.type = type;
    ensureFields();
    state.touched = new Set();
    state.submitted = false;
    state.build = null;
    state.renderError = null;
    if (contentPanel) {
      contentPanel.innerHTML = contentMarkup();
      applyIcons(contentPanel);
    }
    paint();
  }

  async function saveCurrent() {
    const button = view.querySelector('[data-gen-save]');
    const build = currentBuild();
    state.build = build;
    if (!build.ok) {
      state.submitted = true;
      Object.keys(state.fields[state.type] || {}).forEach((name) => state.touched.add(name));
      paint();
      toast(t(build.errorKey || 'generator.errors.noPayload'), { type: 'error' });
      return false;
    }
    setBusy(button, true);
    try {
      const logoId = await persistLogo();
      const draft = buildRecord(build, { logoId });
      let result;
      if (state.editingId) {
        const updated = updateRecord(state.editingId, draft);
        result = updated ? { record: updated, isNew: false } : saveRecord({ ...draft, id: state.localId });
      } else {
        result = saveRecord(draft);
      }
      state.editingId = result.record.id;
      state.localId = result.record.id;
      state.favorite = isFavorite(result.record);
      toast(t(result.isNew ? 'toast.historySaved' : 'toast.historyUpdated'), { type: 'success' });
      paint();
      return true;
    } catch (error) {
      console.error('[generator] save failed', error);
      if (error?.message === 'STORAGE_FULL') toast(t('generator.errors.storageFull'), { type: 'error' });
      else if (error?.message === 'INVALID_RECORD') toast(t('generator.errors.invalidRecord'), { type: 'error' });
      else toast(t('errors.saveFailed'), { type: 'error' });
      return false;
    } finally {
      if (button?.isConnected) setBusy(button, false);
    }
  }

  async function toggleFavorite() {
    const build = currentBuild();
    state.build = build;
    if (!build.ok) {
      toast(t(build.errorKey || 'generator.errors.noPayload'), { type: 'error' });
      return;
    }
    const button = view.querySelector('[data-gen-favorite]');
    setBusy(button, true);
    try {
      const logoId = await persistLogo();
      const draft = buildRecord(build, { logoId });
      const added = toggleFavoriteWithToast(draft);
      if (added === null) return;
      state.favorite = added;
      paint();
    } catch (error) {
      console.error('[generator] favorite failed', error);
      toast(t('errors.saveFailed'), { type: 'error' });
    } finally {
      if (button?.isConnected) setBusy(button, false);
    }
  }

  async function downloadCurrent() {
    const button = view.querySelector('[data-gen-download]');
    const build = currentBuild();
    state.build = build;
    if (!build.ok) {
      toast(t(build.errorKey || 'generator.errors.noPayload'), { type: 'error' });
      return;
    }
    setBusy(button, true);
    try {
      const format = view.querySelector('[data-export-format]')?.value || 'png';
      const logoId = await persistLogo();
      const record = buildRecord(build, { logoId });
      const filename = state.filename ? sanitizeFilename(state.filename, '') : '';
      const result = await downloadRecord(record, {
        format,
        size: state.style.exportSize,
        filename,
        logoDataUrl: state.logo?.dataUrl || null
      });
      toast(t('toast.downloadStarted', { filename: result.filename }), { type: 'success' });
    } catch (error) {
      console.error('[generator] download failed', error);
      toast(qrErrorMessage(error, t), { type: 'error' });
    } finally {
      if (button?.isConnected) setBusy(button, false);
    }
  }

  async function copyImage() {
    const button = view.querySelector('[data-gen-copy-image]');
    const build = currentBuild();
    if (!build.ok) {
      toast(t(build.errorKey || 'generator.errors.noPayload'), { type: 'error' });
      return;
    }
    setBusy(button, true);
    try {
      const record = buildRecord(build, { logoId: state.logoId });
      const mode = await copyQrAsImage(record, {
        size: state.style.exportSize,
        logoDataUrl: state.logo?.dataUrl || null
      });
      toast(t(mode === 'image' ? 'toast.copyImage' : 'toast.copyImageFallback'), {
        type: 'success'
      });
    } catch (error) {
      console.error('[generator] copy image failed', error);
      toast(t('toast.copyFailed'), { type: 'error' });
    } finally {
      if (button?.isConnected) setBusy(button, false);
    }
  }

  async function copyPayload() {
    const build = currentBuild();
    if (!build.ok) {
      toast(t(build.errorKey || 'generator.errors.noPayload'), { type: 'error' });
      return;
    }
    try {
      await copyText(build.payload);
      toast(t('toast.copyPayload'), { type: 'success' });
    } catch {
      toast(t('toast.copyFailed'), { type: 'error' });
    }
  }

  async function printCurrent() {
    const button = view.querySelector('[data-gen-print]');
    const build = currentBuild();
    if (!build.ok) {
      toast(t(build.errorKey || 'generator.errors.noPayload'), { type: 'error' });
      return;
    }
    setBusy(button, true);
    try {
      const record = buildRecord(build, { logoId: state.logoId });
      const dataUrl = await recordDataUrl(record, {
        size: 1024,
        logoDataUrl: state.logo?.dataUrl || null
      });
      await printQr(dataUrl, {
        title: record.label,
        subtitle: `${t(`types.${record.type}`)} · ${record.payload}`
      });
      toast(t('toast.printed'), { type: 'info' });
    } catch (error) {
      console.error('[generator] print failed', error);
      toast(t('toast.printFailed'), { type: 'error' });
    } finally {
      if (button?.isConnected) setBusy(button, false);
    }
  }

  async function handleLogoFile(file) {
    if (!file || !mounted) return;
    if (file.size > 8 * 1024 * 1024) {
      toast(t('generator.errors.logoSourceTooLarge'), { type: 'error' });
      return;
    }
    try {
      const logo = await processLogoFile(file);
      if (!mounted) return;
      state.logo = { ...logo, storedId: null };
      state.logoId = null;
      const raised = state.style.errorCorrection === 'L' || state.style.errorCorrection === 'M';
      if (raised) {
        state.style = normalizeStyle({ ...state.style, errorCorrection: 'H' });
        persistStyle();
      }
      paintDesign(currentBuild());
      paint();
      toast(t('toast.logoAdded'), { type: 'success' });
      if (raised) toast(t('toast.logoEcc'), { type: 'info' });
    } catch (error) {
      console.error('[generator] logo failed', error);
      const code = error?.message || '';
      const key = code === 'LOGO_TOO_LARGE'
        ? 'generator.errors.logoTooLarge'
        : code === 'LOGO_SOURCE_TOO_LARGE'
          ? 'generator.errors.logoSourceTooLarge'
          : code === 'INVALID_LOGO_TYPE'
            ? 'generator.errors.invalidLogoType'
            : code === 'INVALID_SVG'
              ? 'generator.errors.invalidSvg'
              : code === 'INVALID_IMAGE'
                ? 'generator.errors.invalidImage'
                : 'generator.errors.generic';
      toast(t(key), { type: 'error' });
    }
  }

  function removeLogo() {
    state.logo = null;
    state.logoId = null;
    paintDesign(currentBuild());
    paint();
    toast(t('toast.logoRemoved'), { type: 'info' });
  }

  function resetCurrent() {
    resetDraft(state.type);
    if (contentPanel) {
      contentPanel.innerHTML = contentMarkup();
      applyIcons(contentPanel);
    }
    if (designPanel) {
      designPanel.innerHTML = designMarkup();
      applyIcons(designPanel);
    }
    switchTab('content');
    paint();
    toast(t('toast.reset'), { type: 'info' });
  }

  function updateField(input) {
    const name = input.getAttribute('data-field-input');
    if (!name) return;
    const fields = state.fields[state.type] || (state.fields[state.type] = defaultFields(state.type));
    fields[name] = input.type === 'checkbox' ? input.checked : input.value;
    state.touched.add(name);
    state.submitted = false;
    paint();
  }

  function readColor(value) {
    const raw = String(value || '').trim();
    const withHash = raw.startsWith('#') ? raw : `#${raw}`;
    return /^#[0-9a-f]{6}$/i.test(withHash) ? withHash.toLowerCase() : null;
  }

  const onInput = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.matches('[data-field-input]')) {
      updateField(target);
      return;
    }

    if (target.matches('[data-filename]')) {
      state.filename = target.value;
      return;
    }

    if (target.matches('[data-color-picker]')) {
      const key = target.getAttribute('data-color-picker');
      setStyle({ [key]: target.value });
      const text = target.parentElement?.querySelector(`[data-color-text="${key}"]`);
      if (text) text.value = target.value;
      return;
    }

    if (target.matches('[data-color-text]')) {
      const key = target.getAttribute('data-color-text');
      const color = readColor(target.value);
      if (color) {
        setStyle({ [key]: color });
        const picker = target.parentElement?.querySelector(`[data-color-picker="${key}"]`);
        if (picker) picker.value = color;
      }
      return;
    }

    if (target.matches('[data-style-range]')) {
      const key = target.getAttribute('data-style-range');
      const value = fitRange(key, target.value, key === 'logoScale' ? 30 : key === 'logoMargin' ? 6 : 10);
      state.style = normalizeStyle({ ...state.style, [key]: value });
      const valueEl = designPanel?.querySelector(`[data-range-value="${key}"]`);
      if (valueEl) valueEl.textContent = `${formatNumber(target.value, getLanguage())}%`;
      paint();
      persistStyle();
      return;
    }

    if (target.matches('[data-style-select]')) {
      const key = target.getAttribute('data-style-select');
      setStyle({ [key]: target.value });
    }
  };

  const onChange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.matches('[data-file-input], [data-logo-input]')) {
      const file = target.files?.[0];
      target.value = '';
      handleLogoFile(file);
      return;
    }

    if (target.matches('[data-color-text]')) {
      const key = target.getAttribute('data-color-text');
      const color = readColor(target.value);
      if (color) {
        target.value = color;
        setStyle({ [key]: color });
      } else {
        target.value = state.style[key];
      }
      return;
    }

    if (target.matches('[data-export-size]')) {
      setStyle({ exportSize: Number(target.value) });
      return;
    }

    if (target.matches('[data-style-toggle]')) {
      const key = target.getAttribute('data-style-toggle');
      setStyle({ useGradient: target.checked }, { sync: true });
    }
  };

  const onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const tab = target.closest('[data-gen-tab]');
    if (tab) {
      switchTab(tab.getAttribute('data-gen-tab'));
      return;
    }

    const type = target.closest('[data-type]');
    if (type) {
      selectType(type.getAttribute('data-type'));
      return;
    }

    if (target.closest('[data-gen-save]')) {
      saveCurrent();
      return;
    }

    if (target.closest('[data-gen-reset]')) {
      resetCurrent();
      return;
    }

    if (target.closest('[data-gen-favorite]')) {
      toggleFavorite();
      return;
    }

    if (target.closest('[data-gen-download]')) {
      downloadCurrent();
      return;
    }

    if (target.closest('[data-gen-copy-image]')) {
      copyImage();
      return;
    }

    if (target.closest('[data-gen-copy-text]')) {
      copyPayload();
      return;
    }

    if (target.closest('[data-gen-print]')) {
      printCurrent();
      return;
    }

    if (target.closest('[data-logo-remove]')) {
      removeLogo();
      return;
    }

    const preset = target.closest('[data-preset]');
    if (preset) {
      const presetId = preset.getAttribute('data-preset');
      const definition = PRESETS.find((item) => item.id === presetId);
      if (definition) {
        setStyle({ ...definition.style, preset: presetId }, { sync: true });
      }
      return;
    }

    const gradientType = target.closest('[data-gradient-type]');
    if (gradientType) {
      setStyle({ gradientType: gradientType.getAttribute('data-gradient-type') }, { sync: true });
      return;
    }

    const ecc = target.closest('[data-ecc]');
    if (ecc) {
      setStyle({ errorCorrection: ecc.getAttribute('data-ecc') }, { sync: true });
    }
  };

  const onDragOver = (event) => {
    const drop = event.target instanceof Element ? event.target.closest('[data-logo-drop]') : null;
    if (!drop) return;
    event.preventDefault();
    drop.classList.add('is-drag');
  };

  const onDragLeave = (event) => {
    const drop = event.target instanceof Element ? event.target.closest('[data-logo-drop]') : null;
    if (drop) drop.classList.remove('is-drag');
  };

  const onDrop = (event) => {
    const drop = event.target instanceof Element ? event.target.closest('[data-logo-drop]') : null;
    if (!drop) return;
    event.preventDefault();
    drop.classList.remove('is-drag');
    const file = event.dataTransfer?.files?.[0];
    if (file) handleLogoFile(file);
  };

  const onShortcut = () => {
    if (ctx.name === 'generator') saveCurrent();
  };

  view.addEventListener('input', onInput);
  view.addEventListener('change', onChange);
  view.addEventListener('click', onClick);
  view.addEventListener('dragover', onDragOver);
  view.addEventListener('dragleave', onDragLeave);
  view.addEventListener('drop', onDrop);
  window.addEventListener('qs:save', onShortcut);

  paint();
  switchTab(state.tab);

  return () => {
    mounted = false;
    clearTimeout(renderTimer);
    renderTimer = null;
    persistStyle.flush();
    view.removeEventListener('input', onInput);
    view.removeEventListener('change', onChange);
    view.removeEventListener('click', onClick);
    view.removeEventListener('dragover', onDragOver);
    view.removeEventListener('dragleave', onDragLeave);
    view.removeEventListener('drop', onDrop);
    window.removeEventListener('qs:save', onShortcut);
  };
}

function contrastRatioSafe(a, b) {
  try {
    return contrastRatio(a, b);
  } catch {
    return 21;
  }
}

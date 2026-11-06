/**
 * QR Studio — shared configuration.
 * No imports, safe to use from every module.
 */

export const APP_NAME = 'QR Studio';
export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;

export const QR_TYPES = [
  'url',
  'text',
  'wifi',
  'email',
  'phone',
  'sms',
  'vcard',
  'location'
];

export const BATCH_TYPES = ['text', 'url'];
export const ERROR_LEVELS = ['L', 'M', 'Q', 'H'];

/** Byte-mode capacity of a single QR symbol at each error-correction level. */
export const MAX_QR_BYTES = { L: 2953, M: 2331, Q: 1663, H: 1273 };

export const LIMITS = {
  history: 100,
  favorites: 1000,
  scans: 60,
  activity: 40,
  batch: 1000,
  logoBytes: 300 * 1024,
  logoDimension: 512,
  backupBytes: 12 * 1024 * 1024,
  csvBytes: 5 * 1024 * 1024,
  imageBytes: 12 * 1024 * 1024
};

export const EXPORT_SIZES = [256, 512, 1024, 2048, 4096];

export const DOT_STYLES = ['square', 'rounded', 'dots', 'extra-rounded', 'classy', 'classy-rounded'];
export const CORNER_SQUARE_STYLES = ['square', 'extra-rounded', 'dot'];
export const CORNER_DOT_STYLES = ['square', 'dot'];

export const DEFAULT_STYLE = {
  foreground: '#17131f',
  background: '#ffffff',
  useGradient: false,
  gradientColor1: '#7c3aed',
  gradientColor2: '#c084fc',
  gradientType: 'linear',
  dotStyle: 'square',
  cornerSquareStyle: 'extra-rounded',
  cornerDotStyle: 'square',
  errorCorrection: 'M',
  marginPercent: 8,
  exportSize: 1024,
  logoScale: 0.2,
  logoMargin: 0.02,
  preset: 'classic'
};

export const PRESETS = [
  {
    id: 'classic',
    icon: 'square-dashed',
    style: {
      foreground: '#17131f', background: '#ffffff', useGradient: false,
      dotStyle: 'square', cornerSquareStyle: 'extra-rounded', cornerDotStyle: 'square',
      gradientColor1: '#7c3aed', gradientColor2: '#c084fc'
    }
  },
  {
    id: 'violet',
    icon: 'sparkles',
    style: {
      foreground: '#7c3aed', background: '#ffffff', useGradient: true,
      gradientColor1: '#7c3aed', gradientColor2: '#c084fc',
      dotStyle: 'rounded', cornerSquareStyle: 'extra-rounded', cornerDotStyle: 'dot'
    }
  },
  {
    id: 'midnight',
    icon: 'moon',
    style: {
      foreground: '#312e81', background: '#f7f6ff', useGradient: false,
      dotStyle: 'rounded', cornerSquareStyle: 'extra-rounded', cornerDotStyle: 'dot'
    }
  },
  {
    id: 'ocean',
    icon: 'palette',
    style: {
      foreground: '#0891b2', background: '#f0fdfa', useGradient: true,
      gradientColor1: '#0ea5e9', gradientColor2: '#14b8a6',
      dotStyle: 'extra-rounded', cornerSquareStyle: 'extra-rounded', cornerDotStyle: 'dot'
    }
  },
  {
    id: 'sunset',
    icon: 'sun',
    style: {
      foreground: '#ea580c', background: '#fff7ed', useGradient: true,
      gradientColor1: '#f97316', gradientColor2: '#ec4899',
      dotStyle: 'rounded', cornerSquareStyle: 'extra-rounded', cornerDotStyle: 'dot'
    }
  },
  {
    id: 'mono',
    icon: 'circle-dot',
    style: {
      foreground: '#000000', background: '#ffffff', useGradient: false,
      dotStyle: 'square', cornerSquareStyle: 'square', cornerDotStyle: 'square',
      gradientColor1: '#000000', gradientColor2: '#525252'
    }
  }
];

const COLOR_RE = /^#[0-9a-f]{6}$/i;

export function normalizeColor(value, fallback) {
  return typeof value === 'string' && COLOR_RE.test(value) ? value.toLowerCase() : fallback;
}

export function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

export function normalizeStyle(input = {}) {
  const style = { ...DEFAULT_STYLE, ...(input && typeof input === 'object' ? input : {}) };
  return {
    foreground: normalizeColor(style.foreground, DEFAULT_STYLE.foreground),
    background: normalizeColor(style.background, DEFAULT_STYLE.background),
    useGradient: Boolean(style.useGradient),
    gradientColor1: normalizeColor(style.gradientColor1, DEFAULT_STYLE.gradientColor1),
    gradientColor2: normalizeColor(style.gradientColor2, DEFAULT_STYLE.gradientColor2),
    gradientType: style.gradientType === 'radial' ? 'radial' : 'linear',
    dotStyle: DOT_STYLES.includes(style.dotStyle) ? style.dotStyle : DEFAULT_STYLE.dotStyle,
    cornerSquareStyle: CORNER_SQUARE_STYLES.includes(style.cornerSquareStyle)
      ? style.cornerSquareStyle
      : DEFAULT_STYLE.cornerSquareStyle,
    cornerDotStyle: CORNER_DOT_STYLES.includes(style.cornerDotStyle)
      ? style.cornerDotStyle
      : DEFAULT_STYLE.cornerDotStyle,
    errorCorrection: ERROR_LEVELS.includes(style.errorCorrection)
      ? style.errorCorrection
      : DEFAULT_STYLE.errorCorrection,
    marginPercent: clamp(style.marginPercent, 0, 10, DEFAULT_STYLE.marginPercent),
    exportSize: EXPORT_SIZES.includes(Number(style.exportSize))
      ? Number(style.exportSize)
      : DEFAULT_STYLE.exportSize,
    logoScale: clamp(style.logoScale, 0.1, 0.3, DEFAULT_STYLE.logoScale),
    logoMargin: clamp(style.logoMargin, 0, 0.06, DEFAULT_STYLE.logoMargin),
    preset: typeof style.preset === 'string' ? style.preset.slice(0, 32) : DEFAULT_STYLE.preset
  };
}

export function styleFingerprint(style) {
  const s = normalizeStyle(style);
  return [
    s.foreground, s.background, s.useGradient ? 1 : 0, s.gradientColor1,
    s.gradientColor2, s.gradientType, s.dotStyle, s.cornerSquareStyle,
    s.cornerDotStyle, s.errorCorrection, s.marginPercent, s.logoScale
  ].join('|');
}

export function makeFingerprint(payload, style, logoId) {
  return `${payload}\u0000${styleFingerprint(style)}\u0000${logoId || ''}`;
}

/** QR rendering facade around the locally bundled qr-code-styling library. */
import { normalizeStyle, LIMITS, MAX_QR_BYTES } from './config.js';
import { blobToDataUrl, loadScript, readFileAsDataURL } from './utils.js';

let libraryPromise = null;

export function loadQrLibrary() {
  if (window.QRCodeStyling) return Promise.resolve(window.QRCodeStyling);
  if (!libraryPromise) {
    libraryPromise = loadScript('./lib/qr-code-styling/qr-code-styling.js', 'QRCodeStyling');
  }
  return libraryPromise;
}

function gradientOf(style) {
  return {
    type: style.gradientType === 'radial' ? 'radial' : 'linear',
    rotation: Math.PI / 4,
    colorStops: [
      { offset: 0, color: style.gradientColor1 },
      { offset: 1, color: style.gradientColor2 }
    ]
  };
}

export function buildQrOptions({ data, style: rawStyle, size = 512, logoDataUrl = null }) {
  const style = normalizeStyle(rawStyle);
  const margin = Math.round(size * (style.marginPercent / 100));
  const gradient = style.useGradient ? gradientOf(style) : undefined;
  const options = {
    width: size,
    height: size,
    type: 'canvas',
    data: String(data || ''),
    margin,
    qrOptions: {
      typeNumber: 0,
      errorCorrectionLevel: style.errorCorrection
    },
    dotsOptions: {
      type: style.dotStyle,
      color: style.foreground,
      roundSize: true,
      ...(gradient ? { gradient } : {})
    },
    cornersSquareOptions: {
      type: style.cornerSquareStyle,
      color: style.foreground,
      ...(gradient ? { gradient } : {})
    },
    cornersDotOptions: {
      type: style.cornerDotStyle,
      color: style.foreground,
      ...(gradient ? { gradient } : {})
    },
    backgroundOptions: {
      color: style.background
    }
  };
  if (logoDataUrl) {
    options.image = logoDataUrl;
    options.imageOptions = {
      hideBackgroundDots: true,
      imageSize: style.logoScale,
      margin: Math.max(2, Math.round(size * style.logoMargin)),
      saveAsBlob: false
    };
  }
  return options;
}

export async function createQr(container, payload) {
  const QRCodeStyling = await loadQrLibrary();
  const qr = new QRCodeStyling(buildQrOptions(payload));
  if (container) qr.append(container);
  return qr;
}

export async function updateQr(instance, payload) {
  if (!instance) return null;
  await loadQrLibrary();
  instance.update(buildQrOptions(payload));
  return instance;
}

function friendlyError(error) {
  const message = String(error?.message || error || '');
  if (/code length overflow|too long/i.test(message)) {
    return Object.assign(new Error('QR_TOO_LONG'), { code: 'QR_TOO_LONG' });
  }
  if (/canvas is too small|too small/i.test(message)) {
    return Object.assign(new Error('QR_TOO_SMALL'), { code: 'QR_TOO_SMALL' });
  }
  if (/empty/i.test(message)) {
    return Object.assign(new Error('QR_EMPTY'), { code: 'QR_EMPTY' });
  }
  return error;
}

/**
 * Render a standalone QR blob at export resolution.
 * @returns {Promise<Blob>}
 */
export async function renderQrBlob({ data, style, size = 1024, logoDataUrl = null, format = 'png' }) {
  if (!data) throw Object.assign(new Error('QR_EMPTY'), { code: 'QR_EMPTY' });
  const normalized = normalizeStyle(style);
  const max = MAX_QR_BYTES[normalized.errorCorrection] || MAX_QR_BYTES.M;
  if (new TextEncoder().encode(String(data)).length > max) {
    throw Object.assign(new Error('QR_TOO_LONG'), { code: 'QR_TOO_LONG' });
  }
  const QRCodeStyling = await loadQrLibrary();
  const instance = new QRCodeStyling(buildQrOptions({
    data,
    style: normalized,
    size,
    logoDataUrl
  }));
  let blob;
  try {
    blob = await instance.getRawData(format);
  } catch (error) {
    throw friendlyError(error);
  }
  if (!blob || !(blob instanceof Blob) || blob.size === 0) {
    throw Object.assign(new Error('EMPTY_EXPORT'), { code: 'EMPTY_EXPORT' });
  }
  return blob;
}

export async function renderQrDataUrl(payload) {
  const blob = await renderQrBlob(payload);
  return blobToDataUrl(blob);
}

/* ------------------------------------------------------------------ */
/* Logo processing                                                     */
/* ------------------------------------------------------------------ */

function isSvgFile(file) {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '');
}

function isRasterFile(file) {
  return ['image/png', 'image/jpeg', 'image/jpg'].includes(String(file.type).toLowerCase())
    || /\.(png|jpe?g)$/i.test(file.name || '');
}

function sanitizeSvgText(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('INVALID_SVG');
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== 'svg') throw new Error('INVALID_SVG');

  const blocked = new Set([
    'script', 'foreignobject', 'iframe', 'object', 'embed', 'image', 'audio',
    'video', 'canvas', 'link', 'style', 'meta', 'feimage', 'font-face-uri'
  ]);
  const walk = (node) => {
    for (const child of Array.from(node.children)) {
      const tag = child.localName.toLowerCase();
      if (blocked.has(tag)) {
        child.remove();
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith('on')) {
          child.removeAttribute(attr.name);
          continue;
        }
        if ((name === 'href' || name === 'xlink:href' || name === 'src') && !value.startsWith('#')) {
          child.removeAttribute(attr.name);
          continue;
        }
        if (name === 'style') {
          child.removeAttribute(attr.name);
          continue;
        }
        if (/(url\s*\()/i.test(value) && !/url\(\s*['"]?#/i.test(value)) {
          child.removeAttribute(attr.name);
        }
      }
      walk(child);
    }
  };
  walk(root);
  for (const attr of Array.from(root.attributes)) {
    if (attr.name.toLowerCase().startsWith('on')) root.removeAttribute(attr.name);
  }
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!root.getAttribute('viewBox')) {
    const width = parseFloat(root.getAttribute('width'));
    const height = parseFloat(root.getAttribute('height'));
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      root.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }
  }
  const serialized = new XMLSerializer().serializeToString(root);
  if (!serialized || serialized.length > LIMITS.logoBytes) throw new Error('LOGO_TOO_LARGE');
  return serialized;
}

async function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('INVALID_IMAGE'));
    });
    return { img, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('IMAGE_ENCODE_FAILED'));
      else resolve(blob);
    }, type, quality);
  });
}

async function rasterToLogo(file) {
  const { img, url } = await loadImageFile(file);
  try {
    const sourceW = img.naturalWidth || img.width;
    const sourceH = img.naturalHeight || img.height;
    if (!sourceW || !sourceH) throw new Error('INVALID_IMAGE');
    const dimensions = [512, 384, 320, 256, 192, 160];
    for (const maxDim of dimensions) {
      const scale = Math.min(1, maxDim / Math.max(sourceW, sourceH));
      const width = Math.max(1, Math.round(sourceW * scale));
      const height = Math.max(1, Math.round(sourceH * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
      ctx.clearRect(0, 0, width, height);
      if (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, 'image/png');
      if (blob.size <= LIMITS.logoBytes) {
        const dataUrl = await readFileAsDataURL(blob);
        return {
          dataUrl,
          mime: 'image/png',
          name: file.name,
          size: blob.size,
          width,
          height
        };
      }
    }
    // Last resort: JPEG with a white background.
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 320 / Math.max(sourceW, sourceH));
    canvas.width = Math.max(1, Math.round(sourceW * scale));
    canvas.height = Math.max(1, Math.round(sourceH * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.86);
    if (blob.size > LIMITS.logoBytes) throw new Error('LOGO_TOO_LARGE');
    return {
      dataUrl: await readFileAsDataURL(blob),
      mime: 'image/jpeg',
      name: file.name.replace(/\.(png|jpe?g)$/i, '.jpg'),
      size: blob.size,
      width: canvas.width,
      height: canvas.height
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Validate, sanitize and normalize an uploaded logo.
 * @returns {Promise<{dataUrl:string,mime:string,name:string,size:number}>}
 */
export async function processLogoFile(file) {
  if (!file || !(file instanceof File)) throw new Error('INVALID_FILE');
  const svg = isSvgFile(file);
  if (!svg && !isRasterFile(file)) throw new Error('INVALID_LOGO_TYPE');
  if (file.size > 8 * 1024 * 1024) throw new Error('LOGO_SOURCE_TOO_LARGE');

  if (svg) {
    const text = await file.text();
    const serialized = sanitizeSvgText(text);
    const bytes = new TextEncoder().encode(serialized).length;
    if (bytes > LIMITS.logoBytes) throw new Error('LOGO_TOO_LARGE');
    return {
      dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`,
      mime: 'image/svg+xml',
      name: file.name,
      size: bytes,
      width: null,
      height: null
    };
  }
  return rasterToLogo(file);
}

export function qrErrorMessage(error, t) {
  const code = error?.code || error?.message;
  if (code === 'QR_TOO_LONG') return t('generator.errors.tooLong');
  if (code === 'QR_TOO_SMALL') return t('generator.errors.tooSmall');
  if (code === 'QR_EMPTY') return t('generator.errors.required');
  if (code === 'EMPTY_EXPORT') return t('generator.errors.exportFailed');
  return t('generator.errors.generic');
}

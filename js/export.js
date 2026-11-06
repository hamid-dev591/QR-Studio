/** Export helpers: PNG, SVG, JPG, clipboard and print. */
import { getLogo } from './db.js';
import { renderQrBlob } from './qr-engine.js';
import {
  blobToDataUrl, copyText, downloadBlob, sanitizeFilename, stripExtension, todayStamp
} from './utils.js';

export function extensionFor(format) {
  const value = String(format || 'png').toLowerCase();
  if (value === 'svg') return 'svg';
  if (value === 'jpg' || value === 'jpeg') return 'jpg';
  return 'png';
}

export async function logoForRecord(record) {
  if (!record?.logoId) return null;
  try {
    const logo = await getLogo(record.logoId);
    return logo?.dataUrl || null;
  } catch {
    return null;
  }
}

export function suggestedFilename(record) {
  const label = sanitizeFilename(record?.label || 'qr-code', 'qr-code');
  if (label && label !== 'qr-code') return label;
  return `qr-studio-${todayStamp()}`;
}

/**
 * Render and download a record. Throws on any failure; never creates an empty file.
 * @returns {Promise<{blob:Blob,filename:string}>}
 */
export async function downloadRecord(record, {
  format = 'png',
  size = 1024,
  filename = '',
  logoDataUrl = undefined
} = {}) {
  const ext = extensionFor(format);
  const logo = logoDataUrl === undefined ? await logoForRecord(record) : logoDataUrl;
  const blob = await renderQrBlob({
    data: record.payload,
    style: record.settings,
    size,
    logoDataUrl: logo,
    format: ext
  });
  const base = sanitizeFilename(stripExtension(filename || suggestedFilename(record)), 'qr-code');
  const finalName = `${base}.${ext}`;
  downloadBlob(blob, finalName);
  return { blob, filename: finalName };
}

/** Build a data URL for the print sheet. */
export async function recordDataUrl(record, { size = 1024, logoDataUrl = undefined } = {}) {
  const logo = logoDataUrl === undefined ? await logoForRecord(record) : logoDataUrl;
  const blob = await renderQrBlob({
    data: record.payload,
    style: record.settings,
    size,
    logoDataUrl: logo,
    format: 'png'
  });
  return blobToDataUrl(blob);
}

/**
 * Copy the QR as an image when the Clipboard API supports it; otherwise copy
 * the payload text as a graceful fallback.
 * @returns {Promise<'image'|'text'>}
 */
export async function copyQrAsImage(record, { size = 1024, logoDataUrl = undefined, t } = {}) {
  const logo = logoDataUrl === undefined ? await logoForRecord(record) : logoDataUrl;
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined' && window.isSecureContext) {
    try {
      const blob = await renderQrBlob({
        data: record.payload,
        style: record.settings,
        size,
        logoDataUrl: logo,
        format: 'png'
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'image';
    } catch {
      // Fall through to text copying.
    }
  }
  await copyText(record.payload);
  return 'text';
}

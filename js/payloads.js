/** Standards-oriented payload builders and validation for every QR type. */
import { MAX_QR_BYTES, QR_TYPES } from './config.js';
import { domainOf, safeHttpUrl, truncate } from './utils.js';

export const DEFAULT_FIELDS = {
  url: { url: '' },
  text: { text: '' },
  wifi: { ssid: '', encryption: 'WPA', password: '', hidden: false },
  email: { email: '', subject: '', body: '' },
  phone: { phone: '' },
  sms: { phone: '', message: '' },
  vcard: {
    firstName: '', lastName: '', organization: '', jobTitle: '',
    phone: '', email: '', website: '', address: '', note: ''
  },
  location: { lat: '', lng: '', label: '' }
};

export function defaultFields(type) {
  return { ...(DEFAULT_FIELDS[type] || DEFAULT_FIELDS.text) };
}

const TEXT_ENCODER = new TextEncoder();

export function byteLength(text) {
  return TEXT_ENCODER.encode(String(text ?? '')).length;
}

export function validateLength(payload, errorCorrection = 'M') {
  const bytes = byteLength(payload);
  const max = MAX_QR_BYTES[errorCorrection] || MAX_QR_BYTES.M;
  return { ok: bytes <= max, bytes, max };
}

function fail(key, field) {
  return { ok: false, error: { key, params: {} }, field };
}

function emailOk(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || (!url.hostname.includes('.') && url.hostname !== 'localhost' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname))) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function phoneDigits(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function escapeWifi(value) {
  return String(value ?? '').replace(/([\\;,:"])/g, '\\$1');
}

function escapeVcard(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * @returns {{ok:true,payload:string,label:string,fields:object}|{ok:false,error:object,field?:string}}
 */
export function buildPayload(type, rawFields = {}) {
  const fields = { ...defaultFields(type), ...(rawFields || {}) };

  if (type === 'url') {
    const url = normalizeUrl(fields.url);
    if (!url) return fail(fields.url ? 'generator.errors.invalidUrl' : 'generator.errors.required', 'url');
    return { ok: true, payload: url, label: domainOf(url) || url, fields };
  }

  if (type === 'text') {
    if (!String(fields.text || '').trim()) return fail('generator.errors.required', 'text');
    const text = String(fields.text);
    return { ok: true, payload: text, label: truncate(text.replace(/\s+/g, ' ').trim(), 52) || 'Text', fields };
  }

  if (type === 'wifi') {
    const ssid = String(fields.ssid || '').trim();
    if (!ssid) return fail('generator.errors.required', 'ssid');
    const encryption = ['WPA', 'WEP', 'nopass'].includes(fields.encryption) ? fields.encryption : 'WPA';
    const password = String(fields.password || '');
    if (encryption !== 'nopass' && !password) return fail('generator.errors.required', 'password');
    let payload = `WIFI:T:${encryption};S:${escapeWifi(ssid)};`;
    if (encryption !== 'nopass') payload += `P:${escapeWifi(password)};`;
    if (fields.hidden) payload += 'H:true;';
    payload += ';';
    return {
      ok: true,
      payload,
      label: ssid,
      fields: { ...fields, ssid, password, encryption, hidden: Boolean(fields.hidden) }
    };
  }

  if (type === 'email') {
    const email = String(fields.email || '').trim();
    if (!email) return fail('generator.errors.required', 'email');
    if (!emailOk(email)) return fail('generator.errors.invalidEmail', 'email');
    const params = [];
    if (String(fields.subject || '').trim()) params.push(`subject=${encodeURIComponent(fields.subject)}`);
    if (String(fields.body || '')) params.push(`body=${encodeURIComponent(fields.body)}`);
    const payload = `mailto:${email}${params.length ? `?${params.join('&')}` : ''}`;
    return { ok: true, payload, label: email, fields };
  }

  if (type === 'phone') {
    const phone = phoneDigits(fields.phone);
    if (String(fields.phone || '').trim().replace(/\D/g, '').length < 3) {
      return fail(fields.phone ? 'generator.errors.invalidPhone' : 'generator.errors.required', 'phone');
    }
    return { ok: true, payload: `tel:${phone}`, label: String(fields.phone).trim(), fields };
  }

  if (type === 'sms') {
    const phone = phoneDigits(fields.phone);
    if (String(fields.phone || '').trim().replace(/\D/g, '').length < 3) {
      return fail(fields.phone ? 'generator.errors.invalidPhone' : 'generator.errors.required', 'phone');
    }
    const message = String(fields.message || '');
    return {
      ok: true,
      payload: `SMSTO:${phone}:${message}`,
      label: String(fields.phone).trim(),
      fields
    };
  }

  if (type === 'vcard') {
    const firstName = String(fields.firstName || '').trim();
    const lastName = String(fields.lastName || '').trim();
    const organization = String(fields.organization || '').trim();
    if (!firstName && !lastName && !organization) {
      return fail('generator.errors.vcardName', 'firstName');
    }
    const email = String(fields.email || '').trim();
    if (email && !emailOk(email)) return fail('generator.errors.invalidEmail', 'email');
    let website = String(fields.website || '').trim();
    if (website) {
      const normalized = normalizeUrl(website);
      if (!normalized) return fail('generator.errors.invalidUrl', 'website');
      website = normalized;
    }
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
    lines.push(`N:${escapeVcard(lastName)};${escapeVcard(firstName)};;;`);
    lines.push(`FN:${escapeVcard(fullName || organization)}`);
    if (organization) lines.push(`ORG:${escapeVcard(organization)}`);
    if (String(fields.jobTitle || '').trim()) lines.push(`TITLE:${escapeVcard(fields.jobTitle)}`);
    if (String(fields.phone || '').trim()) lines.push(`TEL;TYPE=CELL:${escapeVcard(fields.phone)}`);
    if (email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcard(email)}`);
    if (website) lines.push(`URL:${escapeVcard(website)}`);
    if (String(fields.address || '').trim()) {
      lines.push(`ADR;TYPE=WORK:;;${escapeVcard(String(fields.address).trim())};;;;`);
    }
    if (String(fields.note || '').trim()) lines.push(`NOTE:${escapeVcard(fields.note)}`);
    lines.push('END:VCARD');
    return {
      ok: true,
      payload: lines.join('\r\n'),
      label: fullName || organization,
      fields
    };
  }

  if (type === 'location') {
    const latRaw = String(fields.lat ?? '').trim();
    const lngRaw = String(fields.lng ?? '').trim();
    if (!latRaw || !lngRaw) return fail('generator.errors.required', !latRaw ? 'lat' : 'lng');
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return fail('generator.errors.invalidLat', 'lat');
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return fail('generator.errors.invalidLng', 'lng');
    const label = String(fields.label || '').trim();
    const coord = `${lat.toFixed(6).replace(/\.?0+$/, '')},${lng.toFixed(6).replace(/\.?0+$/, '')}`;
    const payload = label
      ? `geo:${coord}?q=${coord}(${encodeURIComponent(label)})`
      : `geo:${coord}`;
    return { ok: true, payload, label: label || coord, fields };
  }

  return fail('generator.errors.generic');
}

export function detectContentType(content) {
  const text = String(content || '').trim();
  if (/^https?:\/\//i.test(text)) return 'url';
  if (/^wifi:/i.test(text)) return 'wifi';
  if (/^begin:vcard/i.test(text)) return 'vcard';
  if (/^mailto:/i.test(text)) return 'email';
  if (/^tel:/i.test(text)) return 'phone';
  if (/^(smsto:|sms:)/i.test(text)) return 'sms';
  if (/^geo:/i.test(text)) return 'location';
  return 'text';
}

export function openableUrl(content) {
  const trimmed = String(content || '').trim();
  return safeHttpUrl(trimmed) ? trimmed : null;
}

export function isKnownType(type) {
  return QR_TYPES.includes(type);
}

/**
 * Build-time helper: extracts the Lucide icons used by QR Studio into a tiny
 * local bundle. Not shipped as an application dependency.
 *
 * Usage: node tools/build-icons.mjs
 */
import { writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = process.env.LUCIDE_SOURCE ||
  path.join(process.env.LOCALAPPDATA || '', 'Temp', 'qs-deps', 'node_modules', 'lucide', 'dist', 'esm', 'icons');

const aliases = {
  history: 'clock-arrow-down',
  'trash-2': 'trash',
  filter: 'list-filter',
  'file-json': 'file-braces',
  'alert-triangle': 'triangle-exclamation-point',
  'alert-circle': 'circle-exclamation-point',
  'more-horizontal': 'ellipsis',
  'circle-help': 'circle-exclamation-point',
  'bar-chart-3': 'chart-column',
  'circle-alert': 'circle-exclamation-point',
  'shield-alert': 'shield-exclamation-point',
  'scan-line': 'scan-qr-code'
};

const names = [
  'layout-dashboard', 'qr-code', 'scan-line', 'layers', 'history', 'star', 'settings', 'info',
  'menu', 'x', 'sun', 'moon', 'monitor', 'globe', 'chevron-down', 'chevron-left', 'chevron-right',
  'panel-left-close', 'panel-left-open', 'plus', 'download', 'upload', 'copy', 'check', 'trash-2',
  'pencil', 'search', 'filter', 'arrow-up-down', 'printer', 'save', 'heart', 'eye', 'external-link',
  'refresh-cw', 'rotate-ccw', 'undo-2', 'play', 'square', 'folder-archive', 'file-json', 'hard-drive',
  'database', 'shield-check', 'lock', 'sparkles', 'zap', 'image-plus', 'camera', 'camera-off',
  'switch-camera', 'flashlight', 'file-image', 'file-text', 'alert-triangle', 'alert-circle',
  'circle-check', 'circle-x', 'clock', 'link', 'type', 'wifi', 'mail', 'phone', 'message-square',
  'contact', 'map-pin', 'calendar', 'arrow-right', 'arrow-left', 'more-horizontal', 'maximize',
  'minimize', 'loader-circle', 'circle-help', 'list-filter', 'sliders-horizontal', 'bar-chart-3',
  'trending-up', 'cloud-off', 'smartphone', 'monitor-smartphone', 'palette', 'scan', 'image',
  'file-spreadsheet', 'file-check', 'file-x', 'wand-sparkles', 'circle-alert', 'file-down',
  'grip-vertical', 'key-round', 'shield-alert', 'wifi-off', 'camera', 'mouse-pointer-click',
  'square-dashed', 'circle-dot', 'table-2', 'columns-3', 'chevrons-up-down', 'folder-down'
];

const icons = {};
const missing = [];
for (const name of names) {
  const sourceName = aliases[name] || name;
  try {
    const mod = await import(pathToFileURL(path.join(source, `${sourceName}.mjs`)).href);
    icons[name] = mod.default;
  } catch {
    missing.push(name);
  }
}

function attr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

const serialized = Object.fromEntries(
  Object.entries(icons).map(([name, nodes]) => [name, nodes])
);

const out = `/**
 * QR Studio local icon set — a small subset of Lucide.
 * Lucide v1.69.0 · ISC License · https://lucide.dev
 * Only the icons used by QR Studio are bundled. See LICENSE in this folder.
 */
(function (global) {
  'use strict';
  var ICONS = ${JSON.stringify(serialized)};

  function iconSvg(name, extraClass) {
    var nodes = ICONS[name];
    if (!nodes) return '';
    var body = nodes.map(function (node) {
      var tag = node[0];
      var attrs = node[1] || {};
      var parts = Object.keys(attrs).map(function (key) {
        return key + '="' + ${attr.toString()}(attrs[key]) + '"';
      });
      return '<' + tag + (parts.length ? ' ' + parts.join(' ') : '') + '></' + tag + '>';
    }).join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="' +
      (extraClass ? ${attr.toString()}(extraClass) : '') + ' lucide lucide-' + name + '" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  function createIcons(root) {
    var scope = root || global.document;
    if (!scope || !scope.querySelectorAll) return;
    var nodes = scope.querySelectorAll('[data-lucide]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var name = node.getAttribute('data-lucide');
      if (!ICONS[name]) continue;
      var cls = node.getAttribute('class') || '';
      var svg = iconSvg(name, cls);
      if (svg) node.outerHTML = svg;
    }
  }

  global.Lucide = {
    icons: ICONS,
    createIcons: createIcons,
    iconSvg: iconSvg
  };
})(typeof window !== 'undefined' ? window : globalThis);
`;

await writeFile(path.join(root, 'lib', 'lucide', 'lucide.js'), out, 'utf8');

const license = await readFile(path.join(root, 'lib', 'lucide', 'LICENSE'), 'utf8');
await writeFile(path.join(root, 'lib', 'lucide', 'NOTICE.txt'),
  'Lucide icons — https://lucide.dev\nThis project bundles a subset generated from Lucide v1.69.0.\n\n' + license, 'utf8');

console.log(`Bundled ${Object.keys(icons).length} icons.`);
if (missing.length) console.log('Missing:', missing.join(', '));
console.log('Output size:', out.length, 'bytes');

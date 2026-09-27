// Browser entry point. Bundled into a single classic script (app.js) so the page
// works from file:// with no server and no network.
import { GROUPS, COIN_LIST, generateWallets } from './groups.js';
import { runSelfTest } from './selftest.js';
import { qrSvg } from './qr.js';

const $ = (sel) => document.querySelector(sel);

function randomBytes(n) {
  const out = new Uint8Array(n);
  window.crypto.getRandomValues(out);
  return out;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function qrNode(text) {
  const box = el('div', { class: 'qr' });
  box.innerHTML = qrSvg(text); // SVG built locally from our own generated strings
  return box;
}

function coinName(symbol) {
  return COIN_LIST.find((c) => c.symbol === symbol)?.name ?? symbol;
}

// Secrets are typed by hand into offline signing software, so they are shown as
// plain text in 4-character chunks for easier reading. The chunks are separate
// spans with no whitespace between them, so copying still gives the exact string.
function chunkedNode(value) {
  return el('div', { class: 'value secret-value' }, ...(value.match(/.{1,4}/g) ?? []).map((c) => el('span', {}, c)));
}

// Only public addresses get a QR code. Private keys never do: they are typed,
// not scanned, and a camera-readable secret on paper is one more way to leak it.
function itemNode(item, kind) {
  const isSecret = kind === 'secret';
  return el('div', { class: `item ${kind}` },
    isSecret ? null : qrNode(item.value),
    el('div', { class: 'item-text' },
      el('div', { class: 'item-label' }, item.label),
      item.symbols ? el('div', { class: 'chips' }, ...item.symbols.map((s) => el('span', { class: 'chip', title: coinName(s) }, s))) : null,
      item.mnemonic
        ? el('ol', { class: 'words' }, ...item.value.split(' ').map((w) => el('li', {}, w)))
        : isSecret ? chunkedNode(item.value) : el('div', { class: 'value' }, item.value),
      item.hint ? el('div', { class: 'hint' }, item.hint) : null,
    ),
  );
}

function walletNode(w, createdAt) {
  return el('section', { class: 'wallet' },
    el('header', { class: 'wallet-head' },
      el('div', {},
        el('h2', {}, w.title),
        el('div', { class: 'scheme' }, w.scheme),
      ),
      el('div', { class: 'meta' },
        el('div', {}, w.symbols.join(' · ')),
        el('div', {}, `Created ${createdAt}`),
      ),
    ),
    el('h3', { class: 'public-h' }, 'Public — share these to receive funds'),
    el('div', { class: 'items' }, ...w.addresses.map((a) => itemNode(a, 'public'))),
    el('h3', { class: 'secret-h' }, 'Private — anyone with these can spend everything above'),
    el('div', { class: 'items' }, ...w.keys.map((k) => itemNode(k, 'secret'))),
    el('ul', { class: 'notes' }, ...w.notes.map((n) => el('li', {}, n))),
  );
}

function renderSelfTest() {
  const results = runSelfTest(randomBytes);
  const failed = results.filter((r) => !r.ok);
  const panel = $('#selftest');
  panel.className = failed.length ? 'status bad' : 'status good';
  panel.replaceChildren(
    el('strong', {}, failed.length
      ? `Self-test FAILED (${failed.length}/${results.length}). Do not use this page.`
      : `Self-test passed: ${results.length} known-answer checks.`),
    el('details', {},
      el('summary', {}, 'Details'),
      el('ul', {}, ...results.map((r) => el('li', { class: r.ok ? 'ok' : 'fail' }, `${r.ok ? '✔' : '✘'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`))),
    ),
  );
  return failed.length === 0;
}

function renderNetwork() {
  const online = navigator.onLine;
  const badge = $('#network');
  badge.className = online ? 'status warn' : 'status good';
  badge.textContent = online
    ? 'This computer reports a network connection. Disconnect it (and disable Wi-Fi) before generating real wallets.'
    : 'No network connection detected.';
}

function renderGroupPicker() {
  $('#groups').replaceChildren(...GROUPS.map((g) =>
    el('label', { class: 'group-pick' },
      Object.assign(el('input', { type: 'checkbox', value: g.id }), { checked: true }),
      el('span', {}, el('strong', {}, g.title), ` — ${g.symbols.join(', ')}`),
    )));
}

function generate() {
  const ids = [...document.querySelectorAll('#groups input:checked')].map((i) => i.value);
  const out = $('#wallets');
  if (!ids.length) {
    out.replaceChildren(el('p', { class: 'empty' }, 'Select at least one group.'));
    return;
  }
  const createdAt = new Date().toISOString().slice(0, 10);
  out.replaceChildren(...generateWallets(randomBytes, ids).map((w) => walletNode(w, createdAt)));
  $('#print').disabled = false;
  $('#clear').disabled = false;
}

function clearWallets() {
  $('#wallets').replaceChildren();
  $('#print').disabled = true;
  $('#clear').disabled = true;
}

function init() {
  renderGroupPicker();
  renderNetwork();
  window.addEventListener('online', renderNetwork);
  window.addEventListener('offline', renderNetwork);
  const ok = renderSelfTest();
  $('#generate').disabled = !ok;
  $('#generate').addEventListener('click', generate);
  $('#print').addEventListener('click', () => window.print());
  $('#clear').addEventListener('click', clearWallets);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

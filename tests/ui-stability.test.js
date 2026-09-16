const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('UI assets are self-hosted under the strict CSP', () => {
  const htmlFiles = ['index.html', 'auth.html', 'exchanges.html', 'transfers.html', 'security.html'];
  for (const file of htmlFiles) {
    const html = read(path.join('docs', file));
    assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/);
    assert.match(html, /fonts\/dm-sans-latin\.woff2/);
  }
  const server = read('server/index.js');
  assert.match(server, /font-src 'self'/);
  for (const file of ['dm-sans-latin.woff2', 'ibm-plex-mono-400-latin.woff2', 'ibm-plex-mono-500-latin.woff2']) {
    assert.ok(fs.statSync(path.join(root, 'docs', 'fonts', file)).size > 10_000, `${file} is present`);
  }
});

test('transaction ages update without rebuilding unchanged rows', () => {
  const app = read('docs/app.js');
  assert.match(app, /let lastTransactionTableMarkup = null/);
  assert.match(app, /data-transaction-age=/);
  assert.match(app, /transactionTableMarkup !== lastTransactionTableMarkup/);
  assert.match(app, /refreshTransactionAges\(\)/);

  const html = read('docs/index.html');
  const css = read('docs/styles.css');
  assert.match(html, /class="transactions-table"/);
  assert.match(css, /\.transactions-head\s*\{/);
  assert.match(css, /\.transactions-table\s*\{[^}]*table-layout:\s*fixed/s);
});

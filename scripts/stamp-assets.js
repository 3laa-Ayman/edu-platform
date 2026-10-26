/**
 * Cache busting: appends ?v=<content hash> to every CSS/JS/image referenced by public/index.html,
 * so after a deploy browsers and the CDN can never mix old and new files.
 * Runs at deploy time (vercel-build / start:render); idempotent.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC = path.join(__dirname, '../public');
const indexPath = path.join(PUBLIC, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
let count = 0;

html = html.replace(/(href|src)="(\/(?:css|js|img)\/[^"?]+)(\?v=[0-9a-f]+)?"/g, (m, attr, file) => {
  const full = path.join(PUBLIC, file);
  if (!fs.existsSync(full)) return m;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 10);
  count++;
  return `${attr}="${file}?v=${hash}"`;
});

fs.writeFileSync(indexPath, html);
console.log(`✅ stamped ${count} asset URLs in public/index.html`);

/* usage: node mathrender.js items.json   — items: [{"out": "path.png", "html": "<...>"}]
   Renders Arabic RTL math (book style) to tight PNGs with Chromium. Classes:
   .f>.n+.d fraction · .r radical (√ over content) · .s sigma: <span class="s"><span class="t">10</span><span class="g">∑</span><span class="b">ر=1</span></span>
   <sup>/<sub> exponents (an RLM is inserted before each, so a digit exponent after a digit base sits upper-LEFT like the book) · .p power of a group: <span class="p">(س + 2)<sup>6</sup></span> */
const { chromium } = require('playwright'); const fs = require('fs');
const CSS = `body{margin:0;background:#fff}
#c{display:inline-block;padding:10px 16px;font-family:'Noto Sans Arabic','DejaVu Sans',sans-serif;font-size:30px;color:#111;direction:rtl;white-space:nowrap;line-height:1.6}
.f{display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;margin:0 .15em}
.f>.n{border-bottom:2px solid #111;padding:0 .2em}.f>.d{padding:0 .2em}
.r{display:inline-flex;align-items:stretch;vertical-align:middle;position:relative;margin:0 .14em}
.r>span{border-top:2px solid #111;padding:.05em .15em 0}
.f>.n .r{margin-bottom:4px}.f>.d .r{margin-top:5px}
.s{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;line-height:1.05;margin:0 .1em}
.s>.g{font-size:1.6em}.s>.t,.s>.b{font-size:.6em}
.p{unicode-bidi:isolate}
.ltr{direction:ltr;unicode-bidi:isolate;display:inline-block}`;

const DRAW_RADICALS = `(() => {
  // One connected radical per .r, mirrored for RTL (sign on the RIGHT, bar joins the long stroke at the top).
  const NS = 'http://www.w3.org/2000/svg';
  const all = [...document.querySelectorAll('.r')];
  all.sort((a, b) => b.querySelectorAll('.r').length - a.querySelectorAll('.r').length); // inner first
  all.reverse();
  for (const r of all) {
    r.querySelectorAll(':scope > svg.rad').forEach(x => x.remove());
    const H = r.getBoundingClientRect().height;
    const w = Math.max(16, Math.min(34, H * 0.42));
    r.style.paddingRight = w + 'px';
    const sv = document.createElementNS(NS, 'svg');
    sv.setAttribute('class', 'rad'); sv.setAttribute('width', w); sv.setAttribute('height', H);
    sv.style.cssText = 'position:absolute;right:0;top:0;overflow:visible';
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M0,1 L' + (w * 0.55) + ',' + (H * 0.93) + ' L' + (w * 0.8) + ',' + (H * 0.52) + ' L' + w + ',' + (H * 0.6));
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#111'); p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('stroke-linecap', 'round');
    sv.appendChild(p); r.appendChild(sv);
  }
})()`;
(async () => {
  const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const b = await chromium.launch(); const pg = await b.newPage({ deviceScaleFactor: Number(process.env.SCALE || 2) });
  for (const it of items) {
    await pg.setContent(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${CSS}</style></head><body><span id="c">${it.html.replace(/<(sup|sub)>/g, '\u200f<$1>')}</span></body></html>`);
    await pg.evaluate(DRAW_RADICALS);
    await pg.locator('#c').screenshot({ path: it.out, omitBackground: false });
  }
  await b.close(); console.log('rendered', items.length);
})();

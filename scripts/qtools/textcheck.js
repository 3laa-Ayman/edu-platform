/* usage: node textcheck.js q.json outdir — renders every question + options through the PLATFORM's rich() formatter
   (public/js/ui.js) in an RTL page, 10 questions per PNG, so text math can be eyeballed exactly as students see it. */
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const [qf, out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const Q = JSON.parse(fs.readFileSync(qf, 'utf8')).questions;
const UI = fs.readFileSync(require('path').join(__dirname, '../../public/js/ui.js'), 'utf8');
(async () => {
  const b = await chromium.launch(); const mk = () => b.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: Number(process.env.SCALE || 1) }); 
  for (let k = 0; k < Q.length; k += 10) {
    const pg = await mk(); pg.on('pageerror', e => console.log('PAGE ERROR', e.message));
    const chunk = Q.slice(k, k + 10).map((q, i) => ({ n: k + i + 1, q: q.question, o: [q.A, q.B, q.C, q.D], img: Object.keys(q.images || {}).join(',') }));
    await pg.setContent(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
      body{font-family:'Noto Sans Arabic',sans-serif;font-size:19px;margin:12px;background:#fff} .q{border-bottom:1px solid #ccc;padding:8px 2px}
      .o{display:inline-block;margin:4px 10px 0 0;padding:2px 10px;border:1px solid #bbb;border-radius:8px} .i{color:#c62828;font-size:13px}
      bdi.math{unicode-bidi:isolate;white-space:nowrap}</style></head><body><div id="r"></div>
      <script>${UI}</script><script>const C=${JSON.stringify(chunk)};
      document.getElementById('r').innerHTML=C.map(c=>'<div class="q"><b>'+c.n+'.</b> '+rich(c.q)+(c.img?' <span class="i">['+c.img+']</span>':'')+'<br>'+c.o.map((o,j)=>'<span class="o">'+'أبجد'[j]+') '+rich(o)+'</span>').join('')+'</div>').join('');</script></body></html>`);
    if (k < Number(process.env.START || 0) || k >= Number(process.env.STOP || 1e9)) { await pg.close(); continue; } // optional page range
    const shot = path.join(out, `t${String(k / 10 + 1).padStart(2, '0')}.png`);
    for (let t = 1; ; t++) { // Chromium sometimes fails a fullPage capture ("Unable to capture screenshot"): retry
      try { await pg.screenshot({ path: shot, fullPage: true }); break; } catch (e) { if (t >= 4) throw e; await pg.waitForTimeout(500 * t); }
    }
    await pg.close();
  }
  await b.close(); console.log('pages', Math.ceil(Q.length / 10));
})();

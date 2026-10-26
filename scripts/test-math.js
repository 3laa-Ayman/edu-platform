/**
 * Unit test for the exponent / subscript formatter in public/js/ui.js (rich / normalizeMath).
 *   npm run test:math
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../public/js/ui.js'), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// eslint-disable-next-line no-eval
eval(src.slice(src.indexOf('const MATH_RUN'), src.indexOf('const fmtDate')));
const render = (t) => rich(t).replace(/<bdi[^>]*>|<\/bdi>/g, ''); // eslint-disable-line no-undef

const cases = [
  // [input, expected HTML (without the LTR wrapper)]
  ['10^8', '10<sup>8</sup>'],
  ['10 ^ 8', '10<sup>8</sup>'],
  ['10^-19', '10<sup>-19</sup>'],
  ['10^{-19}', '10<sup>-19</sup>'],
  ['x^(n+1)', 'x<sup>n+1</sup>'],
  ['10**8', '10<sup>8</sup>'],
  ['x**2 + 3', 'x<sup>2</sup> + 3'],
  ['10 أس 8', '10<sup>8</sup>'],
  ['س تربيع + ص تكعيب', 'س<sup>2</sup> + ص<sup>3</sup>'],
  ['3E+08 م/ث', '3×10<sup>8</sup> م/ث'],
  ['1.6e-19 كولوم', '1.6×10<sup>-19</sup> كولوم'],
  ['10<sup>8</sup>', '10<sup>8</sup>'],
  ['H<sub>2</sub>O', 'H<sub>2</sub>O'],
  ['10ˆ8', '10<sup>8</sup>'],
  ['10＾8', '10<sup>8</sup>'],
  ['H_2O و CO_2', 'H<sub>2</sub>O و CO<sub>2</sub>'],
  ['Fe_2O_3', 'Fe<sub>2</sub>O<sub>3</sub>'],
  ['نيوتن.م^2/كولوم^2.', 'نيوتن.م<sup>2</sup>/كولوم<sup>2</sup>.'],
  ['س^٢', 'س<sup>٢</sup>'],
  ['**مهم** 3×10^8', '<strong>مهم</strong> 3×10<sup>8</sup>'],
  ['الشحنة 1.6 × 10 ^ -19 كولوم', 'الشحنة 1.6×10<sup>-19</sup> كولوم'],
  ['3 x 10^8', '3×10<sup>8</sup>'],
  ['5 × 4 = 20', '5×4 = 20'],
  // must stay unchanged
  ['10⁸ جاهزة', '10⁸ جاهزة'],
  ['طريقة التربيع والأساس 5', 'طريقة التربيع والأساس 5'],
  ['CO2E5 كود', 'CO2E5 كود'],
  ['5 نيوتن', '5 نيوتن'],
];

let failed = 0;
for (const [input, expected] of cases) {
  const got = render(input);
  const pass = got === expected;
  if (!pass) failed++;
  console.log(`${pass ? '✅' : '❌'} ${input}  →  ${got}${pass ? '' : `   (expected ${expected})`}`);
}
for (const evil of ['<sup><img src=x onerror=alert(1)></sup>', '**<script>alert(1)</script>**', '10^{<b>x</b>}']) {
  const unsafe = /<(img|script|b)\b/i.test(rich(evil)); // eslint-disable-line no-undef
  if (unsafe) failed++;
  console.log(`${unsafe ? '❌ UNSAFE' : '✅ safe'}: ${evil}`);
}
console.log(failed ? `\n${failed} failed` : `\n🎉 all ${cases.length + 3} math checks passed`);
process.exit(failed ? 1 : 0);

"""usage: python3 friso.py q.json — in lines that MIX Arabic and French, wrap each French run (accents, ’, «…») in LRI…PDI so the
platform's rich() (whose LTR_RUN only knows A–Z) does not scramble accented words. Idempotent."""
import json, re, sys
F = ('question', 'A', 'B', 'C', 'D', 'explanation', 'law', 'passage')
AR = re.compile('[؀-ۿ]')
L = 'A-Za-zÀ-ÖØ-öø-ÿŒœ'
RUN = re.compile(r'«?…?\s*[' + L + r'0-9(][' + L + r"0-9 '’.,:;!?…\-–—/+=%()«»·→≠≈]*[" + L + r'0-9.!?…)»%]')
def iso(line):
    if '⁦' in line or not AR.search(line): return line
    def f(m):
        s = m.group(0)
        if not re.search('[' + L + ']', s): return s
        return '⁦' + s + '⁩'
    return RUN.sub(f, line)
p = sys.argv[1]; d = json.load(open(p)); n = 0
for q in d['questions']:
    for k in F:
        v = q.get(k)
        if isinstance(v, str):
            new = '\n'.join(iso(l) for l in v.split('\n')); n += new != v; q[k] = new
json.dump(d, open(p, 'w'), ensure_ascii=False, indent=1); print('fields isolated:', n)

"""usage: python3 ltriso.py q.json — English fields shown in the RTL platform: every line that has Latin letters and NO Arabic
letters is wrapped in LRI…PDI (U+2066 … U+2069), so the platform shows it left-to-right with its punctuation in place
(without it «Salma turned off her phone.» shows as «.Salma turned off her phone», quotes/«?»/«…….» jump sides).
Lines that mix Arabic and English are left to the platform's own rich() (it isolates the English runs). Idempotent."""
import json, re, sys
F = ('question', 'A', 'B', 'C', 'D', 'explanation', 'law', 'passage')
AR = re.compile('[؀-ۿ]'); LAT = re.compile('[A-Za-z]')
def iso(line):
    s = line.strip('⁦⁩')
    if not s.strip() or AR.search(s) or not LAT.search(s): return line
    return '⁦' + s + '⁩'
p = sys.argv[1]; d = json.load(open(p)); n = 0
for q in d['questions']:
    for k in F:
        v = q.get(k)
        if isinstance(v, str):
            new = '\n'.join(iso(l) for l in v.split('\n')); n += new != v; q[k] = new
json.dump(d, open(p, 'w'), ensure_ascii=False, indent=1); print('fields isolated:', n)

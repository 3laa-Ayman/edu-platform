"""usage: python3 greekiso.py q.json  — wraps every Greek letter in text fields with Unicode FSI…PDI (U+2068 … U+2069).
Without it the platform's bidi reorders Arabic math around Greek letters («٠ ≤ θ ≤ π/٢» shows as «٢/θ ≤ π ≥ ٠»,
«١/α» as «α/١»); isolated, they behave like the Arabic letters around them. Idempotent."""
import json, re, sys
F = ('question', 'A', 'B', 'C', 'D', 'explanation', 'law', 'passage')
G = re.compile('(?<!⁨)([Ͱ-Ͽ])(?!⁩)')
p = sys.argv[1]; d = json.load(open(p)); n = 0
for q in d['questions']:
    for k in F:
        if isinstance(q.get(k), str):
            new = G.sub('⁨\\1⁩', q[k]); n += new != q[k]; q[k] = new
json.dump(d, open(p, 'w'), ensure_ascii=False, indent=1); print('fields changed:', n)

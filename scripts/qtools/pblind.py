"""usage: python3 pblind.py <dir>  -> dir/build/blind.txt (questions + options, no answers)"""
import json, sys
d = sys.argv[1]; q = json.load(open(d + '/build/q.json'))['questions']; out = []
for i, r in enumerate(q, 1):
    if r.get('passage'): out.append(f"  [P{r['passage_no']}] {r['passage']}")
    out.append(f"{i}. {r['question']} | A) {r['A']} | B) {r['B']} | C) {r['C']} | D) {r['D']}" + (f"  (P{r['passage_no']})" if r.get('passage_no') else ''))
open(d + '/build/blind.txt', 'w').write('\n'.join(out) + '\n'); print(len(q), 'written')

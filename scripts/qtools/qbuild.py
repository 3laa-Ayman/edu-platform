"""SUBJ=<subject> python3 qbuild.py  (like pbuild.py, plus optional per-question note) usage: python3 qbuild.py <dir> <lesson_type> <seed> <N>  (dir/gen/bank.py -> dir/build/q.json)"""
import json, random, re, shutil, os, sys
from collections import Counter
d, lt, seed, N = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xfix import _old_fix_rows as fix_rows
gen = os.path.abspath(os.path.join(d, 'gen')); sys.path.insert(0, gen); os.chdir(gen)
from bank import Q, P, L
Q.sort(key=lambda x: x['l'])
_o = []
for x in Q:  # keep all questions of one shared figure/passage together (at its first occurrence)
    if x in _o: continue
    _o += [y for y in Q if y['p'] and y['p'] == x['p']] if x['p'] else [x]
assert len(_o) == len(Q); Q[:] = _o
assert len(Q) == N, len(Q)
assert len({x['q'] for x in Q}) == N or (os.environ.get('SAME_STEM_OK') and len({(x['q'], x['c'], tuple(x['d']), x['img'], x['p']) for x in Q}) == N), 'duplicate text'
random.seed(seed)
letters = (list('ABCD') * (N // 4 + 1))[:N]; random.shuffle(letters)
for _ in range(5000):
    bad = [i for i in range(3, N) if letters[i] == letters[i-1] == letters[i-2] == letters[i-3]]
    if not bad: break
    j = random.randrange(N); i = bad[0]; letters[i], letters[j] = letters[j], letters[i]
assert not bad
AR = dict(zip('ABCD', 'أبجد')); out = []; seen = set()
os.makedirs('../build/img', exist_ok=True)
for i, x in enumerate(Q):
    k = 'ABCD'.index(letters[i]); opts = list(x['d']); opts.insert(k, x['c'])
    assert len(set(opts)) == 4
    r = dict(question=x['q'], A=opts[0], B=opts[1], C=opts[2], D=opts[3], answer=AR[letters[i]], explanation=x['e'], law=x['law'],
             subject=os.environ.get('SUBJ','الفيزياء'), lesson=L[x['l']], lesson_type=lt, category='درس', images={})
    if x.get('note'): r['note'] = x['note']
    if x['img']: r['images']['question'] = 'img/' + x['img']
    if x['p']:
        r['passage_no'] = str(list(P).index(x['p']) + 1)
        if x['p'] not in seen:
            seen.add(x['p']); img, txt = P[x['p']]; r['passage'] = txt; r['images']['passage'] = 'img/' + img
    for v in r['images'].values(): shutil.copy('../img/' + os.path.basename(v), '../build/' + v)
    out.append(r)
assert set(P) == seen, set(P) - seen
fix_rows(out)
_runs = [r.get('passage_no') for r in out]
import itertools as _it
_g = [k for k, _ in _it.groupby(_runs) if k]; assert len(_g) == len(set(_g)), 'passage not contiguous'
json.dump({'questions': out}, open('../build/q.json', 'w'), ensure_ascii=False, indent=1)
print(Counter(letters), len(out), sorted(Counter(x['l'] for x in Q).items()), 'with figure:', sum(1 for x in Q if x['img'] or x['p']))

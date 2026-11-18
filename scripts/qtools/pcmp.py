import json, sys, re
f, s = sys.argv[1], sys.argv[2]
mine = {int(a): b for a, b in re.findall(r'(\d+)([ABCD])', s)}
q = json.load(open(f))['questions']; AR = dict(zip('أبجد', 'ABCD'))
assert sorted(mine) == list(range(1, len(q) + 1)), [i for i in range(1, len(q) + 1) if i not in mine]
print('mismatches:', [(i, mine[i], AR[q[i-1]['answer']]) for i in mine if mine[i] != AR[q[i-1]['answer']]])

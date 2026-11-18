import re
SUP = str.maketrans('0123456789-', '⁰¹²³⁴⁵⁶⁷⁸⁹⁻')
def _sci(m):
    exp = int(m.group(2))
    return f'{m.group(1)}×10{str(exp).translate(SUP)}'
def fix(s):
    if not s: return s
    s = re.sub(r'(\d+(?:\.\d+)?)e([+-]\d+)', _sci, s)
    s = re.sub(r'(=\s*)-(\d)', r'\1−\2', s)
    return s
def fix_rows(rows):
    for r in rows:
        for k in ['question', 'A', 'B', 'C', 'D', 'explanation', 'law', 'passage']:
            if r.get(k): r[k] = fix(r[k])
    return rows
if __name__ == '__main__':
    assert fix('= 3.0e+05 Pa') == '= 3.0×10⁵ Pa' and fix('1.01e-08 cm') == '1.01×10⁻⁸ cm' and fix('= -1369') == '= −1369'
    print('ok')

# --- memorized constants are not stated as givens (owner's rule): 22.4 L/mol, R, F, Kw, pH+pOH=14, glycerol/water for fats
import re as _re
_DROP = [r'^R\s*=', r'^F\s*=', r'^Kw\s*=', r'^pH \+ pOH = 14', r'^الحجم المولي', r'^الجلسرين\s*=\s*92']
def _groups(s):
    out, depth, start = [], 0, None
    for i, ch in enumerate(s):
        if ch == '(':
            if depth == 0: start = i
            depth += 1
        elif ch == ')' and depth:
            depth -= 1
            if depth == 0: out.append((start, i))
    return out
def _split_top(t):
    parts, depth, cur = [], 0, ''
    i = 0
    while i < len(t):
        ch = t[i]
        if ch == '(': depth += 1
        elif ch == ')': depth -= 1
        if depth == 0 and t.startswith('، ', i): parts.append(cur); cur = ''; i += 2; continue
        cur += ch; i += 1
    parts.append(cur); return parts
def strip_memorized(q):
    for a, b in reversed(_groups(q)):
        items = _split_top(q[a + 1:b])
        glyc = any(_re.match(_DROP[-1], x.strip()) for x in items)
        keep = [x for x in items if not any(_re.match(p, x.strip()) for p in _DROP) and not (glyc and _re.match(r'^H₂O\s*=\s*18$', x.strip()))]
        if len(keep) == len(items): continue
        q = q[:a] + ('(' + '، '.join(keep) + ')' if keep else '') + q[b + 1:]
    return _re.sub(r'\s+$', '', _re.sub(r' {2,}', ' ', q))
_old_fix_rows = fix_rows
def fix_rows(rows):
    _old_fix_rows(rows)
    for r in rows: r['question'] = strip_memorized(r['question'])
    return rows
assert strip_memorized('x: (Cu = 64، F = 9.65×10⁴ C/mol)') == 'x: (Cu = 64)'
assert strip_memorized('y: (R = 8.31×10³ Pa·L/(mol·K))') == 'y:'
assert strip_memorized('z (KOH = 56، الجلسرين = 92، H₂O = 18)') == 'z (KOH = 56)'
assert strip_memorized('w (H₂SO₄ = 98، H₂O = 18)') == 'w (H₂SO₄ = 98، H₂O = 18)'

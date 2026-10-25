const LETTERS = ['A', 'B', 'C', 'D'];
const ALIASES = {
  A: 'A', B: 'B', C: 'C', D: 'D',
  1: 'A', 2: 'B', 3: 'C', 4: 'D',
  'أ': 'A', 'ا': 'A', 'ب': 'B', 'ج': 'C', 'د': 'D',
};

/** Normalizes "a" / "أ" / "1" / "A" → "A". Returns null if not a valid choice. */
function normalizeChoice(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim().toUpperCase().replace(/[()\s.]/g, '');
  return ALIASES[v] || null;
}

const optionText = (q, letter) => q[`option_${letter.toLowerCase()}`];

module.exports = { LETTERS, normalizeChoice, optionText };

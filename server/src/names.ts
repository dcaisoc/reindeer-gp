/**
 * Names shown on public leaderboards: colleges, validation, a basic
 * profanity filter, and friendly generated display names. The filter is
 * deliberately simple; referees can rename anything it misses.
 */

export const COLLEGES = [
  "Christ's", 'Churchill', 'Clare', 'Clare Hall', 'Corpus Christi', 'Darwin', 'Downing', 'Emmanuel',
  'Fitzwilliam', 'Girton', 'Gonville & Caius', 'Homerton', 'Hughes Hall', 'Jesus', "King's",
  'Lucy Cavendish', 'Magdalene', 'Murray Edwards', 'Newnham', 'Pembroke', 'Peterhouse', "Queens'",
  'Robinson', "St Catharine's", "St Edmund's", "St John's", 'Selwyn', 'Sidney Sussex', 'Trinity',
  'Trinity Hall', 'Wolfson', 'Mixed / none',
];

export const LEVELS = ['elf', 'reindeer', 'santa'] as const;
export type Level = (typeof LEVELS)[number];

// Matched after folding look-alike characters. Kept short on purpose, and
// word-aware so innocent names ("Grapes", "Peacock", "Scunthorpe") pass.
/** Blocked anywhere, even inside other words or with spaces removed. */
const BLOCKED_ANYWHERE = ['fuck', 'shit', 'nigg', 'wank'];
/** Blocked at the start of a word ("bitches", "nazis"). */
const BLOCKED_PREFIX = ['cunt', 'bitch', 'bastard', 'whore', 'slut', 'retard', 'spastic', 'tranny', 'nazi', 'hitler', 'rapist'];
/** Blocked only as a whole word. */
const BLOCKED_WORD = ['dick', 'dickhead', 'cock', 'fag', 'paki', 'rape', 'chink', 'kike', 'twat', 'pussy', 'prick'];
const FOLD: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '|': 'i' };

export function isOffensive(name: string): boolean {
  const folded = name
    .toLowerCase()
    .split('')
    .map((c) => FOLD[c] ?? c)
    .join('');
  const squashed = folded.replace(/[^a-z]/g, '');
  if (BLOCKED_ANYWHERE.some((w) => squashed.includes(w))) return true;
  const words = folded.split(/[^a-z]+/).filter(Boolean);
  // "c u n t" style spacing: judge the letters joined up as one word too.
  if (words.filter((w) => w.length === 1).length >= 3) words.push(squashed);
  return words.some((t) => BLOCKED_WORD.includes(t) || BLOCKED_PREFIX.some((p) => t.startsWith(p)));
}

/** Returns an error message, or null if the name is acceptable. */
export function checkName(name: unknown, what: string, max = 32): string | null {
  if (typeof name !== 'string') return `${what} is required.`;
  const n = name.trim();
  if (n.length < 2) return `${what} must be at least 2 characters.`;
  if (n.length > max) return `${what} must be at most ${max} characters.`;
  if (!/^[\p{L}\p{N} '’.&\-_!?]+$/u.test(n)) return `${what} can use letters, numbers, spaces and ' . & - _ ! ? only.`;
  if (isOffensive(n)) return `Please choose a different ${what.toLowerCase()}.`;
  return null;
}

const ADJ = ['Swift', 'Frosty', 'Jolly', 'Sparkly', 'Brave', 'Cosy', 'Merry', 'Snowy', 'Twinkly', 'Nimble', 'Rosy', 'Silver'];
const NOUN = ['Reindeer', 'Snowfox', 'Penguin', 'Robin', 'Elf', 'Owl', 'Hare', 'Sledder', 'Snowflake', 'Pudding', 'Bauble', 'Comet'];

export function randomDisplayName(): string {
  const r = crypto.getRandomValues(new Uint8Array(3));
  return `${ADJ[r[0] % ADJ.length]} ${NOUN[r[1] % NOUN.length]} ${10 + (r[2] % 90)}`;
}

/** Join codes avoid look-alike characters (no 0/O, 1/I/L). */
export function joinCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(r, (b) => alphabet[b % alphabet.length]).join('');
}

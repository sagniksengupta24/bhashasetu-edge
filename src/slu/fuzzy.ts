// src/slu/fuzzy.ts
// Zero-dependency tokenized n-gram Levenshtein fuzzy matcher for clinical lexicon terms.
// Enforces strict word-boundary token matching so short tokens (e.g. "ors") never match substrings ("worse").

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n];
}

export interface TokenSpan {
  word: string;
  start: number;
  end: number;
}

export function tokenizeWithSpans(text: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  const regex = /[a-z0-9]+/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    spans.push({
      word: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return spans;
}

function maxEditsForClinicalToken(targetLen: number, candidateLen: number): number {
  const minLen = Math.min(targetLen, candidateLen);
  if (minLen <= 3) return 0;
  if (minLen === 4) return 1;
  // minLen >= 5: allow 2 edits when at least one token is >= 6 chars (e.g. bhukar/bukhar, cheene/seene),
  // and 1 edit when both are 5 chars.
  return Math.max(targetLen, candidateLen) >= 6 ? 2 : 1;
}

const CONNECTORS = new Set(['me', 'mein', 'ko', 'ka', 'ke', 'ki', 'se', 'ho', 'toh']);

export interface FuzzyMatchResult {
  start: number;
  end: number;
  isFuzzy: boolean;
}

/**
 * Tokenized n-gram matcher for clinical lexicon & red-flag phrases:
 * - Never matches inside arbitrary substrings (word-boundary token aligned).
 * - Exact token sequence match first; otherwise strict Levenshtein thresholds
 *   (<= 2 edits for tokens >= 5 chars, <= 1 edit for length 4, exact for <= 3 chars).
 */
export function fuzzyPhraseMatch(
  lowerClause: string,
  phrase: string
): FuzzyMatchResult | null {
  const phraseTokens = phrase.toLowerCase().split(/\s+/).filter(Boolean);
  if (phraseTokens.length === 0) return null;

  const clauseSpans = tokenizeWithSpans(lowerClause);
  const windowSize = phraseTokens.length;
  if (clauseSpans.length < windowSize) return null;

  for (let i = 0; i <= clauseSpans.length - windowSize; i++) {
    let allMatched = true;
    let usedFuzzy = false;

    for (let j = 0; j < windowSize; j++) {
      const target = phraseTokens[j];
      const candidate = clauseSpans[i + j].word;

      if (target === candidate) continue;

      if (windowSize > 1 && CONNECTORS.has(target) && CONNECTORS.has(candidate)) {
        usedFuzzy = true;
        continue;
      }

      const limit = maxEditsForClinicalToken(target.length, candidate.length);
      if (limit === 0 || levenshtein(candidate, target) > limit) {
        allMatched = false;
        break;
      }
      usedFuzzy = true;
    }

    if (allMatched) {
      return {
        start: clauseSpans[i].start,
        end: clauseSpans[i + windowSize - 1].end,
        isFuzzy: usedFuzzy,
      };
    }
  }

  return null;
}

/**
 * Exact word-boundary n-gram match (no fuzzy edits) for medication & unit terms.
 */
export function exactTokenPhraseMatch(lowerText: string, alias: string): boolean {
  const aliasTokens = alias.toLowerCase().split(/\s+/).filter(Boolean);
  if (aliasTokens.length === 0) return false;
  const textSpans = tokenizeWithSpans(lowerText);
  if (textSpans.length < aliasTokens.length) return false;

  for (let i = 0; i <= textSpans.length - aliasTokens.length; i++) {
    let match = true;
    for (let j = 0; j < aliasTokens.length; j++) {
      if (textSpans[i + j].word !== aliasTokens[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

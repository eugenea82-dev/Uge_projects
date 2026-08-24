export interface DiffToken {
  value: string;
  type: 'same' | 'added' | 'removed';
}

/**
 * Minimal word-level LCS diff. Good enough for paragraph-length audit
 * statements. Falls back to a single "changed" block for very large inputs
 * to avoid O(n*m) blow-up.
 */
export function diffWords(oldText: string, newText: string): DiffToken[] {
  const oldWords = oldText.split(/(\s+)/);
  const newWords = newText.split(/(\s+)/);

  if (oldWords.length * newWords.length > 400_000) {
    return [
      { value: oldText, type: 'removed' },
      { value: newText, type: 'added' },
    ];
  }

  const m = oldWords.length;
  const n = newWords.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] =
        oldWords[i] === newWords[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldWords[i] === newWords[j]) {
      tokens.push({ value: oldWords[i], type: 'same' });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      tokens.push({ value: oldWords[i], type: 'removed' });
      i++;
    } else {
      tokens.push({ value: newWords[j], type: 'added' });
      j++;
    }
  }
  while (i < m) tokens.push({ value: oldWords[i++], type: 'removed' });
  while (j < n) tokens.push({ value: newWords[j++], type: 'added' });

  return mergeAdjacent(tokens);
}

function mergeAdjacent(tokens: DiffToken[]): DiffToken[] {
  const merged: DiffToken[] = [];
  for (const token of tokens) {
    const last = merged[merged.length - 1];
    if (last && last.type === token.type) {
      last.value += token.value;
    } else {
      merged.push({ ...token });
    }
  }
  return merged;
}

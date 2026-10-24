/** Preserve the field Client's existing allocation thresholds. */
export function pairSuggestion(pending: number) {
  const suggestedPairs = pending < 15 ? 0 : pending < 25 ? 2 : pending < 30 ? 3 : 4;
  return { suggestedPairs, suggestion: suggestedPairs ? `${suggestedPairs} pares ou mais.` : '+1 quadra' };
}

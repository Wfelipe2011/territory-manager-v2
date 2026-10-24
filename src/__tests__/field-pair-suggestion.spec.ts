import { pairSuggestion } from '../modules/field/pair-suggestion';

describe('Sugestão de distribuição preservada do Client', () => {
  it('sugere acrescentar uma quadra abaixo de quinze casas', () => {
    for (const n of [0, 7, 14]) expect(pairSuggestion(n).suggestion).toBe('+1 quadra');
  });
  it('sugere dois pares entre quinze e vinte e quatro casas', () => {
    for (const n of [15, 21, 24]) expect(pairSuggestion(n).suggestion).toBe('2 pares ou mais.');
  });
  it('sugere três pares entre vinte e cinco e vinte e nove casas', () => {
    for (const n of [25, 29]) expect(pairSuggestion(n).suggestion).toBe('3 pares ou mais.');
  });
  it('sugere quatro pares a partir de trinta casas', () => {
    for (const n of [30, 56]) expect(pairSuggestion(n).suggestion).toBe('4 pares ou mais.');
  });
});

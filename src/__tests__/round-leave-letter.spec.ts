import { ThemeMode } from '@prisma/client';
import { calculateLeaveLetter, LeaveLetterRound } from '../modules/round/calculate-leave-letter';

describe('calculateLeaveLetter', () => {
  // janela = criação da rodada (2026-07-06) - 3 meses = 2026-04-06
  const roundStartDate = new Date('2026-04-06T03:00:00Z');

  const round = (overrides: Partial<LeaveLetterRound> = {}): LeaveLetterRound => ({
    completed: false,
    completedDate: null,
    ...overrides,
  });

  it('rodada campaign: nunca gera carta', () => {
    const rounds = [round({ completed: false }), round({ completed: true, completedDate: new Date('2026-06-01T00:00:00Z') })];
    expect(calculateLeaveLetter(rounds, ThemeMode.campaign, roundStartDate)).toBe(false);
  });

  it('sem histórico (nenhuma round): não gera carta', () => {
    expect(calculateLeaveLetter([], ThemeMode.default, roundStartDate)).toBe(false);
  });

  it('visitada dentro da janela: não gera carta', () => {
    const rounds = [round({ completed: true, completedDate: new Date('2026-06-01T00:00:00Z') })];
    expect(calculateLeaveLetter(rounds, ThemeMode.default, roundStartDate)).toBe(false);
  });

  it('visitada fora da janela: gera carta', () => {
    const rounds = [round({ completed: true, completedDate: new Date('2026-03-01T00:00:00Z') })];
    expect(calculateLeaveLetter(rounds, ThemeMode.default, roundStartDate)).toBe(true);
  });

  it('nunca visitada com histórico: gera carta', () => {
    const rounds = [round({ completed: false }), round({ completed: false })];
    expect(calculateLeaveLetter(rounds, ThemeMode.default, roundStartDate)).toBe(true);
  });

  it('última visita mais recente dentro da janela: não gera carta', () => {
    const rounds = [
      round({ completed: true, completedDate: new Date('2026-03-01T00:00:00Z') }),
      round({ completed: true, completedDate: new Date('2026-06-15T00:00:00Z') }),
    ];
    expect(calculateLeaveLetter(rounds, ThemeMode.default, roundStartDate)).toBe(false);
  });

  it('todas as visitas fora da janela: gera carta', () => {
    const rounds = [
      round({ completed: true, completedDate: new Date('2026-02-01T00:00:00Z') }),
      round({ completed: true, completedDate: new Date('2026-04-01T00:00:00Z') }),
    ];
    expect(calculateLeaveLetter(rounds, ThemeMode.default, roundStartDate)).toBe(true);
  });

  it('completed=true sem completedDate: conta como visita recente (não gera carta)', () => {
    const rounds = [round({ completed: true, completedDate: null })];
    expect(calculateLeaveLetter(rounds, ThemeMode.default, roundStartDate)).toBe(false);
  });

  it('completed=false com completedDate: não conta como visita (gera carta)', () => {
    const rounds = [round({ completed: false, completedDate: new Date('2026-06-01T00:00:00Z') })];
    expect(calculateLeaveLetter(rounds, ThemeMode.default, roundStartDate)).toBe(true);
  });
});

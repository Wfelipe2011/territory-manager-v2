import { ThemeMode } from '@prisma/client';

export interface LeaveLetterRound {
  completed: boolean;
  completedDate: Date | null;
}

/**
 * Decide se a casa deve receber carta na nova rodada.
 *
 * Regra (decidida em conjunto com o produto):
 * - Rodadas campaign não contam como histórico nem como "última visita".
 * - Casa sem histórico (sem rounds mode=default) não recebe carta.
 * - Casa com histórico recebe carta quando NÃO houve visita recente:
 *   nenhum round mode=default com completed=true dentro da janela
 *   (completed_date >= roundStartDate).
 * - completed=true sem completed_date é tratado como visita recente
 *   (não gera carta) — cobre casas fantasma e registros legados.
 */
export function calculateLeaveLetter(rounds: LeaveLetterRound[], theme: ThemeMode, roundStartDate: Date): boolean {
  if (theme !== ThemeMode.default) return false;
  if (rounds.length === 0) return false;

  const hasRecentVisit = rounds.some(round => round.completed && (round.completedDate === null || round.completedDate >= roundStartDate));

  return !hasRecentVisit;
}

import { housePermissions, unmarkHours } from '../modules/house/house-permissions';

describe('Permissões de interação com casas', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const state = { completed: false, completedDate: null, endDate: null, dontVisit: false, reportType: null };
  it('permite apenas a ação correspondente ao estado atual', () => {
    expect(housePermissions(state, 5, false, now)).toMatchObject({ canMark: true, canUnmark: false, blockedReason: null });
    expect(housePermissions({ ...state, completed: true, completedDate: now }, 5, false, now)).toMatchObject({ canMark: false, canUnmark: true });
  });
  it('informa o motivo de cada bloqueio', () => {
    for (const [change, reason] of [[{ dontVisit: true }, 'dont_visit'], [{ hasRound: false }, 'no_round'], [{ published: false }, 'pending_approval'], [{ endDate: now }, 'closed_round']] as const) {
      expect(housePermissions({ ...state, ...change }, 5, false, now)).toMatchObject({ canMark: false, canUnmark: false, blockedReason: reason });
    }
  });
  it('preserva o limite de horas inteiras da regra existente', () => {
    const completed = { ...state, completed: true, completedDate: now };
    const until = new Date(now.getTime() + 6 * 3600000);
    expect(housePermissions(completed, 5, false, new Date(until.getTime() - 1))).toMatchObject({ canUnmark: true, canUnmarkUntil: until });
    expect(housePermissions(completed, 5, false, until)).toMatchObject({ canUnmark: false, blockedReason: 'unmark_window_expired' });
  });
  it('mantém exceção administrativa para prazo e rodada encerrada', () => {
    expect(housePermissions({ ...state, completed: true, completedDate: now, endDate: now }, 0, true, new Date('2026-11-01'))).toMatchObject({ canUnmark: true, canUnmarkUntil: null });
    expect(housePermissions({ ...state, dontVisit: true }, 5, true, now).canMark).toBe(false);
  });
  it('usa cinco horas para configuração ausente ou inválida', () => {
    for (const value of [null, '', 'inválido', '-1']) expect(unmarkHours(value)).toBe(5);
    expect(unmarkHours('0')).toBe(0);
    expect(unmarkHours('8')).toBe(8);
  });
});

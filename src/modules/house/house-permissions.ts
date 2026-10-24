export type HouseBlockedReason = 'dont_visit' | 'pending_report' | 'closed_round' | 'unmark_window_expired' | 'no_round' | 'pending_approval';

type HouseState = {
  completed: boolean;
  completedDate: Date | null;
  endDate: Date | null;
  dontVisit: boolean;
  reportType: string | null;
  hasRound?: boolean;
  published?: boolean;
};

export function unmarkHours(value: string | null) {
  const hours = value === null ? 5 : parseInt(value, 10);
  return Number.isFinite(hours) && hours >= 0 ? hours : 5;
}

/** The existing rule compares whole elapsed hours: diff('hours') > configured hours. */
export function housePermissions(state: HouseState, hours: number, isAdmin = false, now = new Date()) {
  const canUnmarkUntil = !isAdmin && state.completed && state.completedDate ? new Date(state.completedDate.getTime() + (hours + 1) * 3600000) : null;
  let blockedReason: HouseBlockedReason | null = null;
  if (state.published === false) blockedReason = 'pending_approval';
  else if (state.hasRound === false) blockedReason = 'no_round';
  else if (state.dontVisit) blockedReason = 'dont_visit';
  else if (!isAdmin && state.endDate) blockedReason = 'closed_round';
  else if (canUnmarkUntil && now >= canUnmarkUntil) blockedReason = 'unmark_window_expired';
  return {
    canMark: !state.completed && !blockedReason,
    canUnmark: state.completed && !blockedReason,
    blockedReason,
    canUnmarkUntil,
  };
}

// The hours the Day and Week views of Automations draw.
//
// The grid started at six, on the guess that earlier hours are rare, and a
// routine set for any time from midnight to five was on the calendar and
// nowhere on the screen: its chip sat above the top of the grid and was
// left out. Now the grid starts at six, or at the hour of the earliest
// routine shown when that is earlier, and ends at eleven at night, or
// after the latest one, so whatever is scheduled has a place to be.
//
// Two routines at the same time were drawn in the same place, one card
// over the other, and neither could be read (GitHub 361). Cards that
// overlap now sit side by side, the way any calendar packs them.

/** Where an ordinary day starts and ends on the grid, as hours. */
export const DAY_START = 6;
export const DAY_END = 23;

/** The first hour the grid draws and the hour it ends at, for routines at
 * these minutes after midnight. */
export function gridHours(minutes: readonly number[]): { start: number; end: number } {
  let start = DAY_START;
  let end = DAY_END;
  for (const at of minutes) {
    if (!Number.isFinite(at)) continue;
    const hour = Math.max(0, Math.min(23, Math.floor(at / 60)));
    start = Math.min(start, hour);
    end = Math.max(end, hour + 1);
  }
  return { start, end };
}

/** A card on a day's column: where it starts and where it ends, in any
 * one unit, the end after the start. */
export interface CardSpan {
  id: string;
  start: number;
  end: number;
}

/** Which column of its group a card takes, counted from the left, and how
 * many columns the group splits the day's width into. */
export interface CardLane {
  column: number;
  columns: number;
}

/**
 * Where each card sits across its day. Cards that overlap, directly or
 * through a chain of others, are one group, and the group splits the
 * width evenly. In order of start, each card takes the leftmost column
 * free when it starts and stays in it, so a later card fills a gap
 * rather than pushing the others along. A card that starts as another
 * ends does not overlap it. A card whose times are not numbers is left alone,
 * in a column of its own. Pure.
 */
export function cardLanes(cards: readonly CardSpan[]): Map<string, CardLane> {
  const lanes = new Map<string, CardLane>();
  const timed = cards.filter((card) => {
    if (Number.isFinite(card.start) && Number.isFinite(card.end)) return true;
    lanes.set(card.id, { column: 0, columns: 1 });
    return false;
  });
  // the longer of two that start together goes first, so it takes the left
  const order = [...timed].sort((a, b) => a.start - b.start || b.end - a.end || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let group: Array<{ id: string; column: number }> = [];
  // where the last card in each of the group's columns ends
  let columnEnds: number[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    for (const { id, column } of group) lanes.set(id, { column, columns: columnEnds.length });
    group = [];
    columnEnds = [];
  };
  for (const card of order) {
    const end = Math.max(card.start, card.end);
    if (group.length && card.start >= groupEnd) close();
    let column = columnEnds.findIndex((at) => at <= card.start);
    if (column === -1) column = columnEnds.push(end) - 1;
    else columnEnds[column] = end;
    group.push({ id: card.id, column });
    groupEnd = group.length === 1 ? end : Math.max(groupEnd, end);
  }
  close();
  return lanes;
}

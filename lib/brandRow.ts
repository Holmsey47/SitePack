import { space } from './theme.ts';

/** Full wordmark and company name share a row only when both fit the measured width. */
export function brandFitsOneRow(markWidth: number, nameWidth: number, boxWidth: number): boolean {
  if (markWidth <= 0 || nameWidth <= 0 || boxWidth <= 0) return false;
  return markWidth + space.sm + nameWidth <= boxWidth;
}

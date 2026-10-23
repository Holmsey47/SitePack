import { snagNumber } from '@/data/snags';

/** Legal copy. [n] is the snapshot count. The word stays "snags", including when that count is 1. */
export const SNAG_CONTRACTOR_CONFIRMATION =
  'I confirm the [n] snags marked complete above have been put right to my satisfaction, on behalf of [Company]. Snags listed as outstanding are not signed off.';

/** Legal copy. [n] is the snapshot count. The word stays "snags", including when that count is 1. */
export const SNAG_INTERNAL_CONFIRMATION =
  "I've checked the [n] snags marked complete above and I'm satisfied they've been put right. This is an internal check for [Company], not sign-off by the main contractor.";

export const SNAG_SIGN_OFF_DISCLAIMER =
  "This sign-off records the snags listed only. It isn't a completion certificate.";

export type SnagSignoffKind = 'internal' | 'contractor';

/** The sentence shown above the pad. [n] is how many snags the snapshot marks complete. A blank company is display-only; the server stores the typed name. */
export function snagConfirmation(company: string, kind: SnagSignoffKind, markedComplete: number): string {
  const shown = company.replace(/£/g, '').trim() || 'your company';
  const count = Number.isFinite(markedComplete) ? Math.max(0, Math.floor(markedComplete)) : 0;
  const sentence = kind === 'contractor' ? SNAG_CONTRACTOR_CONFIRMATION : SNAG_INTERNAL_CONFIRMATION;
  return sentence.replace('[n]', String(count)).replace('[Company]', shown);
}

/** The sign-off form closes after a save, online or on the phone, so the button cannot be tapped again. */
export function signoffFormOpen(input: { savedOnPhone: boolean; signedOff: boolean }): boolean {
  return !input.savedOnPhone && !input.signedOff;
}

/** The contractor pad stays off until its own company field has text. */
export function contractorPadEnabled(contractorCompany: string): boolean {
  return contractorCompany.trim().length > 0;
}

export function outstandingHeading(count: number): string {
  if (count < 1) return 'No snags are outstanding.';
  return `Outstanding (not signed off): ${count}`;
}

export function outstandingLine(snagSeq: number, title: string, level: string | null): string {
  const area = level?.trim();
  const id = snagNumber(snagSeq);
  return area ? `${id} · ${title} · ${area}` : `${id} · ${title}`;
}

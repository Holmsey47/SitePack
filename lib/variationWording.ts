import { formatPounds } from '@/data/variations';

/** Legal copy. Change the sentence here and nowhere else. */
export const VARIATION_CONFIRM_WITH_AMOUNT =
  'I confirm I instructed this extra work on behalf of [Company] and agree the amount shown.';

/** Legal copy. Change the sentence here and nowhere else. */
export const VARIATION_CONFIRM_WITHOUT_AMOUNT =
  'I confirm I instructed this extra work on behalf of [Company]. The price is still to be agreed.';

export const VARIATION_LOCK_LINE =
  'Record locked at signing, [Time]. Any later change creates a new version.';

/** The sentence shown above the pad and stored with the signature. */
export function variationConfirmation(company: string, hasAmount: boolean): string {
  const shown = company.trim() || '[company]';
  const sentence = hasAmount ? VARIATION_CONFIRM_WITH_AMOUNT : VARIATION_CONFIRM_WITHOUT_AMOUNT;
  return sentence.replace('[Company]', shown);
}

export function variationLockLine(signedUk: string): string {
  return VARIATION_LOCK_LINE.replace('[Time]', signedUk);
}

/** VO-7 · Title · £145.50 + VAT · 2 photos. The amount is omitted when it is unset. */
export function variationHandoverSummary(
  voSeq: number,
  title: string,
  valuePence: number | null,
  photoCount: number
): string {
  const photos = `${photoCount} photo${photoCount === 1 ? '' : 's'}`;
  const parts = [`VO-${voSeq}`, title];
  if (valuePence != null) parts.push(formatPounds(valuePence));
  parts.push(photos);
  return parts.join(' · ');
}

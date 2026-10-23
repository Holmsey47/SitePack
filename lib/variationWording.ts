import { formatPounds, formatPoundsAmount, isVariationLocked, type VariationStatus } from '@/data/variations';

/** Legal copy. Change the sentence here and nowhere else. */
export const VARIATION_CONFIRM_WITH_AMOUNT =
  'I confirm I instructed this extra work on behalf of [Company] and agree the amount shown.';

/** Legal copy. Change the sentence here and nowhere else. */
export const VARIATION_CONFIRM_WITHOUT_AMOUNT =
  'I confirm I instructed this extra work on behalf of [Company]. The price is still to be agreed.';

export const VARIATION_LOCK_LINE =
  'Record locked at signing, [Time]. Any later change creates a new version.';

/** The sentence shown above the pad. A blank company is display-only; the stored sentence uses the typed name. */
export function variationConfirmation(company: string, hasAmount: boolean): string {
  const shown = company.trim() || 'your company';
  const sentence = hasAmount ? VARIATION_CONFIRM_WITH_AMOUNT : VARIATION_CONFIRM_WITHOUT_AMOUNT;
  return sentence.replace('[Company]', () => shown);
}

export function variationLockLine(signedUk: string): string {
  return VARIATION_LOCK_LINE.replace('[Time]', () => signedUk);
}

/** Operative copy where a priced sign-off would have shown the pounds. */
export function variationOfficeAmountLine(companyName: string | null | undefined): string {
  const name = companyName?.trim() || 'the office';
  return `Amount: agreed with the office. Ask ${name} for the priced copy.`;
}

export const VARIATION_RESIGN_HINT =
  'To get it signed at this price: Edit as new version, then hand over.';

/** Signed or sent, and the signature the caller can see has no £ snapshot. Operatives use the stored sentence. */
export function variationSignedWithoutPrice(input: {
  seeValue: boolean;
  status: VariationStatus;
  confirmationText: string | null;
  shownValuePence: number | null;
  hasSignature: boolean;
}): boolean {
  if (!isVariationLocked(input.status)) return false;
  if (!input.seeValue) return !input.confirmationText?.includes('agree the amount shown');
  return !input.hasSignature || input.shownValuePence == null;
}

/** Detail amount. A priced sign-off an operative cannot see uses the office line. A null snapshot is not an agreed price. */
export function variationDetailAmount(input: {
  seeValue: boolean;
  valuePence: number | null;
  shownValuePence: number | null;
  signedWithoutPrice: boolean;
  signed: boolean;
  companyName: string | null | undefined;
}): { line: string | null; hint: string | null } {
  if (!input.signed) {
    if (input.seeValue && input.valuePence != null) return { line: `Amount · ${formatPounds(input.valuePence)}`, hint: null };
    return { line: null, hint: null };
  }
  if (input.signedWithoutPrice) {
    if (input.seeValue && input.valuePence != null) {
      return {
        line: `Amount · ${formatPounds(input.valuePence)}, not yet agreed. Signed before a price was set.`,
        hint: VARIATION_RESIGN_HINT,
      };
    }
    return { line: null, hint: null };
  }
  if (!input.seeValue) return { line: variationOfficeAmountLine(input.companyName), hint: null };
  if (input.shownValuePence != null) return { line: `Amount · ${formatPounds(input.shownValuePence)}`, hint: null };
  return { line: null, hint: null };
}

export function variationScreenAmount(input: {
  seeValue: boolean;
  companyName: string | null | undefined;
  status: VariationStatus;
  valuePence: number | null;
  confirmationText: string | null;
  shownValuePence: number | null;
  hasSignature: boolean;
}): { line: string | null; hint: string | null } {
  const signedWithoutPrice = variationSignedWithoutPrice(input);
  return variationDetailAmount({
    seeValue: input.seeValue,
    valuePence: input.valuePence,
    shownValuePence: input.shownValuePence,
    signedWithoutPrice,
    signed: isVariationLocked(input.status),
    companyName: input.companyName,
  });
}

/** List amount. signed_without_price is the server flag; operatives always get null. */
export function variationListAmount(
  row: {
    status: VariationStatus;
    value_pence: number | null;
    shown_value_pence: number | null;
    signed_without_price: boolean;
  },
  seeValue: boolean
): string | null {
  if (!seeValue) return null;
  if (row.signed_without_price) {
    return row.value_pence != null ? `${formatPoundsAmount(row.value_pence)} · not agreed` : null;
  }
  if (isVariationLocked(row.status)) {
    return row.shown_value_pence != null ? formatPounds(row.shown_value_pence) : null;
  }
  return row.value_pence != null ? formatPounds(row.value_pence) : null;
}

/** The office line replaces a pound amount on an operative PDF. Anything else stays on valuePence. */
export function variationPdfAmountLine(line: string | null): string | null {
  if (!line?.startsWith('Amount: agreed with the office')) return null;
  return line;
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

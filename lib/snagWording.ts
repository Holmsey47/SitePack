import { snagNumber, type SnagStatus } from '@/data/snags';

/** Legal copy for one snag. [Company] is filled with a function so a name cannot expand as a pattern. */
export const SNAG_CONTRACTOR_ONE =
  'I confirm the 1 snag marked complete above has been put right to my satisfaction, on behalf of [Company]. Snags listed as outstanding are not signed off.';

/** Legal copy. [n] is the snapshot count when it is not 1. */
export const SNAG_CONTRACTOR_CONFIRMATION =
  'I confirm the [n] snags marked complete above have been put right to my satisfaction, on behalf of [Company]. Snags listed as outstanding are not signed off.';

/** Legal copy for one snag. [Company] is filled with a function so a name cannot expand as a pattern. */
export const SNAG_INTERNAL_ONE =
  "I've checked the 1 snag marked complete above and I'm satisfied it's been put right. This is an internal check for [Company], not sign-off by the main contractor.";

/** Legal copy. [n] is the snapshot count when it is not 1. */
export const SNAG_INTERNAL_CONFIRMATION =
  "I've checked the [n] snags marked complete above and I'm satisfied they've been put right. This is an internal check for [Company], not sign-off by the main contractor.";

export const SNAG_SIGN_OFF_DISCLAIMER =
  "This sign-off records the snags listed only. It isn't a completion certificate.";

export type SnagSignoffKind = 'internal' | 'contractor';

/** The sentence shown above the pad. [n] is how many snags the snapshot marks complete. A blank company is display-only; the server stores the typed name. */
export function snagConfirmation(company: string, kind: SnagSignoffKind, markedComplete: number): string {
  const shown = company.replace(/£/g, '').trim() || 'your company';
  const count = Number.isFinite(markedComplete) ? Math.max(0, Math.floor(markedComplete)) : 0;
  const template =
    kind === 'contractor'
      ? count === 1
        ? SNAG_CONTRACTOR_ONE
        : SNAG_CONTRACTOR_CONFIRMATION
      : count === 1
        ? SNAG_INTERNAL_ONE
        : SNAG_INTERNAL_CONFIRMATION;
  return template.replace('[n]', () => String(count)).replace('[Company]', () => shown);
}

/** The sign-off form closes after a save, online or on the phone, so the button cannot be tapped again. */
export function signoffFormOpen(input: { savedOnPhone: boolean; signedOff: boolean }): boolean {
  return !input.savedOnPhone && !input.signedOff;
}

/** Shown in place of Signed off until the queued sign-off is confirmed. */
export const SIGNED_ON_PHONE = "Signed on this phone, will send when there's signal";

/** The snag screen offers sign-off only while the snag is Fixed. A signed-off snag has no button. */
export function showSignOffOnSnag(status: SnagStatus): boolean {
  return status === 'Fixed';
}

/** Replaces the sign-off button while this person's sign-off is still queued. */
export function signOffWaitingLabel(count: number): string {
  return count === 1 ? '1 sign-off waiting to send' : `${count} sign-offs waiting to send`;
}

/** Shown on a Fixed snag while that snag's sign-off is still queued. */
export const SIGN_OFF_QUEUED = 'Sign-off waiting to send';

/** Notes and names on screen. A newline or tab becomes one space, and accents are composed. */
export function snagDisplayText(value: string): string {
  return value.normalize('NFC').replace(/[\t\n\v\f\r]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/** The contractor pad stays off until its own company field has text. */
export function contractorPadEnabled(contractorCompany: string): boolean {
  return contractorCompany.trim().length > 0;
}

export function outstandingHeading(count: number): string {
  if (count < 1) return 'No snags are outstanding.';
  return `Outstanding (not signed off): ${count}`;
}

export type SignAgainDraft = {
  signMode: 'internal' | 'contractor';
  signerName: string;
  signerRole: string;
  signerCompany: string;
};

let signAgainDraft: SignAgainDraft | null = null;

/** Keep the signer off the URL. The sign screen reads this once, in memory. */
export function rememberSignAgain(draft: SignAgainDraft): void {
  signAgainDraft = {
    signMode: draft.signMode,
    signerName: draft.signerName,
    signerRole: draft.signerRole,
    signerCompany: draft.signerCompany,
  };
}

export function takeSignAgain(): SignAgainDraft | null {
  const draft = signAgainDraft;
  signAgainDraft = null;
  return draft;
}

/** The sign-off route. Name, role and company are not query params. */
export function signAgainPath(siteId: string): string {
  return `/sites/${siteId}/snags/sign`;
}

export function outstandingLine(snagSeq: number, title: string, level: string | null): string {
  const area = snagDisplayText(level ?? '');
  const id = snagNumber(snagSeq);
  const name = snagDisplayText(title);
  return area ? `${id} · ${name} · ${area}` : `${id} · ${name}`;
}

const PUT_RIGHT_NOTE_LIMIT = 40;

function shortenedNote(note: string): string {
  const plain = snagDisplayText(note);
  const chars = Array.from(plain);
  if (chars.length <= PUT_RIGHT_NOTE_LIMIT) return plain;
  return `${chars.slice(0, PUT_RIGHT_NOTE_LIMIT - 1).join('').trimEnd()}\u2026`;
}

/** The snags the sentence calls "marked complete above". Every S-number is kept. Only a long title is shortened. */
export function putRightLine(rows: Array<{ snagSeq: number; note: string }>): string {
  if (rows.length < 1) return 'No snags are marked put right yet.';
  const items = rows.map((row) => {
    const title = shortenedNote(row.note);
    return title ? `${snagNumber(row.snagSeq)} ${title}` : snagNumber(row.snagSeq);
  });
  return `${rows.length} put right: ${items.join(', ')}`;
}

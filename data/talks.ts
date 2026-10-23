import type { TalkDelivery, TalkKind } from '@/lib/talkMeaning';

export const TALK_URL_SECONDS = 300;

export type TalkAudience = 'all' | 'chosen';

export type CreateTalkInput = {
  siteId: string;
  kind: TalkKind;
  delivery: TalkDelivery;
  title: string;
  body: string;
  pdfPath: string | null;
  audience: TalkAudience;
  personIds: string[];
  presenterPersonId: string;
  presenterRole: string;
  presentedAt: string;
};

export type ReviseTalkInput = {
  title: string;
  body: string;
  pdfPath: string | null;
};

export type SignTalkInput = {
  talkId: string;
  versionId: string;
  personId: string;
  signaturePng: string;
  deviceAt: string;
  sessionId: string;
};

export type AskTalkInput = {
  talkId: string;
  versionId: string;
  personId: string;
  body: string;
  deviceAt: string;
  sessionId: string;
};

export type PresenterSignInput = {
  talkId: string;
  versionId: string;
  signaturePng: string;
  deviceAt: string;
  sessionId: string;
};

export type TalkVersionRef = {
  talk_id: string;
  version_id: string;
  version_no: number;
  content_hash: string;
};

export type SignTalkResult = TalkVersionRef & {
  signature_id: string;
  meaning: string;
  received_at: string;
  device_at: string;
  shared_device: boolean;
  captured_by: string;
  session_id: string;
};

export type TalkListItem = {
  talk_id: string;
  site_id: string;
  kind: TalkKind;
  delivery: TalkDelivery;
  title: string;
  version_no: number;
  version_id: string;
  content_hash: string;
  audience: TalkAudience;
  presenter_person_id: string;
  presenter_name: string;
  presenter_role: string;
  presented_at: string;
  signed_count: number | null;
  required_count: number | null;
  question_count: number | null;
  mine_signed: boolean;
  mine_question: boolean;
};

export type TalkPersonRow = {
  person_id: string;
  person_name: string;
  /** First characters of the person id, stable if the display name changes. */
  person_ref: string;
  /** True when the live display name differs from the name stored at signing. */
  name_changed: boolean;
  has_question: boolean;
  question: string | null;
  explained_verbally: boolean;
  interpreter_used: boolean;
};

export type TalkSignedRow = TalkPersonRow & {
  received_at: string;
  device_at: string;
  meaning: string;
  /** Null unless the caller is the host owner, the host CM, or this row's signer. */
  signature_png: string | null;
  shared_device: boolean;
  /** Null unless the caller is the host owner, the host CM, or this row's signer. */
  session_id: string | null;
  /** Null unless the caller is the host owner, the host CM, or this row's signer. */
  captured_by: string | null;
  content_hash: string;
};

export type TalkQuestionRow = {
  person_id: string;
  person_name: string;
  body: string | null;
  received_at: string;
};

export type TalkRegister = {
  required_count: number;
  signed_count: number;
  not_signed: TalkPersonRow[];
  signed: TalkSignedRow[];
  presenter_signature: TalkSignedRow | null;
  questions: TalkQuestionRow[];
};

export type TalkDetail = {
  talk_id: string;
  site_id: string;
  site_name: string;
  company_id: string;
  kind: TalkKind;
  delivery: TalkDelivery;
  title: string;
  body: string;
  pdf_path: string | null;
  pdf_url: string | null;
  pdf_url_expires_at: string | null;
  version_id: string;
  version_no: number;
  content_hash: string;
  audience: TalkAudience;
  presenter_person_id: string;
  presenter_name: string;
  presenter_role: string;
  presented_at: string;
  attendee_meaning: string;
  mine_signed: boolean;
  register: TalkRegister | null;
};

export type TalkBadge = {
  site_id: string;
  outstanding: number;
  questions: number | null;
};

export type InductionGap = {
  person_id: string;
  person_name: string;
};

export function signedCountLabel(signed: number, total: number): string {
  return `${signed} of ${total} signed`;
}

export function readAndSignLabel(count: number): string {
  return `${count} to read and sign`;
}

export function questionsLabel(count: number): string {
  return count === 1 ? '1 question' : `${count} questions`;
}

export function talkError(code: string): string {
  switch (code) {
    case 'not_authorized':
      return 'You cannot do that. Ask the site manager.';
    case 'invalid_input':
      return 'Check the talk and try again.';
    case 'invalid_path':
      return 'That file cannot be attached. Choose the file again.';
    case 'invalid_time':
      return 'The time on this phone is not valid. Check the clock and try again.';
    case 'already_signed':
      return 'This version is already signed.';
    case 'not_required':
      return 'This person does not need to sign this talk.';
    case 'version_locked':
      return 'This talk has a new version. Read it and sign again.';
    default:
      return 'That did not save. Try again.';
  }
}

/** FNV-1a of the talk content. A change of title, body, or file makes a new hash. */
export function talkContentHash(parts: {
  kind: string;
  delivery: string;
  title: string;
  body: string;
  pdfPath: string | null;
}): string {
  const canonical = [parts.kind, parts.delivery, parts.title.trim(), parts.body.trim(), parts.pdfPath ?? ''].join('\n');
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const TALK_CONTROLS = /[\u0000-\u001f\u007f\u0085\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f]/;

/** Rejects C0 controls, DEL, NEL, line separators, and bidi controls. */
export function talkPlain(value: string): string {
  if (TALK_CONTROLS.test(value)) throw new Error('invalid_input');
  return value;
}

const TALK_FILE = /^[A-Za-z0-9._-]+$/;

/** Rejects a leading slash, `..`, and any path outside company/site/talks/. */
export function talkStoragePath(companyId: string, siteId: string, path: string): string {
  const value = path.trim();
  if (!value || value.startsWith('/') || value.includes('..') || value.includes('\\') || value.includes('\0')) {
    throw new Error('invalid_path');
  }
  const parts = value.split('/');
  if (parts.length !== 4) throw new Error('invalid_path');
  const [company, site, folder, file] = parts;
  if (
    company?.toLowerCase() !== companyId.toLowerCase() ||
    site?.toLowerCase() !== siteId.toLowerCase() ||
    folder !== 'talks' ||
    !file ||
    !TALK_FILE.test(file)
  ) {
    throw new Error('invalid_path');
  }
  return `${companyId.toLowerCase()}/${siteId.toLowerCase()}/talks/${file}`;
}

export function signaturePngOk(value: string): boolean {
  return value.startsWith('data:image/png;base64,') && value.length >= 40 && value.length <= 200_000;
}

export function talkSessionOk(value: string): boolean {
  return /^[A-Za-z0-9-]{8,80}$/.test(value);
}

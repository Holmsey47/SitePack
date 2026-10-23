import { newId } from '@/data/newId';
import {
  signaturePngOk,
  talkContentHash,
  talkSessionOk,
  talkStoragePath,
  type AskTalkInput,
  type CreateTalkInput,
  type InductionGap,
  type PresenterSignInput,
  type ReviseTalkInput,
  type SignTalkInput,
  type SignTalkResult,
  type TalkBadge,
  type TalkDetail,
  type TalkListItem,
  type TalkQuestionRow,
  type TalkRegister,
  type TalkSignedRow,
  type TalkVersionRef,
} from '@/data/talks';
import type { Role } from '@/data/types';
import { formatDate } from '@/lib/format';
import { talkMeaning, type TalkDelivery, type TalkKind } from '@/lib/talkMeaning';

export type TalkActor = {
  id: string;
  role: Role;
  company_id: string;
  display_name: string;
  auth_user_id: string | null;
};

export type TalkSite = { id: string; company_id: string; name: string };
export type TalkPerson = { id: string; role: Role; company_id: string; display_name: string | null };
export type TalkAssignment = { site_id: string; person_id: string };

type TalkRow = {
  id: string;
  site_id: string;
  company_id: string;
  kind: TalkKind;
  delivery: TalkDelivery;
  title: string;
  audience: 'all' | 'chosen';
  presenter_person_id: string;
  presenter_name: string;
  presenter_role: string;
  presented_at: string;
  created_by: string;
};

type VersionRow = {
  id: string;
  talk_id: string;
  site_id: string;
  company_id: string;
  version_no: number;
  body: string;
  pdf_path: string | null;
  content_hash: string;
  is_current: boolean;
  created_by: string;
};

type SignatureRow = {
  id: string;
  talk_id: string;
  version_id: string;
  site_id: string;
  company_id: string;
  person_id: string;
  person_name: string;
  captured_by: string;
  session_id: string;
  shared_device: boolean;
  signature_role: 'attendee' | 'presenter';
  meaning: string;
  signature_png: string;
  device_at: string;
  received_at: string;
  content_hash: string;
};

type QuestionRow = {
  id: string;
  talk_id: string;
  version_id: string;
  site_id: string;
  company_id: string;
  person_id: string;
  person_name: string;
  body: string | null;
  captured_by: string;
  session_id: string;
  shared_device: boolean;
  device_at: string;
  received_at: string;
};

type NoteRow = {
  talk_id: string;
  version_id: string;
  person_id: string;
  explained_verbally: boolean;
  interpreter_used: boolean;
  noted_by: string;
};

export type FixtureTalkBucket = {
  talks: TalkRow[];
  versions: VersionRow[];
  required: { talk_id: string; person_id: string }[];
  signatures: SignatureRow[];
  questions: QuestionRow[];
  notes: NoteRow[];
};

export function emptyTalks(): FixtureTalkBucket {
  return { talks: [], versions: [], required: [], signatures: [], questions: [], notes: [] };
}

function fail(code: string): never {
  throw new Error(code);
}

function label(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return (trimmed || 'Someone on site').slice(0, 120);
}

function manager(actor: TalkActor): boolean {
  return actor.role === 'owner' || actor.role === 'cm';
}

function deviceTime(iso: string, now = Date.now()): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at) || at > now + 24 * 3600 * 1000 || at < now - 30 * 24 * 3600 * 1000) fail('invalid_time');
  return new Date(at).toISOString();
}

function requireSite(actor: TalkActor, site: TalkSite | undefined, canAccess: boolean): TalkSite {
  if (!site || site.company_id !== actor.company_id || !canAccess) fail('not_authorized');
  return site;
}

function currentVersion(bucket: FixtureTalkBucket, talkId: string): VersionRow {
  const version = bucket.versions.find((row) => row.talk_id === talkId && row.is_current);
  if (!version) fail('not_authorized');
  return version;
}

function requiredIds(bucket: FixtureTalkBucket, talk: TalkRow, people: TalkPerson[], assignments: TalkAssignment[]): string[] {
  return people
    .filter((person) => person.company_id === talk.company_id && person.role === 'operative')
    .filter((person) => assignments.some((row) => row.site_id === talk.site_id && row.person_id === person.id))
    .filter((person) => talk.audience === 'all' || bucket.required.some((row) => row.talk_id === talk.id && row.person_id === person.id))
    .map((person) => person.id);
}

function isRequired(bucket: FixtureTalkBucket, talk: TalkRow, personId: string, people: TalkPerson[], assignments: TalkAssignment[]) {
  return requiredIds(bucket, talk, people, assignments).includes(personId);
}

function seesRegister(actor: TalkActor, talk: TalkRow): boolean {
  return manager(actor) || actor.id === talk.presenter_person_id;
}

function attendeeSigned(bucket: FixtureTalkBucket, versionId: string, personId: string) {
  return bucket.signatures.some(
    (row) => row.version_id === versionId && row.person_id === personId && row.signature_role === 'attendee'
  );
}

function meaningFor(talk: TalkRow, siteName: string, role: 'attendee' | 'presenter' | 'on_behalf', managerName = '') {
  return talkMeaning({
    kind: talk.kind,
    delivery: talk.delivery,
    signatureRole: role,
    siteName,
    title: talk.title,
    presenterName: talk.presenter_name,
    presentedOn: formatDate(talk.presented_at),
    managerName,
  });
}

function sameName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function resolvePresenterId(actor: TalkActor, presenterName: string, people: TalkPerson[]): string {
  const matches = people.filter(
    (person) => person.company_id === actor.company_id && sameName(person.display_name ?? '', presenterName)
  );
  return matches.find((person) => person.id === actor.id)?.id ?? matches[0]?.id ?? actor.id;
}

function noteFor(bucket: FixtureTalkBucket, versionId: string, personId: string) {
  return bucket.notes.find((row) => row.version_id === versionId && row.person_id === personId);
}

function questionFor(bucket: FixtureTalkBucket, versionId: string, personId: string) {
  return bucket.questions.find((row) => row.version_id === versionId && row.person_id === personId);
}

function counts(bucket: FixtureTalkBucket, talk: TalkRow, version: VersionRow, people: TalkPerson[], assignments: TalkAssignment[]) {
  const ids = requiredIds(bucket, talk, people, assignments);
  const signed = ids.filter((id) => attendeeSigned(bucket, version.id, id)).length;
  const questions = bucket.questions.filter((row) => row.version_id === version.id && ids.includes(row.person_id)).length;
  return { required_count: ids.length, signed_count: signed, question_count: questions };
}

function listItem(
  bucket: FixtureTalkBucket,
  actor: TalkActor,
  talk: TalkRow,
  people: TalkPerson[],
  assignments: TalkAssignment[]
): TalkListItem {
  const version = currentVersion(bucket, talk.id);
  const show = seesRegister(actor, talk);
  const tally = show ? counts(bucket, talk, version, people, assignments) : null;
  return {
    talk_id: talk.id,
    site_id: talk.site_id,
    kind: talk.kind,
    delivery: talk.delivery,
    title: talk.title,
    version_no: version.version_no,
    version_id: version.id,
    content_hash: version.content_hash,
    audience: talk.audience,
    presenter_person_id: talk.presenter_person_id,
    presenter_name: talk.presenter_name,
    presenter_role: talk.presenter_role,
    presented_at: talk.presented_at,
    signed_count: tally ? tally.signed_count : null,
    required_count: tally ? tally.required_count : null,
    question_count: tally ? tally.question_count : null,
    mine_signed: attendeeSigned(bucket, version.id, actor.id),
    mine_question: Boolean(questionFor(bucket, version.id, actor.id)),
  };
}

function assertCapture(actor: TalkActor, talk: TalkRow, personId: string, people: TalkPerson[], assignments: TalkAssignment[], bucket: FixtureTalkBucket) {
  if (!isRequired(bucket, talk, personId, people, assignments)) fail('not_required');
  if (personId === actor.id) return;
  const allowed = manager(actor) || actor.id === talk.presenter_person_id;
  if (!allowed) fail('not_authorized');
  const person = people.find((row) => row.id === personId);
  if (!person || person.company_id !== talk.company_id) fail('not_authorized');
  if (!assignments.some((row) => row.site_id === talk.site_id && row.person_id === personId)) fail('not_authorized');
}

function assertContent(input: { kind: TalkKind; delivery: TalkDelivery; title: string; body: string; pdfPath: string | null; site: TalkSite }) {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 1 || title.length > 120) fail('invalid_input');
  if (body.length > 8000) fail('invalid_input');
  if (!body && !input.pdfPath) fail('invalid_input');
  if (input.kind !== 'induction' && input.kind !== 'toolbox') fail('invalid_input');
  if (input.delivery !== 'phone' && input.delivery !== 'in_person') fail('invalid_input');
  if (input.kind === 'induction' && input.delivery !== 'phone') fail('invalid_input');
  const pdf = input.pdfPath ? talkStoragePath(input.site.company_id, input.site.id, input.pdfPath) : null;
  return { title, body, pdf };
}

export function fixtureCreateTalk(
  bucket: FixtureTalkBucket,
  actor: TalkActor,
  input: CreateTalkInput,
  sites: TalkSite[],
  people: TalkPerson[],
  assignments: TalkAssignment[],
  canAccess: (siteId: string) => boolean
): TalkVersionRef {
  if (!manager(actor)) fail('not_authorized');
  const site = requireSite(actor, sites.find((row) => row.id === input.siteId), canAccess(input.siteId));
  const content = assertContent({ ...input, site });
  const presenterName = input.presenterName.trim();
  const presenterRole = input.presenterRole.trim();
  if (presenterName.length < 1 || presenterName.length > 120 || presenterRole.length < 1 || presenterRole.length > 80) {
    fail('invalid_input');
  }
  if (input.audience !== 'all' && input.audience !== 'chosen') fail('invalid_input');
  const presentedAt = deviceTime(input.presentedAt);
  const chosen = [...new Set(input.personIds)];
  if (input.audience === 'chosen') {
    if (chosen.length < 1) fail('invalid_input');
    for (const personId of chosen) {
      const person = people.find((row) => row.id === personId);
      if (!person || person.role !== 'operative' || person.company_id !== site.company_id) fail('invalid_input');
      if (!assignments.some((row) => row.site_id === site.id && row.person_id === personId)) fail('invalid_input');
    }
  }
  const talkId = newId();
  const versionId = newId();
  const hash = talkContentHash({
    kind: input.kind,
    delivery: input.delivery,
    title: content.title,
    body: content.body,
    pdfPath: content.pdf,
  });
  bucket.talks.push({
    id: talkId,
    site_id: site.id,
    company_id: site.company_id,
    kind: input.kind,
    delivery: input.delivery,
    title: content.title,
    audience: input.audience,
    presenter_person_id: resolvePresenterId(actor, presenterName, people),
    presenter_name: presenterName,
    presenter_role: presenterRole,
    presented_at: presentedAt,
    created_by: actor.id,
  });
  bucket.versions.push({
    id: versionId,
    talk_id: talkId,
    site_id: site.id,
    company_id: site.company_id,
    version_no: 1,
    body: content.body,
    pdf_path: content.pdf,
    content_hash: hash,
    is_current: true,
    created_by: actor.id,
  });
  if (input.audience === 'chosen') {
    for (const personId of chosen) bucket.required.push({ talk_id: talkId, person_id: personId });
  }
  return { talk_id: talkId, version_id: versionId, version_no: 1, content_hash: hash };
}

export function fixtureReviseTalk(
  bucket: FixtureTalkBucket,
  actor: TalkActor,
  talkId: string,
  input: ReviseTalkInput,
  sites: TalkSite[],
  canAccess: (siteId: string) => boolean
): TalkVersionRef {
  if (!manager(actor)) fail('not_authorized');
  const talk = bucket.talks.find((row) => row.id === talkId);
  if (!talk) fail('not_authorized');
  const site = requireSite(actor, sites.find((row) => row.id === talk.site_id), canAccess(talk.site_id));
  const content = assertContent({
    kind: talk.kind,
    delivery: talk.delivery,
    title: input.title,
    body: input.body,
    pdfPath: input.pdfPath,
    site,
  });
  const hash = talkContentHash({
    kind: talk.kind,
    delivery: talk.delivery,
    title: content.title,
    body: content.body,
    pdfPath: content.pdf,
  });
  const current = currentVersion(bucket, talk.id);
  if (hash === current.content_hash && talk.title === content.title) {
    return { talk_id: talk.id, version_id: current.id, version_no: current.version_no, content_hash: current.content_hash };
  }
  current.is_current = false;
  const versionId = newId();
  const versionNo = current.version_no + 1;
  talk.title = content.title;
  bucket.versions.push({
    id: versionId,
    talk_id: talk.id,
    site_id: talk.site_id,
    company_id: talk.company_id,
    version_no: versionNo,
    body: content.body,
    pdf_path: content.pdf,
    content_hash: hash,
    is_current: true,
    created_by: actor.id,
  });
  return { talk_id: talk.id, version_id: versionId, version_no: versionNo, content_hash: hash };
}

function insertSignature(
  bucket: FixtureTalkBucket,
  talk: TalkRow,
  version: VersionRow,
  actor: TalkActor,
  personId: string,
  personName: string,
  role: 'attendee' | 'presenter',
  png: string,
  deviceAt: string,
  sessionId: string,
  siteName: string,
  meaning?: string
): SignTalkResult {
  if (!signaturePngOk(png) || !talkSessionOk(sessionId)) fail('invalid_input');
  const received = new Date().toISOString();
  const device = deviceTime(deviceAt);
  const row: SignatureRow = {
    id: newId(),
    talk_id: talk.id,
    version_id: version.id,
    site_id: talk.site_id,
    company_id: talk.company_id,
    person_id: personId,
    person_name: personName,
    captured_by: actor.id,
    session_id: sessionId,
    shared_device: personId !== actor.id,
    signature_role: role,
    meaning: meaning ?? meaningFor(talk, siteName, role),
    signature_png: png,
    device_at: device,
    received_at: received,
    content_hash: version.content_hash,
  };
  bucket.signatures.push(row);
  return {
    talk_id: talk.id,
    version_id: version.id,
    version_no: version.version_no,
    content_hash: version.content_hash,
    signature_id: row.id,
    meaning: row.meaning,
    received_at: row.received_at,
    device_at: row.device_at,
    shared_device: row.shared_device,
    captured_by: row.captured_by,
    session_id: row.session_id,
  };
}

export function fixtureSignTalk(
  bucket: FixtureTalkBucket,
  actor: TalkActor,
  input: SignTalkInput,
  sites: TalkSite[],
  people: TalkPerson[],
  assignments: TalkAssignment[],
  canAccess: (siteId: string) => boolean
): SignTalkResult {
  const talk = bucket.talks.find((row) => row.id === input.talkId);
  if (!talk) fail('not_authorized');
  const site = requireSite(actor, sites.find((row) => row.id === talk.site_id), canAccess(talk.site_id));
  const version = bucket.versions.find((row) => row.id === input.versionId && row.talk_id === talk.id);
  if (!version) fail('not_authorized');
  if (!version.is_current) fail('version_locked');
  assertCapture(actor, talk, input.personId, people, assignments, bucket);
  if (attendeeSigned(bucket, version.id, input.personId)) fail('already_signed');
  const person = people.find((row) => row.id === input.personId);
  return insertSignature(
    bucket,
    talk,
    version,
    actor,
    input.personId,
    label(person?.display_name),
    'attendee',
    input.signaturePng,
    input.deviceAt,
    input.sessionId,
    site.name
  );
}

export function fixtureAskTalk(
  bucket: FixtureTalkBucket,
  actor: TalkActor,
  input: AskTalkInput,
  sites: TalkSite[],
  people: TalkPerson[],
  assignments: TalkAssignment[],
  canAccess: (siteId: string) => boolean
): { question_id: string; received_at: string } {
  const talk = bucket.talks.find((row) => row.id === input.talkId);
  if (!talk) fail('not_authorized');
  requireSite(actor, sites.find((row) => row.id === talk.site_id), canAccess(talk.site_id));
  const version = bucket.versions.find((row) => row.id === input.versionId && row.talk_id === talk.id);
  if (!version) fail('not_authorized');
  if (!version.is_current) fail('version_locked');
  assertCapture(actor, talk, input.personId, people, assignments, bucket);
  if (!talkSessionOk(input.sessionId)) fail('invalid_input');
  const body = input.body.trim();
  if (body.length > 280) fail('invalid_input');
  const person = people.find((row) => row.id === input.personId);
  const received = new Date().toISOString();
  const existing = questionFor(bucket, version.id, input.personId);
  if (existing) {
    existing.body = body || null;
    existing.device_at = deviceTime(input.deviceAt);
    existing.received_at = received;
    existing.captured_by = actor.id;
    existing.session_id = input.sessionId;
    existing.shared_device = input.personId !== actor.id;
    return { question_id: existing.id, received_at: received };
  }
  const id = newId();
  bucket.questions.push({
    id,
    talk_id: talk.id,
    version_id: version.id,
    site_id: talk.site_id,
    company_id: talk.company_id,
    person_id: input.personId,
    person_name: label(person?.display_name),
    body: body || null,
    captured_by: actor.id,
    session_id: input.sessionId,
    shared_device: input.personId !== actor.id,
    device_at: deviceTime(input.deviceAt),
    received_at: received,
  });
  return { question_id: id, received_at: received };
}

export function fixtureSetTalkNote(
  bucket: FixtureTalkBucket,
  actor: TalkActor,
  talkId: string,
  personId: string,
  explained: boolean,
  interpreter: boolean,
  sites: TalkSite[],
  people: TalkPerson[],
  assignments: TalkAssignment[],
  canAccess: (siteId: string) => boolean
) {
  const talk = bucket.talks.find((row) => row.id === talkId);
  if (!talk) fail('not_authorized');
  requireSite(actor, sites.find((row) => row.id === talk.site_id), canAccess(talk.site_id));
  if (!seesRegister(actor, talk)) fail('not_authorized');
  if (!isRequired(bucket, talk, personId, people, assignments)) fail('not_required');
  const version = currentVersion(bucket, talk.id);
  const existing = noteFor(bucket, version.id, personId);
  if (!explained && !interpreter) {
    bucket.notes = bucket.notes.filter((row) => row !== existing);
    return;
  }
  if (existing) {
    existing.explained_verbally = explained;
    existing.interpreter_used = interpreter;
    existing.noted_by = actor.id;
    return;
  }
  bucket.notes.push({
    talk_id: talk.id,
    version_id: version.id,
    person_id: personId,
    explained_verbally: explained,
    interpreter_used: interpreter,
    noted_by: actor.id,
  });
}

export function fixtureSignPresenter(
  bucket: FixtureTalkBucket,
  actor: TalkActor,
  input: PresenterSignInput,
  sites: TalkSite[],
  people: TalkPerson[],
  canAccess: (siteId: string) => boolean
): SignTalkResult {
  const talk = bucket.talks.find((row) => row.id === input.talkId);
  if (!talk) fail('not_authorized');
  const site = requireSite(actor, sites.find((row) => row.id === talk.site_id), canAccess(talk.site_id));
  if (talk.delivery !== 'in_person') fail('invalid_input');
  const named =
    actor.id === talk.presenter_person_id && sameName(actor.display_name, talk.presenter_name);
  const onBehalf = manager(actor) && !sameName(actor.display_name, talk.presenter_name);
  if (!named && !onBehalf) fail('not_authorized');
  const version = bucket.versions.find((row) => row.id === input.versionId && row.talk_id === talk.id);
  if (!version || !version.is_current) fail('version_locked');
  if (bucket.signatures.some((row) => row.version_id === version.id && row.signature_role === 'presenter')) fail('already_signed');
  const person = people.find((row) => row.id === actor.id);
  const personName = label(person?.display_name || actor.display_name);
  return insertSignature(
    bucket,
    talk,
    version,
    actor,
    actor.id,
    personName,
    'presenter',
    input.signaturePng,
    input.deviceAt,
    input.sessionId,
    site.name,
    named ? meaningFor(talk, site.name, 'presenter') : meaningFor(talk, site.name, 'on_behalf', personName)
  );
}

export function fixtureListTalks(
  bucket: FixtureTalkBucket,
  actor: TalkActor,
  siteId: string,
  sites: TalkSite[],
  people: TalkPerson[],
  assignments: TalkAssignment[],
  canAccess: (siteId: string) => boolean
): TalkListItem[] {
  const site = requireSite(actor, sites.find((row) => row.id === siteId), canAccess(siteId));
  return bucket.talks
    .filter((talk) => talk.site_id === site.id && talk.company_id === actor.company_id)
    .filter((talk) => manager(actor) || actor.id === talk.presenter_person_id || isRequired(bucket, talk, actor.id, people, assignments))
    .map((talk) => listItem(bucket, actor, talk, people, assignments));
}

export function fixtureOutstanding(
  bucket: FixtureTalkBucket,
  actor: TalkActor,
  sites: TalkSite[],
  people: TalkPerson[],
  assignments: TalkAssignment[],
  canAccess: (siteId: string) => boolean
): TalkListItem[] {
  return bucket.talks
    .filter((talk) => talk.company_id === actor.company_id && canAccess(talk.site_id))
    .filter((talk) => sites.some((site) => site.id === talk.site_id))
    .filter((talk) => isRequired(bucket, talk, actor.id, people, assignments))
    .filter((talk) => !attendeeSigned(bucket, currentVersion(bucket, talk.id).id, actor.id))
    .map((talk) => listItem(bucket, actor, talk, people, assignments));
}

function signedRow(bucket: FixtureTalkBucket, row: SignatureRow, people: TalkPerson[]): TalkSignedRow {
  const note = noteFor(bucket, row.version_id, row.person_id);
  const question = questionFor(bucket, row.version_id, row.person_id);
  const person = people.find((item) => item.id === row.person_id);
  return {
    person_id: row.person_id,
    person_name: row.signature_role === 'presenter' ? row.person_name : row.person_name || label(person?.display_name),
    has_question: Boolean(question),
    question: question?.body ?? null,
    explained_verbally: note?.explained_verbally ?? false,
    interpreter_used: note?.interpreter_used ?? false,
    received_at: row.received_at,
    device_at: row.device_at,
    meaning: row.meaning,
    signature_png: row.signature_png,
    shared_device: row.shared_device,
    session_id: row.session_id,
    captured_by: row.captured_by,
    content_hash: row.content_hash,
  };
}

function registerFor(
  bucket: FixtureTalkBucket,
  talk: TalkRow,
  version: VersionRow,
  people: TalkPerson[],
  assignments: TalkAssignment[]
): TalkRegister {
  const ids = requiredIds(bucket, talk, people, assignments);
  const notSigned = ids
    .filter((id) => !attendeeSigned(bucket, version.id, id))
    .map((id) => {
      const person = people.find((row) => row.id === id);
      const note = noteFor(bucket, version.id, id);
      const question = questionFor(bucket, version.id, id);
      return {
        person_id: id,
        person_name: label(person?.display_name),
        has_question: Boolean(question),
        question: question?.body ?? null,
        explained_verbally: note?.explained_verbally ?? false,
        interpreter_used: note?.interpreter_used ?? false,
      };
    })
    .sort((a, b) => a.person_name.localeCompare(b.person_name));
  const signed = bucket.signatures
    .filter((row) => row.version_id === version.id && row.signature_role === 'attendee' && ids.includes(row.person_id))
    .sort((a, b) => a.received_at.localeCompare(b.received_at))
    .map((row) => signedRow(bucket, row, people));
  const presenter = bucket.signatures.find((row) => row.version_id === version.id && row.signature_role === 'presenter');
  const questions: TalkQuestionRow[] = bucket.questions
    .filter((row) => row.version_id === version.id)
    .map((row) => ({
      person_id: row.person_id,
      person_name: row.person_name,
      body: row.body,
      received_at: row.received_at,
    }));
  return {
    required_count: ids.length,
    signed_count: signed.length,
    not_signed: notSigned,
    signed,
    presenter_signature: presenter ? signedRow(bucket, presenter, people) : null,
    questions,
  };
}

export function fixtureTalkDetail(
  bucket: FixtureTalkBucket,
  actor: TalkActor,
  talkId: string,
  sites: TalkSite[],
  people: TalkPerson[],
  assignments: TalkAssignment[],
  canAccess: (siteId: string) => boolean,
  pdfUrl: (path: string) => { url: string; expiresAt: string } | null
): TalkDetail | null {
  const talk = bucket.talks.find((row) => row.id === talkId);
  if (!talk || talk.company_id !== actor.company_id) return null;
  const site = sites.find((row) => row.id === talk.site_id);
  if (!site || !canAccess(talk.site_id)) return null;
  if (!manager(actor) && actor.id !== talk.presenter_person_id && !isRequired(bucket, talk, actor.id, people, assignments)) {
    return null;
  }
  const version = currentVersion(bucket, talk.id);
  const signed = version.pdf_path ? pdfUrl(version.pdf_path) : null;
  const show = seesRegister(actor, talk);
  return {
    talk_id: talk.id,
    site_id: talk.site_id,
    site_name: site.name,
    company_id: talk.company_id,
    kind: talk.kind,
    delivery: talk.delivery,
    title: talk.title,
    body: version.body,
    pdf_path: version.pdf_path,
    pdf_url: signed?.url ?? null,
    pdf_url_expires_at: signed?.expiresAt ?? null,
    version_id: version.id,
    version_no: version.version_no,
    content_hash: version.content_hash,
    audience: talk.audience,
    presenter_person_id: talk.presenter_person_id,
    presenter_name: talk.presenter_name,
    presenter_role: talk.presenter_role,
    presented_at: talk.presented_at,
    attendee_meaning: meaningFor(talk, site.name, 'attendee'),
    mine_signed: attendeeSigned(bucket, version.id, actor.id),
    register: show ? registerFor(bucket, talk, version, people, assignments) : null,
  };
}

export function fixtureMeaningLine(
  bucket: FixtureTalkBucket,
  actor: TalkActor,
  talkId: string,
  personId: string,
  sites: TalkSite[],
  people: TalkPerson[],
  assignments: TalkAssignment[],
  canAccess: (siteId: string) => boolean
): string {
  const talk = bucket.talks.find((row) => row.id === talkId);
  if (!talk) fail('not_authorized');
  const site = requireSite(actor, sites.find((row) => row.id === talk.site_id), canAccess(talk.site_id));
  assertCapture(actor, talk, personId, people, assignments, bucket);
  return meaningFor(talk, site.name, 'attendee');
}

export function fixtureTalkBadges(
  bucket: FixtureTalkBucket,
  actor: TalkActor,
  sites: TalkSite[],
  people: TalkPerson[],
  assignments: TalkAssignment[],
  canAccess: (siteId: string) => boolean
): TalkBadge[] {
  const bySite = new Map<string, TalkBadge>();
  for (const site of sites) {
    if (site.company_id !== actor.company_id || !canAccess(site.id)) continue;
    const talks = bucket.talks.filter((talk) => talk.site_id === site.id);
    let outstanding = 0;
    let questions = 0;
    for (const talk of talks) {
      const version = currentVersion(bucket, talk.id);
      if (isRequired(bucket, talk, actor.id, people, assignments) && !attendeeSigned(bucket, version.id, actor.id)) {
        outstanding += 1;
      }
      if (manager(actor)) questions += bucket.questions.filter((row) => row.version_id === version.id).length;
    }
    if (outstanding < 1 && !(manager(actor) && questions > 0)) continue;
    bySite.set(site.id, { site_id: site.id, outstanding, questions: manager(actor) ? questions : null });
  }
  return [...bySite.values()];
}

export function fixtureInductionGaps(
  bucket: FixtureTalkBucket,
  actor: TalkActor,
  siteId: string,
  sites: TalkSite[],
  people: TalkPerson[],
  assignments: TalkAssignment[],
  openPersonIds: string[],
  canAccess: (siteId: string) => boolean
): InductionGap[] | null {
  if (!manager(actor)) return null;
  const site = requireSite(actor, sites.find((row) => row.id === siteId), canAccess(siteId));
  const gaps: InductionGap[] = [];
  for (const personId of openPersonIds) {
    const person = people.find((row) => row.id === personId);
    const unsigned = bucket.talks.some((talk) => {
      if (talk.site_id !== site.id || talk.kind !== 'induction') return false;
      if (!isRequired(bucket, talk, personId, people, assignments)) return false;
      return !attendeeSigned(bucket, currentVersion(bucket, talk.id).id, personId);
    });
    if (unsigned && person) gaps.push({ person_id: personId, person_name: label(person.display_name) });
  }
  return gaps.sort((a, b) => a.person_name.localeCompare(b.person_name));
}

/** Signatures kept on a version after a newer one is current. Tests use this. */
export function fixtureVersionSignatures(bucket: FixtureTalkBucket, versionId: string): SignatureRow[] {
  return bucket.signatures.filter((row) => row.version_id === versionId);
}

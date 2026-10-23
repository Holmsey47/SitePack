export type TalkKind = 'induction' | 'toolbox';
export type TalkDelivery = 'phone' | 'in_person';
export type TalkSignatureRole = 'attendee' | 'presenter' | 'on_behalf';

/** Inputs for the one wording function. The server stores the sentence it builds. */
export type TalkMeaningInput = {
  kind: TalkKind;
  delivery: TalkDelivery;
  signatureRole: TalkSignatureRole;
  siteName: string;
  title: string;
  presenterName: string;
  /** UK calendar date, for a toolbox talk given in person. */
  presentedOn: string;
  /** The manager signing the register for an absent presenter. */
  managerName?: string;
};

/**
 * The only wording for a signature.
 * Induction, a toolbox talk read on the phone, a toolbox talk given in person,
 * and the presenter sign-off each have one sentence.
 */
export function talkMeaning(input: TalkMeaningInput): string {
  const site = input.siteName.trim();
  const title = input.title.trim();
  const presenter = input.presenterName.trim();
  if (input.signatureRole === 'on_behalf') {
    const manager = (input.managerName ?? '').trim() || 'the site manager';
    return `signed by ${manager} for ${presenter}`;
  }
  if (input.signatureRole === 'presenter') return 'I gave this talk to the people listed.';
  if (input.kind === 'induction') {
    return `I've read and understood the site induction for ${site} and I'll follow it. If anything's unclear, I'll ask the site manager before starting work.`;
  }
  if (input.delivery === 'in_person') {
    return `I was at the toolbox talk '${title}' given by ${presenter} at ${site} on ${input.presentedOn}, and I understood it.`;
  }
  return `I've read and understood the toolbox talk '${title}' for ${site}.`;
}

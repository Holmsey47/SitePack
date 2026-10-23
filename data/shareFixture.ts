import { IDS } from '@/data/ids';
import { formatJoinCode, generateJoinCode } from '@/data/joinCodes';
import {
  SHARE_SECTION_DEFAULTS,
  shareCompanyKey,
  type ShareInviteCreated,
  type ShareInviteRow,
  type ShareSections,
  type SharedDrawing,
  type SharedInductionRow,
  type SharedSignInRow,
  type SharedSiteCard,
  type SharedSiteView,
  type SharedSnag,
  type SharedVariation,
  type SiteShareList,
  type SiteShareRow,
} from '@/data/sharing';

export const HARBOUR_SITE_ID = '99999999-9999-4999-8999-9999999999a1';
export const OLD_YARD_SITE_ID = '99999999-9999-4999-8999-9999999999a2';
export const SECTION_ERROR_SITE_ID = '99999999-9999-4999-8999-9999999999a3';

const ALL_SECTIONS: ShareSections = {
  drawings: true,
  variations: true,
  snags: true,
  sign_in: true,
  inductions: true,
};

type Invite = ShareInviteRow & { siteId: string; code: string };
type Share = SiteShareRow & { siteId: string };

let invites: Invite[] = [];
let shares: Share[] = [];

export function resetShareFixture() {
  invites = [
    {
      id: '99999999-9999-4999-8999-9999999999aa',
      siteId: IDS.oak,
      code: 'ABCD2345',
      guest_company_name: 'Main Contractor Ltd',
      expires_at: '2026-10-29T09:00:00.000Z',
      uses: 0,
      revoked_at: null,
      created_at: '2026-10-22T09:00:00.000Z',
      sections: { ...SHARE_SECTION_DEFAULTS, drawings: true },
    },
  ];
  shares = [
    {
      id: '99999999-9999-4999-8999-9999999999b1',
      siteId: IDS.oak,
      guest_company_id: '99999999-9999-4999-8999-9999999999c1',
      guest_company_name: 'Northbuild',
      redeemed_at: '2026-10-22T09:00:00.000Z',
      revoked_at: null,
      sections: { ...SHARE_SECTION_DEFAULTS, drawings: true, variations: true, snags: true },
    },
  ];
}

resetShareFixture();

function sectionsOf(share: { sections: ShareSections }): ShareSections {
  return { ...share.sections };
}

export function fixtureListSiteShares(siteId: string): SiteShareList {
  return {
    invites: invites.filter((row) => row.siteId === siteId).map(({ siteId: _site, code: _code, ...row }) => row),
    shares: shares
      .filter((row) => row.siteId === siteId)
      .map(({ siteId: _site, ...row }) => ({ ...row, sections: sectionsOf(row) })),
  };
}

export function fixtureCreateSiteShare(input: {
  siteId: string;
  siteName: string;
  guestCompanyName: string;
  sections: ShareSections;
  hostCompanyName: string;
}): ShareInviteCreated {
  const name = input.guestCompanyName.trim();
  if (!shareCompanyKey(name)) throw new Error('invalid_input');
  if (shareCompanyKey(name) === shareCompanyKey(input.hostCompanyName)) throw new Error('own_firm');
  const code = generateJoinCode();
  const row: Invite = {
    id: `99999999-9999-4999-8999-${Date.now().toString(16).slice(-12).padStart(12, 'a')}`,
    siteId: input.siteId,
    code,
    guest_company_name: name,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    uses: 0,
    revoked_at: null,
    created_at: new Date().toISOString(),
    sections: { ...input.sections },
  };
  invites = [row, ...invites];
  return {
    id: row.id,
    code: formatJoinCode(code),
    expires_at: row.expires_at,
    site_id: input.siteId,
    site_name: input.siteName,
    guest_company_name: name,
    sections: { ...input.sections },
  };
}

export function fixtureSetSiteShareSections(shareId: string, sections: ShareSections) {
  const share = shares.find((row) => row.id === shareId && !row.revoked_at);
  if (!share) throw new Error('share_revoked');
  share.sections = { ...sections };
}

export function fixtureRevokeSiteShare(shareId: string) {
  const share = shares.find((row) => row.id === shareId);
  if (!share) throw new Error('not_authorized');
  share.revoked_at = new Date().toISOString();
}

export function fixtureRevokeSiteShareInvite(inviteId: string) {
  const invite = invites.find((row) => row.id === inviteId);
  if (!invite || invite.revoked_at || invite.uses >= 1) throw new Error('not_authorized');
  invite.revoked_at = new Date().toISOString();
}

export function fixtureMySharedSites(): SharedSiteCard[] {
  return [
    {
      share_id: '99999999-9999-4999-8999-9999999999d1',
      site_id: HARBOUR_SITE_ID,
      site_name: 'Harbour Point',
      host_company_name: 'Host Build Ltd',
      cm_contact_name: 'Alex Reed',
      sections: { ...ALL_SECTIONS },
    },
    {
      share_id: '99999999-9999-4999-8999-9999999999d2',
      site_id: OLD_YARD_SITE_ID,
      site_name: 'Old yard',
      host_company_name: 'Host Build Ltd',
      cm_contact_name: 'Alex Reed',
      sections: { ...SHARE_SECTION_DEFAULTS, drawings: true },
    },
  ];
}

export function fixtureSharedSiteView(siteId: string): SharedSiteView {
  if (siteId === OLD_YARD_SITE_ID) throw new Error('share_revoked');
  if (siteId === SECTION_ERROR_SITE_ID) {
    return {
      site_id: siteId,
      site_name: 'Quay error',
      address_line: null,
      host_company_name: 'Host Build Ltd',
      cm_contact_name: 'Alex Reed',
      sections: { ...SHARE_SECTION_DEFAULTS, drawings: true },
    };
  }
  if (siteId !== HARBOUR_SITE_ID) throw new Error('not_shared');
  return {
    site_id: siteId,
    site_name: 'Harbour Point',
    address_line: '4 Quay Road',
    host_company_name: 'Host Build Ltd',
    cm_contact_name: 'Alex Reed',
    sections: { ...ALL_SECTIONS },
  };
}

export function fixtureSharedDrawings(siteId: string): SharedDrawing[] {
  if (siteId === OLD_YARD_SITE_ID) throw new Error('share_revoked');
  if (siteId === SECTION_ERROR_SITE_ID) throw new TypeError('Failed to fetch');
  if (siteId !== HARBOUR_SITE_ID) throw new Error('not_shared');
  return [
    {
      id: '99999999-9999-4999-8999-9999999999e1',
      title: 'Ground floor',
      sheet_number: 'A-101',
      revision: 'C',
      dated: '2026-10-01',
      level: 'GF',
      folder: 'Plans',
    },
  ];
}

export function fixtureSharedDrawingUrl(): { url: string; expires_in: number } {
  return { url: 'https://example.invalid/drawing.pdf', expires_in: 300 };
}

export function fixtureSharedVariations(siteId: string): SharedVariation[] {
  if (siteId !== HARBOUR_SITE_ID) throw new Error('section_off');
  return [
    {
      id: '99999999-9999-4999-8999-9999999999f1',
      vo_seq: 4,
      version_id: '99999999-9999-4999-8999-9999999999f2',
      title: 'Extra beads',
      description: 'Window reveals',
      level_area: 'L2',
      quantity_text: '12 m',
      status: 'Signed',
      signer_name: 'Łukasz Wójcik',
      signer_company: 'Northbuild',
    },
  ];
}

export function fixtureSharedSnags(siteId: string): SharedSnag[] {
  if (siteId !== HARBOUR_SITE_ID) throw new Error('section_off');
  return [
    {
      id: '99999999-9999-4999-8999-9999999999f3',
      snag_seq: 2,
      note: 'Crack by the door',
      level_area: 'GF',
      trade_label: 'dryliner',
      status: 'Open',
      raised_by_name: 'Łukasz Wójcik',
      raised_at: '2026-10-22T08:00:00.000Z',
      fixed_by_name: null,
    },
  ];
}

export function fixtureSharedSignIn(siteId: string): SharedSignInRow[] {
  if (siteId !== HARBOUR_SITE_ID) throw new Error('section_off');
  return [
    {
      id: '99999999-9999-4999-8999-9999999999b2',
      person_name: 'Łukasz Wójcik',
      in_at: '2026-10-22T08:00:00.000Z',
      out_at: '2026-10-22T16:30:00.000Z',
    },
  ];
}

export function fixtureSharedInductions(siteId: string): SharedInductionRow[] {
  if (siteId !== HARBOUR_SITE_ID) throw new Error('section_off');
  return [
    {
      talk_id: '99999999-9999-4999-8999-9999999999b3',
      title: 'Site induction',
      person_name: 'Łukasz Wójcik',
      meaning: 'I have read the induction.',
      received_at: '2026-10-22T08:05:00.000Z',
    },
  ];
}

export function fixtureRedeemSiteShare(code: string): { shareId: string; siteId: string; siteName: string } {
  if (!code.trim()) throw new Error('invalid_input');
  return { shareId: '99999999-9999-4999-8999-9999999999d1', siteId: HARBOUR_SITE_ID, siteName: 'Harbour Point' };
}

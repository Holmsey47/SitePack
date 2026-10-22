import { JOIN_WEB_ORIGIN, formatJoinCode, normalizeJoinCode } from '@/data/joinCodes';
import type { Role } from '@/data/types';

export type InviteSite = {
  id: string;
  name: string;
  archived_at: string | null;
};

export type InviteSiteChoice<T> =
  | { kind: 'none' }
  | { kind: 'one'; site: T }
  | { kind: 'many'; sites: T[] };

/** Working sites only. An archived site cannot take a new join code. */
export function manageableSites<T extends { archived_at: string | null }>(sites: T[]): T[] {
  return sites.filter((site) => site.archived_at == null);
}

/**
 * 0 sites: make one first. 1 site: it is already chosen. Several: the person picks.
 * Archived rows are left out before the count.
 */
export function inviteSiteChoice<T extends { archived_at: string | null }>(sites: T[]): InviteSiteChoice<T> {
  const open = manageableSites(sites);
  if (open.length === 0) return { kind: 'none' };
  if (open.length === 1) return { kind: 'one', site: open[0] };
  return { kind: 'many', sites: open };
}

export function inviteSitesFromPulse(
  rows: { site_id: string; name: string; archived_at: string | null }[],
): InviteSite[] {
  return rows.map((row) => ({ id: row.site_id, name: row.name, archived_at: row.archived_at }));
}

/** Owner and contracts manager only. An operative never gets these actions. */
export function inviteActionsForRole(role: Role | null | undefined): boolean {
  return role === 'owner' || role === 'cm';
}

/** Web Share is hidden when the browser has no navigator.share. Native always has the sheet. */
export function showShareAction(platform: 'web' | 'native', navigatorShare: boolean): boolean {
  return platform === 'native' || navigatorShare;
}

/** Compact code in the path. The join page strips dashes itself, this link does not rely on that. */
export function joinCodeLink(code: string, origin: string = JOIN_WEB_ORIGIN): string {
  const compact = normalizeJoinCode(code);
  return `${origin.replace(/\/$/, '')}/join/${compact}`;
}

/** Plain words for WhatsApp. Two spaces before Code, matching the share card. */
export function whatsAppJoinMessage(input: { site: string; code: string; origin?: string }): string {
  const link = joinCodeLink(input.code, input.origin);
  const display = formatJoinCode(input.code);
  return `Join ${input.site} on SitePack to see the drawings: ${link}  Code: ${display}`;
}

export function whatsAppShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/**
 * Web tries a new tab first. Linking.openURL on web replaces this page, so it is the fallback.
 * Native always uses openURL.
 */
export async function openJoinWhatsApp(
  shareUrl: string,
  platform: 'web' | 'native',
  bridge: {
    openWindow?: (url: string) => boolean;
    openURL: (url: string) => Promise<unknown>;
  },
): Promise<void> {
  if (platform === 'web' && bridge.openWindow?.(shareUrl)) return;
  await bridge.openURL(shareUrl);
}

/**
 * Clipboard module first. On web, a false or thrown result falls back to navigator.clipboard.writeText.
 * The link is not written to the console.
 */
export async function copyJoinLink(
  link: string,
  bridge: {
    setString?: (value: string) => Promise<boolean>;
    writeText?: (value: string) => Promise<void>;
  },
): Promise<void> {
  if (bridge.setString) {
    try {
      const ok = await bridge.setString(link);
      if (ok !== false) return;
    } catch {
      // The web clipboard module can fail closed. The browser API is the fallback.
    }
  }
  if (bridge.writeText) {
    await bridge.writeText(link);
    return;
  }
  throw new Error('copy_failed');
}

export const SHARE_FAILED_TEXT = 'Use Share on WhatsApp or Copy link.';
export const COPY_FAILED_TEXT = 'Could not copy the link.';
export const COPIED_CONFIRMATION_MS = 2000;

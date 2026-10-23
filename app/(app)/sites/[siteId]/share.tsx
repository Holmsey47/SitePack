import { Button, Card, Field, Muted, Screen, SeenRejectNotice, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import {
  SHARE_COMPANY_PLACEHOLDER,
  SHARE_SECTION_DEFAULTS,
  classifyShareFailure,
  pendingInviteLabel,
  pendingShareInvites,
  pendingShareRequestLabel,
  shareFailureNotice,
  shareRenameNote,
  sharedSectionLine,
  stopSharingBody,
  type ShareInviteRow,
  type ShareSections,
  type SiteShareRow,
} from '@/data/sharing';
import { formatUkDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

const SECTION_ROWS: { key: keyof ShareSections; label: string; hint: string }[] = [
  { key: 'drawings', label: 'Drawings', hint: 'Current revisions only' },
  { key: 'variations', label: 'Variations', hint: 'Signed and sent only. Drafts stay hidden' },
  { key: 'snags', label: 'Snags report', hint: 'The snag list' },
  { key: 'sign_in', label: 'Sign-in register', hint: 'Off unless you turn it on' },
  { key: 'inductions', label: 'Inductions register', hint: 'Off unless you turn it on' },
];

export default function ShareSiteScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [company, setCompany] = useState('');
  const [sections, setSections] = useState<ShareSections>({ ...SHARE_SECTION_DEFAULTS });
  const [shares, setShares] = useState<SiteShareRow[]>([]);
  const [invites, setInvites] = useState<ShareInviteRow[]>([]);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SiteShareRow | null>(null);
  const [cancelInvite, setCancelInvite] = useState<ShareInviteRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const owner = person?.role === 'owner';
  const manage = person ? canManageSite(person.role) : false;

  const load = useCallback(() => {
    if (!siteId || !manage) return;
    repo
      .listSiteShares(siteId)
      .then((list) => {
        const nextInvites = pendingShareInvites(list.invites);
        setShares(list.shares.filter((row) => !row.revoked_at && row.status !== 'declined'));
        setInvites(nextInvites);
        if (nextInvites.length === 0) setFormOpen(true);
      })
      .catch((error: unknown) => setNotice(shareFailureNotice(classifyShareFailure(error))));
  }, [manage, siteId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (person && !manage) return <Redirect href={siteId ? `/sites/${siteId}` : '/sites'} />;

  const waiting = shares.filter((row) => row.status === 'pending');
  const open = shares.filter((row) => row.status === 'approved');

  function flip(key: keyof ShareSections) {
    setSections((current) => ({ ...current, [key]: !current[key] }));
  }

  async function onCreate() {
    if (!siteId) return;
    setLoading(true);
    setNotice('');
    try {
      const created = await repo.createSiteShareInvite({
        siteId,
        guestCompanyName: company,
        sections,
      });
      setCompany('');
      setSections({ ...SHARE_SECTION_DEFAULTS });
      setFormOpen(false);
      router.push({
        pathname: '/sites/[siteId]/share-code',
        params: {
          siteId,
          code: created.code,
          expires: created.expires_at,
          firm: created.guest_company_name,
          siteName: created.site_name,
          sections: JSON.stringify(created.sections),
        },
      });
    } catch (error) {
      setNotice(shareFailureNotice(classifyShareFailure(error)));
    } finally {
      setLoading(false);
    }
  }

  async function onToggleShare(share: SiteShareRow, key: keyof ShareSections) {
    const next = { ...share.sections, [key]: !share.sections[key] };
    setNotice('');
    try {
      await repo.setSiteShareSections(share.id, next);
      setShares((rows) => rows.map((row) => (row.id === share.id ? { ...row, sections: next } : row)));
    } catch (error) {
      setNotice(shareFailureNotice(classifyShareFailure(error)));
    }
  }

  async function onApprove(share: SiteShareRow) {
    setNotice('');
    try {
      await repo.approveSiteShare(share.id);
      load();
    } catch (error) {
      setNotice(shareFailureNotice(classifyShareFailure(error)));
    }
  }

  async function onDecline(share: SiteShareRow) {
    setNotice('');
    try {
      await repo.declineSiteShare(share.id);
      load();
    } catch (error) {
      setNotice(shareFailureNotice(classifyShareFailure(error)));
    }
  }

  async function onRevoke() {
    if (!revokeTarget) return;
    setNotice('');
    try {
      await repo.revokeSiteShare(revokeTarget.id);
      setRevokeTarget(null);
      load();
    } catch (error) {
      setNotice(shareFailureNotice(classifyShareFailure(error)));
    }
  }

  async function onCancelInvite() {
    if (!cancelInvite) return;
    setNotice('');
    try {
      await repo.revokeSiteShareInvite(cancelInvite.id);
      setCancelInvite(null);
      load();
    } catch (error) {
      setNotice(shareFailureNotice(classifyShareFailure(error)));
    }
  }

  return (
    <Screen>
      <Title>Share with main contractor</Title>
      <Muted>One site, one company, view only. Opening a code asks you to approve it. Nothing is shared until you do.</Muted>

      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>APPROVAL NEEDED</Text>
      {waiting.length === 0 ? <Muted>No one is waiting.</Muted> : null}
      {waiting.map((share) => {
        const renamed = shareRenameNote(share);
        return (
          <Card key={share.id}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{pendingShareRequestLabel(share)}</Text>
            <Muted>{sharedSectionLine(share.sections)}</Muted>
            {share.code_expires_at ? <Muted>{`Expires ${formatUkDateTime(share.code_expires_at)}`}</Muted> : null}
            {renamed ? <Muted>{renamed}</Muted> : null}
            <Button label="Approve" minHeight={56} onPress={() => void onApprove(share)} />
            <Button label="Decline" variant="danger" minHeight={56} onPress={() => void onDecline(share)} />
          </Card>
        );
      })}

      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>WHO HAS ACCESS</Text>
      {open.length === 0 ? <Muted>No company has this site.</Muted> : null}
      {open.map((share) => {
        const renamed = shareRenameNote(share);
        return (
          <Card key={share.id}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{share.guest_company_name}</Text>
            <Muted>{`Redeemer: ${share.redeemer_name}`}</Muted>
            <Muted>{`Approved by ${share.approved_by_name ?? 'the host'}${share.approved_at ? ` on ${formatUkDateTime(share.approved_at)}` : ''}`}</Muted>
            {renamed ? <Muted>{renamed}</Muted> : null}
            <Muted>{sharedSectionLine(share.sections)}</Muted>
            {owner
              ? SECTION_ROWS.map((row) => (
                  <Pressable
                    key={row.key}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: share.sections[row.key] }}
                    onPress={() => void onToggleShare(share, row.key)}
                    style={{ minHeight: 48, justifyContent: 'center' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: theme.text, fontSize: 16 }}>{row.label}</Text>
                      <Text style={{ color: share.sections[row.key] ? theme.current : theme.muted, fontWeight: '800' }}>
                        {share.sections[row.key] ? 'On' : 'Off'}
                      </Text>
                    </View>
                  </Pressable>
                ))
              : null}
            <Button label="Stop sharing" variant="danger" minHeight={56} onPress={() => setRevokeTarget(share)} />
            {revokeTarget?.id === share.id ? (
              <View>
                <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>
                  {`Stop sharing with ${share.guest_company_name}?`}
                </Text>
                <Muted>{stopSharingBody(share.sections)}</Muted>
                <Button label="Stop sharing" variant="danger" minHeight={56} onPress={() => void onRevoke()} />
                <Button label="Keep sharing" variant="secondary" minHeight={48} onPress={() => setRevokeTarget(null)} />
              </View>
            ) : null}
          </Card>
        );
      })}

      {owner ? (
        <>
          <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>PENDING CODES</Text>
          {invites.length === 0 ? <Muted>No unused codes.</Muted> : null}
          {invites.map((invite) => (
            <Card key={invite.id}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{invite.guest_company_name}</Text>
              <Muted>{sharedSectionLine(invite.sections)}</Muted>
              <Muted>{pendingInviteLabel(invite)}</Muted>
              {new Date(invite.expires_at).getTime() > Date.now() ? (
                <Muted>{`Expires ${formatUkDateTime(invite.expires_at)}`}</Muted>
              ) : null}
              <Button label="Cancel" variant="danger" minHeight={56} onPress={() => setCancelInvite(invite)} />
            </Card>
          ))}
          {cancelInvite ? (
            <Card>
              <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>
                {`Cancel the code for ${cancelInvite.guest_company_name}?`}
              </Text>
              <Muted>The code stops working. Nothing has been shared with them yet.</Muted>
              <Button label="Cancel code" variant="danger" minHeight={56} onPress={() => void onCancelInvite()} />
              <Button label="Keep code" variant="secondary" minHeight={48} onPress={() => setCancelInvite(null)} />
            </Card>
          ) : null}
          {formOpen ? (
            <>
              <Field
                label="Their company"
                value={company}
                onChangeText={setCompany}
                autoCapitalize="words"
                placeholder={SHARE_COMPANY_PLACEHOLDER}
              />
              {SECTION_ROWS.map((row) => (
                <Pressable
                  key={row.key}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: sections[row.key] }}
                  accessibilityLabel={`${row.label} ${sections[row.key] ? 'on' : 'off'}`}
                  onPress={() => flip(row.key)}
                  style={{ minHeight: 48, justifyContent: 'center' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                    <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>{row.label}</Text>
                    <Text style={{ color: sections[row.key] ? theme.current : theme.muted, fontSize: 17, fontWeight: '800' }}>
                      {sections[row.key] ? 'On' : 'Off'}
                    </Text>
                  </View>
                  <Muted>{row.hint}</Muted>
                </Pressable>
              ))}
              <Button label="Create share code" onPress={() => void onCreate()} loading={loading} minHeight={56} />
            </>
          ) : (
            <Button
              label="New share code"
              minHeight={56}
              onPress={() => {
                setCompany('');
                setSections({ ...SHARE_SECTION_DEFAULTS });
                setFormOpen(true);
              }}
            />
          )}
        </>
      ) : null}

      {notice ? <SeenRejectNotice message={notice} onDismiss={() => setNotice('')} /> : null}
    </Screen>
  );
}

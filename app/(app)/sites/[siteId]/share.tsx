import { Button, Card, Field, Muted, Screen, SeenRejectNotice, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import {
  SHARE_COMPANY_PLACEHOLDER,
  SHARE_SECTION_DEFAULTS,
  classifyShareFailure,
  pendingShareInvites,
  shareFailureNotice,
  type ShareInviteRow,
  type ShareSections,
  type SiteShareRow,
} from '@/data/sharing';
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

function sectionLine(sections: ShareSections): string {
  const on = SECTION_ROWS.filter((row) => sections[row.key]).map((row) => row.label);
  return on.length > 0 ? on.join(', ') : 'No sections yet';
}

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
  const [pending, setPending] = useState<SiteShareRow | null>(null);
  const [cancelInvite, setCancelInvite] = useState<ShareInviteRow | null>(null);

  const load = useCallback(() => {
    if (!siteId || person?.role !== 'owner') return;
    repo
      .listSiteShares(siteId)
      .then((list) => {
        setShares(list.shares.filter((row) => !row.revoked_at));
        setInvites(pendingShareInvites(list.invites));
      })
      .catch((error: unknown) => setNotice(shareFailureNotice(classifyShareFailure(error))));
  }, [person?.role, siteId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (person && person.role !== 'owner') return <Redirect href={siteId ? `/sites/${siteId}` : '/sites'} />;

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
      router.push({
        pathname: '/sites/[siteId]/share-code',
        params: {
          siteId,
          code: created.code,
          expires: created.expires_at,
          firm: created.guest_company_name,
          siteName: created.site_name,
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

  async function onRevoke() {
    if (!pending) return;
    setNotice('');
    try {
      await repo.revokeSiteShare(pending.id);
      setPending(null);
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
      <Muted>One site, one company, view only. The code lasts 7 days and works once. Nothing is shared until you turn a section on.</Muted>

      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>PENDING CODES</Text>
      {invites.length === 0 ? <Muted>No unused codes.</Muted> : null}
      {invites.map((invite) => (
        <Card key={invite.id}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{invite.guest_company_name}</Text>
          <Muted>Unused. Cancel it if you do not want it opened.</Muted>
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
      {notice ? <SeenRejectNotice message={notice} onDismiss={() => setNotice('')} /> : null}
      <Button label="Create share code" onPress={() => void onCreate()} loading={loading} minHeight={56} />

      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>SHARED NOW</Text>
      {shares.length === 0 ? <Muted>No company has this site.</Muted> : null}
      {shares.map((share) => (
        <Card key={share.id}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{share.guest_company_name}</Text>
          <Muted>{sectionLine(share.sections)}</Muted>
          {SECTION_ROWS.map((row) => (
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
          ))}
          <Button label="Revoke" variant="danger" minHeight={56} onPress={() => setPending(share)} />
        </Card>
      ))}

      {pending ? (
        <Card>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>
            {`Revoke access for ${pending.guest_company_name}?`}
          </Text>
          <Muted>They lose this site on their next open. Their copy of it is wiped.</Muted>
          <Button label="Revoke access" variant="danger" minHeight={56} onPress={() => void onRevoke()} />
          <Button label="Keep sharing" variant="secondary" minHeight={48} onPress={() => setPending(null)} />
        </Card>
      ) : null}
    </Screen>
  );
}

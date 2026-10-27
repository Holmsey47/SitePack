import { CompanyLogoEditor } from '@/components/CompanyLogo';
import { Icon } from '@/components/icon';
import { Button, Card, Muted, Screen, SectionLabel } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import type { PulseRow } from '@/data/types';
import { archivedRows, RESTORE_SITE_CONFIRM } from '@/data/walk';
import { hit, logo, space, textStyle, theme } from '@/lib/theme';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

/** Company settings. Owners edit the mark. Everyone can sign out from the bottom of the list. */
export default function CompanyScreen() {
  const { person, signOut } = useAuth();
  const router = useRouter();
  if (!person) return <Redirect href="/sites" />;
  if (person.role !== 'owner') {
    return <MemberCompany showMembers={person.role === 'cm'} onSignOut={() => void signOut()} onMembers={() => router.push('/people')} />;
  }

  return (
    <Screen>
      <OwnerList onMembers={() => router.push('/people')} onSignOut={() => void signOut()} />
      <ArchivedSites />
    </Screen>
  );
}

function MemberCompany({
  showMembers,
  onMembers,
  onSignOut,
}: {
  showMembers: boolean;
  onMembers: () => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      repo
        .companyName()
        .then((next) => {
          if (active) setName(next);
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <Screen>
      <SettingsRow label="Name" value={name || 'Company'} />
      {showMembers ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Members" onPress={onMembers} style={rowStyle}>
          <Text style={[textStyle.bodyStrong, { flex: 1 }]}>Members</Text>
          <Icon name="chevron_right" color={theme.muted} />
        </Pressable>
      ) : null}
      <SignOutRow confirm={confirm} setConfirm={setConfirm} onSignOut={onSignOut} />
    </Screen>
  );
}

function OwnerList({ onMembers, onSignOut }: { onMembers: () => void; onSignOut: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <View style={{ gap: space.md }}>
      <CompanyLogoEditor />
      <Pressable accessibilityRole="button" accessibilityLabel="Members" onPress={onMembers} style={rowStyle}>
        <Text style={[textStyle.bodyStrong, { flex: 1 }]}>Members</Text>
        <Icon name="chevron_right" color={theme.muted} />
      </Pressable>
      <SignOutRow confirm={confirm} setConfirm={setConfirm} onSignOut={onSignOut} />
    </View>
  );
}

function SignOutRow({
  confirm,
  setConfirm,
  onSignOut,
}: {
  confirm: boolean;
  setConfirm: (value: boolean) => void;
  onSignOut: () => void;
}) {
  if (!confirm) {
    return (
      <View style={{ marginTop: space.xl }}>
        <Button label="Sign out" variant="ghost" onPress={() => setConfirm(true)} />
      </View>
    );
  }
  return (
    <View style={{ gap: space.md, marginTop: space.xl }}>
      <Text style={textStyle.bodyStrong}>Sign out of SitePack?</Text>
      <Button label="Sign out" variant="danger" onPress={onSignOut} />
      <Button label="Cancel" variant="secondary" onPress={() => setConfirm(false)} />
    </View>
  );
}

function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={rowStyle}>
      <View
        style={{
          width: logo.company,
          height: logo.company,
          borderRadius: 8,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.line,
        }}
      />
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={textStyle.metaStrong}>{label}</Text>
        <Text style={textStyle.bodyStrong}>{value}</Text>
      </View>
    </View>
  );
}

const rowStyle = {
  minHeight: hit.secondary,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: space.md,
  paddingVertical: space.sm,
};

function ArchivedSites() {
  const [rows, setRows] = useState<PulseRow[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    repo
      .companySitesPulse()
      .then((next) => {
        setRows(archivedRows(next));
        setError('');
      })
      .catch(() => setError('Could not load archived sites.'));
    void repo.sweepDrawingOrphans().catch(() => undefined);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={{ gap: space.md }}>
      <SectionLabel>Archived sites</SectionLabel>
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
      {rows.length === 0 && !error ? (
        <EmptyArchived />
      ) : null}
      {rows.map((site) => (
        <Card key={site.site_id}>
          <Text style={textStyle.bodyStrong}>{site.name}</Text>
          {site.address_line ? <Muted>{site.address_line}</Muted> : null}
          {confirmId === site.site_id ? (
            <View style={{ gap: space.sm }}>
              <Text style={textStyle.body}>{site.name}</Text>
              <Text style={textStyle.body}>{RESTORE_SITE_CONFIRM}</Text>
              <Button
                label="Restore"
                variant="secondary"
                minHeight={48}
                onPress={() => {
                  void repo
                    .archiveSite(site.site_id, false)
                    .then(() => {
                      setConfirmId(null);
                      load();
                    })
                    .catch(() => setError('Could not restore the site.'));
                }}
              />
              <Button label="Cancel" variant="ghost" minHeight={48} onPress={() => setConfirmId(null)} />
            </View>
          ) : (
            <Button label="Restore" variant="secondary" minHeight={48} onPress={() => setConfirmId(site.site_id)} />
          )}
        </Card>
      ))}
    </View>
  );
}

function EmptyArchived() {
  return (
    <View style={{ gap: space.sm, paddingVertical: space.md }}>
      <Icon name="inventory_2" color={theme.muted} />
      <Muted>No archived sites.</Muted>
    </View>
  );
}

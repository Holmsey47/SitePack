import { CompanyLogoEditor } from '@/components/CompanyLogo';
import { Button, Card, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import type { PulseRow } from '@/data/types';
import { archivedRows, RESTORE_SITE_CONFIRM } from '@/data/walk';
import { theme } from '@/lib/theme';
import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

/** Owner only. Members who open this route go back to Sites. */
export default function CompanyScreen() {
  const { person } = useAuth();
  if (!person || person.role !== 'owner') return <Redirect href="/sites" />;

  return (
    <Screen>
      <Title>Company</Title>
      <CompanyLogoEditor />
      <ArchivedSites />
    </Screen>
  );
}

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
    <View style={{ gap: 12 }}>
      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>Archived sites</Text>
      {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
      {rows.length === 0 && !error ? <Muted>No archived sites.</Muted> : null}
      {rows.map((site) => (
        <Card key={site.site_id}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{site.name}</Text>
          {site.address_line ? <Muted>{site.address_line}</Muted> : null}
          {confirmId === site.site_id ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{RESTORE_SITE_CONFIRM}</Text>
              <Button
                label="Restore site"
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

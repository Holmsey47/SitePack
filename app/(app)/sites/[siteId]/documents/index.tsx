import { Button, Card, EmptyState, ErrorText, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { siteDocumentKindLabel, type SiteDocumentSummary } from '@/data/siteDocuments';
import { theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

export default function SiteDocumentsScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<SiteDocumentSummary[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const owner = person?.role === 'owner';

  const load = useCallback(async () => {
    if (!siteId) return;
    const next = await repo.listSiteDocuments(siteId);
    setRows(next);
    setLoaded(true);
    setError('');
  }, [siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load documents.'));
    }, [load]),
  );

  return (
    <Screen>
      <Title>Induction & RAMS</Title>
      <ErrorText>{error}</ErrorText>
      {owner ? (
        <Button
          label="Upload document"
          minHeight={48}
          onPress={() => router.push(`/sites/${siteId}/documents/new`)}
        />
      ) : null}
      {loaded && !error && rows.length === 0 ? <EmptyState title="No documents yet" /> : null}
      {rows.map((row) => {
        const status = owner ? `Version ${row.version_no}` : row.signed_by_me ? 'Signed' : 'To sign';
        return (
          <Card key={row.id} onPress={() => router.push(`/sites/${siteId}/documents/${row.id}`)}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>{row.title}</Text>
            <Muted>{siteDocumentKindLabel(row.kind)}</Muted>
            <Text style={{ color: row.signed_by_me || owner ? theme.text : theme.danger, fontSize: 18, fontWeight: '800' }}>
              {status}
            </Text>
          </Card>
        );
      })}
    </Screen>
  );
}

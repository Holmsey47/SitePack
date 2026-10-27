import { Button, Card, EmptyState, ErrorText, Muted, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { siteDocumentKindLabel, type SiteDocumentSummary } from '@/data/siteDocuments';
import { textStyle, theme } from '@/lib/theme';
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
      <ErrorText>{error}</ErrorText>
      {owner && rows.length > 0 ? (
        <Button
          label="Upload document"
          variant="secondary"
          minHeight={48}
          onPress={() => router.push(`/sites/${siteId}/documents/new`)}
        />
      ) : null}
      {loaded && !error && rows.length === 0 ? (
        <EmptyState
          icon="description"
          title="Inductions, toolbox talks and RAMS show up here"
          action={
            owner ? (
              <Button label="Upload document" onPress={() => router.push(`/sites/${siteId}/documents/new`)} />
            ) : undefined
          }
        />
      ) : null}
      {rows.map((row) => {
        const status = row.archived_at ? 'Archived' : owner ? `Version ${row.version_no}` : row.signed_by_me ? 'Signed' : 'To sign';
        return (
          <Card key={row.id} onPress={() => router.push(`/sites/${siteId}/documents/${row.id}`)}>
            <Text style={{ ...textStyle.bodyStrong }}>{row.title}</Text>
            <Muted>{siteDocumentKindLabel(row.kind)}</Muted>
            <Text style={{ ...textStyle.bodyStrong, color: row.signed_by_me || owner ? theme.text : theme.danger }}>
              {status}
            </Text>
          </Card>
        );
      })}
    </Screen>
  );
}

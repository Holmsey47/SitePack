import { Button, Card, ChoiceChip, EmptyState, ErrorText, Muted, Screen, Title } from '@/components/ui';
import { repo } from '@/data/index';
import { filterVariations, variationError, variationNumber, type VariationFilter, type VariationList } from '@/data/variations';
import { deviceIsOnline, getVariationQueue, SAVED_ON_PHONE, type QueuedVariation } from '@/lib/variationQueue';
import { sendQueuedVariation } from '@/lib/sendQueuedVariation';
import { theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

const FILTERS: VariationFilter[] = ['All', 'Draft', 'Signed', 'Sent'];

export default function VariationsScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const router = useRouter();
  const [list, setList] = useState<VariationList | null>(null);
  const [queued, setQueued] = useState<QueuedVariation[]>([]);
  const [filter, setFilter] = useState<VariationFilter>('All');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!siteId) return;
    const pending = (await getVariationQueue().list()).filter((item) => item.siteId === siteId);
    setQueued(pending);
    if (pending.length > 0 && (await deviceIsOnline())) {
      for (const item of pending) {
        try {
          await sendQueuedVariation(item);
          await getVariationQueue().remove(item.localId);
        } catch {
          break;
        }
      }
      setQueued((await getVariationQueue().list()).filter((item) => item.siteId === siteId));
    }
    try {
      setList(await repo.listVariations(siteId));
      setError('');
    } catch (err) {
      setError(variationError(err instanceof Error ? err.message : 'unknown'));
    }
  }, [siteId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setError('Could not load variations.'));
    }, [load])
  );

  const rows = list ? filterVariations(list.rows, filter) : [];

  return (
    <Screen>
      <Title>Variations</Title>
      {list ? (
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
          {list.open_count} open · {list.signed_count} signed
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {FILTERS.map((item) => (
          <ChoiceChip key={item} label={item} selected={filter === item} onPress={() => setFilter(item)} />
        ))}
      </View>
      {queued.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.currentInk, backgroundColor: theme.current, fontWeight: '800', padding: 12, borderRadius: 12 }}>
            {SAVED_ON_PHONE}
          </Text>
          {queued.map((item) => (
            <Card key={item.localId}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>{item.title}</Text>
              <Muted>
                {item.photos.length} photo{item.photos.length === 1 ? '' : 's'} on this phone
              </Muted>
            </Card>
          ))}
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {list && rows.length === 0 && queued.length === 0 ? (
        <EmptyState title="No variations yet" />
      ) : (
        rows.map((row) => (
          <Card key={row.variation_id} onPress={() => router.push(`/sites/${siteId}/variations/${row.variation_id}`)}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
              {variationNumber(row.vo_seq)} · {row.title}
            </Text>
            <Muted>
              {row.status} · {row.photo_count} photo{row.photo_count === 1 ? '' : 's'}
            </Muted>
          </Card>
        ))
      )}
      <Button
        label="New variation"
        minHeight={56}
        onPress={() => router.push(`/sites/${siteId}/variations/new`)}
      />
    </Screen>
  );
}

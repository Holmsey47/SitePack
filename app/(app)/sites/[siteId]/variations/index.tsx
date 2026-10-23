import { Button, Card, ChoiceChip, EmptyState, ErrorText, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canSeeVariationValue, filterVariations, variationError, variationNumber, type VariationFilter, type VariationList } from '@/data/variations';
import { variationListAmount } from '@/lib/variationWording';
import { deviceIsOnline, flushVariationQueue, SAVED_ON_PHONE, type QueuedVariation } from '@/lib/variationQueue';
import { sendQueuedVariation } from '@/lib/sendQueuedVariation';
import { theme } from '@/lib/theme';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

const FILTERS: VariationFilter[] = ['All', 'Draft', 'Signed', 'Sent'];

export default function VariationsScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const seeValue = person ? canSeeVariationValue(person.role) : false;
  const router = useRouter();
  const [list, setList] = useState<VariationList | null>(null);
  const [queued, setQueued] = useState<QueuedVariation[]>([]);
  const [filter, setFilter] = useState<VariationFilter>('All');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const userId = person?.auth_user_id;
    if (!siteId || !userId) return;
    const pending = await flushVariationQueue(userId, siteId, await deviceIsOnline(), sendQueuedVariation);
    setQueued(pending);
    try {
      setList(await repo.listVariations(siteId));
      setError('');
    } catch (err) {
      setError(variationError(err instanceof Error ? err.message : 'unknown'));
    }
  }, [person, siteId]);

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
        rows.map((row) => {
          const pounds = variationListAmount(row, seeValue);
          return (
          <Card key={row.variation_id} onPress={() => router.push(`/sites/${siteId}/variations/${row.variation_id}`)}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
              {variationNumber(row.vo_seq)} · {row.title}
            </Text>
            <Muted>
              {row.status} · {row.photo_count} photo{row.photo_count === 1 ? '' : 's'}
              {pounds ? ` · ${pounds}` : ''}
            </Muted>
          </Card>
          );
        })
      )}
      <Button
        label="New variation"
        minHeight={56}
        onPress={() => router.push(`/sites/${siteId}/variations/new`)}
      />
    </Screen>
  );
}

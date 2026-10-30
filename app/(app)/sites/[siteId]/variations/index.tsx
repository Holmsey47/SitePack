import { Button, Card, EmptyState, ErrorText, FilterBar, Muted, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canSeeVariationValue, filterVariations, variationError, variationNumber, type VariationFilter, type VariationList } from '@/data/variations';
import { variationListAmount } from '@/lib/variationWording';
import { deviceIsOnline, flushVariationQueue, SAVED_ON_PHONE, type QueuedVariation } from '@/lib/variationQueue';
import { sendQueuedVariation } from '@/lib/sendQueuedVariation';
import { markSiteListSeen } from '@/lib/siteListSeenSync';
import { textStyle, theme } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

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
    const seen = markSiteListSeen(siteId, 'variations');
    const pending = await flushVariationQueue(userId, siteId, await deviceIsOnline(), sendQueuedVariation);
    setQueued(pending);
    try {
      setList(await repo.listVariations(siteId));
      setError('');
      await seen;
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
      {list ? (
        <Text style={textStyle.metaStrong}>
          {list.open_count} open · {list.signed_count} signed
        </Text>
      ) : null}
      <FilterBar
        chips={FILTERS.map((item) => ({
          key: item,
          label: item,
          selected: filter === item,
          onPress: () => setFilter(item),
        }))}
        narrowed={filter !== 'All'}
        shown={rows.length}
        total={list?.rows.length ?? 0}
        noun="variations"
        onClear={() => setFilter('All')}
      />
      {queued.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={{ ...textStyle.bodyStrong, backgroundColor: theme.surface, padding: 12, borderRadius: 12 }}>
            {SAVED_ON_PHONE}
          </Text>
          {queued.map((item) => (
            <Card key={item.localId}>
              <Text style={{ ...textStyle.bodyStrong }}>{item.title}</Text>
              <Muted>
                {item.photos.length} photo{item.photos.length === 1 ? '' : 's'} on this phone
              </Muted>
            </Card>
          ))}
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {list && rows.length === 0 && queued.length === 0 ? (
        <EmptyState
          icon="compare_arrows"
          title="Variations for this site show up here"
          action={<Button label="New variation" onPress={() => router.push(`/sites/${siteId}/variations/new`)} />}
        />
      ) : (
        rows.map((row) => {
          const pounds = variationListAmount(row, seeValue);
          return (
          <Card key={row.variation_id} onPress={() => router.push(`/sites/${siteId}/variations/${row.variation_id}`)}>
            <Text style={{ ...textStyle.bodyStrong }}>
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
      {list && rows.length === 0 && queued.length === 0 ? null : (
        <Button label="New variation" minHeight={56} onPress={() => router.push(`/sites/${siteId}/variations/new`)} />
      )}
    </Screen>
  );
}

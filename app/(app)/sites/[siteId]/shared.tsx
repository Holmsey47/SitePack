import { Card, Muted, Screen, SeenRejectNotice, Title } from '@/components/ui';
import { repo } from '@/data/index';
import {
  accessRemovedMessage,
  classifyShareFailure,
  shareFailureNotice,
  withShareRetry,
  type SharedDrawing,
  type SharedSiteView,
  type SharedSnag,
  type SharedVariation,
} from '@/data/sharing';
import { forgetSharedSite } from '@/lib/forgetShare';
import { theme } from '@/lib/theme';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

export default function SharedSiteScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const [view, setView] = useState<SharedSiteView | null>(null);
  const [drawings, setDrawings] = useState<SharedDrawing[]>([]);
  const [variations, setVariations] = useState<SharedVariation[]>([]);
  const [snags, setSnags] = useState<SharedSnag[]>([]);
  const [removed, setRemoved] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setNotice('');
    try {
      const next = await withShareRetry(() => repo.sharedSiteView(siteId));
      const [nextDrawings, nextVariations, nextSnags] = await Promise.all([
        next.sections.drawings ? withShareRetry(() => repo.sharedDrawings(siteId)).catch(() => []) : Promise.resolve([]),
        next.sections.variations ? withShareRetry(() => repo.sharedVariations(siteId)).catch(() => []) : Promise.resolve([]),
        next.sections.snags ? withShareRetry(() => repo.sharedSnags(siteId)).catch(() => []) : Promise.resolve([]),
      ]);
      setView(next);
      setDrawings(nextDrawings);
      setVariations(nextVariations);
      setSnags(nextSnags);
      setRemoved(false);
    } catch (error) {
      const failure = classifyShareFailure(error);
      setView(null);
      if (failure.kind === 'business' && failure.code === 'share_revoked') {
        await forgetSharedSite(siteId);
        setRemoved(true);
        setNotice(accessRemovedMessage());
      } else {
        setNotice(shareFailureNotice(failure));
      }
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDrawing(drawingId: string) {
    setNotice('');
    try {
      const signed = await withShareRetry(() => repo.sharedDrawingUrl(drawingId));
      await Linking.openURL(signed.url);
    } catch (error) {
      setNotice(shareFailureNotice(classifyShareFailure(error)));
    }
  }

  return (
    <Screen>
      <Title>{removed ? 'Access removed' : (view?.site_name ?? 'Shared site')}</Title>
      {loading ? <Muted>Loading the shared site…</Muted> : null}
      {notice ? <SeenRejectNotice message={notice} onDismiss={() => setNotice('')} /> : null}
      {view ? (
        <View style={{ gap: 16 }}>
          <Muted>{view.host_company_name}</Muted>
          {view.address_line ? <Muted>{view.address_line}</Muted> : null}
          <Muted>Contracts manager: {view.cm_contact_name || 'the host company'}</Muted>
          <Muted>View only. Your company cannot change this site.</Muted>

          {view.sections.drawings ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>DRAWINGS</Text>
              {drawings.length === 0 ? <Muted>No current drawings.</Muted> : null}
              {drawings.map((drawing) => (
                <Card key={drawing.id}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={drawing.title}
                    onPress={() => void openDrawing(drawing.id)}
                    style={{ minHeight: 48, justifyContent: 'center', gap: 4 }}>
                    <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{drawing.title}</Text>
                    <Muted>
                      {[drawing.sheet_number, drawing.revision ? `Rev ${drawing.revision}` : ''].filter(Boolean).join(' · ')}
                    </Muted>
                  </Pressable>
                </Card>
              ))}
            </View>
          ) : null}

          {view.sections.variations ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>VARIATIONS</Text>
              {variations.length === 0 ? <Muted>No signed or sent variations.</Muted> : null}
              {variations.map((row) => (
                <Card key={row.version_id}>
                  <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{`VO-${row.vo_seq} ${row.title}`}</Text>
                  <Muted>{row.status}</Muted>
                  {row.signer_name ? <Muted>{row.signer_name}</Muted> : null}
                </Card>
              ))}
            </View>
          ) : null}

          {view.sections.snags ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>SNAGS</Text>
              {snags.length === 0 ? <Muted>No snags.</Muted> : null}
              {snags.map((row) => (
                <Card key={row.id}>
                  <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{row.note}</Text>
                  <Muted>{`${row.status} · ${row.raised_by_name}`}</Muted>
                </Card>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

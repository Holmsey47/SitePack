import { Button, Card, Muted, Screen, SeenRejectNotice, Title } from '@/components/ui';
import { repo } from '@/data/index';
import {
  accessRemovedMessage,
  classifyShareFailure,
  shareFailureNotice,
  withShareRetry,
  type SharedDrawing,
  type SharedInductionRow,
  type SharedSignInRow,
  type SharedSiteView,
  type SharedSnag,
  type SharedVariation,
} from '@/data/sharing';
import { formatUkDateTime } from '@/lib/format';
import { forgetSharedSite } from '@/lib/forgetShare';
import { theme } from '@/lib/theme';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

type Loaded<T> = { rows: T[]; failed: boolean };

const EMPTY: Loaded<never> = { rows: [], failed: false };

async function loadRows<T>(enabled: boolean, run: () => Promise<T[]>): Promise<Loaded<T>> {
  if (!enabled) return { rows: [], failed: false };
  try {
    return { rows: await withShareRetry(run), failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

export default function SharedSiteScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const [view, setView] = useState<SharedSiteView | null>(null);
  const [drawings, setDrawings] = useState<Loaded<SharedDrawing>>(EMPTY);
  const [variations, setVariations] = useState<Loaded<SharedVariation>>(EMPTY);
  const [snags, setSnags] = useState<Loaded<SharedSnag>>(EMPTY);
  const [signIns, setSignIns] = useState<Loaded<SharedSignInRow>>(EMPTY);
  const [inductions, setInductions] = useState<Loaded<SharedInductionRow>>(EMPTY);
  const [removed, setRemoved] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [retryNote, setRetryNote] = useState('');
  const failedRef = useRef(false);

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setNotice('');
    try {
      const next = await withShareRetry(() => repo.sharedSiteView(siteId));
      const [nextDrawings, nextVariations, nextSnags, nextSignIns, nextInductions] = await Promise.all([
        loadRows(next.sections.drawings, () => repo.sharedDrawings(siteId)),
        loadRows(next.sections.variations, () => repo.sharedVariations(siteId)),
        loadRows(next.sections.snags, () => repo.sharedSnags(siteId)),
        loadRows(next.sections.sign_in, () => repo.sharedSignInRegister(siteId)),
        loadRows(next.sections.inductions, () => repo.sharedInductionRegister(siteId)),
      ]);
      setView(next);
      setDrawings(nextDrawings);
      setVariations(nextVariations);
      setSnags(nextSnags);
      setSignIns(nextSignIns);
      setInductions(nextInductions);
      setRemoved(false);
      failedRef.current =
        nextDrawings.failed || nextVariations.failed || nextSnags.failed || nextSignIns.failed || nextInductions.failed;
    } catch (error) {
      const failure = classifyShareFailure(error);
      setView(null);
      setDrawings(EMPTY);
      setVariations(EMPTY);
      setSnags(EMPTY);
      setSignIns(EMPTY);
      setInductions(EMPTY);
      failedRef.current = false;
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

  async function onRetry() {
    setRetryNote('Trying again…');
    const started = Date.now();
    await load();
    if (!failedRef.current) {
      setRetryNote('');
      return;
    }
    const wait = 450 - (Date.now() - started);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (failedRef.current) setRetryNote('Still not loading, check signal');
  }

  function sectionProblem(): string {
    return retryNote || 'This section did not load.';
  }

  async function openDrawing(drawingId: string) {
    setNotice('');
    try {
      const signed = await withShareRetry(() => repo.sharedDrawingUrl(siteId, drawingId));
      await Linking.openURL(signed.url);
    } catch (error) {
      setNotice(shareFailureNotice(classifyShareFailure(error)));
    }
  }

  return (
    <Screen>
      {view ? (
        <View
          style={{
            backgroundColor: theme.current,
            borderRadius: 12,
            minHeight: 48,
            justifyContent: 'center',
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}>
          <Text style={{ color: theme.currentInk, fontSize: 17, fontWeight: '800' }}>
            {`Shared by ${view.host_company_name}, view only`}
          </Text>
        </View>
      ) : null}
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
              {drawings.failed ? (
                <Card>
                  <Muted>{sectionProblem()}</Muted>
                  <Button label="Retry" minHeight={48} onPress={() => void onRetry()} />
                </Card>
              ) : null}
              {!drawings.failed && drawings.rows.length === 0 ? <Muted>No current drawings.</Muted> : null}
              {drawings.rows.map((drawing) => (
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
              {variations.failed ? (
                <Card>
                  <Muted>{sectionProblem()}</Muted>
                  <Button label="Retry" minHeight={48} onPress={() => void onRetry()} />
                </Card>
              ) : null}
              {!variations.failed && variations.rows.length === 0 ? <Muted>No signed or sent variations.</Muted> : null}
              {variations.rows.map((row) => (
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
              {snags.failed ? (
                <Card>
                  <Muted>{sectionProblem()}</Muted>
                  <Button label="Retry" minHeight={48} onPress={() => void onRetry()} />
                </Card>
              ) : null}
              {!snags.failed && snags.rows.length === 0 ? <Muted>No snags.</Muted> : null}
              {snags.rows.map((row) => (
                <Card key={row.id}>
                  <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{row.note}</Text>
                  <Muted>{`${row.status} · ${row.raised_by_name}`}</Muted>
                </Card>
              ))}
            </View>
          ) : null}

          {view.sections.sign_in ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>SIGN-IN</Text>
              {signIns.failed ? (
                <Card>
                  <Muted>{sectionProblem()}</Muted>
                  <Button label="Retry" minHeight={48} onPress={() => void onRetry()} />
                </Card>
              ) : null}
              {!signIns.failed && signIns.rows.length === 0 ? <Muted>No one has signed in.</Muted> : null}
              {signIns.rows.map((row) => (
                <Card key={row.id}>
                  <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{row.person_name}</Text>
                  <Muted>
                    {`In ${formatUkDateTime(row.in_at)}${row.out_at ? ` · Out ${formatUkDateTime(row.out_at)}` : ''}`}
                  </Muted>
                </Card>
              ))}
            </View>
          ) : null}

          {view.sections.inductions ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>INDUCTIONS</Text>
              {inductions.failed ? (
                <Card>
                  <Muted>{sectionProblem()}</Muted>
                  <Button label="Retry" minHeight={48} onPress={() => void onRetry()} />
                </Card>
              ) : null}
              {!inductions.failed && inductions.rows.length === 0 ? <Muted>No induction signatures.</Muted> : null}
              {inductions.rows.map((row) => (
                <Card key={row.id}>
                  <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>{row.person_name}</Text>
                  <Muted>{row.title}</Muted>
                  <Muted>{row.meaning}</Muted>
                </Card>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

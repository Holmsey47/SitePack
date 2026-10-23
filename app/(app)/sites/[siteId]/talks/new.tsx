import { Button, ChoiceChip, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import { talkError } from '@/data/talks';
import type { TalkDelivery, TalkKind } from '@/lib/talkMeaning';
import { formatUkDateTime } from '@/lib/format';
import { theme } from '@/lib/theme';
import * as DocumentPicker from 'expo-document-picker';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function NewTalkScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [kind, setKind] = useState<TalkKind>('induction');
  const [delivery, setDelivery] = useState<TalkDelivery>('phone');
  const [audience, setAudience] = useState<'all' | 'chosen'>('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [presenterId, setPresenterId] = useState(person?.id ?? '');
  const [presenters, setPresenters] = useState<{ id: string; name: string }[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const radioRefs = useRef<({ focus?: () => void } | null)[]>([]);
  const [presenterRole, setPresenterRole] = useState(person?.role === 'owner' ? 'Owner' : 'Contracts manager');
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [pdf, setPdf] = useState<Uint8Array | null>(null);
  const [pdfName, setPdfName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const when = formatUkDateTime(new Date().toISOString());

  useEffect(() => {
    if (!siteId) return;
    repo
      .listAssignments(siteId)
      .then((rows) => {
        const assigned = rows.map((row) => ({
          id: row.person_id,
          name: row.person?.display_name || 'Someone on site',
          role: row.person?.role,
        }));
        const options = [...assigned];
        if (person && !options.some((row) => row.id === person.id)) {
          options.unshift({ id: person.id, name: person.display_name || 'You', role: person.role });
        }
        setPresenters(options.map((row) => ({ id: row.id, name: row.name })));
        setPeople(assigned.filter((row) => row.role === 'operative').map((row) => ({ id: row.id, name: row.name })));
        setPresenterId((current) => current || person?.id || options[0]?.id || '');
      })
      .catch(() => {
        setPeople([]);
        setPresenters(person ? [{ id: person.id, name: person.display_name || 'You' }] : []);
      });
  }, [person, siteId]);

  useEffect(() => {
    const index = presenters.findIndex((row) => row.id === presenterId);
    if (index >= 0) setFocusIndex(index);
  }, [presenterId, presenters]);

  function onPresenterKey(event: { key: string; preventDefault: () => void }, index: number) {
    const nextKey = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const prevKey = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      const row = presenters[index];
      if (row) setPresenterId(row.id);
      return;
    }
    if (!nextKey && !prevKey) return;
    event.preventDefault();
    if (presenters.length === 0) return;
    const next = (index + (nextKey ? 1 : -1) + presenters.length) % presenters.length;
    const row = presenters[next];
    if (!row) return;
    setFocusIndex(next);
    setPresenterId(row.id);
    radioRefs.current[next]?.focus?.();
  }

  if (person && !canManageSite(person.role)) return <Redirect href={`/sites/${siteId}/talks`} />;

  async function pickPdf() {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPdfName(asset.name);
    if (asset.file) {
      setPdf(new Uint8Array(await asset.file.arrayBuffer()));
      return;
    }
    if (asset.uri) {
      const response = await fetch(asset.uri);
      setPdf(new Uint8Array(await response.arrayBuffer()));
    }
  }

  async function onCreate() {
    if (!siteId || !person) return;
    setSaving(true);
    setError('');
    try {
      let pdfPath: string | null = null;
      if (pdf) {
        const uploaded = await repo.uploadTalkPdf({ companyId: person.company_id, siteId, bytes: pdf });
        pdfPath = uploaded.storagePath;
      }
      const created = await repo.createTalk({
        siteId,
        kind,
        delivery: kind === 'toolbox' ? delivery : 'phone',
        title,
        body,
        pdfPath,
        audience,
        personIds: audience === 'chosen' ? chosen : [],
        presenterPersonId: presenterId,
        presenterRole,
        presentedAt: new Date().toISOString(),
      });
      router.replace(`/sites/${siteId}/talks/${created.talk_id}`);
    } catch (err) {
      setError(talkError(err instanceof Error ? err.message : 'unknown'));
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Title>New document</Title>
      <Muted>Time recorded: {when}</Muted>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <ChoiceChip
          label="Induction"
          selected={kind === 'induction'}
          onPress={() => {
            setKind('induction');
            setDelivery('phone');
          }}
        />
        <ChoiceChip label="Toolbox talk" selected={kind === 'toolbox'} onPress={() => setKind('toolbox')} />
        <ChoiceChip
          label="RAMS"
          selected={kind === 'rams'}
          onPress={() => {
            setKind('rams');
            setDelivery('phone');
          }}
        />
      </View>
      {kind === 'toolbox' ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <ChoiceChip label="Read on the phone" selected={delivery === 'phone'} onPress={() => setDelivery('phone')} />
          <ChoiceChip label="Given in person" selected={delivery === 'in_person'} onPress={() => setDelivery('in_person')} />
        </View>
      ) : null}
      <Field label="Title" value={title} onChangeText={setTitle} autoCapitalize="sentences" />
      <Field label="What it says" value={body} onChangeText={setBody} multiline autoCapitalize="sentences" />
      <Button label={pdfName ? `PDF attached · ${pdfName}` : 'Attach a PDF'} variant="secondary" minHeight={56} onPress={() => void pickPdf()} />
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>Presenter</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Presenter" role="radiogroup">
        {presenters.map((row, index) => {
          const on = presenterId === row.id;
          return (
            <Pressable
              key={row.id}
              ref={(node) => {
                radioRefs.current[index] = node as { focus?: () => void } | null;
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              role="radio"
              aria-checked={on}
              tabIndex={index === focusIndex ? 0 : -1}
              onPress={() => {
                setFocusIndex(index);
                setPresenterId(row.id);
              }}
              {...({ onKeyDown: (event: { key: string; preventDefault: () => void }) => onPresenterKey(event, index) } as {
                onKeyDown: (event: { key: string; preventDefault: () => void }) => void;
              })}
              style={{ minHeight: 48, justifyContent: 'center' }}>
              <Text style={{ color: on ? theme.current : theme.text, fontSize: 17, fontWeight: '800' }}>{row.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <Field label="Presenter role" value={presenterRole} onChangeText={setPresenterRole} autoCapitalize="words" />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <ChoiceChip label="All on site" selected={audience === 'all'} onPress={() => setAudience('all')} />
        <ChoiceChip label="Chosen people" selected={audience === 'chosen'} onPress={() => setAudience('chosen')} />
      </View>
      {audience === 'chosen'
        ? people.map((row) => {
            const on = chosen.includes(row.id);
            return (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                onPress={() => setChosen((current) => (on ? current.filter((id) => id !== row.id) : [...current, row.id]))}
                style={{ minHeight: 48, justifyContent: 'center' }}>
                <Text style={{ color: on ? theme.current : theme.text, fontSize: 17, fontWeight: '800' }}>
                  {on ? `Included · ${row.name}` : row.name}
                </Text>
              </Pressable>
            );
          })
        : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button label="Create document" minHeight={56} loading={saving} onPress={() => void onCreate()} />
    </Screen>
  );
}

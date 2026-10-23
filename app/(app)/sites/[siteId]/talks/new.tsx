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
import { useEffect, useState } from 'react';
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
  const [presenterName, setPresenterName] = useState(person?.display_name ?? '');
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
        setPeople(
          rows
            .filter((row) => row.person?.role === 'operative')
            .map((row) => ({ id: row.person_id, name: row.person?.display_name || 'Someone on site' }))
        );
      })
      .catch(() => setPeople([]));
  }, [siteId]);

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
        delivery: kind === 'induction' ? 'phone' : delivery,
        title,
        body,
        pdfPath,
        audience,
        personIds: audience === 'chosen' ? chosen : [],
        presenterName,
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
      <Title>New talk</Title>
      <Muted>Time recorded: {when}</Muted>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <ChoiceChip label="Induction" selected={kind === 'induction'} onPress={() => setKind('induction')} />
        <ChoiceChip label="Toolbox talk" selected={kind === 'toolbox'} onPress={() => setKind('toolbox')} />
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
      <Field label="Presenter name" value={presenterName} onChangeText={setPresenterName} autoCapitalize="words" />
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
      <Button label="Create talk" minHeight={56} loading={saving} onPress={() => void onCreate()} />
    </Screen>
  );
}

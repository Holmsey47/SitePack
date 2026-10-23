import { PhotoPicker, type PickedPhoto } from '@/components/PhotoPicker';
import { Button, ChoiceChip, ErrorText, Field, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { newId } from '@/data/newId';
import { snagError } from '@/data/snags';
import { sendQueuedSnag } from '@/lib/sendQueuedSnag';
import { theme } from '@/lib/theme';
import { deviceIsOnline, persistThenSendSnag, SAVED_ON_PHONE } from '@/lib/snagQueue';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

export default function NewSnagScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const router = useRouter();
  const { person } = useAuth();
  const [note, setNote] = useState('');
  const [levelArea, setLevelArea] = useState('');
  const [trade, setTrade] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!siteId) return;
    repo
      .snagTradeLabels(siteId)
      .then(setLabels)
      .catch(() => setLabels([]));
  }, [siteId]);

  function addPhotos(picked: PickedPhoto[]) {
    setPhotos((current) => {
      const room = 10 - current.length;
      if (room <= 0) return current;
      return [...current, ...picked.slice(0, room)];
    });
  }

  async function onSave() {
    if (!siteId || !person) return;
    if (!note.trim()) {
      setError('Add a note.');
      return;
    }
    if (!trade.trim()) {
      setError('Add a trade.');
      return;
    }
    if (photos.length < 1) {
      setError('Add a photo.');
      return;
    }
    if (!person.auth_user_id) {
      setError('Sign in again before raising a snag.');
      return;
    }
    setSaving(true);
    setError('');
    const raisedAt = new Date().toISOString();
    const item = {
      kind: 'create' as const,
      localId: newId(),
      ownerId: person.auth_user_id,
      siteId,
      companyId: person.company_id,
      note: note.trim(),
      levelArea: levelArea.trim() || null,
      tradeLabel: trade.trim(),
      photos: photos.map(({ id, bytes, contentType }) => ({ id, bytes, contentType })),
      raisedAt,
    };
    try {
      const result = await persistThenSendSnag(item, await deviceIsOnline(), sendQueuedSnag);
      if (result === 'queued') {
        setNotice(SAVED_ON_PHONE);
        return;
      }
      router.back();
    } catch (err) {
      setNotice(SAVED_ON_PHONE);
      setError(snagError(err instanceof Error ? err.message : 'unknown'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Title>Raise a snag</Title>
      {notice ? (
        <Text style={{ color: theme.currentInk, backgroundColor: theme.current, fontWeight: '800', padding: 12, borderRadius: 12 }}>{notice}</Text>
      ) : null}
      <Field label="Note" value={note} onChangeText={setNote} autoCapitalize="sentences" multiline maxLength={2000} />
      <Field label="Level or area (optional)" value={levelArea} onChangeText={setLevelArea} autoCapitalize="words" maxLength={80} />
      <Field label="Trade" value={trade} onChangeText={setTrade} autoCapitalize="words" maxLength={80} placeholder="dryliner" />
      {labels.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {labels.map((label) => (
            <ChoiceChip key={label} label={label} selected={trade.trim().toLowerCase() === label.toLowerCase()} onPress={() => setTrade(label)} />
          ))}
        </View>
      ) : null}
      <View style={{ gap: 8 }}>
        {photos.map((photo) => (
          <View key={photo.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Image source={{ uri: photo.preview }} style={{ width: 96, height: 96, borderRadius: 8 }} accessibilityLabel="Snag photo" />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              onPress={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}
              style={{ minHeight: 48, minWidth: 48, justifyContent: 'center', paddingHorizontal: 8 }}>
              <Text style={{ color: theme.danger, fontWeight: '800' }}>Remove</Text>
            </Pressable>
          </View>
        ))}
        <PhotoPicker count={photos.length} multiple onAdd={addPhotos} onError={setError} />
      </View>
      <ErrorText>{error}</ErrorText>
      <Button label="Save snag" minHeight={56} loading={saving} onPress={() => void onSave()} />
    </Screen>
  );
}

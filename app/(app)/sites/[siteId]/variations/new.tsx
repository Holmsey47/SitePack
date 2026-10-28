import { PhotoPicker, type PickedPhoto } from '@/components/PhotoPicker';
import { Button, ErrorText, Field, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { newId } from '@/data/newId';
import { canSetVariationValue, parsePounds, variationError } from '@/data/variations';
import { claimSaveTap, releaseSaveTap, SAVED_OFFLINE, saveControl, type SavePhase } from '@/lib/offlineSave';
import { sendQueuedVariation } from '@/lib/sendQueuedVariation';
import { textStyle, theme } from '@/lib/theme';
import { deviceIsOnline, persistThenSend, SAVED_ON_PHONE } from '@/lib/variationQueue';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

export default function NewVariationScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [levelArea, setLevelArea] = useState('');
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clientId] = useState(newId);
  const saveLock = useRef(false);
  const [phase, setPhase] = useState<SavePhase>('idle');
  const control = saveControl(phase, 'Save variation');
  const manager = person ? canSetVariationValue(person.role) : false;

  function addPhotos(picked: PickedPhoto[]) {
    setPhotos((current) => {
      const room = 10 - current.length;
      if (room <= 0) return current;
      return [...current, ...picked.slice(0, room)];
    });
  }

  async function onSave() {
    const userId = person?.auth_user_id;
    if (!siteId || !userId) return;
    if (!title.trim()) {
      setError('Add a title.');
      return;
    }
    if (photos.length < 1) {
      setError('Add between 1 and 10 photos.');
      return;
    }
    let valuePence: number | null = null;
    if (manager && amount.trim()) {
      try {
        valuePence = parsePounds(amount);
      } catch {
        setError('Enter the amount in pounds, such as 12.50.');
        return;
      }
    }
    if (!claimSaveTap(saveLock)) return;
    setPhase('saving');
    setError('');
    setNotice('');
    const item = {
      localId: clientId,
      siteId,
      companyId: person.company_id,
      title: title.trim(),
      description: description.trim(),
      levelArea: levelArea.trim() || null,
      quantityText: quantity.trim() || null,
      valuePence,
      photos: photos.map(({ id, bytes, contentType }) => ({ id, bytes, contentType })),
      savedAt: new Date().toISOString(),
      ownerUserId: userId,
      notice: SAVED_ON_PHONE,
    };
    try {
      const result = await persistThenSend(item, await deviceIsOnline(), sendQueuedVariation);
      if (result === 'queued') {
        setPhase('saved');
        setNotice(SAVED_OFFLINE);
        router.back();
        return;
      }
      setPhase('saved');
      router.back();
    } catch (err) {
      releaseSaveTap(saveLock);
      setPhase('error');
      setError(variationError(err instanceof Error ? err.message : 'unknown'));
    }
  }

  return (
    <Screen>
      {notice ? (
        <Text style={{ ...textStyle.bodyStrong, backgroundColor: theme.surface, padding: 12, borderRadius: 12 }}>
          {notice}
        </Text>
      ) : null}
      <Field label="Title" value={title} onChangeText={setTitle} autoCapitalize="sentences" maxLength={120} />
      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        autoCapitalize="sentences"
        multiline
        maxLength={2000}
      />
      <Field label="Level or area (optional)" value={levelArea} onChangeText={setLevelArea} autoCapitalize="words" maxLength={80} />
      <Field
        label="Quantity or hours (optional)"
        value={quantity}
        onChangeText={setQuantity}
        placeholder="12 m or 3 hours"
        autoCapitalize="sentences"
        maxLength={80}
      />
      {manager ? (
        <Field label="£ ex VAT" value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="default" />
      ) : null}
      <View style={{ gap: 8 }}>
        {photos.map((photo) => (
          <View key={photo.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Image source={{ uri: photo.preview }} style={{ width: 72, height: 72, borderRadius: 8 }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              onPress={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}
              style={{ minHeight: 48, minWidth: 48, justifyContent: 'center', paddingHorizontal: 8 }}>
              <Text style={{ color: theme.danger, fontWeight: '800' }}>Remove</Text>
            </Pressable>
          </View>
        ))}
        <PhotoPicker
          count={photos.length}
          multiple
          title={photos.length === 0 ? 'Add photo' : `Add photo (${photos.length} of 10)`}
          onAdd={addPhotos}
          onError={setError}
        />
      </View>
      <ErrorText>{error}</ErrorText>
      <Button label={control.label} minHeight={56} disabled={!control.enabled} onPress={() => void onSave()} />
    </Screen>
  );
}

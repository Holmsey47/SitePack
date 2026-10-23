import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { newId } from '@/data/newId';
import { canSetVariationValue, parsePounds, variationError } from '@/data/variations';
import { preparePhoto } from '@/lib/photoPrep';
import { sendQueuedVariation } from '@/lib/sendQueuedVariation';
import { theme } from '@/lib/theme';
import {
  deviceIsOnline,
  persistThenSend,
  SAVED_ON_PHONE,
  type QueuedPhoto,
} from '@/lib/variationQueue';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { createElement, useRef, useState } from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';

type LocalPhoto = QueuedPhoto & { preview: string };

function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type });
}

export default function NewVariationScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const fileRef = useRef<{ click: () => void } | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [levelArea, setLevelArea] = useState('');
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const manager = person ? canSetVariationValue(person.role) : false;

  async function addBlob(blob: Blob) {
    const prepared = await preparePhoto({ blob });
    const preview = URL.createObjectURL(bytesToBlob(prepared.bytes, 'image/jpeg'));
    setPhotos((current) =>
      current.length >= 10
        ? current
        : [...current, { id: newId(), bytes: prepared.bytes, contentType: prepared.contentType, preview }]
    );
  }

  async function addFromPicker() {
    if (photos.length >= 10) return;
    if (Platform.OS === 'web') {
      fileRef.current?.click();
      return;
    }
    const ImagePicker = await import('expo-image-picker');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 10 - photos.length,
      quality: 1,
    });
    if (result.canceled) return;
    for (const asset of result.assets) {
      const prepared = await preparePhoto({ uri: asset.uri });
      setPhotos((current) =>
        current.length >= 10
          ? current
          : [
              ...current,
              { id: newId(), bytes: prepared.bytes, contentType: prepared.contentType, preview: asset.uri },
            ]
      );
    }
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
    setSaving(true);
    setError('');
    const item = {
      localId: newId(),
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
        setNotice(SAVED_ON_PHONE);
        return;
      }
      router.back();
    } catch (err) {
      setNotice(SAVED_ON_PHONE);
      setError(variationError(err instanceof Error ? err.message : 'unknown'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Title>New variation</Title>
      {notice ? (
        <Text style={{ color: theme.currentInk, backgroundColor: theme.current, fontWeight: '800', padding: 12, borderRadius: 12 }}>
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
        <Button
          label={photos.length === 0 ? 'Add photo' : `Add photo (${photos.length} of 10)`}
          variant="secondary"
          minHeight={48}
          disabled={photos.length >= 10}
          onPress={() => void addFromPicker().catch(() => setError('Could not read that photo.'))}
        />
      </View>
      {Platform.OS === 'web'
        ? createElement('input', {
            ref: fileRef,
            type: 'file',
            accept: 'image/*',
            multiple: true,
            style: { display: 'none' },
            onChange: (event: { target: { files: FileList | null; value: string } }) => {
              const files = event.target.files;
              if (!files) return;
              void (async () => {
                try {
                  for (const file of Array.from(files).slice(0, 10 - photos.length)) await addBlob(file);
                } catch {
                  setError('Could not read that photo.');
                } finally {
                  event.target.value = '';
                }
              })();
            },
          })
        : null}
      <ErrorText>{error}</ErrorText>
      <Button label="Save variation" minHeight={56} loading={saving} onPress={() => void onSave()} />
    </Screen>
  );
}

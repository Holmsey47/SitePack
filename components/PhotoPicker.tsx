import { Button, Muted } from '@/components/ui';
import { newId } from '@/data/newId';
import { preparePhoto } from '@/lib/photoPrep';
import { theme } from '@/lib/theme';
import { createElement, useRef, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';

export type PickedPhoto = {
  id: string;
  bytes: Uint8Array;
  contentType: 'image/jpeg';
  preview: string;
};

const CAMERA_OFF = 'The camera is off for SitePack. Turn it on in the phone settings, then try again.';
const OPEN_SETTINGS = 'Open settings';

function copyBytes(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: 'image/jpeg' });
}

function readError(err: unknown): string {
  const code = err instanceof Error ? err.message : '';
  if (code === 'photo_too_large') return 'Each photo must be 1.5MB or smaller.';
  return 'Could not read that photo.';
}

async function fromUri(uri: string): Promise<PickedPhoto> {
  const prepared = await preparePhoto({ uri });
  return { id: newId(), bytes: prepared.bytes, contentType: prepared.contentType, preview: uri };
}

async function fromBlob(blob: Blob): Promise<PickedPhoto> {
  const prepared = await preparePhoto({ blob });
  const preview = URL.createObjectURL(copyBytes(prepared.bytes));
  return { id: newId(), bytes: prepared.bytes, contentType: prepared.contentType, preview };
}

/**
 * Take photo or choose from the gallery. Photos are resized to the 1.5MB upload limit before onAdd.
 * Web uses a file input. Take photo sets capture="environment" so a phone still opens the camera.
 */
export function PhotoPicker({
  count,
  max = 10,
  multiple = false,
  title,
  onAdd,
  onError,
}: {
  count: number;
  max?: number;
  multiple?: boolean;
  title?: string;
  onAdd: (photos: PickedPhoto[]) => void;
  onError: (message: string) => void;
}) {
  const cameraRef = useRef<{ click: () => void } | null>(null);
  const libraryRef = useRef<{ click: () => void } | null>(null);
  const countRef = useRef(count);
  countRef.current = count;
  const [cameraDenied, setCameraDenied] = useState(false);
  const full = count >= max;

  async function takePhoto() {
    if (max - countRef.current <= 0) return;
    if (Platform.OS === 'web') {
      cameraRef.current?.click();
      return;
    }
    try {
      const ImagePicker = await import('expo-image-picker');
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setCameraDenied(true);
        return;
      }
      setCameraDenied(false);
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
      if (result.canceled || !result.assets[0]) return;
      if (max - countRef.current <= 0) return;
      const picked = await fromUri(result.assets[0].uri);
      onAdd([picked]);
    } catch (err) {
      onError(readError(err));
    }
  }

  async function chooseGallery() {
    if (max - countRef.current <= 0) return;
    if (Platform.OS === 'web') {
      libraryRef.current?.click();
      return;
    }
    try {
      const ImagePicker = await import('expo-image-picker');
      const room = max - countRef.current;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: multiple,
        selectionLimit: multiple ? room : 1,
        quality: 1,
      });
      if (result.canceled) return;
      const picked: PickedPhoto[] = [];
      for (const asset of result.assets.slice(0, room)) picked.push(await fromUri(asset.uri));
      if (picked.length) onAdd(picked);
    } catch (err) {
      onError(readError(err));
    }
  }

  function onWebFiles(event: { target: { files: FileList | null; value: string } }, limitOne: boolean) {
    const files = event.target.files;
    const list = files ? Array.from(files) : [];
    event.target.value = '';
    if (list.length === 0) return;
    const room = max - countRef.current;
    const chosen = (limitOne ? list.slice(0, 1) : list).slice(0, Math.max(0, room));
    void (async () => {
      try {
        const picked: PickedPhoto[] = [];
        for (const file of chosen) picked.push(await fromBlob(file));
        if (picked.length) onAdd(picked);
      } catch (err) {
        onError(readError(err));
      }
    })();
  }

  return (
    <View style={{ gap: 8 }}>
      {title ? <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>{title}</Text> : null}
      {cameraDenied ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{CAMERA_OFF}</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={OPEN_SETTINGS}
            onPress={() => {
              void Linking.openSettings().catch(() => onError(CAMERA_OFF));
            }}
            style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={{ color: theme.current, fontSize: 17, fontWeight: '800', textDecorationLine: 'underline' }}>{OPEN_SETTINGS}</Text>
          </Pressable>
        </View>
      ) : null}
      {full ? (
        <Muted>{`${max} photos already. Remove one to add another.`}</Muted>
      ) : (
        <View style={{ gap: 8 }}>
          <Button label="Take photo" variant="secondary" minHeight={48} onPress={() => void takePhoto()} />
          <Button label="Choose from gallery" variant="secondary" minHeight={48} onPress={() => void chooseGallery()} />
        </View>
      )}
      {Platform.OS === 'web' ? (
        <View>
          {createElement('input', {
            ref: cameraRef,
            type: 'file',
            accept: 'image/*',
            capture: 'environment',
            style: { display: 'none' },
            onChange: (event: { target: { files: FileList | null; value: string } }) => onWebFiles(event, true),
          })}
          {createElement('input', {
            ref: libraryRef,
            type: 'file',
            accept: 'image/*',
            multiple,
            style: { display: 'none' },
            onChange: (event: { target: { files: FileList | null; value: string } }) => onWebFiles(event, false),
          })}
        </View>
      ) : null}
    </View>
  );
}

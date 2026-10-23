import { PhotoPicker, type PickedPhoto } from '@/components/PhotoPicker';
import { Button, ErrorText, Muted } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { logoFailureMessage, LOGO_MAX_BYTES, LOGO_MAX_EDGE } from '@/data/companyLogo';
import { repo } from '@/data/index';
import { theme } from '@/lib/theme';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';

/**
 * Home header. The logo, or the company name when there is no logo.
 * Owners open Company from the mark or the cog. Members cannot.
 */
export function CompanyLogo() {
  const { person } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  const load = useCallback(() => {
    if (!person) return () => undefined;
    let active = true;
    repo
      .companyMark()
      .then((mark) => {
        if (!active) return;
        setName(mark.name);
        setLogoUrl(mark.logoUrl);
        setBroken(false);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [person]);

  useFocusEffect(load);

  if (!person) return null;
  const owner = person.role === 'owner';
  const showLogo = Boolean(logoUrl) && !broken;
  const mark = showLogo ? (
    <Image
      accessibilityLabel={name || 'Company logo'}
      source={{ uri: logoUrl ?? undefined }}
      onError={() => setBroken(true)}
      style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: theme.surface }}
    />
  ) : (
    <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800', flex: 1 }}>{name}</Text>
  );

  if (!owner) {
    return <View style={{ minHeight: 48, justifyContent: 'center' }}>{mark}</View>;
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name || 'Company'}
        onPress={() => router.push('/company')}
        style={{ flex: 1, minHeight: 48, justifyContent: 'center' }}>
        {mark}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Company settings"
        onPress={() => router.push('/company')}
        style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
        <MaterialIcons name="settings" size={24} color={theme.text} />
      </Pressable>
    </View>
  );
}

/** Owner company screen. Same picker as site photos, resized to 512px. */
export function CompanyLogoEditor() {
  const { person } = useAuth();
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!person) return () => undefined;
    let active = true;
    repo
      .companyMark()
      .then((mark) => {
        if (!active) return;
        setName(mark.name);
        setLogoUrl(mark.logoUrl);
        setBroken(false);
        setError('');
      })
      .catch(() => {
        if (!active) return;
        setError('Could not load the company.');
      });
    return () => {
      active = false;
    };
  }, [person]);

  useFocusEffect(load);

  const showLogo = Boolean(logoUrl) && !broken;

  async function save(photo: PickedPhoto | null) {
    setSaving(true);
    setError('');
    try {
      const mark = await repo.setCompanyLogo(
        photo ? { bytes: photo.bytes, contentType: photo.contentType } : null
      );
      setName(mark.name);
      setLogoUrl(mark.logoUrl);
      setBroken(false);
      setPicking(false);
      setConfirmRemove(false);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(logoFailureMessage(code));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      {showLogo ? (
        <Image
          accessibilityLabel={name || 'Company logo'}
          source={{ uri: logoUrl ?? undefined }}
          onError={() => setBroken(true)}
          style={{ width: 96, height: 96, borderRadius: 16, backgroundColor: theme.surface }}
        />
      ) : null}
      <Text style={{ color: theme.text, fontSize: 22, fontWeight: '800' }}>{name}</Text>
      <Muted>The company name stays as it is.</Muted>
      {showLogo && !picking ? (
        <Button label="Change logo" variant="secondary" minHeight={48} disabled={saving} onPress={() => setPicking(true)} />
      ) : null}
      {!showLogo && !picking ? (
        <Button label="Add logo" variant="secondary" minHeight={48} disabled={saving} onPress={() => setPicking(true)} />
      ) : null}
      {picking ? (
        <View style={{ gap: 8 }}>
          <Muted>JPEG, PNG, or WebP, resized to 512px.</Muted>
          <PhotoPicker
            count={0}
            max={1}
            maxEdge={LOGO_MAX_EDGE}
            maxBytes={LOGO_MAX_BYTES}
            tooLarge="Use a JPEG, PNG, or WebP under 1MB."
            onAdd={(photos) => {
              const photo = photos[0];
              if (photo) void save(photo);
            }}
            onError={setError}
          />
          <Button label="Cancel" variant="secondary" minHeight={48} disabled={saving} onPress={() => setPicking(false)} />
        </View>
      ) : null}
      {showLogo ? (
        <Button
          label="Remove logo"
          variant="danger"
          minHeight={48}
          disabled={saving}
          onPress={() => setConfirmRemove(true)}
        />
      ) : null}
      <Modal visible={confirmRemove} transparent animationType="fade" onRequestClose={() => setConfirmRemove(false)}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.65)' }}>
          <View style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 20, gap: 12 }}>
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>Remove the company logo?</Text>
            <Button label="Remove logo" variant="danger" minHeight={48} disabled={saving} onPress={() => void save(null)} />
            <Button label="Cancel" variant="secondary" minHeight={48} disabled={saving} onPress={() => setConfirmRemove(false)} />
          </View>
        </View>
      </Modal>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

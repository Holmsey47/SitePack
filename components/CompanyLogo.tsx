import { PhotoPicker, type PickedPhoto } from '@/components/PhotoPicker';
import { Button, ErrorText, Muted } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { logoFailureMessage, LOGO_MAX_BYTES, LOGO_MAX_EDGE } from '@/data/companyLogo';
import { repo } from '@/data/index';
import { theme } from '@/lib/theme';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Text, View } from 'react-native';

/**
 * Home header mark. The logo is a signed URL when the company has one.
 * A missing or failed image leaves the company name.
 * The owner adds, changes, or removes it here, after they are signed in.
 */
export function CompanyLogo() {
  const { person } = useAuth();
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const [picking, setPicking] = useState(false);
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

  if (!person) return null;
  const owner = person.role === 'owner';
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
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(logoFailureMessage(code));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
        {showLogo ? (
          <Image
            accessibilityLabel={name || 'Company logo'}
            source={{ uri: logoUrl ?? undefined }}
            onError={() => setBroken(true)}
            style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: theme.surface }}
          />
        ) : null}
        <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800', flex: 1 }}>{name}</Text>
      </View>
      {owner ? (
        <View style={{ gap: 8 }}>
          {logoUrl && !picking ? (
            <View style={{ gap: 8 }}>
              <Button label="Change logo" variant="secondary" minHeight={48} disabled={saving} onPress={() => setPicking(true)} />
              <Button label="Remove logo" variant="secondary" minHeight={48} disabled={saving} onPress={() => void save(null)} />
            </View>
          ) : null}
          {!logoUrl && !picking ? (
            <Button label="Add logo" variant="secondary" minHeight={48} disabled={saving} onPress={() => setPicking(true)} />
          ) : null}
          {picking ? (
            <View style={{ gap: 8 }}>
              <Muted>Optional. JPEG, PNG, or WebP, resized to 512px.</Muted>
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
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

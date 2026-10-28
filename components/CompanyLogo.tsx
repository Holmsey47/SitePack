import { PhotoPicker, type PickedPhoto } from '@/components/PhotoPicker';
import { Button, ErrorText, Muted, Wordmark } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { logoFailureMessage, LOGO_MAX_BYTES, LOGO_MAX_EDGE } from '@/data/companyLogo';
import { repo } from '@/data/index';
import { Icon } from '@/components/icon';
import { brandFitsOneRow } from '@/lib/brandRow';
import { logo, space, textStyle, theme, typeScale } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Modal, Pressable, View } from 'react-native';

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

  if (!owner) {
    return (
      <View style={{ flex: 1, minWidth: 0 }}>
        <FittedBrand name={name} showLogo={showLogo} logoUrl={logoUrl} onBroken={() => setBroken(true)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name || 'Company'}
        onPress={() => router.push('/company')}
        style={{ flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center' }}>
        <FittedBrand name={name} showLogo={showLogo} logoUrl={logoUrl} onBroken={() => setBroken(true)} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Company settings"
        onPress={() => router.push('/company')}
        style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="settings" color={theme.text} />
      </Pressable>
    </View>
  );
}

/** Full SitePack wordmark beside the company name, or a smaller stack when the row would clip. */
function FittedBrand({
  name,
  showLogo,
  logoUrl,
  onBroken,
}: {
  name: string;
  showLogo: boolean;
  logoUrl: string | null;
  onBroken: () => void;
}) {
  const [box, setBox] = useState(0);
  const [markWidth, setMarkWidth] = useState(0);
  const [nameWidth, setNameWidth] = useState(0);
  const nameSlot = showLogo ? logo.company : nameWidth;
  const row = brandFitsOneRow(markWidth, nameSlot, box);
  const company = showLogo ? (
    <Image
      accessibilityLabel={name || 'Company logo'}
      source={{ uri: logoUrl ?? undefined }}
      onError={onBroken}
      style={{ width: logo.company, height: logo.company, borderRadius: 8, backgroundColor: theme.surface }}
    />
  ) : (
    <Text style={row ? textStyle.title : textStyle.body} numberOfLines={row ? 1 : 2}>
      {name}
    </Text>
  );

  return (
    <View style={{ flex: 1, minWidth: 0 }} onLayout={(event) => setBox(event.nativeEvent.layout.width)}>
      <View
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
        style={{ position: 'absolute', opacity: 0, alignSelf: 'flex-start' }}>
        <View style={{ alignSelf: 'flex-start' }} onLayout={(event) => setMarkWidth(event.nativeEvent.layout.width)}>
          <Wordmark />
        </View>
        {showLogo ? null : (
          <View style={{ alignSelf: 'flex-start' }} onLayout={(event) => setNameWidth(event.nativeEvent.layout.width)}>
            <Text style={textStyle.title}>{name}</Text>
          </View>
        )}
      </View>
      {row ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 }}>
          <Wordmark />
          <View style={{ flexShrink: 1, minWidth: 0 }}>{company}</View>
        </View>
      ) : (
        <View style={{ gap: space.xs }}>
          <Wordmark size={typeScale.title} />
          <View style={{ minHeight: 48, justifyContent: 'center' }}>{company}</View>
        </View>
      )}
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
          style={{ width: logo.company, height: logo.company, borderRadius: 8, backgroundColor: theme.surface }}
        />
      ) : null}
      <Text style={textStyle.title}>{name}</Text>
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
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: theme.scrim }}>
          <View style={{ backgroundColor: theme.surface, borderRadius: 12, padding: 16, gap: 12 }}>
            <Text style={textStyle.title}>Remove the company logo?</Text>
            <Button label="Remove logo" variant="danger" minHeight={48} disabled={saving} onPress={() => void save(null)} />
            <Button label="Cancel" variant="secondary" minHeight={48} disabled={saving} onPress={() => setConfirmRemove(false)} />
          </View>
        </View>
      </Modal>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

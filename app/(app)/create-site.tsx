import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';

export default function CreateSiteScreen() {
  const { person } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [mainContractor, setMainContractor] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [whatItIs, setWhatItIs] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (person && person.role !== 'owner') return <Redirect href="/home" />;

  async function onSubmit() {
    setLoading(true);
    setError('');
    try {
      await repo.createSite({
        name,
        mainContractor,
        addressLine,
        whatItIs,
      });
      router.replace('/sites');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the site');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Title>Create site</Title>
      <Muted>Name is required. The other lines can wait.</Muted>
      <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="Elm Yard" />
      <Field
        label="Main contractor"
        value={mainContractor}
        onChangeText={setMainContractor}
        autoCapitalize="words"
        placeholder="Optional"
      />
      <Field
        label="Site address"
        value={addressLine}
        onChangeText={setAddressLine}
        autoCapitalize="words"
        placeholder="Optional"
      />
      <Field
        label="What it is"
        value={whatItIs}
        onChangeText={setWhatItIs}
        autoCapitalize="sentences"
        placeholder="12 houses"
      />
      <ErrorText>{error}</ErrorText>
      <Button label="Create site" onPress={() => void onSubmit()} loading={loading} disabled={!name.trim()} />
    </Screen>
  );
}

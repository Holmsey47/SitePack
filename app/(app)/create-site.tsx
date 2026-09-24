import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
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

  if (person && person.role !== 'owner') return <Redirect href="/sites" />;

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
      <Field label="Type" value={whatItIs} onChangeText={setWhatItIs} autoCapitalize="sentences" placeholder="Optional" />
      <ErrorText>{error}</ErrorText>
      <Button label="Create site" onPress={() => void onSubmit()} loading={loading} disabled={!name.trim()} />
    </Screen>
  );
}

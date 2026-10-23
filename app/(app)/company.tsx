import { CompanyLogoEditor } from '@/components/CompanyLogo';
import { Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { Redirect } from 'expo-router';

/** Owner only. Members who open this route go back to Sites. */
export default function CompanyScreen() {
  const { person } = useAuth();
  if (!person || person.role !== 'owner') return <Redirect href="/sites" />;

  return (
    <Screen>
      <Title>Company</Title>
      <CompanyLogoEditor />
    </Screen>
  );
}

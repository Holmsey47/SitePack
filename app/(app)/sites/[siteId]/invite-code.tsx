import { JoinCodeOffer } from '@/components/JoinCodeOffer';
import { Muted, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

export default function InviteCodeScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const [siteName, setSiteName] = useState('this site');

  useFocusEffect(
    useCallback(() => {
      if (!siteId) return undefined;
      let active = true;
      repo
        .companySitesPulse()
        .then((rows) => {
          if (!active) return;
          const site = rows.find((row) => row.site_id === siteId);
          if (site?.name) setSiteName(site.name);
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [siteId]),
  );

  if (person && !canManageSite(person.role)) return <Redirect href="/sites" />;
  if (!siteId) return null;

  return (
    <Screen>
      <Muted>A valid code puts them straight on this site. No approval step.</Muted>
      <JoinCodeOffer key={siteId} siteId={siteId} siteName={siteName} />
    </Screen>
  );
}

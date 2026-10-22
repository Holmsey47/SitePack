import { useBackOverlay } from '@/components/useBackOverlay';
import { Button, Screen } from '@/components/ui';
import { AUTH_LINK_STAY_HINT, signOutAndUseLabel, staySignedInLabel } from '@/lib/authLink';
import { theme } from '@/lib/theme';
import { useState } from 'react';
import { Text } from 'react-native';

export function AuthLinkConfirm({
  currentAccount,
  linkAccount,
  onUseLink,
  onStay,
}: {
  currentAccount: string;
  linkAccount: string;
  onUseLink: () => void;
  onStay: () => void;
}) {
  const [pressed, setPressed] = useState<'stay' | 'use' | null>(null);
  useBackOverlay(true, onStay);

  function choose(next: 'stay' | 'use') {
    if (pressed) return;
    setPressed(next);
    if (next === 'stay') onStay();
    else onUseLink();
  }

  return (
    <Screen>
      <Text style={{ color: theme.text, fontSize: 22, lineHeight: 30, fontWeight: '700', paddingTop: 24 }}>
        {`You're signed in as ${currentAccount}. This link is for ${linkAccount}.`}
      </Text>
      <Text style={{ color: theme.text, fontSize: 16, lineHeight: 22 }}>{AUTH_LINK_STAY_HINT}</Text>
      <Button
        label={staySignedInLabel(currentAccount)}
        minHeight={theme.thumb}
        loading={pressed === 'stay'}
        disabled={pressed !== null}
        onPress={() => choose('stay')}
      />
      <Button
        label={signOutAndUseLabel(linkAccount)}
        variant="secondary"
        minHeight={theme.thumb}
        loading={pressed === 'use'}
        disabled={pressed !== null}
        onPress={() => choose('use')}
      />
    </Screen>
  );
}

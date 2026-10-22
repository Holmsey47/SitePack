import { Button, Screen } from '@/components/ui';
import { theme } from '@/lib/theme';
import { useState } from 'react';
import { Text } from 'react-native';

export function AuthLinkConfirm({
  message,
  onContinue,
  onStay,
}: {
  message: string;
  onContinue: () => void;
  onStay: () => void;
}) {
  const [pressed, setPressed] = useState<'continue' | 'stay' | null>(null);

  function choose(next: 'continue' | 'stay') {
    if (pressed) return;
    setPressed(next);
    if (next === 'continue') onContinue();
    else onStay();
  }

  return (
    <Screen>
      <Text style={{ color: theme.text, fontSize: 22, lineHeight: 30, fontWeight: '700', paddingTop: 24 }}>
        {message}
      </Text>
      <Button
        label="Sign out and continue"
        minHeight={theme.thumb}
        loading={pressed === 'continue'}
        disabled={pressed !== null}
        onPress={() => choose('continue')}
      />
      <Button
        label="Stay signed in"
        variant="secondary"
        minHeight={theme.thumb}
        loading={pressed === 'stay'}
        disabled={pressed !== null}
        onPress={() => choose('stay')}
      />
    </Screen>
  );
}

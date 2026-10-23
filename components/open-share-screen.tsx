import { Button, Muted, Screen, SeenRejectNotice, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { publicCodePath } from '@/data/joinCodes';
import { repo } from '@/data/index';
import { classifyShareFailure, shareFailureNotice, sharedSectionLine, withShareRetry, type ShareCodePreview } from '@/data/sharing';
import { clearStagedShareCode, peekStagedShareCode, stageShareCode } from '@/lib/appLinks';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Text } from 'react-native';
import { theme } from '@/lib/theme';

/**
 * The code is lifted into state and stripped from the address bar.
 * Redeeming it asks the host to approve. A pending share does not open the site.
 */
export function OpenShareScreen({ routeCode }: { routeCode?: string }) {
  const { person } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState(() => routeCode || peekStagedShareCode());
  const [notice, setNotice] = useState('');
  const [waiting, setWaiting] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ShareCodePreview | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') {
      if (!routeCode || typeof window === 'undefined') return;
      stageShareCode(routeCode);
      const strip = () => {
        const next = publicCodePath(window.location.pathname);
        if (next) window.history.replaceState(window.history.state, '', next);
      };
      strip();
      const id = window.setTimeout(strip, 0);
      return () => window.clearTimeout(id);
    }
    if (routeCode) {
      stageShareCode(routeCode);
      router.replace('/share');
      return;
    }
    const staged = peekStagedShareCode();
    if (staged) setCode(staged);
    clearStagedShareCode();
  }, [routeCode, router]);

  useEffect(() => {
    if (!person || !code) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    repo
      .previewSiteShare(code)
      .then((row) => {
        if (!cancelled) setPreview(row);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [person, code]);

  async function onOpen() {
    if (!code) return;
    setNotice('');
    setWaiting('');
    setLoading(true);
    try {
      const opened = await withShareRetry(() => repo.redeemSiteShare(code));
      if (opened.status === 'approved') {
        router.replace(`/sites/${opened.siteId}/shared`);
        return;
      }
      setWaiting(`${opened.siteName} is waiting for the host to approve your company. You cannot view it yet.`);
    } catch (error) {
      setNotice(shareFailureNotice(classifyShareFailure(error)));
    } finally {
      setLoading(false);
    }
  }

  if (!person) {
    return (
      <Screen>
        <Title>Open a share</Title>
        <Muted>Sign in to your company, then open this link again. The code joins a site your company can view. It does not put you in the other company.</Muted>
        <Button label="Sign in" onPress={() => router.push('/login')} />
        <Button label="Join your company" variant="secondary" minHeight={48} onPress={() => router.push('/join')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Open a share</Title>
      <Muted>This asks the host to let your company view one site. You stay in your company.</Muted>
      {notice ? <SeenRejectNotice message={notice} onDismiss={() => setNotice('')} /> : null}
      {waiting ? <Muted>{waiting}</Muted> : null}
      {preview ? (
        <>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>
            {`${preview.site_name}, shared by ${preview.host_company_name}`}
          </Text>
          <Muted>{sharedSectionLine(preview.sections)}</Muted>
        </>
      ) : null}
      <Button label="Open this site" onPress={() => void onOpen()} loading={loading} disabled={!code} />
    </Screen>
  );
}

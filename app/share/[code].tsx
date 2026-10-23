import { OpenShareScreen } from '@/components/open-share-screen';
import { useLocalSearchParams } from 'expo-router';

export default function OpenShareCodeScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const routeCode = Array.isArray(code) ? code[0] : (code ?? '');
  return <OpenShareScreen routeCode={routeCode} />;
}

import { JoinScreen } from '@/components/join-screen';
import { useLocalSearchParams } from 'expo-router';

export default function JoinWithCode() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const routeCode = Array.isArray(code) ? code[0] : code;
  return <JoinScreen routeCode={routeCode} />;
}

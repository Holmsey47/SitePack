import { ResetScreen } from '@/components/reset-screen';
import { useLocalSearchParams } from 'expo-router';

export default function ResetWithCode() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const routeCode = Array.isArray(code) ? code[0] : code;
  return <ResetScreen routeCode={routeCode} />;
}
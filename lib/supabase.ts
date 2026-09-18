import 'expo-sqlite/localStorage/install';

import { AppState, Platform } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  '';

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);

export const useFixtures =
  process.env.EXPO_PUBLIC_USE_FIXTURES === '1' || !hasSupabaseConfig;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (useFixtures) {
    throw new Error('Supabase client is not used in fixture mode');
  }
  if (!client) {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        storage: globalThis.localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
        flowType: 'pkce',
      },
    });
    if (Platform.OS !== 'web') {
      AppState.addEventListener('change', (state) => {
        if (state === 'active') client?.auth.startAutoRefresh();
        else client?.auth.stopAutoRefresh();
      });
    }
  }
  return client;
}

// Production web export. Fails closed when the hosted Supabase env is missing.
import { spawnSync } from 'node:child_process';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const key =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

if (!url || !key) {
  console.error(
    'Production web build needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
  );
  process.exit(1);
}

if (process.env.EXPO_PUBLIC_USE_FIXTURES === '1') {
  console.error('Production web build must not set EXPO_PUBLIC_USE_FIXTURES.');
  process.exit(1);
}

const result = spawnSync('npx', ['expo', 'export', '--platform', 'web'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);

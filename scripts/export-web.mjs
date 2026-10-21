// Production web export. Fails closed when the hosted Supabase env is missing.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

// Production deploys the prebuilt dist, not the repo root. Copy the SPA
// rewrites and the Referrer-Policy header into that bundle.
const source = path.resolve('vercel.json');
const target = path.resolve('dist/vercel.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log('Wrote dist/vercel.json from vercel.json.');

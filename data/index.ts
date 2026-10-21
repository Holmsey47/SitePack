import type { SitePackRepo } from '@/data/repo';
import { useFixtures } from '@/lib/supabase';

// require() so a production bundle can drop the fixture module when the flag is off.
export const repo: SitePackRepo = useFixtures
  ? (require('@/data/fixtureRepo') as typeof import('@/data/fixtureRepo')).fixtureRepo
  : (require('@/data/supabaseRepo') as typeof import('@/data/supabaseRepo')).supabaseRepo;

export { useFixtures };

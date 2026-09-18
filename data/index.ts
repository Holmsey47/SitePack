import { fixtureRepo } from '@/data/fixtureRepo';
import type { SitePackRepo } from '@/data/repo';
import { supabaseRepo } from '@/data/supabaseRepo';
import { useFixtures } from '@/lib/supabase';

export const repo: SitePackRepo = useFixtures ? fixtureRepo : supabaseRepo;
export { useFixtures };

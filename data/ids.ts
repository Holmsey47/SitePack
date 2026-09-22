export const IDS = {
  company: '11111111-1111-1111-1111-111111111111',
  owner: '22222222-2222-2222-2222-222222222222',
  cm: '33333333-3333-3333-3333-333333333333',
  amy: '44444444-4444-4444-4444-444444444444',
  ben: '55555555-5555-5555-5555-555555555555',
  oak: '66666666-6666-6666-6666-666666666666',
  riverside: '77777777-7777-7777-7777-777777777777',
  warehouse: '88888888-8888-8888-8888-888888888888',
  gfRevB: '99999999-9999-9999-9999-999999999991',
  gfRevC: '99999999-9999-9999-9999-999999999992',
  ffRevA: '99999999-9999-9999-9999-999999999993',
  yard: '99999999-9999-9999-9999-999999999994',
  openRequest: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
} as const;

export const SEED_PASSWORD = 'SitePack123!';

export const SEED_LOGINS = [
  { email: 'owner@sitepack.test', role: 'owner', name: 'Jordan Hale' },
  { email: 'cm@sitepack.test', role: 'cm', name: 'Priya Shah' },
  { email: 'amy@sitepack.test', role: 'operative', name: 'Amy Keane' },
  { email: 'ben@sitepack.test', role: 'operative', name: 'Ben Torres' },
] as const;

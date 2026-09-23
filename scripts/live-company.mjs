#!/usr/bin/env node
// One-time hosted company. Does not load supabase/seed.sql.
// Fixture mode stays for local smokes when the URL is blank.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const LIVE_PROJECT_NAME = 'sitepack-live';
export const DEFAULT_REGION = 'eu-west-2';
export const DEFAULT_WEB_ORIGIN = 'http://127.0.0.1:8081';

/** Existing hosted project. This script must not link, push, or write its keys. */
export const FORBIDDEN_PROJECT_REFS = new Set(['qgmybdpuewenyqhwslpr']);

const FIXTURE_EMAILS = new Set([
  'amy@sitepack.test',
  'ben@sitepack.test',
  'cm@sitepack.test',
  'owner@sitepack.test',
]);

const FIXTURE_COMPANY_NAMES = new Set(['ashfield finishes']);
const FIXTURE_DISPLAY_NAMES = new Set(['jordan hale', 'priya shah', 'amy keane', 'ben torres']);

const REGIONS = new Set([
  'ap-east-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ca-central-1',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'sa-east-1',
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
]);

const SECRET_FLAGS = new Set(['--password', '-p', '--db-password']);

export function assertLiveProjectRef(ref) {
  const value = String(ref ?? '').trim();
  if (!/^[a-z]{20}$/.test(value)) {
    throw new Error('Project ref must be 20 lowercase letters.');
  }
  if (FORBIDDEN_PROJECT_REFS.has(value)) {
    throw new Error('Refusing the existing hosted project. Create sitepack-live instead.');
  }
  return value;
}

export function assertShaunEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('SHAUN_EMAIL must be a real email address.');
  }
  if (FIXTURE_EMAILS.has(value) || value.endsWith('@sitepack.test')) {
    throw new Error('SHAUN_EMAIL cannot be a fixture address. Those stay in seed.sql.');
  }
  return value;
}

export function assertCompanyName(name) {
  const value = String(name ?? '').trim();
  if (value.length < 2 || value.length > 80) {
    throw new Error('COMPANY_NAME must be 2–80 characters.');
  }
  if (FIXTURE_COMPANY_NAMES.has(value.toLowerCase())) {
    throw new Error('COMPANY_NAME cannot be the fixture company.');
  }
  return value;
}

export function assertDisplayName(name) {
  const value = String(name ?? '').trim() || 'Shaun';
  if (value.length > 80) throw new Error('SHAUN_DISPLAY_NAME is too long.');
  if (FIXTURE_DISPLAY_NAMES.has(value.toLowerCase())) {
    throw new Error('SHAUN_DISPLAY_NAME cannot be a fixture person.');
  }
  return value;
}

export function assertPassword(password) {
  const value = String(password ?? '');
  if (value.length < 8) throw new Error('SHAUN_PASSWORD must be at least 8 characters.');
  return value;
}

export function assertDbPassword(password) {
  const value = String(password ?? '');
  if (value.length < 8) throw new Error('SUPABASE_DB_PASSWORD must be at least 8 characters.');
  return value;
}

export function assertRegion(region) {
  const value = String(region ?? DEFAULT_REGION).trim();
  if (!REGIONS.has(value)) throw new Error(`Unsupported region ${value}.`);
  return value;
}

export function inviteRedirect(origin) {
  const base = String(origin ?? DEFAULT_WEB_ORIGIN).trim().replace(/\/$/, '');
  if (!/^https?:\/\/[^/\s]+$/.test(base)) {
    throw new Error('WEB_ORIGIN must be an origin, such as http://127.0.0.1:8081.');
  }
  return `${base}/set-password`;
}

export function redirectUrlsFromConfig(toml) {
  const match = String(toml).match(/additional_redirect_urls\s*=\s*\[([\s\S]*?)\]/);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((found) => found[1]);
}

export function assertInviteRedirect(redirect, toml) {
  const urls = redirectUrlsFromConfig(toml);
  if (!urls.includes(redirect)) {
    throw new Error(`Add ${redirect} to additional_redirect_urls in supabase/config.toml, then run again.`);
  }
  return redirect;
}

export function assertHostedArgs(args) {
  const checked = [];
  for (let i = 0; i < args.length; i += 1) {
    if (SECRET_FLAGS.has(args[i])) {
      i += 1;
      continue;
    }
    checked.push(args[i]);
  }
  const joined = checked.join(' ');
  if (
    checked.includes('--include-seed') ||
    checked.includes('reset') ||
    checked.includes('seed') ||
    joined.includes('seed.sql')
  ) {
    throw new Error('Refusing to load seed.sql onto the hosted project.');
  }
  const refFlag = checked.indexOf('--project-ref');
  if (refFlag !== -1 && checked[refFlag + 1]) assertLiveProjectRef(checked[refFlag + 1]);
  return args;
}

export function createProjectArgs({ orgId, region, password }) {
  if (!orgId) throw new Error('SUPABASE_ORG_ID is required to create the project.');
  return assertHostedArgs([
    'projects',
    'create',
    LIVE_PROJECT_NAME,
    '--org-id',
    orgId,
    '--db-password',
    assertDbPassword(password),
    '--region',
    assertRegion(region),
    '--yes',
  ]);
}

export function linkArgs(ref, password) {
  return assertHostedArgs([
    'link',
    '--project-ref',
    assertLiveProjectRef(ref),
    '--password',
    assertDbPassword(password),
    '--yes',
  ]);
}

export function configPushArgs(ref) {
  return assertHostedArgs(['config', 'push', '--project-ref', assertLiveProjectRef(ref), '--yes']);
}

export function dbPushArgs(password) {
  return assertHostedArgs(['db', 'push', '--linked', '--yes', '--password', assertDbPassword(password)]);
}

export function secretArgs(ref, redirect) {
  return assertHostedArgs([
    'secrets',
    'set',
    `INVITE_REDIRECT_URL=${redirect}`,
    '--project-ref',
    assertLiveProjectRef(ref),
  ]);
}

export function deployArgs(ref) {
  return assertHostedArgs([
    'functions',
    'deploy',
    'invite-person',
    '--project-ref',
    assertLiveProjectRef(ref),
    '--use-api',
    '--yes',
  ]);
}

export function pickOrgId(payload, explicit) {
  if (explicit) return String(explicit).trim();
  const list = Array.isArray(payload) ? payload : payload?.organizations ?? [];
  if (list.length !== 1) {
    throw new Error('Set SUPABASE_ORG_ID. This account does not have exactly one organization.');
  }
  const id = list[0]?.id ?? list[0]?.organization_id;
  if (!id) throw new Error('Organization list had no id.');
  return String(id);
}

export function projectList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.projects)) return payload.projects;
  throw new Error('Could not read the project list.');
}

export function resolveProjectRef(payload, requestedRef) {
  const list = projectList(payload);
  if (requestedRef) {
    const ref = assertLiveProjectRef(requestedRef);
    const found = list.find((project) => (project.id ?? project.ref) === ref);
    if (!found) throw new Error('SITEPACK_PROJECT_REF is not in this account.');
    if (found.name !== LIVE_PROJECT_NAME) {
      throw new Error(`Refusing ${found.name}. This script only touches ${LIVE_PROJECT_NAME}.`);
    }
    return ref;
  }
  const matches = list.filter((project) => project.name === LIVE_PROJECT_NAME);
  if (matches.length > 1) throw new Error(`More than one ${LIVE_PROJECT_NAME} project.`);
  if (matches.length === 0) return null;
  return assertLiveProjectRef(matches[0].id ?? matches[0].ref);
}

export function projectRefFromCreate(payload) {
  const ref = payload?.id ?? payload?.ref ?? payload?.project_ref;
  return assertLiveProjectRef(ref);
}

export function assertLinkedRef(current, next) {
  const linked = String(current ?? '').trim();
  if (!linked) return;
  const safe = assertLiveProjectRef(linked);
  if (safe !== next) {
    throw new Error(`This checkout is linked to ${safe}. Refusing to switch projects.`);
  }
}

function keyList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.keys)) return payload.keys;
  if (Array.isArray(payload?.api_keys)) return payload.api_keys;
  return [];
}

function keyValue(key) {
  return key?.api_key ?? key?.key ?? key?.apiKey ?? key?.value ?? '';
}

export function pickClientKey(payload) {
  const list = keyList(payload);
  const client =
    list.find((key) => String(key.name ?? '').toLowerCase() === 'anon') ??
    list.find((key) => {
      const type = String(key.type ?? '').toLowerCase();
      return type === 'anon' || type === 'publishable';
    });
  const value = keyValue(client);
  if (!value || /service_role|sb_secret_/i.test(value)) {
    throw new Error('No anon or publishable key was returned.');
  }
  return value;
}

export function pickServiceKey(payload) {
  const list = keyList(payload);
  const secret =
    list.find((key) => String(key.name ?? '').toLowerCase() === 'service_role') ??
    list.find((key) => {
      const type = String(key.type ?? '').toLowerCase();
      return type === 'service_role' || type === 'secret';
    });
  const value = keyValue(secret);
  if (!value) throw new Error('No service role key was returned.');
  return value;
}

export function liveUrl(ref) {
  return `https://${assertLiveProjectRef(ref)}.supabase.co`;
}

export function renderEnvLocal(existing, { url, anonKey }) {
  if (!/^https:\/\/[a-z]{20}\.supabase\.co$/.test(url)) {
    throw new Error('Refusing to write a Supabase URL that is not the live project.');
  }
  assertLiveProjectRef(url.slice('https://'.length, -'.supabase.co'.length));
  if (/service_role|sb_secret_/i.test(anonKey) || !anonKey) {
    throw new Error('Refusing to write a secret key into .env.local.');
  }
  const kept = String(existing ?? '')
    .split('\n')
    .filter(
      (line) =>
        line.trim() &&
        !/^EXPO_PUBLIC_SUPABASE_URL=/.test(line) &&
        !/^EXPO_PUBLIC_SUPABASE_ANON_KEY=/.test(line) &&
        !/^EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/.test(line) &&
        !/^EXPO_PUBLIC_USE_FIXTURES=/.test(line),
    );
  return [`EXPO_PUBLIC_SUPABASE_URL=${url}`, `EXPO_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`, ...kept, ''].join('\n');
}

export function dollarQuote(value) {
  let tag = 'sp';
  const text = String(value);
  while (text.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${text}$${tag}$`;
}

export function rowsFromQuery(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.result)) return payload.result;
  throw new Error('Could not read the SQL result.');
}

export function ownerBootstrapSql({ userId, email, displayName, companyName }) {
  const id = String(userId ?? '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new Error('Auth user id is not a uuid.');
  }
  const mail = assertShaunEmail(email);
  const shown = assertDisplayName(displayName);
  const company = assertCompanyName(companyName);
  return `
with inserted as (
  insert into public.companies (name)
  select ${dollarQuote(company)}
  where not exists (select 1 from public.companies)
  returning id, created_at
),
chosen as (
  select id, created_at from inserted
  union all
  select id, created_at from public.companies
  where not exists (select 1 from inserted)
)
insert into public.people (id, auth_user_id, company_id, role, display_name, email)
select ${dollarQuote(id)}::uuid, ${dollarQuote(id)}::uuid, chosen.id, 'owner', ${dollarQuote(shown)}, ${dollarQuote(mail)}
from chosen
where not exists (select 1 from public.people)
order by chosen.created_at
limit 1
`.trim();
}

export const FIXTURE_PROBE_SQL = `
select
  (select count(*)::int from public.people where email ilike '%@sitepack.test') as fixture_people,
  (select count(*)::int from public.companies where name = 'Ashfield Finishes') as fixture_companies
`.trim();

export function assertNoFixtures(payload) {
  const row = rowsFromQuery(payload)[0];
  const people = Number(row?.fixture_people);
  const companies = Number(row?.fixture_companies);
  if (!Number.isInteger(people) || !Number.isInteger(companies)) {
    throw new Error('Could not confirm the project is free of fixture rows. Stop.');
  }
  if (people > 0 || companies > 0) {
    throw new Error('Fixture rows are on this project. seed.sql must not be loaded. Stop.');
  }
}

function readInput() {
  const email = assertShaunEmail(process.env.SHAUN_EMAIL);
  const password = assertPassword(process.env.SHAUN_PASSWORD);
  const companyName = assertCompanyName(process.env.COMPANY_NAME);
  const displayName = assertDisplayName(process.env.SHAUN_DISPLAY_NAME);
  const dbPassword = assertDbPassword(process.env.SUPABASE_DB_PASSWORD);
  const region = assertRegion(process.env.SITEPACK_REGION);
  const toml = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  const redirect = assertInviteRedirect(inviteRedirect(process.env.WEB_ORIGIN), toml);
  const requestedRef = process.env.SITEPACK_PROJECT_REF?.trim() || '';
  if (requestedRef) assertLiveProjectRef(requestedRef);
  return {
    email,
    password,
    companyName,
    displayName,
    dbPassword,
    region,
    redirect,
    requestedRef,
    orgId: process.env.SUPABASE_ORG_ID?.trim() || '',
  };
}

function runSupabase(args, { json = false, secrets = [] } = {}) {
  assertHostedArgs(args);
  const result = spawnSync('npx', ['--yes', 'supabase', ...args, ...(json ? ['-o', 'json'] : [])], {
    cwd: root,
    encoding: 'utf8',
    stdio: json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw new Error(result.error.message);
  if (json) {
    if (result.status !== 0) {
      throw new Error(redact(result.stderr || `supabase ${args[0]} failed.`, secrets));
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error(`supabase ${args[0]} did not return JSON.`);
    }
  }
  if (result.status !== 0) {
    throw new Error(`supabase ${args[0]} ${args[1] ?? ''} failed.`);
  }
  return null;
}

function redact(text, secrets) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('[redacted]');
  }
  return out.trim();
}

function linkedRef() {
  const file = path.join(root, 'supabase/.temp/project-ref');
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').trim();
}

async function ensureAuthUser({ url, serviceKey, email, password, displayName }) {
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    }),
  });
  const body = await response.json().catch(() => ({}));
  const createdId = body?.id ?? body?.user?.id;
  if (response.ok && createdId) return createdId;
  const already = response.status === 422 || body?.error_code === 'email_exists';
  if (!already) {
    const message =
      typeof body?.msg === 'string'
        ? body.msg
        : typeof body?.message === 'string'
          ? body.message
          : 'Could not create the owner login.';
    throw new Error(redact(message, [password, serviceKey]));
  }
  const listed = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const users = await listed.json().catch(() => ({}));
  const rows = Array.isArray(users?.users) ? users.users : Array.isArray(users) ? users : [];
  const match = rows.find((user) => user.email?.toLowerCase() === email);
  if (!match?.id) throw new Error('The owner login already exists, but its id could not be read.');
  return match.id;
}

function queryLinked(sql, secrets) {
  const file = path.join(os.tmpdir(), `sitepack-live-${process.pid}-${Date.now()}.sql`);
  fs.writeFileSync(file, sql, { mode: 0o600 });
  try {
    return runSupabase(['db', 'query', '--linked', '--file', file], { json: true, secrets });
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function existingEnv() {
  const envPath = path.join(root, '.env.local');
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  if (existing.includes('qgmybdpuewenyqhwslpr')) {
    throw new Error('.env.local points at the other hosted project. Move that file aside and run again.');
  }
  return { envPath, existing };
}

async function main() {
  const input = readInput();
  const { envPath, existing } = existingEnv();
  const checking = process.argv.includes('--check');
  if (checking) {
    console.log(`Live company check`);
    console.log(`- project: ${input.requestedRef || `create or reuse ${LIVE_PROJECT_NAME}`} (${input.region})`);
    console.log('- migrations: files in supabase/migrations, seed.sql not included');
    console.log(`- owner: ${input.email} (${input.displayName}), one company`);
    console.log(`- invite redirect: ${input.redirect}`);
    console.log('- keys: .env.local only, not committed');
    console.log('No project was created.');
    return;
  }

  console.log(`Looking for ${LIVE_PROJECT_NAME}.`);
  let projects = projectList(runSupabase(['projects', 'list'], { json: true, secrets: [input.password, input.dbPassword] }));
  let ref = resolveProjectRef(projects, input.requestedRef);
  if (!ref) {
    const orgs = runSupabase(['orgs', 'list'], { json: true, secrets: [input.password, input.dbPassword] });
    const orgId = pickOrgId(orgs, input.orgId);
    console.log(`Creating ${LIVE_PROJECT_NAME} in ${input.region}.`);
    const created = runSupabase(createProjectArgs({ orgId, region: input.region, password: input.dbPassword }), {
      json: true,
      secrets: [input.password, input.dbPassword],
    });
    ref = projectRefFromCreate(created);
    const deadline = Date.now() + 3 * 60 * 1000;
    let status = created?.status ?? '';
    while (status !== 'ACTIVE_HEALTHY' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      projects = projectList(runSupabase(['projects', 'list'], { json: true, secrets: [input.password, input.dbPassword] }));
      status = projects.find((project) => (project.id ?? project.ref) === ref)?.status ?? '';
      console.log(`Waiting for the database (${status || 'starting'}).`);
    }
    if (status !== 'ACTIVE_HEALTHY') {
      throw new Error('The project was created but is not ready yet. Run this script again in a minute.');
    }
  }

  assertLinkedRef(linkedRef(), ref);
  console.log(`Linking ${ref}.`);
  runSupabase(linkArgs(ref, input.dbPassword), { secrets: [input.password, input.dbPassword] });
  console.log('Applying auth config: public signup off, email on, /set-password allowed.');
  runSupabase(configPushArgs(ref), { secrets: [input.password, input.dbPassword] });
  console.log('Pushing migrations. seed.sql is not included.');
  runSupabase(dbPushArgs(input.dbPassword), { secrets: [input.password, input.dbPassword] });

  const probe = queryLinked(FIXTURE_PROBE_SQL, [input.password, input.dbPassword]);
  assertNoFixtures(probe);

  const keys = runSupabase(['projects', 'api-keys', '--project-ref', ref, '--reveal'], {
    json: true,
    secrets: [input.password, input.dbPassword],
  });
  const serviceKey = pickServiceKey(keys);
  const anonKey = pickClientKey(keys);
  const url = liveUrl(ref);
  const userId = await ensureAuthUser({
    url,
    serviceKey,
    email: input.email,
    password: input.password,
    displayName: input.displayName,
  });
  queryLinked(
    ownerBootstrapSql({
      userId,
      email: input.email,
      displayName: input.displayName,
      companyName: input.companyName,
    }),
    [input.password, input.dbPassword, serviceKey],
  );

  console.log('Deploying invite-person.');
  runSupabase(secretArgs(ref, input.redirect), { secrets: [input.password, input.dbPassword, serviceKey] });
  runSupabase(deployArgs(ref), { secrets: [input.password, input.dbPassword, serviceKey] });

  fs.writeFileSync(envPath, renderEnvLocal(existing, { url, anonKey }), { mode: 0o600 });

  console.log('');
  console.log('Bootstrap finished. seed.sql was not loaded.');
  console.log('Restart the web app: npm run web');
  console.log('Home should not say "Running on local seed".');
  console.log('Then run the smoke in docs/live-company.md.');
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Bootstrap failed.');
    process.exit(1);
  });
}

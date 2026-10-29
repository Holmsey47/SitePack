// Checks the prebuild AndroidManifest for the App Link intent filters.
import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve('android/app/src/main/AndroidManifest.xml');
if (!fs.existsSync(manifestPath)) {
  console.error('android/app/src/main/AndroidManifest.xml is missing. Run expo prebuild first.');
  process.exit(1);
}

const xml = fs.readFileSync(manifestPath, 'utf8');
const filters = [...xml.matchAll(/<intent-filter\b([^>]*)>([\s\S]*?)<\/intent-filter>/g)].map((match) => ({
  attrs: match[1],
  body: match[2],
  autoVerify: /android:autoVerify="true"/.test(match[1]),
}));

const expected = new Set([
  'https|sitepack-preview.vercel.app|pathPrefix|/join/',
  'https|sitepack-preview.vercel.app|path|/set-password',
  'https|sitepack-preview.vercel.app|path|/reset',
  'https|sitepack-preview.vercel.app|pathPrefix|/reset/',
]);

function attr(source, name) {
  const found = new RegExp(`android:${name}="([^"]*)"`).exec(source);
  return found ? found[1] : '';
}

function dataSignature(source) {
  const scheme = attr(source, 'scheme');
  const host = attr(source, 'host');
  const pathValue = attr(source, 'path');
  const pathPrefix = attr(source, 'pathPrefix');
  const pathPattern = attr(source, 'pathPattern');
  if (pathPattern) return `${scheme}|${host}|pathPattern|${pathPattern}`;
  if (pathPrefix) return `${scheme}|${host}|pathPrefix|${pathPrefix}`;
  if (pathValue) return `${scheme}|${host}|path|${pathValue}`;
  return `${scheme}|${host}|`;
}

const verified = filters.filter((filter) => filter.autoVerify);
if (verified.length !== 1) {
  console.error(`Expected exactly one autoVerify intent-filter, found ${verified.length}.`);
  process.exit(1);
}

const filter = verified[0];
const action = attr(filter.body, 'name');
const categories = [...filter.body.matchAll(/<category\b[^>]*android:name="([^"]+)"/g)].map((match) => match[1]);
const data = [...filter.body.matchAll(/<data\b([^>]*)\/?>/g)].map((match) => dataSignature(match[1]));
const dataSet = new Set(data);

if (!filter.body.includes('android.intent.action.VIEW') || action.includes('MAIN')) {
  console.error('The autoVerify intent-filter must use VIEW.');
  process.exit(1);
}
for (const category of ['android.intent.category.BROWSABLE', 'android.intent.category.DEFAULT']) {
  if (!categories.includes(category)) {
    console.error(`The autoVerify intent-filter is missing ${category}.`);
    process.exit(1);
  }
}
if (categories.length !== 2) {
  console.error(`The autoVerify intent-filter has unexpected categories: ${categories.join(', ')}`);
  process.exit(1);
}

const missing = [...expected].filter((item) => !dataSet.has(item));
const extra = [...dataSet].filter((item) => !expected.has(item));
if (data.length !== expected.size || missing.length || extra.length) {
  console.error('autoVerify data does not match the join, set-password, and reset paths.');
  console.error(`missing: ${missing.join(' | ') || 'none'}`);
  console.error(`extra: ${extra.join(' | ') || 'none'}`);
  process.exit(1);
}

const blockedPermissions = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.RECORD_AUDIO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];
const permissionTags = [...xml.matchAll(/<uses-permission(?:-sdk-\d+)?\b([^>]*?)\/?>/g)].map((match) => match[1]);
for (const name of blockedPermissions) {
  const tags = permissionTags.filter((tag) => tag.includes(`android:name="${name}"`));
  if (tags.length === 0 || xml.split(name).length - 1 !== tags.length) {
    console.error(`${name} must appear only as a uses-permission tools:node="remove" entry.`);
    process.exit(1);
  }
  if (tags.some((tag) => !/tools:node="remove"/.test(tag))) {
    console.error(`${name} is granted. Block it with tools:node="remove".`);
    process.exit(1);
  }
}

const cameraName = 'android.permission.CAMERA';
const cameraTags = permissionTags.filter((tag) => tag.includes(`android:name="${cameraName}"`));
const cameraGranted = cameraTags.filter((tag) => !/tools:node="remove"/.test(tag));
if (cameraGranted.length < 1 || cameraTags.some((tag) => /tools:node="remove"/.test(tag))) {
  console.error('android.permission.CAMERA must stay granted. Do not block it.');
  process.exit(1);
}

const roleHits = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'build') continue;
      walk(full);
      continue;
    }
    if (!/\.(xml|java|kt|gradle|properties|json)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (text.includes('service_role')) roleHits.push(full);
  }
}
walk(path.resolve('android/app/src'));
if (roleHits.length > 0) {
  console.error('service_role leaked into the Android project:');
  for (const hit of roleHits) console.error(hit);
  process.exit(1);
}

const gradlePath = path.resolve('android/app/build.gradle');
if (!fs.existsSync(gradlePath)) {
  console.error('android/app/build.gradle is missing. Run expo prebuild first.');
  process.exit(1);
}
const gradle = fs.readFileSync(gradlePath, 'utf8');
for (const name of [
  'SITEPACK_KEYSTORE_PATH',
  'SITEPACK_KEYSTORE_PASSWORD',
  'SITEPACK_KEY_ALIAS',
  'SITEPACK_KEY_PASSWORD',
]) {
  if (!gradle.includes(`System.getenv("${name}")`)) {
    console.error(`Release signing must read ${name} from the environment.`);
    process.exit(1);
  }
}
const application = xml.match(/<application\b([^>]*)>/);
if (!application || !/\bandroid:allowBackup="false"/.test(application[1])) {
  console.error('The application tag must set android:allowBackup="false".');
  process.exit(1);
}
if (/\bandroid:allowBackup="true"/.test(xml)) {
  console.error('android:allowBackup="true" is still present.');
  process.exit(1);
}

const buildTypesAt = gradle.indexOf('buildTypes');
const releaseTypeAt = buildTypesAt < 0 ? -1 : gradle.indexOf('release {', buildTypesAt);
if (releaseTypeAt < 0) {
  console.error('app/build.gradle has no release build type.');
  process.exit(1);
}
let depth = 0;
let releaseTypeEnd = -1;
for (let index = gradle.indexOf('{', releaseTypeAt); index < gradle.length; index += 1) {
  if (gradle[index] === '{') depth += 1;
  else if (gradle[index] === '}') {
    depth -= 1;
    if (depth === 0) {
      releaseTypeEnd = index;
      break;
    }
  }
}
const releaseType = releaseTypeEnd < 0 ? '' : gradle.slice(releaseTypeAt, releaseTypeEnd + 1);
if (!releaseType.includes('signingConfig signingConfigs.release')) {
  console.error('Release builds must use signingConfigs.release.');
  process.exit(1);
}
if (releaseType.includes('signingConfigs.debug')) {
  console.error('Release builds must not fall back to the debug signing config.');
  process.exit(1);
}
if (!gradle.includes('throw new GradleException("Release signing is missing "')) {
  console.error('Release signing must fail the build when SITEPACK keystore env is missing.');
  process.exit(1);
}
if (!/debug \{\s*signingConfig signingConfigs\.debug/.test(gradle)) {
  console.error('Debug builds must keep signingConfigs.debug.');
  process.exit(1);
}
if (gradle.includes('storePassword "') || gradle.includes("storePassword 'upload'")) {
  console.error('Release store password must not be written into build.gradle.');
  process.exit(1);
}

const gradlePropertiesPath = path.resolve('android/gradle.properties');
if (!fs.existsSync(gradlePropertiesPath)) {
  console.error('android/gradle.properties is missing. Run expo prebuild first.');
  process.exit(1);
}
const architectures = [...fs.readFileSync(gradlePropertiesPath, 'utf8').matchAll(/^reactNativeArchitectures=(.*)$/gm)].map(
  (match) => match[1]
);
if (architectures.length !== 1 || architectures[0] !== 'arm64-v8a') {
  console.error(`reactNativeArchitectures must be arm64-v8a. Found: ${architectures.join(' | ') || 'none'}`);
  process.exit(1);
}

const autoStart = xml.indexOf('android:autoVerify="true"');
const start = xml.lastIndexOf('<intent-filter', autoStart);
const end = xml.indexOf('</intent-filter>', autoStart) + '</intent-filter>'.length;
console.log(xml.slice(start, end));
console.log('AndroidManifest autoVerify intent-filter matches uk.sitepack.app App Links.');
console.log('Blocked permissions are present only as tools:node="remove".');
console.log('service_role grep: clean.');
console.log('android:allowBackup is false.');
console.log('Release signing reads SITEPACK_KEYSTORE_* from the environment and fails closed.');
console.log('reactNativeArchitectures is arm64-v8a.');

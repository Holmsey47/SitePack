export function formatAppVersionLine(input: {
  name?: string | null;
  version?: string | null;
  build?: string | null;
}): string {
  const name = input.name?.trim() || 'SitePack';
  const version = input.version?.trim() || '';
  const build = input.build?.trim() || '';
  if (version && build) return `${name} ${version} (${build})`;
  if (version) return `${name} ${version}`;
  return name;
}

/** Installed binary first. Web has no native build, so the embedded app config fills in. */
export function readAppVersion(input: {
  nativeApplicationVersion: string | null;
  nativeBuildVersion: string | null;
  configName?: string | null;
  configVersion?: string | null;
  configVersionCode?: number | null;
}): string {
  const version = input.nativeApplicationVersion || input.configVersion || null;
  const build =
    input.nativeBuildVersion ||
    (input.configVersionCode != null ? String(input.configVersionCode) : null);
  return formatAppVersionLine({ name: input.configName, version, build });
}

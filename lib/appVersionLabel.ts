import * as Application from 'expo-application';
import Constants from 'expo-constants';

import { readAppVersion } from '@/lib/appVersion';

/** Runtime version from the installed app. Not a hard-coded string. */
export function appVersionLine(): string {
  const config = Constants.expoConfig;
  return readAppVersion({
    nativeApplicationVersion: Application.nativeApplicationVersion,
    nativeBuildVersion: Application.nativeBuildVersion,
    configName: config?.name ?? null,
    configVersion: config?.version ?? null,
    configVersionCode: config?.android?.versionCode ?? null,
  });
}

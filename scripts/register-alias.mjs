import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
    const base = new URL(`../${specifier.slice(2)}`, import.meta.url);
    const withTs = new URL(`${base.href}.ts`);
    if (existsSync(fileURLToPath(withTs))) return nextResolve(withTs.href, context);
    return nextResolve(base.href, context);
  },
});

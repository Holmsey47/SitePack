import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

function resolveSource(base) {
  if (existsSync(fileURLToPath(base))) return base;
  for (const ext of ['.ts', '.tsx']) {
    const candidate = new URL(`${base.href}${ext}`);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return base;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = new URL(`../${specifier.slice(2)}`, import.meta.url);
      return nextResolve(resolveSource(base).href, context);
    }
    const parent = context.parentURL ?? '';
    const inApp = parent.includes('/workspace/') && !parent.includes('/node_modules/');
    if (inApp && (specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
      return nextResolve(resolveSource(new URL(specifier, parent)).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: url,
    });
    return {
      format: 'module',
      source: `const __DEV__ = globalThis.__DEV__ ?? false;\n${outputText}`,
      shortCircuit: true,
    };
  },
});

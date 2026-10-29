import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import TestRenderer from 'react-test-renderer';

const reactNativeMock = new URL('../scripts/react-native-mock.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'react-native') return nextResolve(reactNativeMock, context);
    return nextResolve(specifier, context);
  },
});

test('open, then Cancel, closes the menu, and the backdrop does too', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { MenuHost } = await import('./menu-sheet.tsx');
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      createElement(MenuHost, {
        items: [{ label: 'Share / Save', onPress() {} }],
      }),
    );
  });
  const open = () => renderer.root.findByProps({ accessibilityLabel: 'More' }).props.onPress();
  const sheet = () => renderer.root.findAllByProps({ testID: 'overflow-backdrop' });

  assert.equal(sheet().length, 0);
  await TestRenderer.act(async () => {
    open();
  });
  assert.equal(sheet().length > 0, true);

  await TestRenderer.act(async () => {
    renderer.root.findAllByProps({ testID: 'overflow-cancel' })[0].props.onPress();
  });
  assert.equal(sheet().length, 0);

  await TestRenderer.act(async () => {
    open();
  });
  assert.equal(sheet().length > 0, true);
  await TestRenderer.act(async () => {
    sheet()[0].props.onPress();
  });
  assert.equal(sheet().length, 0);

  const pdf = fs.readFileSync('app/(app)/pdf.tsx', 'utf8');
  const options = pdf.slice(pdf.indexOf('navigation.setOptions'), pdf.indexOf('useEffect'));
  assert.equal(options.includes('OverflowMenu'), false);
  assert.equal(options.includes('headerRight'), false);
  assert.match(pdf, /<OverflowMenu label="More" items=\{\[\{ label: 'Share \/ Save'/);
  const menu = fs.readFileSync('components/ui.tsx', 'utf8');
  const shareRow = menu.slice(menu.indexOf('export function OverflowMenu'), menu.indexOf('export function LogoSlot'));
  assert.match(shareRow, /<MenuSheet/);
  const sheetSource = fs.readFileSync('components/menu-sheet.tsx', 'utf8');
  assert.match(sheetSource, /minHeight: hit\.secondary/);
  assert.match(sheetSource, /testID="overflow-cancel"/);
  assert.match(sheetSource, /testID="overflow-backdrop"/);
  const nudge = fs.readFileSync('components/sign-nudge.tsx', 'utf8');
  assert.match(nudge, /theme\.current/);
  assert.match(nudge, /chevron_right/);
  assert.equal(/#[0-9A-Fa-f]{3,8}/.test(nudge), false);
});

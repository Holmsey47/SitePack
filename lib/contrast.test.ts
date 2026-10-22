import assert from 'node:assert/strict';
import test from 'node:test';
import { contrastRatio } from './contrast.ts';
import { theme } from './theme.ts';

test('the out of date badge contrast is at least 4.5', () => {
  const ratio = contrastRatio(theme.currentInk, theme.open);
  assert.ok(ratio >= 4.5, `ink on open is ${ratio.toFixed(2)}`);
  assert.ok(contrastRatio('#F4F1EA', '#D96B4F') < 4.5);
});

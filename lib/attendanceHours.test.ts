import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWeekSheet,
  clockGap,
  CLOCK_GAP_MS,
  decimalHours,
  FLAG_CORRECTED,
  FLAG_FORGOT,
  FLAG_GAP,
  forgottenClose,
  formatHours,
  hoursOnLondonDay,
  londonCloseIso,
  londonDateKey,
  londonDayEndMs,
  londonDayStartMs,
  londonWallIso,
  londonWeekStart,
  OVERNIGHT_GRACE_HOUR,
  weekCsv,
  type HourSpan,
} from './attendanceHours.ts';

function span(partial: Partial<HourSpan> & Pick<HourSpan, 'inAt' | 'outAt'>): HourSpan {
  return {
    personId: partial.personId ?? 'amy',
    personName: partial.personName ?? 'Amy Keane',
    forgot: partial.forgot ?? false,
    gap: partial.gap ?? false,
    corrected: partial.corrected ?? false,
    inAt: partial.inAt,
    outAt: partial.outAt,
  };
}

test('a shift across midnight splits onto both London days and the total matches', () => {
  const inAt = '2026-10-20T21:00:00.000Z';
  const outAt = '2026-10-21T05:00:00.000Z';
  assert.equal(londonDateKey(inAt), '2026-10-20');
  assert.equal(londonDateKey(outAt), '2026-10-21');
  assert.equal(hoursOnLondonDay(inAt, outAt, '2026-10-20'), 2 * 60 * 60 * 1000);
  assert.equal(hoursOnLondonDay(inAt, outAt, '2026-10-21'), 6 * 60 * 60 * 1000);
  const week = londonWeekStart(inAt);
  assert.equal(week, '2026-10-19');
  const [row] = buildWeekSheet([span({ inAt, outAt })], week, '2026-10-22T12:00:00.000Z');
  assert.equal(row?.days[1], '2h 00m');
  assert.equal(row?.days[2], '6h 00m');
  assert.equal(row?.total, '8h 00m');
  assert.equal(row?.totalMs, row?.dayMs.reduce((sum, ms) => sum + ms, 0));
});

test('the last Sunday in March is a 23 hour day and a 00:30 to 03:30 shift is 2 hours', () => {
  assert.equal(londonDayEndMs('2026-03-29') - londonDayStartMs('2026-03-29'), 23 * 60 * 60 * 1000);
  const inAt = '2026-03-29T00:30:00.000Z';
  const outAt = '2026-03-29T02:30:00.000Z';
  assert.equal(londonDateKey(inAt), '2026-03-29');
  assert.equal(londonDateKey(outAt), '2026-03-29');
  const [row] = buildWeekSheet([span({ inAt, outAt })], '2026-03-23', '2026-03-30T12:00:00.000Z');
  assert.equal(row?.days[6], '2h 00m');
  assert.equal(row?.total, '2h 00m');
});

test('the last Sunday in October is a 25 hour day and a 00:30 to 03:30 shift is 4 hours', () => {
  assert.equal(londonDayEndMs('2026-10-25') - londonDayStartMs('2026-10-25'), 25 * 60 * 60 * 1000);
  const inAt = '2026-10-24T23:30:00.000Z';
  const outAt = '2026-10-25T03:30:00.000Z';
  assert.equal(londonDateKey(inAt), '2026-10-25');
  assert.equal(londonDateKey(outAt), '2026-10-25');
  const [row] = buildWeekSheet([span({ inAt, outAt })], '2026-10-19', '2026-10-26T12:00:00.000Z');
  assert.equal(row?.days[6], '4h 00m');
  assert.equal(row?.total, '4h 00m');
});

test('a forgotten sign-out closes at 23:59 Europe/London and a second pass stays there', () => {
  const inAt = '2026-10-20T20:00:00.000Z';
  const now = '2026-10-21T08:00:00.000Z';
  const closed = forgottenClose(inAt, null, now);
  assert.equal(closed?.forgot, true);
  assert.equal(closed?.outAt, londonCloseIso(inAt));
  assert.equal(londonDateKey(closed?.outAt ?? ''), '2026-10-20');
  assert.equal(closed?.outAt, '2026-10-20T22:59:00.000Z');
  assert.equal(forgottenClose(inAt, closed?.outAt ?? null, now), null);
  const [row] = buildWeekSheet([span({ inAt, outAt: null })], '2026-10-19', now);
  assert.equal(row?.days[1], '2h 59m');
  assert.equal(row?.total, formatHours(row?.totalMs ?? 0));
});

test('a sign-out before 06:00 London keeps the real time and 07:00 is a forgotten close', () => {
  assert.equal(OVERNIGHT_GRACE_HOUR, 6);
  const inAt = londonWallIso('2026-10-20', 22, 0);
  const atTwo = londonWallIso('2026-10-21', 2, 0);
  const atSix = londonWallIso('2026-10-21', 6, 0);
  assert.equal(forgottenClose(inAt, null, atTwo), null);
  const [open] = buildWeekSheet([span({ inAt, outAt: atTwo })], '2026-10-19', atTwo);
  assert.equal(open?.days[1], '2h 00m');
  assert.equal(open?.days[2], '2h 00m');
  assert.equal(open?.total, '4h 00m');
  const closed = forgottenClose(inAt, null, atSix);
  assert.equal(closed?.forgot, true);
  assert.equal(closed?.outAt, londonCloseIso(inAt));
  assert.equal(forgottenClose(inAt, closed?.outAt ?? null, atSix), null);
});

test('two days of 1h 00m 40s floor to whole minutes before the total', () => {
  const tueIn = '2026-10-20T07:00:00.000Z';
  const tueOut = '2026-10-20T08:00:40.000Z';
  const wedIn = '2026-10-21T07:00:00.000Z';
  const wedOut = '2026-10-21T08:00:40.000Z';
  assert.equal(hoursOnLondonDay(tueIn, tueOut, '2026-10-20'), 60 * 60 * 1000 + 40 * 1000);
  const [row] = buildWeekSheet(
    [span({ inAt: tueIn, outAt: tueOut }), span({ inAt: wedIn, outAt: wedOut })],
    '2026-10-19',
    '2026-10-22T12:00:00.000Z'
  );
  assert.equal(row?.days[1], '1h 00m');
  assert.equal(row?.days[2], '1h 00m');
  assert.equal(row?.total, '2h 00m');
  assert.equal(row?.totalMs, (row?.dayMs ?? []).reduce((sum, ms) => sum + ms, 0));
  assert.equal(decimalHours(row?.totalMs ?? 0), '2.00');
});

test('CSV totals match the sheet totals', () => {
  const rows = buildWeekSheet(
    [
      span({ personId: 'amy', personName: 'Amy Keane', inAt: '2026-10-20T21:00:00.000Z', outAt: '2026-10-21T05:00:00.000Z' }),
      span({ personId: 'ben', personName: 'Ben, Torres', inAt: '2026-10-19T08:00:00.000Z', outAt: '2026-10-19T16:30:00.000Z' }),
    ],
    '2026-10-19',
    '2026-10-22T12:00:00.000Z'
  );
  const flagged = buildWeekSheet(
    [
      span({
        personId: 'lee',
        personName: '=Lee',
        inAt: '2026-10-20T08:00:00.000Z',
        outAt: '2026-10-20T16:00:00.000Z',
        forgot: true,
        gap: true,
        corrected: true,
      }),
    ],
    '2026-10-19',
    '2026-10-22T12:00:00.000Z'
  );
  const csv = weekCsv([...rows, ...flagged], '@Oak', '2026-10-19');
  const lines = csv.split('\n').slice(1);
  assert.equal(lines.length, rows.length + flagged.length);
  lines.forEach((line, index) => {
    const row = [...rows, ...flagged][index];
    assert.ok(row);
    assert.match(line, new RegExp(`${row.total},${decimalHours(row.totalMs)}`));
    assert.equal(row.dayMs.reduce((sum, ms) => sum + ms, 0), row.totalMs);
    assert.equal(formatHours(row.totalMs), row.total);
  });
  assert.match(csv, /Site,Week,Person,/);
  assert.match(csv, /"Ben, Torres"/);
  assert.match(csv, /'@Oak/);
  assert.match(csv, /'=Lee/);
  assert.match(csv, new RegExp(`${FLAG_FORGOT}; ${FLAG_GAP}; ${FLAG_CORRECTED}`));
});

test('a clock gap is only more than 10 minutes', () => {
  const received = '2026-10-22T08:00:00.000Z';
  const ten = new Date(new Date(received).getTime() - CLOCK_GAP_MS).toISOString();
  const over = new Date(new Date(received).getTime() - CLOCK_GAP_MS - 1).toISOString();
  assert.equal(clockGap(ten, received), false);
  assert.equal(clockGap(over, received), true);
});

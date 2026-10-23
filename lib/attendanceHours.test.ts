import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildWeekSheet,
  clockGap,
  CLOCK_GAP_MS,
  decimalHours,
  FLAG_CORRECTED,
  FLAG_FORGOT,
  FLAG_GAP,
  FLAG_LATE,
  FORGOT_YESTERDAY_NOTICE,
  forgottenClose,
  forgotLineForVisit,
  forgotYesterday,
  formatHours,
  graceCouldOwn,
  graceHolds,
  hoursOnLondonDay,
  londonCloseIso,
  londonDateKey,
  londonDayEndMs,
  londonDayStartMs,
  londonWallIso,
  londonWeekStart,
  OVERNIGHT_GRACE_HOUR,
  OVERNIGHT_HOLD_HOURS,
  OVERNIGHT_START_HOUR,
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
    late: partial.late ?? false,
    correctedBy: partial.correctedBy,
    reason: partial.reason,
    prior: partial.prior,
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
  assert.equal(row?.days[1], 'not signed out (in 9:00pm)');
  assert.equal(row?.dayLines[0], 'Tue: not signed out (in 9:00pm)');
  assert.equal(row?.total, '0h 00m');
  assert.equal(row?.totalMs, 0);
  assert.equal(row?.totalLine, 'Total 0h 00m + 1 shift to check');
  assert.equal(formatHours(row?.totalMs ?? 0), row?.total);
});

test('a day shift is closed at 05:30 and a 22:00 shift is still held', () => {
  const dayIn = londonWallIso('2026-10-20', 7, 0);
  const early = londonWallIso('2026-10-21', 5, 30);
  const closed = forgottenClose(dayIn, null, early);
  assert.equal(closed?.forgot, true);
  assert.equal(closed?.outAt, londonCloseIso(dayIn));
  assert.equal(londonDateKey(closed?.outAt ?? ''), '2026-10-20');
  const evening = londonWallIso('2026-10-20', 22, 0);
  assert.equal(forgottenClose(evening, null, early), null);
  assert.equal(graceHolds(evening, early), true);
  assert.equal(graceHolds(evening, londonWallIso('2026-10-21', 6, 0)), false);
  assert.equal(graceCouldOwn(evening, londonWallIso('2026-10-21', 7, 0)), true);
  assert.equal(graceCouldOwn(dayIn, early), false);
  assert.equal(graceCouldOwn(evening, londonWallIso('2026-10-23', 10, 0)), false);
});

test('the phone constants match the migration grace literals', () => {
  assert.equal(OVERNIGHT_GRACE_HOUR, 6);
  assert.equal(OVERNIGHT_START_HOUR, 14);
  assert.equal(OVERNIGHT_HOLD_HOURS, 24 - OVERNIGHT_START_HOUR + OVERNIGHT_GRACE_HOUR);
  assert.equal(OVERNIGHT_HOLD_HOURS, 16);
  const sql = fs.readFileSync('supabase/migrations/20261022180000_site_attendance.sql', 'utf8');
  const count = (needle: string) => sql.split(needle).length - 1;
  assert.equal(count(`time '${String(OVERNIGHT_GRACE_HOUR).padStart(2, '0')}:00'`), 1);
  assert.equal(count(`time '${String(OVERNIGHT_START_HOUR).padStart(2, '0')}:00'`), 1);
  assert.equal(count(`interval '${OVERNIGHT_HOLD_HOURS} hours'`), 1);
  assert.match(sql, /October clock-change night/);
  assert.match(sql, /loses the hold at 05:00 GMT/);
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
        correctedBy: 'Jordan Hale',
        reason: 'Closed at four',
        prior: 'was not signed out',
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
  assert.match(csv, /Corrected by,Reason/);
  assert.match(csv, new RegExp(FLAG_GAP));
  assert.equal(csv.includes(FLAG_FORGOT), false);
  assert.equal(csv.includes(`,${FLAG_CORRECTED},`), false);
  assert.match(csv, /Jordan Hale,Closed at four/);
  const guarded = weekCsv(
    buildWeekSheet(
      [span({ personId: 'lee', personName: '\t=cmd', inAt: '2026-10-20T08:00:00.000Z', outAt: '2026-10-20T16:00:00.000Z', late: true })],
      '2026-10-19',
      '2026-10-22T12:00:00.000Z'
    ),
    '\r@Oak',
    '2026-10-19'
  );
  assert.match(guarded, /'\t=cmd/);
  assert.match(guarded, /"'\r@Oak"/);
  const embedded = weekCsv(
    buildWeekSheet(
      [span({ personId: 'ann', personName: 'Ann\rBob "C"', inAt: '2026-10-20T08:00:00.000Z', outAt: '2026-10-20T16:00:00.000Z' })],
      '2026-10-19',
      '2026-10-22T12:00:00.000Z'
    ),
    'Oak',
    '2026-10-19'
  );
  assert.match(embedded, /"Ann\rBob ""C"""/);
  const separated = weekCsv(
    buildWeekSheet(
      [span({ personId: 'nel', personName: 'Ann\u0085\u2028\u202eBob', inAt: '2026-10-20T08:00:00.000Z', outAt: '2026-10-20T16:00:00.000Z' })],
      '2026-10-19',
      '2026-10-22T12:00:00.000Z'
    ),
    'Oak',
    '2026-10-19'
  );
  assert.match(separated, /Ann   Bob/);
  assert.equal(separated.includes('\u0085'), false);
  assert.equal(separated.includes('\u202e'), false);
  const newline = weekCsv(
    buildWeekSheet(
      [span({ personId: 'ann', personName: 'Ann\nBob', inAt: '2026-10-20T08:00:00.000Z', outAt: '2026-10-20T16:00:00.000Z' })],
      '2026-10-19',
      '2026-10-22T12:00:00.000Z'
    ),
    'Oak',
    '2026-10-19'
  );
  assert.equal(newline.includes('"Ann\nBob"'), true);
  assert.match(guarded, new RegExp(FLAG_LATE));
  assert.equal(guarded.includes(`,${FLAG_CORRECTED},`), false);
  const quotedReason = weekCsv(
    buildWeekSheet(
      [
        span({
          personId: 'lee',
          personName: 'Lee',
          inAt: '2026-10-20T08:00:00.000Z',
          outAt: '2026-10-20T16:00:00.000Z',
          forgot: true,
          corrected: true,
          correctedBy: '\r=Boss',
          reason: '=\rLeft\rnow',
          prior: 'was a late sign-out',
        }),
      ],
      '2026-10-19',
      '2026-10-22T12:00:00.000Z'
    ),
    'Oak',
    '2026-10-19'
  );
  assert.match(quotedReason, /"'\r=Boss"/);
  assert.match(quotedReason, /"'=\rLeft\rnow"/);
});

test('an uncorrected not-signed-out shift stays out of the day, the week, and the CSV until it is corrected', () => {
  const inAt = londonWallIso('2026-10-21', 8, 0);
  const later = londonWallIso('2026-10-21', 9, 0);
  const now = londonWallIso('2026-10-22', 9, 0);
  const [open] = buildWeekSheet([span({ inAt, outAt: null })], '2026-10-19', now);
  assert.equal(open?.dayLines.join('\n'), 'Wed: not signed out (in 8:00am)');
  assert.equal(open?.days[2], 'not signed out (in 8:00am)');
  assert.equal(open?.dayLines.includes('Mon: '), false);
  assert.equal(open?.totalLine, 'Total 0h 00m + 1 shift to check');
  assert.equal(open?.totalMs, 0);
  const csv = weekCsv(open ? [open] : [], 'Oak', '2026-10-19');
  assert.match(csv, /Site,Week,Person,Mon,Tue,Wed,Thu,Fri,Sat,Sun,Total,Decimal hours,Flags,Corrected by,Reason/);
  assert.match(csv, /Amy Keane,,,not signed out \(in 8:00am\),,,,,0h 00m \+ 1 shift to check,,Not signed out,,/);
  assert.equal(csv.includes('0.00'), false);
  assert.equal(csv.includes('15h'), false);
  const [pair] = buildWeekSheet(
    [span({ inAt, outAt: null }), span({ inAt: later, outAt: null })],
    '2026-10-19',
    now
  );
  assert.equal(pair?.totalLine, 'Total 0h 00m + 2 shifts to check');
  assert.match(weekCsv(pair ? [pair] : [], 'Oak', '2026-10-19'), /2 shifts to check,,Not signed out/);
  const [fixed] = buildWeekSheet(
    [
      span({
        inAt,
        outAt: londonWallIso('2026-10-21', 16, 0),
        forgot: true,
        corrected: true,
        correctedBy: 'Jordan Hale',
        reason: 'Left at four',
        prior: 'was not signed out',
      }),
    ],
    '2026-10-19',
    now
  );
  assert.equal(fixed?.dayLines[0], 'Wed: 8h 00m');
  assert.equal(fixed?.total, '8h 00m');
  assert.equal(fixed?.totalLine, 'Total 8h 00m');
  assert.equal(fixed?.checkCount, 0);
  assert.equal(fixed?.shifts[0]?.correction, 'Corrected by Jordan Hale: was not signed out');
  assert.equal(fixed?.shifts[0]?.reason, 'Left at four');
  assert.equal(fixed?.shifts[0]?.flags.includes(FLAG_FORGOT), false);
  assert.equal(fixed?.shifts[0]?.flags.includes(FLAG_CORRECTED), false);
  assert.match(weekCsv(fixed ? [fixed] : [], 'Oak', '2026-10-19'), /8h 00m,8\.00,,Jordan Hale,Left at four/);
  const tinyOut = new Date(new Date(inAt).getTime() + 30_000).toISOString();
  const [tiny] = buildWeekSheet([span({ inAt, outAt: tinyOut })], '2026-10-19', now);
  assert.match(weekCsv(tiny ? [tiny] : [], 'Oak', '2026-10-19'), /0h 00m,0\.00/);
});

test('the next-morning notice is only for the owner of yesterday’s forgotten shift, and only once', () => {
  const now = londonWallIso('2026-10-22', 9, 0);
  const rows = [
    {
      entryId: 'e1',
      personId: 'amy',
      inAt: londonWallIso('2026-10-21', 8, 0),
      forgot: true,
      corrected: false,
    },
    {
      entryId: 'e2',
      personId: 'ben',
      inAt: londonWallIso('2026-10-21', 8, 0),
      forgot: true,
      corrected: false,
    },
  ];
  const hit = forgotYesterday(rows, now, 'amy', new Set());
  assert.equal(hit?.entryId, 'e1');
  assert.equal(hit?.message, FORGOT_YESTERDAY_NOTICE);
  assert.equal(forgotYesterday(rows, now, 'ben', new Set())?.entryId, 'e2');
  assert.equal(forgotYesterday(rows, now, 'chris', new Set()), null);
  assert.equal(forgotYesterday(rows, now, 'amy', new Set(['e1'])), null);
  assert.equal(
    forgotYesterday([{ ...rows[0], corrected: true }], now, 'amy', new Set()),
    null
  );
  assert.equal(
    forgotYesterday([{ ...rows[0], forgot: false }], now, 'amy', new Set()),
    null
  );
  assert.equal(
    forgotYesterday([{ ...rows[0], inAt: londonWallIso('2026-10-22', 8, 0) }], now, 'amy', new Set()),
    null
  );
  assert.equal(forgotLineForVisit(rows, now, 'amy', new Set(), true), null);
  assert.equal(forgotLineForVisit(rows, now, 'amy', new Set(), false)?.message, FORGOT_YESTERDAY_NOTICE);
});

test('a clock gap is only more than 10 minutes', () => {
  const received = '2026-10-22T08:00:00.000Z';
  const ten = new Date(new Date(received).getTime() - CLOCK_GAP_MS).toISOString();
  const over = new Date(new Date(received).getTime() - CLOCK_GAP_MS - 1).toISOString();
  assert.equal(clockGap(ten, received), false);
  assert.equal(clockGap(over, received), true);
});

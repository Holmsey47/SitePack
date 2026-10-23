import { Button, Card, EmptyState, Muted, Screen, Title } from '@/components/ui';
import { attendanceError, forgotLine, gapLine, type AttendanceEntry, type WeeklyAttendance } from '@/data/attendance';
import { repo } from '@/data/index';
import { formatUkDateTime } from '@/lib/format';
import {
  buildWeekSheet,
  clockGap,
  londonWeekStart,
  preparedLine,
  shiftWeek,
  weekCsv,
  weekRangeLabel,
  WEEK_DAYS,
  type HourSpan,
  type WeekRow,
} from '@/lib/attendanceHours';
import { attendancePdfFilename, buildAttendancePdf } from '@/lib/attendancePdf';
import { saveSheet } from '@/lib/saveSheet';
import { theme } from '@/lib/theme';
import { File as PhoneFile, Paths } from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

function spansFrom(sheet: WeeklyAttendance | null): HourSpan[] {
  if (!sheet) return [];
  return sheet.entries.map((entry) => ({
    personId: entry.person_id,
    personName: entry.person_name,
    inAt: entry.in_at,
    outAt: entry.out_at,
    forgot: entry.forgot_sign_out,
    gap: Boolean(
      entry.in_gap ||
        entry.out_gap ||
        (entry.late_out_device_at && entry.late_out_received_at && clockGap(entry.late_out_device_at, entry.late_out_received_at))
    ),
    corrected: (entry.audit?.length ?? 0) > 0,
  }));
}

function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type });
}

export default function WeeklyHoursScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(() => londonWeekStart(new Date().toISOString()));
  const [rows, setRows] = useState<WeekRow[] | null>(null);
  const [entries, setEntries] = useState<AttendanceEntry[]>([]);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const thisWeek = londonWeekStart(new Date().toISOString());

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const sheet = await repo.weeklyAttendance(siteId, weekStart);
      if (sheet == null) {
        setHidden(true);
        setRows(null);
        setEntries([]);
      } else {
        setHidden(false);
        setEntries(sheet.entries);
        setRows(buildWeekSheet(spansFrom(sheet), weekStart, new Date().toISOString()));
      }
      setError('');
    } catch (err) {
      setError(attendanceError(err instanceof Error ? err.message : 'unknown'));
    }
  }, [siteId, weekStart]);

  useEffect(() => {
    load().catch(() => setError('Could not load the sheet.'));
  }, [load]);

  async function shareFile(name: string, bytes: Uint8Array, mime: string) {
    if (Platform.OS === 'web') {
      const blob = bytesToBlob(bytes, mime);
      const file = new globalThis.File([blob], name, { type: mime });
      const nav = navigator as Navigator & { canShare?: (data: { files?: File[] }) => boolean };
      if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: name.replace(/\.(pdf|csv)$/, '') });
        return;
      }
      const url = URL.createObjectURL(blob);
      if (mime === 'application/pdf') {
        await saveSheet(url, name);
        return;
      }
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      return;
    }
    const local = new PhoneFile(Paths.cache, name);
    local.write(bytes);
    await Sharing.shareAsync(local.uri, { mimeType: mime, UTI: mime === 'application/pdf' ? 'com.adobe.pdf' : 'public.comma-separated-values-text' });
  }

  async function onCsv() {
    if (!rows) return;
    setBusy(true);
    setError('');
    try {
      const site = await repo.getSite(siteId ?? '');
      const name = `Hours week ${weekStart}.csv`;
      await shareFile(name, new TextEncoder().encode(weekCsv(rows, site?.name ?? 'Site', weekStart)), 'text/csv');
    } catch {
      setError('Could not share the sheet.');
    } finally {
      setBusy(false);
    }
  }

  async function onPdf() {
    if (!siteId || !rows) return;
    setBusy(true);
    setError('');
    try {
      const [company, site] = await Promise.all([repo.companyName(), repo.getSite(siteId)]);
      const generatedAt = new Date().toISOString();
      const { bytes } = await buildAttendancePdf({
        companyName: company,
        siteName: site?.name ?? 'Site',
        weekStart,
        generatedAt,
        rows,
      });
      await shareFile(attendancePdfFilename(site?.name ?? 'Site', weekStart), bytes, 'application/pdf');
    } catch {
      setError('Could not share the sheet.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Weekly hours</Title>
      <Muted>{weekRangeLabel(weekStart)}</Muted>
      <Muted>{preparedLine(new Date().toISOString())}</Muted>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button label="Previous week" variant="secondary" minHeight={48} onPress={() => setWeekStart(shiftWeek(weekStart, -1))} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Next week"
            variant="secondary"
            minHeight={48}
            disabled={weekStart >= thisWeek}
            onPress={() => setWeekStart(shiftWeek(weekStart, 1))}
          />
        </View>
      </View>
      {error ? <Text style={{ color: theme.danger, fontSize: 16 }}>{error}</Text> : null}
      {hidden ? <EmptyState title="You cannot see this sheet." /> : null}
      {rows && rows.length === 0 ? <EmptyState title="No hours this week" /> : null}
      {rows?.map((row) => (
        <Card key={row.personId}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>{row.personName}</Text>
          {WEEK_DAYS.map((day, index) => (
            <Text key={day} style={{ color: theme.text, fontSize: 16, minHeight: 28 }}>
              {day} {row.days[index]}
            </Text>
          ))}
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>Total {row.total}</Text>
          {entries
            .filter((entry) => entry.person_id === row.personId)
            .map((entry) => (
              <Pressable
                key={entry.entry_id}
                accessibilityRole="button"
                accessibilityLabel={`Correct ${entry.person_name}`}
                onPress={() => router.push(`/sites/${siteId}/attendance/${entry.entry_id}`)}
                style={{ minHeight: 48, justifyContent: 'center' }}>
                <Text style={{ color: theme.text, fontSize: 16 }}>
                  {formatUkDateTime(entry.in_at)}
                  {entry.out_at ? ` – ${formatUkDateTime(entry.out_at)}` : ' · still in'}
                </Text>
                {forgotLine(entry) ? <Text style={{ color: theme.text, fontWeight: '800' }}>{forgotLine(entry)}</Text> : null}
                {gapLine(entry) ? <Text style={{ color: theme.text, fontWeight: '800' }}>{gapLine(entry)}</Text> : null}
                {entry.audit && entry.audit.length > 0 ? (
                  <Text style={{ color: theme.text, fontWeight: '800' }}>Corrected</Text>
                ) : null}
              </Pressable>
            ))}
        </Card>
      ))}
      {rows ? (
        <View style={{ gap: 8 }}>
          <Button label="Share CSV" minHeight={56} loading={busy} onPress={() => void onCsv()} />
          <Button label="Share PDF" minHeight={56} loading={busy} onPress={() => void onPdf()} />
        </View>
      ) : null}
    </Screen>
  );
}

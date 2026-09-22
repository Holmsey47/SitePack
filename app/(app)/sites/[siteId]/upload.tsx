import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { FOLDER_PRESETS, OTHER_FOLDER, displayFolder } from '@/data/folders';
import { repo } from '@/data/index';
import { canManageSite } from '@/data/repo';
import type { Drawing, SiteAssignment } from '@/data/types';
import { theme } from '@/lib/theme';
import * as DocumentPicker from 'expo-document-picker';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function UploadScreen() {
  const { siteId } = useLocalSearchParams<{ siteId: string }>();
  const { person } = useAuth();
  const router = useRouter();
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [assignees, setAssignees] = useState<SiteAssignment[]>([]);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [sheetNumber, setSheetNumber] = useState('');
  const [revision, setRevision] = useState('');
  const [dated, setDated] = useState(new Date().toISOString().slice(0, 10));
  const [folderName, setFolderName] = useState('');
  const [fileName, setFileName] = useState('');
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [doneRev, setDoneRev] = useState<string | null>(null);

  useEffect(() => {
    if (!siteId) return;
    repo.listDrawings(siteId).then((rows) => setDrawings(rows.filter((d) => d.is_current)));
    repo.listAssignments(siteId).then(setAssignees).catch(() => setAssignees([]));
  }, [siteId]);

  if (person && !canManageSite(person.role)) return <Redirect href={`/sites/${siteId}`} />;

  async function pickPdf() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setFileName(asset.name);
    if (asset.file) {
      const buf = new Uint8Array(await asset.file.arrayBuffer());
      setBytes(buf);
      return;
    }
    if (asset.uri) {
      const response = await fetch(asset.uri);
      setBytes(new Uint8Array(await response.arrayBuffer()));
    }
  }

  async function onConfirm() {
    if (!siteId || !person || !bytes || !title.trim() || !revision.trim()) return;
    setLoading(true);
    setError('');
    const drawingId = crypto.randomUUID();
    try {
      const uploaded = await repo.uploadDrawingFile({
        companyId: person.company_id,
        siteId,
        drawingId,
        bytes,
        contentType: 'application/pdf',
        fileName: fileName || `${title}.pdf`,
      });
      await repo.replaceDrawing({
        id: drawingId,
        siteId,
        title: title.trim(),
        sheetNumber: sheetNumber.trim() || null,
        revision: revision.trim(),
        dated: dated || null,
        storagePath: uploaded.storagePath,
        fileSizeBytes: uploaded.fileSizeBytes,
        contentType: 'application/pdf',
        replaceDrawingId: replaceId,
        folder: folderName,
      });
      setDoneRev(revision.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed — current pack was not changed.');
    } finally {
      setLoading(false);
    }
  }

  if (doneRev) {
    return (
      <Screen>
        <Title>Pack updated</Title>
        <Muted>
          Rev {doneRev} is now current. Previous rev moved to superseded. Assigned people will see it as the default open
          — no WhatsApp forward.
        </Muted>
        <Button label="Back to pack" onPress={() => router.replace(`/sites/${siteId}`)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Upload / replace</Title>
      <Muted>New file becomes current. Old rev retires automatically. Target: under two minutes.</Muted>
      <Muted>
        Assigned now:{' '}
        {assignees.length
          ? assignees.map((a) => a.person?.display_name ?? a.person?.email ?? 'Unknown').join(', ')
          : 'nobody yet'}
      </Muted>
      <Text style={{ color: theme.muted, fontWeight: '700' }}>Replace existing current sheet (optional)</Text>
      {drawings.map((drawing) => (
        <Pressable
          key={drawing.id}
          onPress={() => {
            setReplaceId(drawing.id);
            setTitle(drawing.title);
            setSheetNumber(drawing.sheet_number ?? '');
            setFolderName(displayFolder(drawing.folder));
          }}
          style={{
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: replaceId === drawing.id ? theme.current : theme.line,
            backgroundColor: theme.surface,
          }}>
          <Text style={{ color: theme.text, fontWeight: '700' }}>
            {drawing.title} · Rev {drawing.revision}
          </Text>
          <Text style={{ color: theme.muted }}>{displayFolder(drawing.folder)}</Text>
        </Pressable>
      ))}
      <Field label="Title" value={title} onChangeText={setTitle} autoCapitalize="words" placeholder="Ground Floor GA" />
      <Field label="Sheet number" value={sheetNumber} onChangeText={setSheetNumber} placeholder="A-101" />
      <Field label="Revision" value={revision} onChangeText={setRevision} placeholder="D" />
      <Field label="Dated" value={dated} onChangeText={setDated} placeholder="YYYY-MM-DD" />
      <Text style={{ color: theme.muted, fontWeight: '700' }}>Folder</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {FOLDER_PRESETS.map((preset) => {
          const selected = folderName.trim() === preset || (preset === OTHER_FOLDER && folderName.trim() === '');
          return (
            <Pressable
              key={preset}
              accessibilityRole="button"
              onPress={() => setFolderName(preset)}
              style={{
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: selected ? theme.current : theme.line,
                backgroundColor: theme.surface,
              }}>
              <Text style={{ color: theme.text, fontWeight: selected ? '800' : '600' }}>{preset}</Text>
            </Pressable>
          );
        })}
      </View>
      <Field
        label="Folder name"
        value={folderName}
        onChangeText={setFolderName}
        autoCapitalize="words"
        placeholder="Or type a name. Blank is Other."
      />
      <Muted>Filed under {displayFolder(folderName)}. One level only.</Muted>
      <Button label={fileName ? `PDF: ${fileName}` : 'Pick PDF'} variant="secondary" onPress={() => void pickPdf()} />
      <ErrorText>{error}</ErrorText>
      <Button
        label="Confirm — make current"
        onPress={() => void onConfirm()}
        loading={loading}
        disabled={!bytes || !title.trim() || !revision.trim()}
      />
      <View />
    </Screen>
  );
}

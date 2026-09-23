import { Button, ErrorText, Field, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { FOLDER_PRESETS, OTHER_FOLDER, displayFolder } from '@/data/folders';
import { repo } from '@/data/index';
import { newId } from '@/data/newId';
import { canManageSite } from '@/data/repo';
import { revisionCurrentLine } from '@/data/walk';
import { theme } from '@/lib/theme';
import * as DocumentPicker from 'expo-document-picker';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

export default function UploadScreen() {
  const { siteId, replace } = useLocalSearchParams<{ siteId: string; replace?: string }>();
  const replaceId = typeof replace === 'string' && replace.length > 0 ? replace : null;
  const { person } = useAuth();
  const router = useRouter();
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
    if (!siteId || !replaceId) return;
    repo.listDrawings(siteId).then((rows) => {
      const drawing = rows.find((row) => row.id === replaceId);
      if (!drawing) return;
      setTitle(drawing.title);
      setSheetNumber(drawing.sheet_number ?? '');
      setFolderName(displayFolder(drawing.folder));
    });
  }, [replaceId, siteId]);

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
    const drawingId = newId();
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
        <Title>{revisionCurrentLine(doneRev)}</Title>
        <Button label="Back to pack" onPress={() => router.replace(`/sites/${siteId}`)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Upload</Title>
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
      <Button label={fileName ? `PDF: ${fileName}` : 'Pick PDF'} variant="secondary" onPress={() => void pickPdf()} />
      <ErrorText>{error}</ErrorText>
      <Button
        label="Confirm — make current"
        onPress={() => void onConfirm()}
        loading={loading}
        disabled={!bytes || !title.trim() || !revision.trim()}
      />
    </Screen>
  );
}

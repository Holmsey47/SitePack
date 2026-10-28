import { useBackOverlay } from '@/components/useBackOverlay';
import { Button, ChoiceChip, ErrorText, Field, Screen, Title } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import {
  FOLDER_PRESETS,
  LABEL_LIMIT,
  LEVEL_PRESETS,
  OTHER_FOLDER,
  displayFolder,
  displayLevel,
  limitLabel,
} from '@/data/folders';
import { repo } from '@/data/index';
import { newId } from '@/data/newId';
import { canManageSite } from '@/data/repo';
import { revisionCurrentLine } from '@/data/walk';
import { setUploadBackGuard } from '@/lib/backRegistry';
import { textStyle, theme } from '@/lib/theme';
import { readPickedBytes } from '@/lib/uploadBytes';
import { usePreventRemove, type NavigationAction } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Redirect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Text, View } from 'react-native';

export default function UploadScreen() {
  const { siteId, replace } = useLocalSearchParams<{ siteId: string; replace?: string }>();
  const replaceId = typeof replace === 'string' && replace.length > 0 ? replace : null;
  const { person } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [allowLeave, setAllowLeave] = useState(false);
  const pendingAction = useRef<NavigationAction | null>(null);
  const [title, setTitle] = useState('');
  const [sheetNumber, setSheetNumber] = useState('');
  const [revision, setRevision] = useState('');
  const [dated, setDated] = useState(new Date().toISOString().slice(0, 10));
  const [folderName, setFolderName] = useState('');
  const [levelName, setLevelName] = useState('');
  const [folderNote, setFolderNote] = useState('');
  const [levelNote, setLevelNote] = useState('');
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
      setFolderName(limitLabel(displayFolder(drawing.folder)));
      setLevelName(limitLabel(displayLevel(drawing.level) ?? ''));
      setFolderNote('');
      setLevelNote('');
    });
  }, [replaceId, siteId]);

  usePreventRemove(loading && !allowLeave, ({ data }) => {
    pendingAction.current = data.action;
    setLeaveAsk(true);
  });

  useEffect(() => {
    if (!loading) {
      setUploadBackGuard(false, null);
      setLeaveAsk(false);
      return;
    }
    setUploadBackGuard(true, () => setLeaveAsk(true));
    return () => setUploadBackGuard(false, null);
  }, [loading]);

  useBackOverlay(leaveAsk, () => {
    pendingAction.current = null;
    setLeaveAsk(false);
  });

  useEffect(() => {
    if (!allowLeave) return;
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action) navigation.dispatch(action);
    else router.back();
  }, [allowLeave, navigation, router]);

  if (person && !canManageSite(person.role)) return <Redirect href={`/sites/${siteId}`} />;

  async function pickPdf() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    try {
      const next = await readPickedBytes(asset, Platform.OS);
      setBytes(next);
      setFileName(asset.name);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that PDF.');
    }
  }

  async function onConfirm() {
    if (!siteId || !person || !bytes || !title.trim() || !revision.trim()) return;
    if (Array.from(folderName).length > LABEL_LIMIT || Array.from(levelName).length > LABEL_LIMIT) {
      setError('Folder name and level can be at most 40 characters.');
      return;
    }
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
        level: levelName,
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
    <View style={{ flex: 1 }}>
    <Screen>
      <Field label="Title" value={title} onChangeText={setTitle} autoCapitalize="words" placeholder="Ground Floor GA" />
      <Field label="Sheet number" value={sheetNumber} onChangeText={setSheetNumber} placeholder="A-101" />
      <Field label="Revision" value={revision} onChangeText={setRevision} placeholder="D" />
      <Field label="Dated" value={dated} onChangeText={setDated} placeholder="YYYY-MM-DD" />
      <Text style={{ color: theme.text, fontWeight: '800' }}>Folder</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {FOLDER_PRESETS.map((preset) => {
          const selected = folderName.trim() === preset || (preset === OTHER_FOLDER && folderName.trim() === '');
          return (
            <ChoiceChip
              key={preset}
              label={preset}
              selected={selected}
              onPress={() => {
                setFolderName(preset);
                setFolderNote('');
              }}
            />
          );
        })}
      </View>
      <Field
        label="Folder name"
        value={folderName}
        onChangeText={(value) => {
          setFolderName(limitLabel(value));
          setFolderNote(
            Array.from(value).length > LABEL_LIMIT ? 'Folder name can be at most 40 characters.' : ''
          );
        }}
        autoCapitalize="words"
        placeholder="Or type a name. Blank is Other."
        maxLength={LABEL_LIMIT}
      />
      <Text style={{ color: folderNote ? theme.danger : theme.text, fontWeight: '700' }}>
        {folderNote || '40 characters at most.'}
      </Text>
      <Text style={{ color: theme.text, fontWeight: '800' }}>Level</Text>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {LEVEL_PRESETS.map((preset) => (
          <ChoiceChip
            key={preset}
            label={preset}
            selected={levelName.trim() === preset}
            onPress={() => {
              setLevelName(preset);
              setLevelNote('');
            }}
          />
        ))}
      </View>
      <Field
        label="Level name"
        value={levelName}
        onChangeText={(value) => {
          setLevelName(limitLabel(value));
          setLevelNote(Array.from(value).length > LABEL_LIMIT ? 'Level can be at most 40 characters.' : '');
        }}
        autoCapitalize="words"
        placeholder="Optional. Blank is fine."
        maxLength={LABEL_LIMIT}
      />
      <Text style={{ color: levelNote ? theme.danger : theme.text, fontWeight: '700' }}>
        {levelNote || '40 characters at most. Blank is fine.'}
      </Text>
      <Button label={fileName ? `PDF: ${fileName}` : 'Pick PDF'} variant="secondary" onPress={() => void pickPdf()} />
      <ErrorText>{error}</ErrorText>
      <Button
        label="Confirm — make current"
        onPress={() => void onConfirm()}
        loading={loading}
        disabled={!bytes || !title.trim() || !revision.trim()}
      />
    </Screen>
    <Modal visible={leaveAsk} transparent animationType="fade" onRequestClose={() => setLeaveAsk(false)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(8, 10, 14, 0.86)', justifyContent: 'flex-end', padding: 16, gap: 12 }}>
        <Text style={{ ...textStyle.title }}>This upload is still going.</Text>
        <Text style={{ ...textStyle.meta }}>
          The upload keeps going. It becomes current when it finishes.
        </Text>
        <Button
          label="Stay"
          onPress={() => {
            pendingAction.current = null;
            setLeaveAsk(false);
          }}
        />
        <Button
          label="Leave"
          variant="secondary"
          onPress={() => {
            setLeaveAsk(false);
            setAllowLeave(true);
          }}
        />
      </View>
    </Modal>
    </View>
  );
}

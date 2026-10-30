import { Card, Muted, Screen } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { repo } from '@/data/index';
import { siteDocumentKindLabel } from '@/data/siteDocuments';
import { loadSignNudge, type UnsignedSignDocument } from '@/data/signNudge';
import { hit, textStyle } from '@/lib/theme';
import { Text } from '@/src/theme/text';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

export default function ToSignScreen() {
  const { person } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<UnsignedSignDocument[] | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!person) return;
      let active = true;
      loadSignNudge(() => repo.listUnsignedSiteDocuments()).then((next) => {
        if (!active) return;
        setFailed(next == null);
        setRows(next ?? []);
      });
      return () => {
        active = false;
      };
    }, [person]),
  );

  return (
    <Screen>
      {failed ? <Muted>Could not load documents.</Muted> : null}
      {!failed && rows != null && rows.length === 0 ? <Muted>Nothing to sign.</Muted> : null}
      {rows?.map((doc) => (
        <Card
          key={doc.id}
          onPress={() => router.push(`/sites/${doc.siteId}/documents/${doc.id}`)}>
          <View testID="sign-list-row" style={{ minHeight: hit.min, justifyContent: 'center' }}>
            <Text style={textStyle.bodyStrong}>
              {siteDocumentKindLabel(doc.kind)}: {doc.title}
            </Text>
            <Text style={textStyle.meta}>{doc.siteName}</Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

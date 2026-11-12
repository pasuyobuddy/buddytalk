import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/ui';
import { useConversations } from '../../hooks/useConversations';
import { forwardMessage } from '../../lib/api';
import { colors } from '../../lib/theme';

export default function Forward() {
  const { messageId } = useLocalSearchParams<{ messageId: string }>();
  const { items } = useConversations();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 20) next.add(id);
      return next;
    });

  const send = async () => {
    setBusy(true);
    try {
      await forwardMessage(messageId, [...picked]);
      router.back();
    } catch (e) {
      Alert.alert('Could not forward', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={items}
        keyExtractor={(c) => c.conversation_id}
        renderItem={({ item }) => {
          const on = picked.has(item.conversation_id);
          return (
            <Pressable style={styles.row} onPress={() => toggle(item.conversation_id)}>
              <Avatar path={item.avatar_path} name={item.title} group={item.kind === 'group' && !item.avatar_path} />
              <Text style={styles.title}>{item.title}</Text>
              <Text style={[styles.check, on && styles.checkOn]}>{on ? '✓' : ''}</Text>
            </Pressable>
          );
        }}
      />
      <View style={{ padding: 12 }}>
        <Button title={picked.size ? `Send to ${picked.size}` : 'Choose chats'} onPress={send} busy={busy} disabled={!picked.size} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#fff', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { flex: 1, marginLeft: 12, fontSize: 16, color: colors.text },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.border, textAlign: 'center', color: '#fff', fontWeight: '800' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});

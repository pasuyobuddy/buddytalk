import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useConversations } from '../../hooks/useConversations';
import { cachedProfile, getProfiles, searchMessages } from '../../lib/api';
import { chatListTime } from '../../lib/format';
import { colors } from '../../lib/theme';

type Hit = Awaited<ReturnType<typeof searchMessages>>[number];

export default function Search() {
  const { conversationId } = useLocalSearchParams<{ conversationId?: string }>();
  const { items } = useConversations();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) {
        setHits([]);
        return;
      }
      setBusy(true);
      try {
        const rows = await searchMessages(q.trim(), conversationId);
        await getProfiles(rows.map((r) => r.sender_id).filter(Boolean));
        setHits(rows);
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, conversationId]);

  const titleOf = (cid: string) => items.find((c) => c.conversation_id === cid)?.title ?? 'Chat';

  return (
    <View style={{ flex: 1 }}>
      <TextInput
        style={styles.search}
        placeholder={conversationId ? 'Search this chat' : 'Search all messages'}
        placeholderTextColor={colors.textMuted}
        value={q}
        onChangeText={setQ}
        autoFocus
      />
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
      <FlatList
        data={hits}
        keyExtractor={(h) => h.message_id}
        ListEmptyComponent={q.trim().length >= 2 && !busy ? <Text style={styles.empty}>No messages found</Text> : undefined}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.conversation_id } })}>
            <View style={styles.top}>
              <Text style={styles.chat} numberOfLines={1}>
                {titleOf(item.conversation_id)}
              </Text>
              <Text style={styles.time}>{chatListTime(item.created_at)}</Text>
            </View>
            <Text style={styles.body} numberOfLines={2}>
              <Text style={{ fontWeight: '600' }}>{cachedProfile(item.sender_id)?.display_name ?? ''}: </Text>
              {item.body}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    margin: 12, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16,
    borderWidth: 1, borderColor: colors.border, color: colors.text,
  },
  row: { backgroundColor: '#fff', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  top: { flexDirection: 'row', justifyContent: 'space-between' },
  chat: { fontWeight: '700', color: colors.primary, flex: 1 },
  time: { color: colors.textMuted, fontSize: 12 },
  body: { color: colors.text, marginTop: 4 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 30 },
});

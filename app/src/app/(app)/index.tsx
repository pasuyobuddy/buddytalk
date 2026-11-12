import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { AccountBadge, Avatar } from '../../components/Avatar';
import { useConversations } from '../../hooks/useConversations';
import { setConversationPrefs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { chatListTime, messagePreview } from '../../lib/format';
import { colors } from '../../lib/theme';
import type { ConversationListItem } from '../../lib/types';

export default function Chats() {
  const { session } = useAuth();
  const me = session!.user.id;
  const { items, loading, error, refresh } = useConversations();
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'all' | 'unread' | 'groups' | 'archived'>('all');

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return items.filter((c) => {
      if (tab === 'archived' ? !c.archived : c.archived) return false;
      if (tab === 'unread' && c.unread_count === 0) return false;
      if (tab === 'groups' && c.kind !== 'group') return false;
      return !f || (c.title ?? '').toLowerCase().includes(f) || (c.last_message_body ?? '').toLowerCase().includes(f);
    });
  }, [items, filter, tab]);

  const chatActions = (c: ConversationListItem) => {
    Alert.alert(c.title ?? 'Chat', undefined, [
      { text: c.pinned ? 'Unpin' : 'Pin', onPress: () => setConversationPrefs(c.conversation_id, { pinned: !c.pinned }).then(refresh) },
      { text: c.archived ? 'Unarchive' : 'Archive', onPress: () => setConversationPrefs(c.conversation_id, { archived: !c.archived }).then(refresh) },
      {
        text: isMuted(c) ? 'Unmute' : 'Mute 8 hours',
        onPress: () =>
          setConversationPrefs(c.conversation_id, { mutedUntil: isMuted(c) ? null : new Date(Date.now() + 8 * 3600_000) }).then(refresh),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <Pressable onPress={() => router.push('/search')} hitSlop={8} style={{ marginRight: 18 }} accessibilityLabel="Search messages">
                <Text style={styles.headerIcon}>🔍</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/settings')} hitSlop={8} accessibilityLabel="Settings">
                <Text style={styles.headerIcon}>⚙️</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      <TextInput
        style={styles.filter}
        placeholder="Search chats"
        placeholderTextColor={colors.textMuted}
        value={filter}
        onChangeText={setFilter}
      />
      <View style={styles.tabs}>
        {(['all', 'unread', 'groups', 'archived'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t[0].toUpperCase() + t.slice(1)}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(c) => c.conversation_id}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {tab === 'all' && !filter ? 'No chats yet. Tap + to start one.' : 'Nothing here.'}
            </Text>
          }
          renderItem={({ item }) => (
            <ChatRow item={item} me={me} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.conversation_id } })} onLongPress={() => chatActions(item)} />
          )}
        />
      )}
      <Pressable style={styles.fab} onPress={() => router.push('/new-chat')} accessibilityLabel="New chat">
        <Text style={styles.fabText}>＋</Text>
      </Pressable>
    </View>
  );
}

function isMuted(c: ConversationListItem) {
  return Boolean(c.muted_until && new Date(c.muted_until).getTime() > Date.now()) || c.notify_level === 'none';
}

function senderPrefix(item: ConversationListItem, mine: boolean) {
  if (item.last_message_kind === 'system' || item.last_message_deleted) return '';
  if (mine) return 'You: ';
  if (item.kind === 'group' && item.last_message_sender_name) return `${item.last_message_sender_name.split(' ')[0]}: `;
  return '';
}

function ChatRow({ item, me, onPress, onLongPress }: { item: ConversationListItem; me: string; onPress: () => void; onLongPress: () => void }) {
  const mine = item.last_message_sender_id === me;
  const preview = item.last_message_id
    ? `${senderPrefix(item, mine)}${messagePreview(item.last_message_kind, item.last_message_body, item.last_message_deleted)}`
    : item.kind === 'group'
      ? `${item.member_count} members`
      : 'Say hi 👋';
  return (
    <Pressable style={styles.row} onPress={onPress} onLongPress={onLongPress}>
      <Avatar path={item.avatar_path} name={item.title} size={52} group={item.kind === 'group' && !item.avatar_path} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {item.pinned ? '📌 ' : ''}
              {item.title ?? 'Chat'}
            </Text>
            {item.kind === 'direct' ? <AccountBadge type={item.other_account_type} /> : null}
          </View>
          <Text style={[styles.time, item.unread_count > 0 && { color: colors.primary, fontWeight: '700' }]}>
            {chatListTime(item.last_message_at)}
          </Text>
        </View>
        <View style={styles.rowTop}>
          <Text style={styles.preview} numberOfLines={1}>
            {item.last_message_kind === 'system' ? 'Group updated' : preview}
          </Text>
          {isMuted(item) ? <Text style={styles.muted}>🔕</Text> : null}
          {item.mention_count > 0 ? <Text style={styles.at}>@</Text> : null}
          {item.unread_count > 0 ? (
            <View style={[styles.badge, isMuted(item) && { backgroundColor: colors.textMuted }]}>
              <Text style={styles.badgeText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerIcon: { fontSize: 20 },
  filter: {
    margin: 10, marginBottom: 4, backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9,
    fontSize: 15, color: colors.text,
  },
  tabs: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 6 },
  tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: '#E5E7EB', marginHorizontal: 3 },
  tabOn: { backgroundColor: '#DBEAFE' },
  tabText: { color: colors.textMuted, fontWeight: '600' },
  tabTextOn: { color: colors.primaryDark },
  row: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff', alignItems: 'center' },
  rowBody: { flex: 1, marginLeft: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: 10 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '600', color: colors.text, flexShrink: 1 },
  time: { fontSize: 12, color: colors.textMuted, marginLeft: 8 },
  preview: { flex: 1, color: colors.textMuted, marginTop: 3, fontSize: 14 },
  muted: { marginLeft: 6, fontSize: 13 },
  at: { marginLeft: 6, color: '#fff', backgroundColor: colors.accent, borderRadius: 10, width: 20, height: 20, textAlign: 'center', fontWeight: '800' },
  badge: { marginLeft: 6, backgroundColor: colors.primary, borderRadius: 11, minWidth: 22, height: 22, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  fab: {
    position: 'absolute', right: 20, bottom: 28, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.green,
    alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4,
  },
  fabText: { color: '#fff', fontSize: 30, marginTop: -2 },
  empty: { textAlign: 'center', marginTop: 48, color: colors.textMuted },
  error: { color: colors.danger, textAlign: 'center', margin: 8 },
});

import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../../../../components/Avatar';
import { Composer, type PickedFile } from '../../../../components/Composer';
import { MessageBubble, type Receipt } from '../../../../components/MessageBubble';
import { useChat } from '../../../../hooks/useChat';
import { cachedProfile, deleteMessage, listBlocked, reportUser, setReaction } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { dayLabel, lastSeen, messagePreview, uuid } from '../../../../lib/format';
import { discard, enqueue, retry } from '../../../../lib/outbox';
import { setOpenConversation } from '../../../../lib/push';
import { colors } from '../../../../lib/theme';
import type { UiMessage } from '../../../../lib/types';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const me = session!.user.id;
  const chat = useChat(id, me);
  const [replyTo, setReplyTo] = useState<UiMessage | null>(null);
  const [selected, setSelected] = useState<UiMessage | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [iBlocked, setIBlocked] = useState(false);
  const listRef = useRef<FlatList<UiMessage>>(null);

  const isGroup = chat.conversation?.kind === 'group';
  const other = chat.members.find((m) => m.user_id !== me);
  const myRole = chat.members.find((m) => m.user_id === me)?.role;

  useFocusEffect(
    useCallback(() => {
      setOpenConversation(id);
      return () => setOpenConversation(null);
    }, [id]),
  );

  useEffect(() => {
    if (!isGroup && other) listBlocked().then((ids) => setIBlocked(ids.includes(other.user_id)));
  }, [isGroup, other]);

  const usernames = useMemo(
    () => new Set(chat.members.map((m) => m.profile?.username.toLowerCase()).filter(Boolean) as string[]),
    [chat.members],
  );

  // Delivered / read ticks: compare each of my messages with everyone else's pointers.
  const othersPointers = useMemo(() => {
    const others = chat.members.filter((m) => m.user_id !== me);
    const minOf = (vals: (string | null)[]) =>
      vals.length === 0 ? null : vals.some((v) => !v) ? null : vals.reduce((a, b) => (a! < b! ? a : b));
    return {
      delivered: minOf(others.map((m) => m.last_delivered_at)),
      read: minOf(others.map((m) => m.read_receipt_at)),
    };
  }, [chat.members, me]);

  const receiptFor = useCallback(
    (m: UiMessage): Receipt => {
      if (m.local) return m.local.status;
      if (othersPointers.read && othersPointers.read >= m.created_at) return 'read';
      if (othersPointers.delivered && othersPointers.delivered >= m.created_at) return 'delivered';
      return 'sent';
    },
    [othersPointers],
  );

  const title = isGroup ? chat.conversation?.name ?? 'Group' : other?.profile?.display_name ?? 'Chat';
  const subtitle = isGroup
    ? chat.members.map((m) => (m.user_id === me ? 'You' : m.profile?.display_name ?? '')).join(', ')
    : chat.presence?.is_online
      ? 'online'
      : chat.presence
        ? lastSeen(chat.presence.last_seen_at)
        : other?.profile?.account_type === 'rider'
          ? 'Rider'
          : 'Customer';

  // ---------------------------------------------------------------- sending
  const base = () => ({
    id: uuid(),
    conversationId: id,
    senderId: me,
    replyToId: replyTo && !replyTo.local ? replyTo.id : null,
  });

  const sendText = (text: string, mentions: string[]) => {
    void enqueue({ ...base(), kind: 'text', body: text, mentions });
    setReplyTo(null);
  };
  const sendFile = (kind: 'image' | 'document', file: PickedFile, caption: string) => {
    void enqueue({
      ...base(),
      kind,
      body: kind === 'document' ? file.name : caption || null,
      mentions: [],
      file,
    });
    setReplyTo(null);
  };
  const sendVoice = (file: PickedFile) => {
    void enqueue({ ...base(), kind: 'voice', body: null, mentions: [], metadata: { duration_ms: file.durationMs }, file });
    setReplyTo(null);
  };

  // ---------------------------------------------------------------- actions
  const myReaction = selected ? chat.reactions.get(selected.id)?.find((r) => r.user_id === me)?.emoji : undefined;

  const react = async (emoji: string) => {
    if (!selected) return;
    const target = selected;
    setSelected(null);
    try {
      await setReaction(target.id, me, myReaction === emoji ? null : emoji);
    } catch (e) {
      Alert.alert('Could not react', e instanceof Error ? e.message : String(e));
    }
  };

  const confirmDelete = (m: UiMessage) => {
    setSelected(null);
    if (m.local) {
      void discard(m.id);
      return;
    }
    const canEveryone = m.sender_id === me || (isGroup && myRole === 'admin');
    Alert.alert('Delete message?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete for me', onPress: () => deleteMessage(m.id, false).catch((e) => Alert.alert('Error', String(e.message ?? e))) },
      ...(canEveryone
        ? [{ text: 'Delete for everyone', style: 'destructive' as const, onPress: () => deleteMessage(m.id, true).catch((e) => Alert.alert('Error', String(e.message ?? e))) }]
        : []),
    ]);
  };

  const report = (m: UiMessage) => {
    setSelected(null);
    Alert.alert('Report this message?', 'The message and sender will be sent to the BuddyTalk team for review.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: () =>
          reportUser({ reportedUserId: m.sender_id ?? undefined, conversationId: id, messageId: m.id, reason: 'inappropriate' })
            .then(() => Alert.alert('Thanks', 'Your report was sent.'))
            .catch((e) => Alert.alert('Error', String(e.message ?? e))),
      },
    ]);
  };

  const jumpTo = (messageId: string) => {
    const index = chat.messages.findIndex((m) => m.id === messageId);
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setHighlight(messageId);
    setTimeout(() => setHighlight(null), 1500);
  };

  const disabledReason = chat.removed
    ? isGroup
      ? "You can't send messages because you're no longer in this group."
      : 'This chat is unavailable.'
    : iBlocked
      ? 'You blocked this person. Unblock them in chat info to send messages.'
      : null;

  if (chat.error && !chat.conversation) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.textMuted }}>This chat is not available.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.chatBackground }} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Pressable style={styles.header} onPress={() => router.push({ pathname: '/chat/[id]/info', params: { id } })}>
              <Avatar
                path={isGroup ? chat.conversation?.avatar_path : other?.profile?.avatar_path}
                name={title}
                size={36}
                group={isGroup && !chat.conversation?.avatar_path}
              />
              <View style={{ marginLeft: 10, flexShrink: 1 }}>
                <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
                <Text style={styles.headerSub} numberOfLines={1}>{subtitle}</Text>
              </View>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        {chat.loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            inverted
            data={chat.messages}
            keyExtractor={(m) => m.id}
            onEndReached={chat.loadOlder}
            onEndReachedThreshold={0.3}
            onScrollToIndexFailed={() => undefined}
            ListFooterComponent={chat.loadingOlder ? <ActivityIndicator style={{ margin: 12 }} color={colors.primary} /> : undefined}
            renderItem={({ item, index }) => {
              const older = chat.messages[index + 1];
              const newDay = !older || new Date(older.created_at).toDateString() !== new Date(item.created_at).toDateString();
              const showSender = isGroup && (!older || older.sender_id !== item.sender_id || older.kind === 'system' || newDay);
              const replyTarget = item.reply_to_id ? chat.messageById.get(item.reply_to_id) : undefined;
              return (
                <View>
                  {newDay ? (
                    <View style={styles.dayWrap}>
                      <Text style={styles.day}>{dayLabel(item.created_at)}</Text>
                    </View>
                  ) : null}
                  <MessageBubble
                    message={item}
                    mine={item.sender_id === me}
                    showSender={showSender}
                    sender={cachedProfile(item.sender_id)}
                    replyTo={replyTarget}
                    reactions={chat.reactions.get(item.id)}
                    receipt={item.sender_id === me ? receiptFor(item) : undefined}
                    highlighted={highlight === item.id}
                    usernames={usernames}
                    myId={me}
                    onLongPress={setSelected}
                    onPressReply={jumpTo}
                    onOpenImage={setViewer}
                    onRetry={(mid) => void retry(mid)}
                  />
                </View>
              );
            }}
          />
        )}
        <Composer
          isGroup={isGroup}
          members={chat.members}
          myId={me}
          replyTo={replyTo}
          replyName={replyTo?.sender_id === me ? 'yourself' : cachedProfile(replyTo?.sender_id)?.display_name}
          onCancelReply={() => setReplyTo(null)}
          onSendText={sendText}
          onSendFile={sendFile}
          onSendVoice={sendVoice}
          disabledReason={disabledReason}
        />
      </KeyboardAvoidingView>

      {/* Long-press menu */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)}>
          <View style={styles.sheet}>
            {selected && !selected.local ? (
              <View style={styles.reactRow}>
                {QUICK_REACTIONS.map((e) => (
                  <Pressable key={e} onPress={() => react(e)} style={[styles.reactBtn, myReaction === e && styles.reactOn]}>
                    <Text style={{ fontSize: 26 }}>{e}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Text style={styles.sheetPreview} numberOfLines={2}>
              {selected ? messagePreview(selected.kind, selected.body) : ''}
            </Text>
            {selected && !selected.local && !disabledReason ? (
              <SheetItem label="↩  Reply" onPress={() => { setReplyTo(selected); setSelected(null); }} />
            ) : null}
            {selected?.body ? (
              <SheetItem label="⧉  Copy" onPress={() => { void Clipboard.setStringAsync(selected.body ?? ''); setSelected(null); }} />
            ) : null}
            {selected && !selected.local ? (
              <SheetItem
                label="↪  Forward"
                onPress={() => {
                  const mid = selected.id;
                  setSelected(null);
                  router.push({ pathname: '/forward', params: { messageId: mid } });
                }}
              />
            ) : null}
            {selected && selected.sender_id !== me && !selected.local ? <SheetItem label="⚑  Report" onPress={() => report(selected)} /> : null}
            {selected ? <SheetItem label="🗑  Delete" danger onPress={() => confirmDelete(selected)} /> : null}
          </View>
        </Pressable>
      </Modal>

      {/* Full-screen photo */}
      <Modal visible={!!viewer} transparent onRequestClose={() => setViewer(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewer(null)}>
          {viewer ? <Image source={{ uri: viewer }} style={{ width: '100%', height: '80%' }} contentFit="contain" /> : null}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function SheetItem({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={styles.sheetItem} onPress={onPress}>
      <Text style={[styles.sheetText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', maxWidth: 260 },
  headerTitle: { color: '#fff', fontWeight: '700', fontSize: 17 },
  headerSub: { color: '#DBEAFE', fontSize: 12 },
  dayWrap: { alignItems: 'center', marginVertical: 8 },
  day: { backgroundColor: '#FFFFFFDD', color: colors.textMuted, fontSize: 12, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 24, paddingTop: 10 },
  reactRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 12, paddingVertical: 6 },
  reactBtn: { padding: 6, borderRadius: 22 },
  reactOn: { backgroundColor: '#DBEAFE' },
  sheetPreview: { color: colors.textMuted, paddingHorizontal: 20, paddingVertical: 8, fontStyle: 'italic' },
  sheetItem: { paddingHorizontal: 22, paddingVertical: 14 },
  sheetText: { fontSize: 16, color: colors.text },
  viewer: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
});

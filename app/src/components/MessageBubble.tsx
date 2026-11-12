import { Image } from 'expo-image';
import { memo, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { cachedProfile, mediaUrl } from '../lib/api';
import { fileSize, messagePreview, timeOfDay } from '../lib/format';
import { colors } from '../lib/theme';
import type { Attachment, Profile, Reaction, UiMessage } from '../lib/types';
import { VoicePlayer } from './VoicePlayer';

export type Receipt = 'queued' | 'sending' | 'failed' | 'sent' | 'delivered' | 'read';

export function Ticks({ receipt }: { receipt: Receipt }) {
  switch (receipt) {
    case 'queued':
    case 'sending':
      return <Text style={[styles.tick, { color: colors.textMuted }]}>🕓</Text>;
    case 'failed':
      return <Text style={[styles.tick, { color: colors.danger }]}>⚠</Text>;
    case 'sent':
      return <Text style={[styles.tick, { color: colors.textMuted }]}>✓</Text>;
    case 'delivered':
      return <Text style={[styles.tick, { color: colors.textMuted }]}>✓✓</Text>;
    case 'read':
      return <Text style={[styles.tick, { color: colors.read }]}>✓✓</Text>;
  }
}

function systemText(m: UiMessage, nameOf: (id: string) => string): string {
  const meta = m.metadata as Record<string, unknown>;
  const actor = m.sender_id ? nameOf(m.sender_id) : 'Someone';
  const ids = Array.isArray(meta.user_ids) ? (meta.user_ids as string[]) : [];
  const who = typeof meta.user_id === 'string' ? nameOf(meta.user_id) : '';
  switch (meta.event) {
    case 'group_created': return `${actor} created the group "${String(meta.name ?? '')}"`;
    case 'members_added': return `${actor} added ${ids.map(nameOf).join(', ')}`;
    case 'member_removed': return `${actor} removed ${who}`;
    case 'member_left': return `${who || actor} left`;
    case 'admin_added': return `${who} is now an admin`;
    case 'admin_removed': return `${who} is no longer an admin`;
    case 'name_changed': return `${actor} changed the group name to "${String(meta.name ?? '')}"`;
    case 'description_changed': return `${actor} changed the group description`;
    case 'photo_changed': return `${actor} changed the group photo`;
    default: return 'Group updated';
  }
}

function RichBody({ text, mine, usernames }: { text: string; mine: boolean; usernames: Set<string> }) {
  const parts = text.split(/(@[A-Za-z0-9_.]{3,30})/g);
  return (
    <Text style={styles.body} selectable={false}>
      {parts.map((p, i) =>
        p.startsWith('@') && usernames.has(p.slice(1).toLowerCase()) ? (
          <Text key={i} style={[styles.mention, mine && { color: colors.primaryDark }]}>
            {p}
          </Text>
        ) : (
          <Text key={i}>{p}</Text>
        ),
      )}
    </Text>
  );
}

function ImageAttachment({ att, localUri, onOpen }: { att?: Attachment; localUri?: string; onOpen: (uri: string) => void }) {
  const [uri, setUri] = useState<string | null>(localUri ?? null);
  useEffect(() => {
    if (!localUri && att) mediaUrl(att.storage_path).then(setUri).catch(() => setUri(null));
  }, [att, localUri]);
  const ratio = att?.width && att?.height ? att.width / att.height : 4 / 3;
  return (
    <Pressable onPress={() => uri && onOpen(uri)}>
      <Image
        source={uri ? { uri } : undefined}
        style={[styles.image, { aspectRatio: Math.max(0.6, Math.min(ratio, 1.8)) }]}
        contentFit="cover"
        transition={150}
      />
    </Pressable>
  );
}

function DocumentAttachment({ att, name }: { att?: Attachment; name: string }) {
  const open = async () => {
    if (!att) return;
    const url = await mediaUrl(att.storage_path);
    await Linking.openURL(url);
  };
  return (
    <Pressable style={styles.doc} onPress={open} accessibilityLabel={`Open ${name}`}>
      <Text style={styles.docIcon}>📄</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.docName} numberOfLines={2}>{att?.file_name ?? name}</Text>
        <Text style={styles.docMeta}>{att ? fileSize(att.size_bytes) : 'Uploading…'}</Text>
      </View>
    </Pressable>
  );
}

interface Props {
  message: UiMessage;
  mine: boolean;
  showSender: boolean;
  sender?: Profile;
  replyTo?: UiMessage;
  reactions?: Reaction[];
  receipt?: Receipt;
  highlighted?: boolean;
  usernames: Set<string>;
  myId: string;
  onLongPress: (m: UiMessage) => void;
  onPressReply: (id: string) => void;
  onOpenImage: (uri: string) => void;
  onRetry: (id: string) => void;
}

function MessageBubbleImpl(p: Props) {
  const m = p.message;
  const nameOf = (id: string) => (id === p.myId ? 'You' : cachedProfile(id)?.display_name ?? 'Someone');

  if (m.kind === 'system') {
    return (
      <View style={styles.systemWrap}>
        <Text style={styles.system}>{systemText(m, nameOf)}</Text>
      </View>
    );
  }

  const att = m.message_attachments?.[0];
  const deleted = Boolean(m.deleted_at);
  const grouped = new Map<string, number>();
  (p.reactions ?? []).forEach((r) => grouped.set(r.emoji, (grouped.get(r.emoji) ?? 0) + 1));

  return (
    <View style={[styles.row, p.mine ? styles.rowMine : styles.rowTheirs]}>
      <Pressable
        onLongPress={() => !deleted && p.onLongPress(m)}
        onPress={() => m.local?.status === 'failed' && p.onRetry(m.id)}
        delayLongPress={250}
        style={[
          styles.bubble,
          p.mine ? styles.mine : styles.theirs,
          p.highlighted && styles.highlight,
        ]}
      >
        {p.showSender && !p.mine ? (
          <Text style={styles.sender}>
            {p.sender?.display_name ?? 'Unknown'}
            {p.sender?.account_type === 'rider' ? '  · Rider' : ''}
          </Text>
        ) : null}

        {m.forwarded && !deleted ? <Text style={styles.forwarded}>↪ Forwarded</Text> : null}

        {p.replyTo && !deleted ? (
          <Pressable style={styles.quote} onPress={() => p.onPressReply(p.replyTo!.id)}>
            <Text style={styles.quoteName}>{p.replyTo.sender_id ? nameOf(p.replyTo.sender_id) : ''}</Text>
            <Text style={styles.quoteText} numberOfLines={2}>
              {messagePreview(p.replyTo.kind, p.replyTo.body, Boolean(p.replyTo.deleted_at))}
            </Text>
          </Pressable>
        ) : null}

        {deleted ? (
          <Text style={styles.deleted}>🚫 {p.mine ? 'You deleted this message' : 'This message was deleted'}</Text>
        ) : (
          <>
            {m.kind === 'image' ? <ImageAttachment att={att} localUri={m.local?.fileUri} onOpen={p.onOpenImage} /> : null}
            {m.kind === 'document' ? <DocumentAttachment att={att} name={m.body ?? 'Document'} /> : null}
            {m.kind === 'voice' ? (
              <VoicePlayer
                path={att?.storage_path}
                localUri={m.local?.fileUri}
                durationMs={att?.duration_ms ?? (m.metadata?.duration_ms as number | undefined)}
              />
            ) : null}
            {m.body && m.kind !== 'document' ? <RichBody text={m.body} mine={p.mine} usernames={p.usernames} /> : null}
          </>
        )}

        <View style={styles.meta}>
          <Text style={styles.time}>{timeOfDay(m.created_at)}</Text>
          {p.mine && p.receipt && !deleted ? <Ticks receipt={p.receipt} /> : null}
        </View>
        {m.local?.status === 'failed' ? <Text style={styles.failed}>Not sent. Tap to retry.</Text> : null}
      </Pressable>
      {grouped.size ? (
        <View style={[styles.reactions, p.mine ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
          {[...grouped.entries()].map(([emoji, n]) => (
            <Text key={emoji} style={styles.reaction}>
              {emoji}
              {n > 1 ? ` ${n}` : ''}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);

const styles = StyleSheet.create({
  row: { paddingHorizontal: 10, marginVertical: 2 },
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '82%', borderRadius: 12, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  mine: { backgroundColor: colors.bubbleMine, borderTopRightRadius: 3 },
  theirs: { backgroundColor: colors.bubbleTheirs, borderTopLeftRadius: 3 },
  highlight: { borderWidth: 2, borderColor: colors.accent },
  sender: { fontSize: 13, fontWeight: '700', color: colors.primary, marginBottom: 2 },
  forwarded: { fontSize: 12, fontStyle: 'italic', color: colors.textMuted, marginBottom: 2 },
  quote: {
    borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 4,
  },
  quoteName: { fontSize: 12, fontWeight: '700', color: colors.accent },
  quoteText: { fontSize: 13, color: colors.textMuted },
  body: { fontSize: 16, color: colors.text, lineHeight: 21 },
  mention: { color: colors.mention, fontWeight: '600' },
  deleted: { fontSize: 15, fontStyle: 'italic', color: colors.textMuted },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', marginTop: 2 },
  time: { fontSize: 11, color: colors.textMuted },
  tick: { fontSize: 12, marginLeft: 4, fontWeight: '700' },
  failed: { fontSize: 12, color: colors.danger, marginTop: 2 },
  image: { width: 240, borderRadius: 8, backgroundColor: '#CBD5E1', marginBottom: 4 },
  doc: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.05)',
    padding: 8, borderRadius: 8, minWidth: 200, marginBottom: 2,
  },
  docIcon: { fontSize: 26, marginRight: 8 },
  docName: { fontSize: 14, fontWeight: '600', color: colors.text },
  docMeta: { fontSize: 12, color: colors.textMuted },
  systemWrap: { alignItems: 'center', marginVertical: 6, paddingHorizontal: 24 },
  system: {
    fontSize: 12, color: colors.textMuted, backgroundColor: '#FFFFFFCC',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, textAlign: 'center',
  },
  reactions: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 6, paddingVertical: 1,
    marginTop: -4, borderWidth: 1, borderColor: colors.border,
  },
  reaction: { fontSize: 13, marginHorizontal: 2 },
});

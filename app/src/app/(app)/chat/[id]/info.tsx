import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { AccountBadge, Avatar } from '../../../../components/Avatar';
import { Button, ListRow, Section } from '../../../../components/ui';
import {
  blockUser,
  getConversation,
  getMembers,
  leaveGroup,
  listBlocked,
  removeGroupMember,
  reportUser,
  setConversationPrefs,
  setGroupAdmin,
  unblockUser,
  updateGroup,
  uploadAvatar,
} from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { onChatEvent } from '../../../../lib/realtime';
import { colors } from '../../../../lib/theme';
import type { Conversation, Member, NotifyLevel } from '../../../../lib/types';

const MUTE_OPTIONS: { label: string; hours: number | null }[] = [
  { label: '8 hours', hours: 8 },
  { label: '1 week', hours: 24 * 7 },
  { label: 'Always', hours: 24 * 365 * 50 },
];

export default function ChatInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const me = session!.user.id;
  const [conv, setConv] = useState<Conversation | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, m, b] = await Promise.all([getConversation(id), getMembers(id), listBlocked()]);
      setConv(c);
      setMembers(m);
      setBlocked(b);
      setName(c.name ?? '');
      setDescription(c.description ?? '');
    } catch {
      router.back();
    }
  }, [id]);

  useEffect(() => {
    void load();
    return onChatEvent((e) => {
      if ((e.type === 'members_change' && (!e.conversationId || e.conversationId === id)) ||
          (e.type === 'conversation_update' && e.conversationId === id)) {
        void load();
      }
    });
  }, [id, load]);

  if (!conv) {
    return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />;
  }

  const isGroup = conv.kind === 'group';
  const mine = members.find((m) => m.user_id === me);
  const isAdmin = mine?.role === 'admin';
  const canEdit = isGroup && (isAdmin || !conv.only_admins_can_edit);
  const other = members.find((m) => m.user_id !== me);
  const muted = mine?.muted_until && new Date(mine.muted_until).getTime() > Date.now();

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changePhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
    if (res.canceled || !res.assets[0]) return;
    const uri = res.assets[0].uri;
    await run(async () => {
      const path = await uploadAvatar(`groups/${id}`, uri);
      await updateGroup(id, { avatarPath: path });
    });
  };

  const memberActions = (m: Member) => {
    if (!isAdmin || m.user_id === me) return;
    const nm = m.profile?.display_name ?? 'Member';
    Alert.alert(nm, undefined, [
      m.role === 'admin'
        ? { text: 'Dismiss as admin', onPress: () => run(() => setGroupAdmin(id, m.user_id, false)) }
        : { text: 'Make group admin', onPress: () => run(() => setGroupAdmin(id, m.user_id, true)) },
      {
        text: `Remove ${nm}`,
        style: 'destructive',
        onPress: () => run(() => removeGroupMember(id, m.user_id)),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const chooseMute = () => {
    if (muted) {
      void run(() => setConversationPrefs(id, { mutedUntil: null }));
      return;
    }
    Alert.alert('Mute notifications for…', undefined, [
      ...MUTE_OPTIONS.map((o) => ({
        text: o.label,
        onPress: () => run(() => setConversationPrefs(id, { mutedUntil: new Date(Date.now() + (o.hours ?? 0) * 3600_000) })),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const chooseLevel = () => {
    const levels: { label: string; value: NotifyLevel }[] = [
      { label: 'All messages', value: 'all' },
      { label: 'Only @mentions', value: 'mentions' },
      { label: 'Nothing', value: 'none' },
    ];
    Alert.alert('Notify me about', undefined, [
      ...levels.map((l) => ({ text: l.label, onPress: () => run(() => setConversationPrefs(id, { notifyLevel: l.value })) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const otherBlocked = other ? blocked.includes(other.user_id) : false;
  const title = isGroup ? conv.name : other?.profile?.display_name;
  const avatarPath = isGroup ? conv.avatar_path : other?.profile?.avatar_path;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.top}>
        <Pressable onPress={canEdit ? changePhoto : undefined}>
          <Avatar path={avatarPath} name={title} size={110} group={isGroup && !avatarPath} />
          {canEdit ? <Text style={styles.changePhoto}>Change photo</Text> : null}
        </Pressable>
        {editing ? (
          <View style={{ width: '100%', paddingHorizontal: 20 }}>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Group name" maxLength={80} />
            <TextInput
              style={[styles.input, { minHeight: 70 }]}
              value={description}
              onChangeText={setDescription}
              placeholder="Group description"
              multiline
              maxLength={500}
            />
            <Button title="Save" busy={busy} onPress={() => run(async () => { await updateGroup(id, { name, description }); setEditing(false); })} />
            <Button title="Cancel" kind="secondary" onPress={() => setEditing(false)} />
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
              <Text style={styles.name}>{title}</Text>
              {!isGroup ? <AccountBadge type={other?.profile?.account_type} /> : null}
            </View>
            <Text style={styles.sub}>
              {isGroup ? `Group · ${members.length} members` : `@${other?.profile?.username ?? ''}`}
            </Text>
            {isGroup && conv.description ? <Text style={styles.description}>{conv.description}</Text> : null}
            {!isGroup && other?.profile?.about ? <Text style={styles.description}>{other.profile.about}</Text> : null}
            {canEdit ? (
              <Pressable onPress={() => setEditing(true)}>
                <Text style={styles.edit}>Edit name and description</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>

      <Section title="Notifications">
        <ListRow
          title="Mute notifications"
          subtitle={muted ? `Muted until ${new Date(mine!.muted_until!).toLocaleString()}` : 'Off'}
          onPress={chooseMute}
          right={<Switch value={!!muted} onValueChange={chooseMute} />}
        />
        {isGroup ? (
          <ListRow
            title="Notify me about"
            subtitle={mine?.notify_level === 'mentions' ? 'Only @mentions' : mine?.notify_level === 'none' ? 'Nothing' : 'All messages'}
            onPress={chooseLevel}
          />
        ) : null}
      </Section>

      <Section>
        <ListRow title="🔍  Search in this chat" onPress={() => router.push({ pathname: '/search', params: { conversationId: id } })} />
        <ListRow
          title="Clear chat history"
          subtitle="Hides earlier messages on your phone only"
          onPress={() =>
            Alert.alert('Clear chat?', 'Messages before now will be hidden for you.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Clear', style: 'destructive', onPress: () => run(() => setConversationPrefs(id, { clearHistory: true })) },
            ])
          }
        />
      </Section>

      {isGroup ? (
        <Section title={`${members.length} members`}>
          {isAdmin ? (
            <ListRow title="➕  Add members" onPress={() => router.push({ pathname: '/chat/[id]/add-members', params: { id } })} />
          ) : null}
          {members.map((m) => (
            <Pressable key={m.user_id} style={styles.member} onPress={() => memberActions(m)}>
              <Avatar path={m.profile?.avatar_path} name={m.profile?.display_name} size={40} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.memberName}>{m.user_id === me ? 'You' : m.profile?.display_name}</Text>
                  <AccountBadge type={m.profile?.account_type} />
                </View>
                <Text style={styles.sub}>@{m.profile?.username}</Text>
              </View>
              {m.role === 'admin' ? <Text style={styles.admin}>Admin</Text> : null}
            </Pressable>
          ))}
          {isAdmin ? (
            <ListRow
              title="Only admins can edit group info"
              right={
                <Switch
                  value={conv.only_admins_can_edit}
                  onValueChange={(v) => run(() => updateGroup(id, { onlyAdminsCanEdit: v }))}
                />
              }
            />
          ) : null}
        </Section>
      ) : null}

      <Section>
        {isGroup ? (
          <ListRow
            title="Exit group"
            danger
            onPress={() =>
              Alert.alert('Exit group?', undefined, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Exit', style: 'destructive', onPress: () => run(async () => { await leaveGroup(id); router.dismissTo('/'); }) },
              ])
            }
          />
        ) : other ? (
          <ListRow
            title={otherBlocked ? `Unblock ${other.profile?.display_name}` : `Block ${other.profile?.display_name}`}
            danger={!otherBlocked}
            onPress={() =>
              otherBlocked
                ? run(() => unblockUser(me, other.user_id))
                : Alert.alert('Block this person?', 'They will not be able to message you or see when you are online.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Block', style: 'destructive', onPress: () => run(() => blockUser(me, other.user_id)) },
                  ])
            }
          />
        ) : null}
        <ListRow
          title={isGroup ? 'Report group' : `Report ${other?.profile?.display_name ?? ''}`}
          danger
          onPress={() =>
            Alert.alert('Report', 'Why are you reporting?', [
              ...(['spam', 'harassment', 'scam', 'inappropriate'] as const).map((reason) => ({
                text: reason[0].toUpperCase() + reason.slice(1),
                onPress: () =>
                  run(async () => {
                    await reportUser({ reason, conversationId: id, reportedUserId: isGroup ? undefined : other?.user_id });
                    Alert.alert('Thanks', 'Your report was sent.');
                  }),
              })),
              { text: 'Cancel', style: 'cancel' as const },
            ])
          }
        />
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'center', paddingVertical: 24, backgroundColor: '#fff' },
  changePhoto: { color: colors.primary, textAlign: 'center', marginTop: 6, fontWeight: '600' },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  sub: { color: colors.textMuted, marginTop: 2 },
  description: { color: colors.text, marginTop: 10, paddingHorizontal: 24, textAlign: 'center' },
  edit: { color: colors.primary, marginTop: 10, fontWeight: '600' },
  input: {
    backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    padding: 12, fontSize: 16, marginTop: 10, color: colors.text,
  },
  member: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  memberName: { fontSize: 16, fontWeight: '600', color: colors.text },
  admin: {
    color: colors.primary, borderWidth: 1, borderColor: colors.primary, borderRadius: 6,
    paddingHorizontal: 6, fontSize: 12, fontWeight: '700',
  },
});

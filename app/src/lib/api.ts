import { File as FsFile } from 'expo-file-system';
import { supabase } from './supabase';
import type {
  Conversation,
  ConversationListItem,
  Member,
  Message,
  MessageSettings,
  NotifyLevel,
  Presence,
  Profile,
  Reaction,
} from './types';

export const PAGE_SIZE = 40;
const MESSAGE_SELECT = '*, message_attachments(*)';

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// ------------------------------------------------------------------ profiles
const profileCache = new Map<string, Profile>();

export async function getProfiles(ids: string[]): Promise<Map<string, Profile>> {
  const missing = [...new Set(ids)].filter((id) => id && !profileCache.has(id));
  if (missing.length) {
    const rows = check(
      await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_path, account_type, about')
        .in('id', missing),
    ) as Profile[];
    rows.forEach((p) => profileCache.set(p.id, p));
  }
  const out = new Map<string, Profile>();
  ids.forEach((id) => {
    const p = profileCache.get(id);
    if (p) out.set(id, p);
  });
  return out;
}

export function cachedProfile(id: string | null | undefined): Profile | undefined {
  return id ? profileCache.get(id) : undefined;
}

export function rememberProfile(p: Profile) {
  profileCache.set(p.id, p);
}

export async function updateMyProfile(userId: string, patch: Partial<Pick<Profile, 'display_name' | 'username' | 'about' | 'avatar_path'>>) {
  const row = check(
    await supabase.from('profiles').update(patch).eq('id', userId).select().single(),
  ) as Profile;
  profileCache.set(row.id, row);
  return row;
}

export async function searchUsers(query: string): Promise<Profile[]> {
  if (!query.trim()) return [];
  const rows = check(await supabase.rpc('search_users', { p_query: query.trim() })) as Profile[];
  rows.forEach((p) => profileCache.set(p.id, p));
  return rows;
}

// ------------------------------------------------------------------ conversations
export async function listConversations(): Promise<ConversationListItem[]> {
  return check(await supabase.rpc('list_my_conversations')) as ConversationListItem[];
}

export async function getConversation(id: string): Promise<Conversation> {
  return check(await supabase.from('conversations').select('*').eq('id', id).single()) as Conversation;
}

export async function getMembers(conversationId: string): Promise<Member[]> {
  const rows = check(
    await supabase
      .from('conversation_members')
      .select('conversation_id, user_id, role, joined_at, last_delivered_at, read_receipt_at, muted_until, notify_level')
      .eq('conversation_id', conversationId)
      .order('joined_at'),
  ) as Member[];
  const profiles = await getProfiles(rows.map((r) => r.user_id));
  return rows.map((r) => ({ ...r, profile: profiles.get(r.user_id) }));
}

export async function openDirectChat(otherUserId: string): Promise<string> {
  return check(await supabase.rpc('get_or_create_direct_conversation', { p_other_user: otherUserId })) as string;
}

export async function createGroup(name: string, description: string, memberIds: string[]): Promise<string> {
  return check(
    await supabase.rpc('create_group', { p_name: name, p_description: description, p_member_ids: memberIds }),
  ) as string;
}

export async function addGroupMembers(conversationId: string, userIds: string[]) {
  return check(await supabase.rpc('add_group_members', { p_conversation: conversationId, p_user_ids: userIds }));
}

export async function removeGroupMember(conversationId: string, userId: string) {
  check(await supabase.rpc('remove_group_member', { p_conversation: conversationId, p_user: userId }));
}

export async function setGroupAdmin(conversationId: string, userId: string, isAdmin: boolean) {
  check(await supabase.rpc('set_group_admin', { p_conversation: conversationId, p_user: userId, p_is_admin: isAdmin }));
}

export async function updateGroup(
  conversationId: string,
  patch: { name?: string; description?: string; avatarPath?: string; onlyAdminsCanEdit?: boolean },
) {
  check(
    await supabase.rpc('update_group', {
      p_conversation: conversationId,
      p_name: patch.name ?? null,
      p_description: patch.description ?? null,
      p_avatar_path: patch.avatarPath ?? null,
      p_only_admins_can_edit: patch.onlyAdminsCanEdit ?? null,
    }),
  );
}

export async function leaveGroup(conversationId: string) {
  check(await supabase.rpc('leave_group', { p_conversation: conversationId }));
}

export async function setConversationPrefs(
  conversationId: string,
  prefs: { mutedUntil?: Date | null; notifyLevel?: NotifyLevel; archived?: boolean; pinned?: boolean; clearHistory?: boolean },
) {
  check(
    await supabase.rpc('set_conversation_prefs', {
      p_conversation: conversationId,
      p_muted_until: prefs.mutedUntil ? prefs.mutedUntil.toISOString() : null,
      p_unmute: prefs.mutedUntil === null,
      p_notify_level: prefs.notifyLevel ?? null,
      p_archived: prefs.archived ?? null,
      p_pinned: prefs.pinned ?? null,
      p_clear_history: prefs.clearHistory ?? false,
    }),
  );
}

// ------------------------------------------------------------------ messages
/** Newest first. Pass the oldest loaded message to get the page before it. */
export async function fetchMessages(conversationId: string, before?: { created_at: string; id: string }): Promise<Message[]> {
  let q = supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);
  if (before) {
    q = q.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`);
  }
  return check(await q) as Message[];
}

export async function fetchMessage(id: string): Promise<Message | null> {
  const { data } = await supabase.from('messages').select(MESSAGE_SELECT).eq('id', id).maybeSingle();
  return (data as Message) ?? null;
}

export async function fetchMessagesSince(conversationId: string, sinceIso: string): Promise<Message[]> {
  return check(
    await supabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('conversation_id', conversationId)
      .gt('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(500),
  ) as Message[];
}

export interface SendInput {
  id: string;
  conversationId: string;
  senderId: string;
  kind: 'text' | 'image' | 'document' | 'voice';
  body: string | null;
  replyToId: string | null;
  mentions: string[];
  metadata?: Record<string, unknown>;
  file?: { uri: string; mimeType: string; name: string; size?: number; durationMs?: number; width?: number; height?: number };
}

/** Uploads the file (if any), inserts the message, then the attachment row. Safe to retry. */
export async function sendMessage(input: SendInput): Promise<void> {
  let storagePath: string | null = null;
  let size = input.file?.size ?? 0;
  if (input.file) {
    const ext = input.file.name.includes('.') ? input.file.name.split('.').pop() : 'bin';
    storagePath = `${input.conversationId}/${input.senderId}/${input.id}.${ext}`;
    const bytes = await new FsFile(input.file.uri).arrayBuffer();
    size = bytes.byteLength;
    const up = await supabase.storage
      .from('chat-media')
      .upload(storagePath, bytes, { contentType: input.file.mimeType, upsert: false });
    // "already exists" means an earlier attempt uploaded it: keep going.
    if (up.error && !/exist|duplicate/i.test(up.error.message)) throw new Error(up.error.message);
  }

  const ins = await supabase.from('messages').insert({
    id: input.id,
    conversation_id: input.conversationId,
    sender_id: input.senderId,
    kind: input.kind,
    body: input.body,
    reply_to_id: input.replyToId,
    mentions: input.mentions,
    metadata: input.metadata ?? {},
  });
  // 23505 = already inserted by an earlier attempt: treat as success.
  if (ins.error && ins.error.code !== '23505') throw new Error(ins.error.message);

  if (input.file && storagePath) {
    const existing = await supabase.from('message_attachments').select('id').eq('message_id', input.id).limit(1);
    if (!existing.data?.length) {
      check(
        await supabase.from('message_attachments').insert({
          message_id: input.id,
          conversation_id: input.conversationId,
          uploader_id: input.senderId,
          storage_path: storagePath,
          mime_type: input.file.mimeType,
          size_bytes: size,
          file_name: input.file.name,
          duration_ms: input.file.durationMs ?? null,
          width: input.file.width ?? null,
          height: input.file.height ?? null,
        }),
      );
    }
  }
}

export async function deleteMessage(messageId: string, forEveryone: boolean) {
  const paths = check(
    await supabase.rpc('delete_message', { p_message: messageId, p_for_everyone: forEveryone }),
  ) as string[] | null;
  if (paths?.length) {
    // Best effort: remove files only this message used.
    await supabase.storage.from('chat-media').remove(paths);
  }
}

export async function forwardMessage(messageId: string, conversationIds: string[]) {
  return check(await supabase.rpc('forward_message', { p_message: messageId, p_conversation_ids: conversationIds }));
}

export async function markRead(conversationId: string) {
  await supabase.rpc('mark_conversation_read', { p_conversation: conversationId });
}

export async function markAllDelivered() {
  await supabase.rpc('mark_all_delivered');
}

export async function searchMessages(query: string, conversationId?: string) {
  return check(
    await supabase.rpc('search_messages', { p_query: query, p_conversation: conversationId ?? null }),
  ) as { message_id: string; conversation_id: string; sender_id: string; body: string; created_at: string; kind: string }[];
}

// ------------------------------------------------------------------ reactions
export async function fetchReactions(messageIds: string[]): Promise<Reaction[]> {
  if (!messageIds.length) return [];
  return check(await supabase.from('message_reactions').select('*').in('message_id', messageIds)) as Reaction[];
}

export async function setReaction(messageId: string, userId: string, emoji: string | null) {
  if (emoji === null) {
    check(await supabase.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', userId));
  } else {
    check(
      await supabase
        .from('message_reactions')
        .upsert({ message_id: messageId, user_id: userId, emoji }, { onConflict: 'message_id,user_id' }),
    );
  }
}

// ------------------------------------------------------------------ media URLs
const signedCache = new Map<string, { url: string; expires: number }>();

export async function mediaUrl(path: string): Promise<string> {
  const hit = signedCache.get(path);
  if (hit && hit.expires > Date.now() + 60_000) return hit.url;
  const { data, error } = await supabase.storage.from('chat-media').createSignedUrl(path, 3600);
  if (error || !data) throw new Error(error?.message ?? 'Could not load file');
  signedCache.set(path, { url: data.signedUrl, expires: Date.now() + 3600_000 });
  return data.signedUrl;
}

export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

export async function uploadAvatar(folder: string, uri: string, mimeType = 'image/jpeg'): Promise<string> {
  const path = `${folder}/${Date.now()}.jpg`;
  const bytes = await new FsFile(uri).arrayBuffer();
  const { error } = await supabase.storage.from('avatars').upload(path, bytes, { contentType: mimeType, upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

// ------------------------------------------------------------------ settings, presence, safety
export async function getMySettings(userId: string): Promise<MessageSettings> {
  return check(
    await supabase
      .from('user_message_settings')
      .select('user_id, notifications_enabled, show_message_preview, group_notifications, send_read_receipts, show_online_status')
      .eq('user_id', userId)
      .single(),
  ) as MessageSettings;
}

export async function updateMySettings(userId: string, patch: Partial<Omit<MessageSettings, 'user_id'>>) {
  check(await supabase.from('user_message_settings').update(patch).eq('user_id', userId));
}

export async function setPresence(online: boolean) {
  await supabase.rpc('set_presence', { p_online: online });
}

export async function getPresence(userIds: string[]): Promise<Presence[]> {
  if (!userIds.length) return [];
  return check(await supabase.rpc('get_presence', { p_user_ids: userIds })) as Presence[];
}

export async function listBlocked(): Promise<string[]> {
  const rows = check(await supabase.from('user_blocks').select('blocked_id')) as { blocked_id: string }[];
  return rows.map((r) => r.blocked_id);
}

export async function blockUser(me: string, other: string) {
  const res = await supabase.from('user_blocks').insert({ blocker_id: me, blocked_id: other });
  if (res.error && res.error.code !== '23505') throw new Error(res.error.message);
}

export async function unblockUser(me: string, other: string) {
  check(await supabase.from('user_blocks').delete().eq('blocker_id', me).eq('blocked_id', other));
}

export async function reportUser(input: {
  reportedUserId?: string;
  conversationId?: string;
  messageId?: string;
  reason: 'spam' | 'harassment' | 'scam' | 'inappropriate' | 'other';
  details?: string;
}) {
  check(
    await supabase.from('user_reports').insert({
      reported_user_id: input.reportedUserId ?? null,
      conversation_id: input.conversationId ?? null,
      message_id: input.messageId ?? null,
      reason: input.reason,
      details: input.details ?? null,
    }),
  );
}

export async function registerPushToken(token: string, platform: 'android' | 'ios') {
  await supabase.rpc('register_push_token', { p_token: token, p_platform: platform });
}

export async function removePushToken(token: string) {
  await supabase.from('push_tokens').delete().eq('token', token);
}

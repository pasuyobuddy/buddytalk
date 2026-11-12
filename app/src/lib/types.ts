export type AccountType = 'customer' | 'rider';
export type MessageKind = 'text' | 'image' | 'document' | 'voice' | 'system';
export type NotifyLevel = 'all' | 'mentions' | 'none';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  account_type: AccountType;
  about?: string | null;
}

export interface Attachment {
  id: string;
  message_id: string;
  conversation_id: string;
  uploader_id: string | null;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  file_name: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
}

export interface Reaction {
  message_id: string;
  user_id: string;
  conversation_id: string;
  emoji: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  kind: MessageKind;
  body: string | null;
  reply_to_id: string | null;
  forwarded: boolean;
  mentions: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  message_attachments?: Attachment[];
}

/** A message in the UI: server rows plus local not-yet-sent ones. */
export interface UiMessage extends Message {
  local?: {
    status: 'queued' | 'sending' | 'failed';
    fileUri?: string;
    error?: string;
  };
}

export interface ConversationListItem {
  conversation_id: string;
  kind: 'direct' | 'group';
  title: string | null;
  avatar_path: string | null;
  other_user_id: string | null;
  other_account_type: AccountType | null;
  member_count: number;
  my_role: 'admin' | 'member';
  last_message_at: string | null;
  last_message_id: string | null;
  last_message_kind: MessageKind | null;
  last_message_body: string | null;
  last_message_sender_id: string | null;
  last_message_sender_name: string | null;
  last_message_deleted: boolean | null;
  unread_count: number;
  mention_count: number;
  muted_until: string | null;
  notify_level: NotifyLevel;
  archived: boolean;
  pinned: boolean;
}

export interface Conversation {
  id: string;
  kind: 'direct' | 'group';
  name: string | null;
  description: string | null;
  avatar_path: string | null;
  only_admins_can_edit: boolean;
  created_by: string | null;
  created_at: string;
}

export interface Member {
  conversation_id: string;
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
  last_delivered_at: string | null;
  read_receipt_at: string | null;
  muted_until: string | null;
  notify_level: NotifyLevel;
  profile?: Profile;
}

export interface MessageSettings {
  user_id: string;
  notifications_enabled: boolean;
  show_message_preview: boolean;
  group_notifications: boolean;
  send_read_receipts: boolean;
  show_online_status: boolean;
}

export interface Presence {
  user_id: string;
  is_online: boolean;
  last_seen_at: string | null;
}

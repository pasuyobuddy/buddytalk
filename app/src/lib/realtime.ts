// One realtime connection for the whole app. Row Level Security on the server
// means each user only receives changes for conversations they belong to.
// Screens subscribe to this small event bus instead of opening their own channels.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Attachment, Message, Reaction } from './types';

export type ChatEvent =
  | { type: 'message_insert'; message: Message }
  | { type: 'message_update'; message: Message }
  | { type: 'attachment_insert'; attachment: Attachment }
  | { type: 'reaction_upsert'; reaction: Reaction }
  | { type: 'reaction_delete'; reaction: Partial<Reaction> }
  | { type: 'members_change'; conversationId: string | null }
  | { type: 'conversation_update'; conversationId: string }
  | { type: 'reconnected' };

type Listener = (e: ChatEvent) => void;
const listeners = new Set<Listener>();
let channel: RealtimeChannel | null = null;
let wasDisconnected = false;

function emit(e: ChatEvent) {
  listeners.forEach((l) => l(e));
}

export function onChatEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startRealtime(userId: string) {
  stopRealtime();
  channel = supabase
    .channel(`inbox:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) =>
      emit({ type: 'message_insert', message: p.new as Message }),
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (p) =>
      emit({ type: 'message_update', message: p.new as Message }),
    )
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_attachments' }, (p) =>
      emit({ type: 'attachment_insert', attachment: p.new as Attachment }),
    )
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, (p) =>
      emit({ type: 'reaction_upsert', reaction: p.new as Reaction }),
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_reactions' }, (p) =>
      emit({ type: 'reaction_upsert', reaction: p.new as Reaction }),
    )
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, (p) =>
      emit({ type: 'reaction_delete', reaction: p.old as Partial<Reaction> }),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, (p) => {
      const row = (p.new && Object.keys(p.new).length ? p.new : p.old) as { conversation_id?: string };
      emit({ type: 'members_change', conversationId: row?.conversation_id ?? null });
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, (p) =>
      emit({ type: 'conversation_update', conversationId: (p.new as { id: string }).id }),
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (wasDisconnected) emit({ type: 'reconnected' });
        wasDisconnected = false;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        wasDisconnected = true;
      }
    });
}

export function stopRealtime() {
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
}

/** Ask screens to catch up (e.g. app returned to the foreground). */
export function requestResync() {
  emit({ type: 'reconnected' });
}

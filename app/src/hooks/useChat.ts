import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  fetchMessage,
  fetchMessages,
  fetchMessagesSince,
  fetchReactions,
  getConversation,
  getMembers,
  getPresence,
  getProfiles,
  markRead,
  PAGE_SIZE,
} from '../lib/api';
import { subscribeOutbox, type OutboxItem } from '../lib/outbox';
import { onChatEvent } from '../lib/realtime';
import type { Conversation, Member, Message, Presence, Reaction, UiMessage } from '../lib/types';

function sortDesc(a: Message, b: Message) {
  if (a.created_at === b.created_at) return a.id < b.id ? 1 : -1;
  return a.created_at < b.created_at ? 1 : -1;
}

export function useChat(conversationId: string, myId: string) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [serverMessages, setServerMessages] = useState<Map<string, Message>>(new Map());
  const [reactions, setReactions] = useState<Map<string, Reaction[]>>(new Map());
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef(serverMessages);
  messagesRef.current = serverMessages;

  const scheduleRead = useCallback(() => {
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      if (AppState.currentState === 'active') void markRead(conversationId);
    }, 500);
  }, [conversationId]);

  const mergeMessages = useCallback((rows: Message[]) => {
    if (!rows.length) return;
    setServerMessages((prev) => {
      const next = new Map(prev);
      rows.forEach((m) => {
        const old = next.get(m.id);
        // Realtime rows do not include attachments; keep the ones we already have.
        next.set(m.id, { ...m, message_attachments: m.message_attachments ?? old?.message_attachments ?? [] });
      });
      return next;
    });
    void getProfiles(rows.map((r) => r.sender_id).filter(Boolean) as string[]);
  }, []);

  const loadReactions = useCallback(async (ids: string[]) => {
    const rows = await fetchReactions(ids);
    setReactions((prev) => {
      const next = new Map(prev);
      ids.forEach((id) => next.delete(id));
      rows.forEach((r) => next.set(r.message_id, [...(next.get(r.message_id) ?? []), r]));
      return next;
    });
  }, []);

  const refreshMembers = useCallback(async () => {
    try {
      const rows = await getMembers(conversationId);
      setMembers(rows);
      setRemoved(!rows.some((m) => m.user_id === myId));
    } catch {
      setRemoved(true);
    }
  }, [conversationId, myId]);

  const refreshPresence = useCallback(
    async (conv: Conversation | null, mems: Member[]) => {
      if (!conv || conv.kind !== 'direct') return;
      const other = mems.find((m) => m.user_id !== myId);
      if (!other) return;
      const [p] = await getPresence([other.user_id]);
      setPresence(p ?? null);
    },
    [myId],
  );

  // Catch up after being offline or in the background.
  const resync = useCallback(async () => {
    const newest = [...messagesRef.current.values()].sort(sortDesc)[0];
    try {
      const rows = newest ? await fetchMessagesSince(conversationId, newest.created_at) : await fetchMessages(conversationId);
      mergeMessages(rows);
      await refreshMembers();
      if (rows.length) scheduleRead();
    } catch {
      // Still offline; the next reconnect will try again.
    }
  }, [conversationId, mergeMessages, refreshMembers, scheduleRead]);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setServerMessages(new Map());
    setReactions(new Map());
    (async () => {
      try {
        const [conv, firstPage] = await Promise.all([getConversation(conversationId), fetchMessages(conversationId)]);
        if (cancelled) return;
        setConversation(conv);
        mergeMessages(firstPage);
        setHasMore(firstPage.length === PAGE_SIZE);
        await Promise.all([refreshMembers(), loadReactions(firstPage.map((m) => m.id))]);
        scheduleRead();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, mergeMessages, refreshMembers, loadReactions, scheduleRead]);

  useEffect(() => {
    void refreshPresence(conversation, members);
    const t = setInterval(() => void refreshPresence(conversation, members), 30_000);
    return () => clearInterval(t);
  }, [conversation, members, refreshPresence]);

  // Live updates.
  useEffect(() => {
    const off = onChatEvent(async (e) => {
      switch (e.type) {
        case 'message_insert':
          if (e.message.conversation_id !== conversationId) return;
          mergeMessages([e.message]);
          if (e.message.sender_id !== myId) scheduleRead();
          if (e.message.kind === 'system') void refreshMembers();
          return;
        case 'message_update':
          if (e.message.conversation_id !== conversationId) return;
          mergeMessages([e.message]);
          return;
        case 'attachment_insert': {
          if (e.attachment.conversation_id !== conversationId) return;
          const full = await fetchMessage(e.attachment.message_id);
          if (full) mergeMessages([full]);
          return;
        }
        case 'reaction_upsert':
          if (e.reaction.conversation_id !== conversationId) return;
          setReactions((prev) => {
            const next = new Map(prev);
            const list = (next.get(e.reaction.message_id) ?? []).filter((r) => r.user_id !== e.reaction.user_id);
            next.set(e.reaction.message_id, [...list, e.reaction]);
            return next;
          });
          return;
        case 'reaction_delete': {
          const { message_id, user_id } = e.reaction;
          if (!message_id || !messagesRef.current.has(message_id)) return;
          setReactions((prev) => {
            const next = new Map(prev);
            next.set(message_id, (next.get(message_id) ?? []).filter((r) => r.user_id !== user_id));
            return next;
          });
          return;
        }
        case 'members_change':
          if (e.conversationId && e.conversationId !== conversationId) return;
          void refreshMembers();
          return;
        case 'conversation_update':
          if (e.conversationId !== conversationId) return;
          setConversation(await getConversation(conversationId).catch(() => null));
          return;
        case 'reconnected':
          void resync();
          return;
      }
    });
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void resync();
    });
    return () => {
      off();
      appSub.remove();
      if (readTimer.current) clearTimeout(readTimer.current);
    };
  }, [conversationId, myId, mergeMessages, refreshMembers, resync, scheduleRead]);

  useEffect(() => subscribeOutbox((all) => setOutbox(all.filter((i) => i.input.conversationId === conversationId))), [conversationId]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore) return;
    const oldest = [...messagesRef.current.values()].sort(sortDesc).at(-1);
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(conversationId, oldest);
      mergeMessages(page);
      setHasMore(page.length === PAGE_SIZE);
      await loadReactions(page.map((m) => m.id));
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, hasMore, loadingOlder, mergeMessages, loadReactions]);

  // Server messages + pending local ones, newest first (for an inverted list).
  const messages: UiMessage[] = useMemo(() => {
    const server = [...serverMessages.values()];
    const pending: UiMessage[] = outbox
      .filter((o) => !serverMessages.has(o.input.id))
      .map((o) => ({
        id: o.input.id,
        conversation_id: o.input.conversationId,
        sender_id: o.input.senderId,
        kind: o.input.kind,
        body: o.input.body,
        reply_to_id: o.input.replyToId,
        forwarded: false,
        mentions: o.input.mentions,
        metadata: o.input.metadata ?? {},
        created_at: o.createdAt,
        edited_at: null,
        deleted_at: null,
        message_attachments: [],
        local: { status: o.status, fileUri: o.input.file?.uri, error: o.error },
      }));
    return [...server, ...pending].sort(sortDesc);
  }, [serverMessages, outbox]);

  return {
    conversation,
    members,
    messages,
    messageById: serverMessages,
    reactions,
    presence,
    loading,
    loadingOlder,
    hasMore,
    loadOlder,
    error,
    removed,
    refreshMembers,
  };
}

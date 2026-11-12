import { useCallback, useEffect, useRef, useState } from 'react';
import { listConversations } from '../lib/api';
import { setBadge } from '../lib/push';
import { onChatEvent } from '../lib/realtime';
import type { ConversationListItem } from '../lib/types';

export function useConversations() {
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await listConversations();
      setItems(rows);
      setError(null);
      const unread = rows.reduce((n, r) => n + (r.archived ? 0 : r.unread_count), 0);
      void setBadge(unread);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Many events can arrive at once (e.g. a busy group); refresh at most every 400 ms.
    const off = onChatEvent((e) => {
      if (e.type === 'attachment_insert' || e.type === 'reaction_upsert' || e.type === 'reaction_delete') return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refresh(), 400);
    });
    return () => {
      off();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  return { items, loading, error, refresh };
}

// Offline-safe sending. Every outgoing message is saved to the device first,
// shown immediately in the chat, then sent when there is a connection.
// The message id is created on the phone, so a retry can never create a duplicate.
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { sendMessage, type SendInput } from './api';

const KEY = 'buddytalk/outbox/v1';

export interface OutboxItem {
  input: SendInput;
  createdAt: string;
  attempts: number;
  status: 'queued' | 'sending' | 'failed';
  error?: string;
}

type Listener = (items: OutboxItem[]) => void;

let items: OutboxItem[] = [];
let loaded = false;
let running = false;
let online = true;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;
const listeners = new Set<Listener>();

function emit() {
  const snapshot = [...items];
  listeners.forEach((l) => l(snapshot));
}

async function persist() {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    items = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    // Anything left "sending" from a crash should be retried.
    items = items.map((i) => (i.status === 'sending' ? { ...i, status: 'queued' } : i));
  } catch {
    items = [];
  }
  emit();
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  listener([...items]);
  return () => listeners.delete(listener);
}

export function outboxFor(conversationId: string): OutboxItem[] {
  return items.filter((i) => i.input.conversationId === conversationId);
}

export async function enqueue(input: SendInput) {
  await load();
  items.push({ input, createdAt: new Date().toISOString(), attempts: 0, status: 'queued' });
  emit();
  await persist();
  void processOutbox();
}

export async function retry(id: string) {
  items = items.map((i) => (i.input.id === id ? { ...i, status: 'queued', attempts: 0, error: undefined } : i));
  emit();
  await persist();
  void processOutbox();
}

export async function discard(id: string) {
  items = items.filter((i) => i.input.id !== id);
  emit();
  await persist();
}

// The phone's "connected" signal is not always reliable, so after a network
// error also retry on a timer: 2s, 4s, 8s, then every 10s.
function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void processOutbox();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 10_000);
}

export async function processOutbox() {
  await load();
  if (running) return;
  running = true;
  try {
    // Send in order, oldest first, so chats stay in the right order.
    for (;;) {
      const next = items.find((i) => i.status === 'queued');
      if (!next) break;
      next.status = 'sending';
      emit();
      try {
        await sendMessage(next.input);
        items = items.filter((i) => i.input.id !== next.input.id);
        retryDelay = 2000;
      } catch (e) {
        next.attempts += 1;
        next.error = e instanceof Error ? e.message : String(e);
        const isNetwork = /network|fetch|timeout|offline/i.test(next.error);
        // Network errors wait for reconnection; other errors give up after 3 tries.
        next.status = isNetwork ? 'queued' : next.attempts >= 3 ? 'failed' : 'queued';
        if (isNetwork) {
          emit();
          await persist();
          scheduleRetry();
          break;
        }
      }
      emit();
      await persist();
    }
  } finally {
    running = false;
  }
}

let started = false;
export function startOutbox() {
  if (started) return;
  started = true;
  void load().then(processOutbox);
  NetInfo.addEventListener((state) => {
    // Only trust "connected"; the reachability probe can be wrong on some networks,
    // and a failed send is retried on a timer anyway.
    const nowOnline = state.isConnected !== false;
    const cameBack = nowOnline && !online;
    online = nowOnline;
    if (cameBack) {
      retryDelay = 2000;
      void processOutbox();
    }
  });
}

export function isOnline() {
  return online;
}

export async function clearOutbox() {
  items = [];
  emit();
  await AsyncStorage.removeItem(KEY);
}

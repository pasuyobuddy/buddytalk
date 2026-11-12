import type { MessageKind } from './types';

export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function chatListTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeOfDay(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const diffDays = (now.getTime() - d.getTime()) / 86_400_000;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString();
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function lastSeen(iso: string | null): string {
  if (!iso) return 'offline';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `last seen today at ${timeOfDay(iso)}`;
  return `last seen ${d.toLocaleDateString()} at ${timeOfDay(iso)}`;
}

export function durationLabel(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function messagePreview(kind: MessageKind | null, body: string | null, deleted?: boolean | null): string {
  if (deleted) return '🚫 This message was deleted';
  switch (kind) {
    case 'image': return body ? `📷 ${body}` : '📷 Photo';
    case 'document': return body ? `📄 ${body}` : '📄 Document';
    case 'voice': return '🎤 Voice message';
    case 'system': return body ?? 'Group updated';
    default: return body ?? '';
  }
}

export function uuid(): string {
  // RFC4122 v4 from Math.random is fine for client-generated message ids
  // (the server rejects duplicates, which is exactly what the outbox relies on).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

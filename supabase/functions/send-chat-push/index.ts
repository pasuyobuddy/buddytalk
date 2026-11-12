// Supabase Edge Function: send-chat-push
//
// Called by a Database Webhook on INSERT into public.messages.
// Works out who should be notified (respecting mute, notification level,
// blocks and settings) and sends Firebase Cloud Messaging (HTTP v1) pushes.
//
// Secrets (supabase secrets set ...):
//   FCM_SERVICE_ACCOUNT   full JSON of a Firebase service account key
//   PUSH_WEBHOOK_SECRET   random string; the webhook sends it in the x-webhook-secret header
// Provided automatically: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  kind: "text" | "image" | "document" | "voice" | "system";
  body: string | null;
  mentions: string[];
  forwarded: boolean;
  created_at: string;
};

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// ---------- Google OAuth token for FCM (cached while valid) ----------
let cachedToken: { value: string; expires: number } | null = null;

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expires - 60 > now) return cachedToken.value;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${base64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`OAuth token request failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  cachedToken = { value: json.access_token, expires: now + (json.expires_in ?? 3600) };
  return cachedToken.value;
}

// ---------- Notification text ----------
function previewText(msg: MessageRow): string {
  if (msg.forwarded && msg.kind === "text") return `Forwarded: ${msg.body ?? ""}`;
  switch (msg.kind) {
    case "image": return msg.body ? `📷 ${msg.body}` : "📷 Photo";
    case "document": return msg.body ? `📄 ${msg.body}` : "📄 Document";
    case "voice": return "🎤 Voice message";
    default: return msg.body ?? "";
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("PUSH_WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: { type?: string; table?: string; record?: MessageRow };
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const msg = payload.record;
  if (payload.type !== "INSERT" || payload.table !== "messages" || !msg || msg.kind === "system" || !msg.sender_id) {
    return Response.json({ skipped: true });
  }

  const [{ data: conv }, { data: sender }, { data: members }, { data: blocks }] = await Promise.all([
    supabase.from("conversations").select("id, kind, name").eq("id", msg.conversation_id).single(),
    supabase.from("profiles").select("id, display_name").eq("id", msg.sender_id).single(),
    supabase.from("conversation_members")
      .select("user_id, muted_until, notify_level")
      .eq("conversation_id", msg.conversation_id)
      .neq("user_id", msg.sender_id),
    supabase.from("user_blocks").select("blocker_id").eq("blocked_id", msg.sender_id),
  ]);
  if (!conv || !members?.length) return Response.json({ sent: 0 });

  const blockedBy = new Set((blocks ?? []).map((b) => b.blocker_id));
  const now = Date.now();
  const candidates = members.filter((m) => {
    if (blockedBy.has(m.user_id)) return false;
    const mentioned = (msg.mentions ?? []).includes(m.user_id);
    if (m.muted_until && new Date(m.muted_until).getTime() > now && !mentioned) return false;
    if (m.notify_level === "none") return false;
    if (m.notify_level === "mentions" && !mentioned) return false;
    return true;
  });
  if (!candidates.length) return Response.json({ sent: 0 });

  const ids = candidates.map((c) => c.user_id);
  const [{ data: settings }, { data: tokens }] = await Promise.all([
    supabase.from("user_message_settings")
      .select("user_id, notifications_enabled, show_message_preview, group_notifications")
      .in("user_id", ids),
    supabase.from("push_tokens").select("token, user_id, platform").in("user_id", ids),
  ]);
  const settingsBy = new Map((settings ?? []).map((s) => [s.user_id, s]));

  const sa: ServiceAccount = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "{}");
  if (!sa.private_key) return new Response("FCM_SERVICE_ACCOUNT not set", { status: 500 });
  const accessToken = await getAccessToken(sa);

  const senderName = sender?.display_name ?? "New message";
  const isGroup = conv.kind === "group";
  const text = previewText(msg);

  // Unread totals so the app icon badge is correct.
  const unreadBy = new Map<string, number>();
  await Promise.all(ids.map(async (uid) => {
    const { data } = await supabase.rpc("total_unread_for_user", { p_user: uid });
    unreadBy.set(uid, typeof data === "number" ? data : 0);
  }));

  let sent = 0;
  const stale: string[] = [];
  await Promise.all((tokens ?? []).map(async (t) => {
    const s = settingsBy.get(t.user_id);
    if (s && !s.notifications_enabled) return;
    if (s && isGroup && !s.group_notifications && !(msg.mentions ?? []).includes(t.user_id)) return;

    const showPreview = s?.show_message_preview ?? true;
    const title = isGroup ? (conv.name ?? "Group") : senderName;
    const body = showPreview ? (isGroup ? `${senderName}: ${text}` : text) : "New message";

    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: t.token,
          notification: { title, body: body.slice(0, 240) },
          data: {
            conversation_id: msg.conversation_id,
            message_id: msg.id,
            kind: conv.kind,
            unread: String(unreadBy.get(t.user_id) ?? 0),
          },
          android: {
            priority: "HIGH",
            collapse_key: msg.conversation_id,
            notification: {
              channel_id: "messages",
              tag: msg.conversation_id, // newer message for same chat replaces the older one
              notification_count: unreadBy.get(t.user_id) ?? 0,
            },
          },
          apns: { payload: { aps: { badge: unreadBy.get(t.user_id) ?? 0, "thread-id": msg.conversation_id } } },
        },
      }),
    });
    if (res.ok) {
      sent++;
    } else {
      const err = await res.text();
      if (res.status === 404 || err.includes("UNREGISTERED") || err.includes("INVALID_ARGUMENT")) stale.push(t.token);
      else console.error("FCM error", res.status, err);
    }
  }));

  if (stale.length) await supabase.from("push_tokens").delete().in("token", stale);
  return Response.json({ sent, removed: stale.length });
});

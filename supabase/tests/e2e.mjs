// End-to-end test against a running Supabase (local `supabase start` or a test project).
// Uses the real Auth, REST, Realtime and Storage APIs the app uses.
//
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... node supabase/tests/e2e.mjs
//
// Needs @supabase/supabase-js (run from app/ or `npm i @supabase/supabase-js`).
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
if (!url || !anon) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY');

let passed = 0;
let failed = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = Date.now().toString(36);

async function newUser(name, type) {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({
    email: `${name}.${run}@example.com`,
    password: 'password-123',
    options: { data: { username: `${name}_${run}`, display_name: name, account_type: type } },
  });
  if (error) throw error;
  if (!data.session) throw new Error('Email confirmation is on; turn it off for this test');
  return { c, id: data.user.id, name };
}

function waitFor(list, pred, ms = 8000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const t = setInterval(() => {
      const hit = list.find(pred);
      if (hit || Date.now() - start > ms) {
        clearInterval(t);
        resolve(hit ?? null);
      }
    }, 100);
  });
}

const alice = await newUser('alice', 'customer');
const bob = await newUser('bob', 'rider');
const carol = await newUser('carol', 'customer');

const { data: prof } = await alice.c.from('profiles').select('*').eq('id', bob.id).single();
ok('sign-up creates profile with account type', prof?.account_type === 'rider');

// Bob listens on one realtime channel, like the app does.
const bobEvents = [];
const ch = bob.c
  .channel('inbox-test')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => bobEvents.push(p.new))
  .subscribe();
const carolEvents = [];
const ch2 = carol.c
  .channel('inbox-test-c')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => carolEvents.push(p.new))
  .subscribe();
await sleep(2500);

// Private chat
const { data: dm, error: dmErr } = await alice.c.rpc('get_or_create_direct_conversation', { p_other_user: bob.id });
ok('alice opens a private chat with bob', !!dm, dmErr?.message);

const msgId = crypto.randomUUID();
const { error: sendErr } = await alice.c
  .from('messages')
  .insert({ id: msgId, conversation_id: dm, sender_id: alice.id, body: 'Hi Bob, I am at the gate' });
ok('alice sends a message', !sendErr, sendErr?.message);
const { error: dupErr } = await alice.c
  .from('messages')
  .insert({ id: msgId, conversation_id: dm, sender_id: alice.id, body: 'retry' });
ok('retrying the same message id is rejected as duplicate (23505)', dupErr?.code === '23505', dupErr?.code);

const got = await waitFor(bobEvents, (m) => m.id === msgId);
ok('bob receives it instantly over realtime', !!got);
await sleep(1000);
ok('carol (not a member) does not receive it over realtime', !carolEvents.some((m) => m.id === msgId));

const { data: list } = await bob.c.rpc('list_my_conversations');
const row = list?.find((r) => r.conversation_id === dm);
ok('bob sees 1 unread in chats list', row?.unread_count === 1, JSON.stringify(row));
await bob.c.rpc('mark_conversation_read', { p_conversation: dm });
const { data: mem } = await alice.c.from('conversation_members').select('user_id, read_receipt_at').eq('conversation_id', dm);
ok('alice can see bob read it (blue ticks)', !!mem?.find((m) => m.user_id === bob.id)?.read_receipt_at);

// Photo upload + access control
const path = `${dm}/${alice.id}/${crypto.randomUUID()}.png`;
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const up = await alice.c.storage.from('chat-media').upload(path, png, { contentType: 'image/png' });
ok('alice uploads a photo into the chat folder', !up.error, up.error?.message);
const imgId = crypto.randomUUID();
await alice.c.from('messages').insert({ id: imgId, conversation_id: dm, sender_id: alice.id, kind: 'image', body: 'gate' });
const att = await alice.c.from('message_attachments').insert({
  message_id: imgId, conversation_id: dm, uploader_id: alice.id, storage_path: path, mime_type: 'image/png', size_bytes: png.length,
});
ok('alice attaches it to a message', !att.error, att.error?.message);
const bobDl = await bob.c.storage.from('chat-media').download(path);
ok('bob can download the photo', !bobDl.error && bobDl.data?.size === png.length, bobDl.error?.message);
const carolDl = await carol.c.storage.from('chat-media').download(path);
ok('carol cannot download the photo', !!carolDl.error);
const carolSigned = await carol.c.storage.from('chat-media').createSignedUrl(path, 60);
ok('carol cannot get a link to the photo', !!carolSigned.error);
const badUp = await carol.c.storage.from('chat-media').upload(`${dm}/${carol.id}/x.png`, png, { contentType: 'image/png' });
ok('carol cannot upload into their chat', !!badUp.error);

// Group
const { data: grp, error: gErr } = await alice.c.rpc('create_group', {
  p_name: 'Riders Hub', p_description: 'Coordination', p_member_ids: [bob.id, carol.id],
});
ok('alice creates a group with bob and carol', !!grp, gErr?.message);
await alice.c.from('messages').insert({ conversation_id: grp, sender_id: alice.id, body: `@bob_${run} please confirm`, mentions: [bob.id] });
const { data: list2 } = await bob.c.rpc('list_my_conversations');
ok('bob gets an @mention count', list2?.find((r) => r.conversation_id === grp)?.mention_count === 1);
const notAdmin = await bob.c.rpc('remove_group_member', { p_conversation: grp, p_user: carol.id });
ok('bob (not admin) cannot remove carol', !!notAdmin.error);
await alice.c.rpc('set_group_admin', { p_conversation: grp, p_user: bob.id, p_is_admin: true });
const asAdmin = await bob.c.rpc('remove_group_member', { p_conversation: grp, p_user: carol.id });
ok('after promotion bob can remove carol', !asAdmin.error, asAdmin.error?.message);
const carolRead = await carol.c.from('messages').select('id').eq('conversation_id', grp);
ok('removed carol can no longer read the group', (carolRead.data ?? []).length === 0);

// Forward the photo into the group; group members can open it
const fwd = await bob.c.rpc('forward_message', { p_message: imgId, p_conversation_ids: [grp] });
ok('bob forwards the photo into the group', fwd.data === 1, fwd.error?.message);

// Reactions + delete
const re = await bob.c.from('message_reactions').upsert({ message_id: msgId, user_id: bob.id, emoji: '👍' });
ok('bob reacts 👍', !re.error, re.error?.message);
const delOther = await bob.c.rpc('delete_message', { p_message: msgId, p_for_everyone: true });
ok("bob cannot delete alice's message for everyone", !!delOther.error);
const delOwn = await alice.c.rpc('delete_message', { p_message: msgId, p_for_everyone: true });
ok('alice deletes her message for everyone', !delOwn.error, delOwn.error?.message);

// Block
await bob.c.from('user_blocks').insert({ blocker_id: bob.id, blocked_id: alice.id });
const blockedSend = await alice.c.from('messages').insert({ conversation_id: dm, sender_id: alice.id, body: 'hello?' });
ok('after bob blocks alice, she cannot message him', !!blockedSend.error);

// Search
const s = await alice.c.rpc('search_messages', { p_query: 'confirm' });
ok('message search works', (s.data ?? []).length >= 1, s.error?.message);

await bob.c.removeChannel(ch);
await carol.c.removeChannel(ch2);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

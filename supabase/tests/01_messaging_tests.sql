-- Permission and behaviour tests. Run after the stub + migrations:
--   psql -v ON_ERROR_STOP=1 -f 01_messaging_tests.sql
-- Each check raises an exception (stopping the run) if it fails.
\set QUIET on
create schema if not exists tests;
grant usage on schema tests to authenticated, anon, service_role;
create table tests.results (n serial, name text, ok boolean);
grant all on tests.results to authenticated, anon, service_role;
grant usage on sequence tests.results_n_seq to authenticated, anon, service_role;
create table tests.ids (k text primary key, v uuid);
grant all on tests.ids to authenticated, anon, service_role;

create function tests.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin
  insert into tests.results (name, ok) values (p_name, coalesce(p_cond, false));
  if not coalesce(p_cond, false) then raise exception 'FAILED: %', p_name; end if;
end; $$;

create function tests.fails(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    insert into tests.results (name, ok) values (p_name, true);
    return;
  end;
  insert into tests.results (name, ok) values (p_name, false);
  raise exception 'FAILED (expected an error): %', p_name;
end; $$;

create function tests.id(p_k text) returns uuid language sql as $$ select v from tests.ids where k = p_k $$;
create function tests.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into tests.ids values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v $$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

-- Users sign up (auth trigger creates profiles + settings)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@test', '{"username":"alice","display_name":"Alice","account_type":"customer"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test',   '{"username":"bob","display_name":"Bob Rider","account_type":"rider"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@test', '{"username":"carol","display_name":"Carol"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@test',  '{"username":"alice","display_name":"Dave","account_type":"hacker"}');

select tests.ok('profiles created on sign up', (select count(*) = 4 from public.profiles));
select tests.ok('settings created on sign up', (select count(*) = 4 from public.user_message_settings));
select tests.ok('rider account type kept', (select account_type = 'rider' from public.profiles where username = 'bob'));
select tests.ok('invalid account type falls back to customer',
  (select account_type = 'customer' from public.profiles where display_name = 'Dave'));
select tests.ok('duplicate username gets a generated one',
  (select username like 'user_%' from public.profiles where display_name = 'Dave'));

-- ------------------------------------------------------------------ signed out
set role anon;
select tests.fails('anon cannot read profiles', 'select * from public.profiles');
select tests.fails('anon cannot read messages', 'select * from public.messages');
select tests.fails('anon cannot call RPCs', $$select public.get_or_create_direct_conversation('00000000-0000-0000-0000-00000000000b')$$);
reset role;

-- ------------------------------------------------------------------ alice
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

select tests.put('dm_ab', public.get_or_create_direct_conversation('00000000-0000-0000-0000-00000000000b'));
select tests.ok('same direct chat returned twice',
  public.get_or_create_direct_conversation('00000000-0000-0000-0000-00000000000b') = tests.id('dm_ab'));
select tests.fails('cannot chat with yourself',
  $$select public.get_or_create_direct_conversation('00000000-0000-0000-0000-00000000000a')$$);

insert into public.messages (id, conversation_id, sender_id, body)
values ('10000000-0000-0000-0000-000000000001', tests.id('dm_ab'), auth.uid(), 'Hi Bob, where are you?');
select tests.fails('resending same client id is rejected (outbox idempotency)',
  $$insert into public.messages (id, conversation_id, sender_id, body)
    values ('10000000-0000-0000-0000-000000000001', tests.id('dm_ab'), auth.uid(), 'dup')$$);
select tests.fails('cannot send as someone else',
  $$insert into public.messages (conversation_id, sender_id, body)
    values (tests.id('dm_ab'), '00000000-0000-0000-0000-00000000000b', 'spoof')$$);
select tests.fails('cannot send empty text',
  $$insert into public.messages (conversation_id, sender_id, body) values (tests.id('dm_ab'), auth.uid(), '   ')$$);
select tests.fails('cannot send system messages',
  $$insert into public.messages (conversation_id, sender_id, kind, body) values (tests.id('dm_ab'), auth.uid(), 'system', 'x')$$);
select tests.fails('cannot fake a forwarded flag',
  $$insert into public.messages (conversation_id, sender_id, body, forwarded) values (tests.id('dm_ab'), auth.uid(), 'x', true)$$);
select tests.fails('cannot edit messages directly',
  $$update public.messages set body = 'changed' where id = '10000000-0000-0000-0000-000000000001'$$);
select tests.fails('cannot hard-delete messages directly',
  $$delete from public.messages where id = '10000000-0000-0000-0000-000000000001'$$);
select tests.fails('cannot change own account type',
  $$update public.profiles set account_type = 'rider' where id = auth.uid()$$);
update public.profiles set display_name = 'Alice A.' where id = auth.uid();
select tests.ok('can edit own display name', (select display_name = 'Alice A.' from public.profiles where id = auth.uid()));
update public.profiles set display_name = 'Hacked' where username = 'bob';
select tests.ok('cannot edit other profiles', (select display_name = 'Bob Rider' from public.profiles where username = 'bob'));

-- attachments
select tests.put('img_msg', gen_random_uuid());
insert into public.messages (id, conversation_id, sender_id, kind, body)
values (tests.id('img_msg'), tests.id('dm_ab'), auth.uid(), 'image', 'photo of the gate');
insert into storage.objects (bucket_id, name) values ('chat-media', tests.id('dm_ab') || '/' || auth.uid() || '/gate.jpg');
insert into public.message_attachments (message_id, conversation_id, uploader_id, storage_path, mime_type, size_bytes, file_name)
values (tests.id('img_msg'), tests.id('dm_ab'), auth.uid(), tests.id('dm_ab') || '/' || auth.uid() || '/gate.jpg', 'image/jpeg', 2048, 'gate.jpg');
select tests.fails('cannot upload into another user folder',
  $$insert into storage.objects (bucket_id, name) values ('chat-media', tests.id('dm_ab') || '/00000000-0000-0000-0000-00000000000b/x.jpg')$$);
select tests.fails('cannot upload into a chat you are not in',
  $$insert into storage.objects (bucket_id, name) values ('chat-media', gen_random_uuid() || '/' || auth.uid() || '/x.jpg')$$);
select tests.fails('bad folder name is just refused',
  $$insert into storage.objects (bucket_id, name) values ('chat-media', 'not-a-uuid/' || auth.uid() || '/x.jpg')$$);
insert into storage.objects (bucket_id, name) values ('avatars', 'users/' || auth.uid() || '/me.jpg');
select tests.fails('cannot set someone else''s avatar',
  $$insert into storage.objects (bucket_id, name) values ('avatars', 'users/00000000-0000-0000-0000-00000000000b/me.jpg')$$);

-- group
select tests.put('grp', public.create_group('Riders Hub', 'Coordination',
  array['00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c']::uuid[]));
select tests.ok('group has 3 members', (select count(*) = 3 from public.conversation_members where conversation_id = tests.id('grp')));
select tests.ok('creator is admin', public.is_conversation_admin(tests.id('grp')));
select tests.ok('system messages posted',
  (select count(*) = 2 from public.messages where conversation_id = tests.id('grp') and kind = 'system'));
insert into public.messages (conversation_id, sender_id, body, mentions)
values (tests.id('grp'), auth.uid(), '@bob please confirm',
        array['00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000d']::uuid[]);
select tests.ok('mentions of non-members are dropped',
  (select mentions = array['00000000-0000-0000-0000-00000000000b']::uuid[] from public.messages
    where conversation_id = tests.id('grp') and body like '@bob%'));
select tests.fails('group needs a name', $$select public.create_group('  ')$$);
reset role;

-- ------------------------------------------------------------------ bob
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select tests.ok('bob sees alice''s direct message',
  (select count(*) = 2 from public.messages where conversation_id = tests.id('dm_ab')));
select tests.ok('bob can read the attachment row',
  (select count(*) = 1 from public.message_attachments where message_id = tests.id('img_msg')));
select tests.ok('bob can read the file in storage',
  (select count(*) = 1 from storage.objects where bucket_id = 'chat-media' and name like tests.id('dm_ab') || '/%'));
select tests.ok('unread count is 2 for bob',
  (select unread_count = 2 from public.list_my_conversations() where conversation_id = tests.id('dm_ab')));
select tests.ok('mention counted for bob',
  (select mention_count = 1 from public.list_my_conversations() where conversation_id = tests.id('grp')));
select tests.ok('direct chat title is the other person',
  (select title = 'Alice A.' from public.list_my_conversations() where conversation_id = tests.id('dm_ab')));
select public.mark_conversation_read(tests.id('dm_ab'));
select tests.ok('unread cleared after read',
  (select unread_count = 0 from public.list_my_conversations() where conversation_id = tests.id('dm_ab')));
select tests.ok('read receipt visible to members',
  (select read_receipt_at is not null from public.conversation_members
    where conversation_id = tests.id('dm_ab') and user_id = auth.uid()));

-- reply, react
insert into public.messages (conversation_id, sender_id, body, reply_to_id)
values (tests.id('dm_ab'), auth.uid(), 'At the gate now', '10000000-0000-0000-0000-000000000001');
insert into public.message_reactions (message_id, user_id, emoji) values ('10000000-0000-0000-0000-000000000001', auth.uid(), '👍');
update public.message_reactions set emoji = '❤️' where message_id = '10000000-0000-0000-0000-000000000001' and user_id = auth.uid();
select tests.ok('reaction changed', (select emoji = '❤️' from public.message_reactions where message_id = '10000000-0000-0000-0000-000000000001'));
select tests.fails('cannot reply to a message from another chat',
  $$insert into public.messages (conversation_id, sender_id, body, reply_to_id)
    select tests.id('grp'), auth.uid(), 'x', '10000000-0000-0000-0000-000000000001'$$);
select tests.fails('cannot react as someone else',
  $$insert into public.message_reactions (message_id, user_id, emoji)
    values (tests.id('img_msg'), '00000000-0000-0000-0000-00000000000a', '😂')$$);

-- non-admin group actions
select tests.fails('member cannot add people', $$select public.add_group_members(tests.id('grp'), array['00000000-0000-0000-0000-00000000000d']::uuid[])$$);
select tests.fails('member cannot remove people', $$select public.remove_group_member(tests.id('grp'), '00000000-0000-0000-0000-00000000000c')$$);
select tests.fails('member cannot make admins', $$select public.set_group_admin(tests.id('grp'), auth.uid(), true)$$);
select tests.fails('member cannot rename group (admins only by default)', $$select public.update_group(tests.id('grp'), 'Mine now')$$);
select tests.fails('member cannot change group photo in storage',
  $$insert into storage.objects (bucket_id, name) values ('avatars', 'groups/' || tests.id('grp') || '/p.jpg')$$);
select tests.fails('cannot delete alice''s message for everyone',
  $$select public.delete_message('10000000-0000-0000-0000-000000000001', true)$$);

-- delete for me
select public.delete_message('10000000-0000-0000-0000-000000000001', false);
select tests.ok('deleted-for-me message hidden from bob',
  (select count(*) = 0 from public.messages where id = '10000000-0000-0000-0000-000000000001'));

-- forward the photo into the group
select tests.ok('forward returns 1', public.forward_message(tests.id('img_msg'), array[tests.id('grp')]) = 1);
select tests.ok('forwarded copy has the attachment',
  (select count(*) = 1 from public.messages m join public.message_attachments a on a.message_id = m.id
    where m.conversation_id = tests.id('grp') and m.forwarded));
select tests.fails('cannot forward into a chat you are not in',
  $$select public.forward_message(tests.id('img_msg'), array[gen_random_uuid()])$$);

-- search
select tests.ok('search finds message', (select count(*) >= 1 from public.search_messages('gate')));
select tests.ok('search users finds alice', (select count(*) = 1 from public.search_users('ali') where username = 'alice'));

-- block alice
insert into public.user_blocks (blocker_id, blocked_id) values (auth.uid(), '00000000-0000-0000-0000-00000000000a');
reset role;

-- ------------------------------------------------------------------ carol (group member only)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select tests.ok('carol cannot see the alice-bob chat',
  (select count(*) = 0 from public.messages where conversation_id = tests.id('dm_ab')));
select tests.ok('carol cannot see that chat''s members',
  (select count(*) = 0 from public.conversation_members where conversation_id = tests.id('dm_ab')));
select tests.ok('carol cannot see the attachment row of that chat',
  (select count(*) = 0 from public.message_attachments where conversation_id = tests.id('dm_ab')
     and message_id = tests.id('img_msg')));
select tests.ok('carol CAN see the forwarded photo in the group',
  (select count(*) = 1 from storage.objects where bucket_id = 'chat-media' and name like tests.id('dm_ab') || '/%'));
select tests.fails('carol cannot post into alice-bob chat',
  $$insert into public.messages (conversation_id, sender_id, body) values (tests.id('dm_ab'), auth.uid(), 'hi')$$);
select tests.fails('carol cannot forward a message from a chat she is not in',
  $$select public.forward_message(tests.id('img_msg'), array[tests.id('grp')])$$);
select tests.ok('carol cannot read others'' settings', (select count(*) = 1 from public.user_message_settings));
select tests.ok('carol cannot see bob''s block list', (select count(*) = 0 from public.user_blocks));
select tests.ok('presence hidden for non-contacts',
  (select count(*) = 0 from public.get_presence(array['00000000-0000-0000-0000-00000000000d']::uuid[])));
insert into public.user_reports (reported_user_id, reason, details) values ('00000000-0000-0000-0000-00000000000b', 'spam', 'test');
select tests.fails('report cannot be pre-closed',
  $$insert into public.user_reports (reported_user_id, reason, status) values ('00000000-0000-0000-0000-00000000000b', 'spam', 'closed')$$);
select public.leave_group(tests.id('grp'));
select tests.ok('carol left the group', not public.is_conversation_member(tests.id('grp')));
select tests.ok('carol no longer sees group messages',
  (select count(*) = 0 from public.messages where conversation_id = tests.id('grp')));
reset role;

-- ------------------------------------------------------------------ alice again (blocked by bob)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select tests.fails('blocked: alice cannot message bob',
  $$insert into public.messages (conversation_id, sender_id, body) values (tests.id('dm_ab'), auth.uid(), 'hello?')$$);
select tests.ok('blocked: presence of bob hidden',
  (select count(*) = 0 from public.get_presence(array['00000000-0000-0000-0000-00000000000b']::uuid[])));
select tests.put('grp_blk', public.create_group('Blocked test', null, array['00000000-0000-0000-0000-00000000000b']::uuid[]));
select tests.ok('blocked: alice cannot add bob to a new group',
  (select count(*) = 1 from public.conversation_members where conversation_id = tests.id('grp_blk')));
insert into public.messages (conversation_id, sender_id, body) values (tests.id('grp'), auth.uid(), 'still in group');

-- admin actions
select tests.ok('re-add carol', public.add_group_members(tests.id('grp'), array['00000000-0000-0000-0000-00000000000c']::uuid[]) = 1);
select public.set_group_admin(tests.id('grp'), '00000000-0000-0000-0000-00000000000b', true);
select tests.ok('bob is now admin', (select role = 'admin' from public.conversation_members
  where conversation_id = tests.id('grp') and user_id = '00000000-0000-0000-0000-00000000000b'));
select public.update_group(tests.id('grp'), 'Riders Hub 2', 'New description', 'groups/' || tests.id('grp') || '/p.jpg');
select tests.ok('group renamed', (select name = 'Riders Hub 2' and avatar_path like 'groups/%' from public.conversations where id = tests.id('grp')));
select tests.fails('group photo must live in the group folder',
  $$select public.update_group(tests.id('grp'), null, null, 'users/00000000-0000-0000-0000-00000000000a/x.jpg')$$);
select public.remove_group_member(tests.id('grp'), '00000000-0000-0000-0000-00000000000c');
select tests.ok('carol removed', (select count(*) = 2 from public.conversation_members where conversation_id = tests.id('grp')));
select public.set_conversation_prefs(tests.id('grp'), now() + interval '8 hours', false, 'mentions', null, true);
select tests.ok('muted + mentions only + pinned', (select muted_until > now() and notify_level = 'mentions' and pinned
  from public.conversation_members where conversation_id = tests.id('grp') and user_id = auth.uid()));
select tests.fails('cannot set prefs directly on the table',
  $$update public.conversation_members set role = 'admin' where user_id = auth.uid()$$);

-- delete for everyone (own message) returns storage paths to clean up
select tests.ok('delete for everyone keeps shared file (forwarded copy still uses it)',
  cardinality(public.delete_message(tests.id('img_msg'), true)) = 0);
select tests.ok('deleted message body wiped',
  (select body is null and deleted_at is not null from public.messages where id = tests.id('img_msg')));
select tests.fails('cannot react to deleted message',
  $$insert into public.message_reactions (message_id, user_id, emoji) values (tests.id('img_msg'), auth.uid(), '👍')$$);

-- admin leaves -> admin handed over
select tests.put('grp2', public.create_group('Small', null, array['00000000-0000-0000-0000-00000000000c']::uuid[]));
select public.leave_group(tests.id('grp2'));
reset role;
select tests.ok('admin handed over when last admin leaves',
  (select role = 'admin' from public.conversation_members where conversation_id = tests.id('grp2')
     and user_id = '00000000-0000-0000-0000-00000000000c'));

-- ------------------------------------------------------------------ dave: new member sees no old history
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.add_group_members(tests.id('grp'), array['00000000-0000-0000-0000-00000000000d']::uuid[]);
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select tests.ok('new member does not see messages from before joining',
  (select count(*) = 0 from public.messages where conversation_id = tests.id('grp') and kind <> 'system'));
select public.register_push_token('tok-dave', 'android');
select tests.ok('can see own push token', (select count(*) = 1 from public.push_tokens));
insert into public.messages (conversation_id, sender_id, body) values (tests.id('grp'), auth.uid(), 'Hi all, Dave here');
select tests.fails('users cannot call the service-only unread function',
  $$select public.total_unread_for_user('00000000-0000-0000-0000-00000000000b')$$);
reset role;
set role service_role;
select tests.ok('service role unread total for bob', public.total_unread_for_user('00000000-0000-0000-0000-00000000000b') = 1);
reset role;

\echo
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from tests.results;

-- =====================================================================
-- Server functions (called from the app with supabase.rpc(...)).
-- Every function checks auth.uid() and membership/admin rights itself.
-- =====================================================================

-- Internal: post a system message ("Ana added Ben").
create or replace function public._system_message(p_conversation uuid, p_actor uuid, p_event text, p_meta jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.messages (conversation_id, sender_id, kind, body, metadata)
  values (p_conversation, p_actor, 'system', null, jsonb_build_object('event', p_event) || coalesce(p_meta, '{}'::jsonb));
end;
$$;
revoke all on function public._system_message(uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public._require_user()
returns uuid
language plpgsql stable
as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- Private chats
-- ---------------------------------------------------------------------
create or replace function public.get_or_create_direct_conversation(p_other_user uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me   uuid := public._require_user();
  v_key  text;
  v_id   uuid;
begin
  if p_other_user is null or p_other_user = v_me then
    raise exception 'Choose another user' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_other_user) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  v_key := least(v_me::text, p_other_user::text) || ':' || greatest(v_me::text, p_other_user::text);

  select id into v_id from public.conversations where direct_key = v_key;
  if v_id is null then
    if public.is_blocked_between(v_me, p_other_user) then
      raise exception 'You cannot message this user' using errcode = '42501';
    end if;
    insert into public.conversations (kind, direct_key, created_by)
    values ('direct', v_key, v_me)
    on conflict (direct_key) do nothing
    returning id into v_id;
    if v_id is null then  -- created concurrently by the other person
      select id into v_id from public.conversations where direct_key = v_key;
    end if;
  end if;

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  values (v_id, v_me, 'member', v_me), (v_id, p_other_user, 'member', v_me)
  on conflict do nothing;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------
create or replace function public.create_group(
  p_name text, p_description text default null, p_member_ids uuid[] default '{}', p_avatar_path text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := public._require_user();
  v_id uuid;
  v_added uuid[];
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Group name is required' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_member_ids, '{}')) > 255 then
    raise exception 'Too many members' using errcode = '22023';
  end if;

  insert into public.conversations (kind, name, description, avatar_path, created_by)
  values ('group', btrim(p_name), nullif(btrim(p_description), ''), p_avatar_path, v_me)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  values (v_id, v_me, 'admin', v_me);

  with ins as (
    insert into public.conversation_members (conversation_id, user_id, role, added_by)
    select v_id, p.id, 'member', v_me
      from public.profiles p
     where p.id = any (coalesce(p_member_ids, '{}'))
       and p.id <> v_me
       and not exists (select 1 from public.user_blocks b where b.blocker_id = p.id and b.blocked_id = v_me)
    on conflict do nothing
    returning user_id)
  select coalesce(array_agg(user_id), '{}') into v_added from ins;

  perform public._system_message(v_id, v_me, 'group_created', jsonb_build_object('name', btrim(p_name)));
  if cardinality(v_added) > 0 then
    perform public._system_message(v_id, v_me, 'members_added', jsonb_build_object('user_ids', to_jsonb(v_added)));
  end if;
  return v_id;
end;
$$;

create or replace function public.add_group_members(p_conversation uuid, p_user_ids uuid[])
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := public._require_user();
  v_added uuid[];
begin
  if not exists (select 1 from public.conversations where id = p_conversation and kind = 'group') then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  if not public.is_conversation_admin(p_conversation) then
    raise exception 'Only group admins can add members' using errcode = '42501';
  end if;
  with ins as (
    insert into public.conversation_members (conversation_id, user_id, role, added_by)
    select p_conversation, p.id, 'member', v_me
      from public.profiles p
     where p.id = any (coalesce(p_user_ids, '{}'))
       and not exists (select 1 from public.user_blocks b where b.blocker_id = p.id and b.blocked_id = v_me)
    on conflict do nothing
    returning user_id)
  select coalesce(array_agg(user_id), '{}') into v_added from ins;

  if cardinality(v_added) > 0 then
    perform public._system_message(p_conversation, v_me, 'members_added', jsonb_build_object('user_ids', to_jsonb(v_added)));
  end if;
  return cardinality(v_added);
end;
$$;

create or replace function public.remove_group_member(p_conversation uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := public._require_user();
begin
  if p_user = v_me then
    perform public.leave_group(p_conversation);
    return;
  end if;
  if not exists (select 1 from public.conversations where id = p_conversation and kind = 'group') then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  if not public.is_conversation_admin(p_conversation) then
    raise exception 'Only group admins can remove members' using errcode = '42501';
  end if;
  delete from public.conversation_members where conversation_id = p_conversation and user_id = p_user;
  if found then
    perform public._system_message(p_conversation, v_me, 'member_removed', jsonb_build_object('user_id', p_user));
  end if;
end;
$$;

create or replace function public.set_group_admin(p_conversation uuid, p_user uuid, p_is_admin boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := public._require_user();
begin
  if not public.is_conversation_admin(p_conversation) then
    raise exception 'Only group admins can change admins' using errcode = '42501';
  end if;
  if not p_is_admin and not exists (
      select 1 from public.conversation_members
       where conversation_id = p_conversation and role = 'admin' and user_id <> p_user) then
    raise exception 'A group needs at least one admin' using errcode = '22023';
  end if;
  update public.conversation_members
     set role = case when p_is_admin then 'admin' else 'member' end
   where conversation_id = p_conversation and user_id = p_user
     and role is distinct from (case when p_is_admin then 'admin' else 'member' end);
  if found then
    perform public._system_message(p_conversation, v_me,
      case when p_is_admin then 'admin_added' else 'admin_removed' end,
      jsonb_build_object('user_id', p_user));
  end if;
end;
$$;

create or replace function public.update_group(
  p_conversation uuid,
  p_name text default null,
  p_description text default null,
  p_avatar_path text default null,
  p_only_admins_can_edit boolean default null,
  p_clear_avatar boolean default false)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me   uuid := public._require_user();
  v_conv public.conversations%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation and kind = 'group';
  if not found or not public.is_conversation_member(p_conversation) then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  if (v_conv.only_admins_can_edit or p_only_admins_can_edit is not null)
     and not public.is_conversation_admin(p_conversation) then
    raise exception 'Only group admins can edit group info' using errcode = '42501';
  end if;
  if p_avatar_path is not null and (split_part(p_avatar_path, '/', 1) <> 'groups'
     or split_part(p_avatar_path, '/', 2) <> p_conversation::text) then
    raise exception 'Invalid group photo path' using errcode = '22023';
  end if;

  update public.conversations set
    name        = coalesce(nullif(btrim(p_name), ''), name),
    description = case when p_description is null then description else nullif(btrim(p_description), '') end,
    avatar_path = case when p_clear_avatar then null else coalesce(p_avatar_path, avatar_path) end,
    only_admins_can_edit = coalesce(p_only_admins_can_edit, only_admins_can_edit)
  where id = p_conversation;

  if p_name is not null and btrim(p_name) <> '' and btrim(p_name) is distinct from v_conv.name then
    perform public._system_message(p_conversation, v_me, 'name_changed', jsonb_build_object('name', btrim(p_name)));
  end if;
  if p_description is not null and nullif(btrim(p_description), '') is distinct from v_conv.description then
    perform public._system_message(p_conversation, v_me, 'description_changed', '{}'::jsonb);
  end if;
  if p_avatar_path is not null or p_clear_avatar then
    perform public._system_message(p_conversation, v_me, 'photo_changed', '{}'::jsonb);
  end if;
end;
$$;

create or replace function public.leave_group(p_conversation uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := public._require_user();
  v_role text;
  v_next uuid;
begin
  select cm.role into v_role
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id and c.kind = 'group'
   where cm.conversation_id = p_conversation and cm.user_id = v_me;
  if v_role is null then
    raise exception 'You are not in this group' using errcode = 'P0002';
  end if;

  delete from public.conversation_members where conversation_id = p_conversation and user_id = v_me;
  perform public._system_message(p_conversation, v_me, 'member_left', jsonb_build_object('user_id', v_me));

  -- Hand over admin if the last admin left.
  if v_role = 'admin' and not exists (
      select 1 from public.conversation_members where conversation_id = p_conversation and role = 'admin') then
    select user_id into v_next from public.conversation_members
     where conversation_id = p_conversation order by joined_at, user_id limit 1;
    if v_next is not null then
      update public.conversation_members set role = 'admin'
       where conversation_id = p_conversation and user_id = v_next;
      perform public._system_message(p_conversation, v_me, 'admin_added', jsonb_build_object('user_id', v_next));
    end if;
  end if;

  -- Last person out deletes the group.
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation) then
    delete from public.conversations where id = p_conversation;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Per-chat preferences (mute, notification level, archive, pin, clear)
-- ---------------------------------------------------------------------
create or replace function public.set_conversation_prefs(
  p_conversation uuid,
  p_muted_until timestamptz default null,
  p_unmute boolean default false,
  p_notify_level text default null,
  p_archived boolean default null,
  p_pinned boolean default null,
  p_clear_history boolean default false)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := public._require_user();
begin
  update public.conversation_members set
    muted_until  = case when p_unmute then null else coalesce(p_muted_until, muted_until) end,
    notify_level = coalesce(p_notify_level, notify_level),
    archived     = coalesce(p_archived, archived),
    pinned       = coalesce(p_pinned, pinned),
    cleared_at   = case when p_clear_history then now() else cleared_at end
  where conversation_id = p_conversation and user_id = v_me;
  if not found then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Delivery and read receipts
-- ---------------------------------------------------------------------
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := public._require_user();
  v_receipts boolean;
begin
  select coalesce(send_read_receipts, true) into v_receipts
    from public.user_message_settings where user_id = v_me;
  update public.conversation_members set
    last_read_at      = now(),
    last_delivered_at = now(),
    read_receipt_at   = case when coalesce(v_receipts, true) then now() else read_receipt_at end
  where conversation_id = p_conversation and user_id = v_me;
end;
$$;

-- Called when the app comes online / receives a push: everything so far is "delivered".
create or replace function public.mark_all_delivered()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := public._require_user();
begin
  update public.conversation_members cm set last_delivered_at = now()
    from public.conversations c
   where c.id = cm.conversation_id
     and cm.user_id = v_me
     and c.last_message_at is not null
     and (cm.last_delivered_at is null or cm.last_delivered_at < c.last_message_at);
end;
$$;

-- ---------------------------------------------------------------------
-- Delete / forward
-- ---------------------------------------------------------------------
-- Returns storage paths the caller should remove from the bucket (for-everyone deletes).
create or replace function public.delete_message(p_message uuid, p_for_everyone boolean default false)
returns text[]
language plpgsql security definer set search_path = public
as $$
declare
  v_me    uuid := public._require_user();
  v_msg   public.messages%rowtype;
  v_paths text[];
begin
  select * into v_msg from public.messages where id = p_message;
  if not found or not public.is_conversation_member(v_msg.conversation_id) then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  if not p_for_everyone then
    insert into public.message_hidden (user_id, message_id) values (v_me, p_message) on conflict do nothing;
    return '{}';
  end if;

  if v_msg.kind = 'system' then
    raise exception 'System messages cannot be deleted for everyone' using errcode = '42501';
  end if;
  if v_msg.sender_id is distinct from v_me and not (
       public.is_conversation_admin(v_msg.conversation_id)
       and exists (select 1 from public.conversations where id = v_msg.conversation_id and kind = 'group')) then
    raise exception 'You can only delete your own messages for everyone' using errcode = '42501';
  end if;

  -- Files that are not shared by any other message (e.g. forwards) can be removed from storage.
  select coalesce(array_agg(a.storage_path), '{}') into v_paths
    from public.message_attachments a
   where a.message_id = p_message
     and not exists (select 1 from public.message_attachments o
                      where o.storage_path = a.storage_path and o.message_id <> p_message);

  delete from public.message_attachments where message_id = p_message;
  delete from public.message_reactions where message_id = p_message;
  update public.messages set
    body = null, mentions = '{}', metadata = jsonb_build_object('deleted_by', v_me),
    deleted_at = now()
  where id = p_message;
  return v_paths;
end;
$$;

create or replace function public.forward_message(p_message uuid, p_conversation_ids uuid[])
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_me    uuid := public._require_user();
  v_msg   public.messages%rowtype;
  v_conv  uuid;
  v_new   uuid;
  v_count integer := 0;
begin
  select * into v_msg from public.messages where id = p_message;
  if not found or not public.is_conversation_member(v_msg.conversation_id)
     or v_msg.created_at < public.member_visible_from(v_msg.conversation_id)
     or v_msg.deleted_at is not null or v_msg.kind = 'system' then
    raise exception 'Message cannot be forwarded' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_conversation_ids, '{}')) > 20 then
    raise exception 'You can forward to at most 20 chats at once' using errcode = '22023';
  end if;

  foreach v_conv in array coalesce(p_conversation_ids, '{}') loop
    if not public.is_conversation_member(v_conv) then
      raise exception 'You are not a member of one of the selected chats' using errcode = '42501';
    end if;
    insert into public.messages (conversation_id, sender_id, kind, body, forwarded, metadata)
    values (v_conv, v_me, v_msg.kind, v_msg.body, true,
            jsonb_strip_nulls(jsonb_build_object('duration_ms', v_msg.metadata -> 'duration_ms')))
    returning id into v_new;

    insert into public.message_attachments
      (message_id, conversation_id, uploader_id, storage_path, mime_type, size_bytes, file_name, duration_ms, width, height)
    select v_new, v_conv, v_me, a.storage_path, a.mime_type, a.size_bytes, a.file_name, a.duration_ms, a.width, a.height
      from public.message_attachments a where a.message_id = p_message;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Chats list with unread counts (runs as the caller, so RLS applies)
-- ---------------------------------------------------------------------
create or replace function public.list_my_conversations()
returns table (
  conversation_id   uuid,
  kind              text,
  title             text,
  avatar_path       text,
  other_user_id     uuid,
  other_account_type text,
  member_count      integer,
  my_role           text,
  last_message_at   timestamptz,
  last_message_id   uuid,
  last_message_kind text,
  last_message_body text,
  last_message_sender_id uuid,
  last_message_sender_name text,
  last_message_deleted boolean,
  unread_count      integer,
  mention_count     integer,
  muted_until       timestamptz,
  notify_level      text,
  archived          boolean,
  pinned            boolean)
language sql stable security invoker set search_path = public
as $$
  select
    c.id,
    c.kind,
    case when c.kind = 'group' then c.name else op.display_name end,
    case when c.kind = 'group' then c.avatar_path else op.avatar_path end,
    op.id,
    op.account_type,
    (select count(*)::int from public.conversation_members x where x.conversation_id = c.id),
    me.role,
    c.last_message_at,
    lm.id, lm.kind, lm.body, lm.sender_id,
    (select sp.display_name from public.profiles sp where sp.id = lm.sender_id),
    lm.deleted_at is not null,
    (select count(*)::int from public.messages m
      where m.conversation_id = c.id
        and m.created_at > coalesce(me.last_read_at, '-infinity')
        and m.sender_id is distinct from auth.uid()
        and m.kind <> 'system'
        and m.deleted_at is null),
    (select count(*)::int from public.messages m
      where m.conversation_id = c.id
        and m.created_at > coalesce(me.last_read_at, '-infinity')
        and auth.uid() = any (m.mentions)
        and m.deleted_at is null),
    me.muted_until,
    me.notify_level,
    me.archived,
    me.pinned
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id
  left join lateral (
    select p.* from public.conversation_members o
      join public.profiles p on p.id = o.user_id
     where c.kind = 'direct' and o.conversation_id = c.id and o.user_id <> auth.uid()
     limit 1) op on true
  left join lateral (
    select m.* from public.messages m
     where m.conversation_id = c.id
     order by m.created_at desc, m.id desc
     limit 1) lm on true
  where me.user_id = auth.uid()
  order by me.pinned desc, coalesce(c.last_message_at, c.created_at) desc;
$$;

create or replace function public.total_unread_count()
returns integer
language sql stable security invoker set search_path = public
as $$
  select coalesce(sum(unread_count), 0)::int from public.list_my_conversations();
$$;

-- ---------------------------------------------------------------------
-- Search (runs as the caller, so it only ever sees allowed messages)
-- ---------------------------------------------------------------------
create or replace function public.search_messages(p_query text, p_conversation uuid default null, p_limit integer default 50)
returns table (message_id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz, kind text)
language sql stable security invoker set search_path = public
as $$
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at, m.kind
    from public.messages m
   where coalesce(btrim(p_query), '') <> ''
     and m.deleted_at is null
     and m.kind in ('text', 'image', 'document')
     and (p_conversation is null or m.conversation_id = p_conversation)
     and (m.search_tsv @@ plainto_tsquery('simple', p_query)
          or m.body ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%')
   order by m.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- Find people to chat with (excludes people who blocked you).
create or replace function public.search_users(p_query text, p_limit integer default 30)
returns table (id uuid, username citext, display_name text, avatar_path text, account_type text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.username, p.display_name, p.avatar_path, p.account_type
    from public.profiles p
   where auth.uid() is not null
     and p.id <> auth.uid()
     and coalesce(btrim(p_query), '') <> ''
     and (p.username ilike replace(replace(p_query, '%', ''), '_', '\_') || '%'
          or p.display_name ilike '%' || replace(replace(p_query, '%', ''), '_', '\_') || '%')
     and not exists (select 1 from public.user_blocks b where b.blocker_id = p.id and b.blocked_id = auth.uid())
   order by (p.username = p_query::citext) desc, p.display_name
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

-- ---------------------------------------------------------------------
-- Online status
-- ---------------------------------------------------------------------
create or replace function public.set_presence(p_online boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := public._require_user();
begin
  insert into public.user_message_settings (user_id, is_online, last_seen_at)
  values (v_me, p_online, now())
  on conflict (user_id) do update set is_online = excluded.is_online, last_seen_at = now();
end;
$$;

-- Returns online / last seen only for people you share a chat with,
-- who allow it, and when nobody has blocked anybody.
create or replace function public.get_presence(p_user_ids uuid[])
returns table (user_id uuid, is_online boolean, last_seen_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select s.user_id,
         s.is_online and s.last_seen_at > now() - interval '2 minutes',
         s.last_seen_at
    from public.user_message_settings s
   where s.user_id = any (p_user_ids)
     and auth.uid() is not null
     and s.show_online_status
     and not public.is_blocked_between(auth.uid(), s.user_id)
     and exists (
       select 1 from public.conversation_members a
         join public.conversation_members b on b.conversation_id = a.conversation_id
        where a.user_id = auth.uid() and b.user_id = s.user_id);
$$;

-- ---------------------------------------------------------------------
-- Push tokens
-- ---------------------------------------------------------------------
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := public._require_user();
begin
  if coalesce(p_token, '') = '' or p_platform not in ('android', 'ios', 'web') then
    raise exception 'Invalid push token' using errcode = '22023';
  end if;
  -- A device token belongs to whoever is signed in on that device now.
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, v_me, p_platform, now())
  on conflict (token) do update set user_id = v_me, platform = excluded.platform, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- Privileges: only signed-in users may call these.
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.get_or_create_direct_conversation(uuid)',
    'public.create_group(text, text, uuid[], text)',
    'public.add_group_members(uuid, uuid[])',
    'public.remove_group_member(uuid, uuid)',
    'public.set_group_admin(uuid, uuid, boolean)',
    'public.update_group(uuid, text, text, text, boolean, boolean)',
    'public.leave_group(uuid)',
    'public.set_conversation_prefs(uuid, timestamptz, boolean, text, boolean, boolean, boolean)',
    'public.mark_conversation_read(uuid)',
    'public.mark_all_delivered()',
    'public.delete_message(uuid, boolean)',
    'public.forward_message(uuid, uuid[])',
    'public.list_my_conversations()',
    'public.total_unread_count()',
    'public.search_messages(text, uuid, integer)',
    'public.search_users(text, integer)',
    'public.set_presence(boolean)',
    'public.get_presence(uuid[])',
    'public.register_push_token(text, text)',
    'public._require_user()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- Used by the push notification function (service role only) for the app badge.
create or replace function public.total_unread_for_user(p_user uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(count(*), 0)::int
    from public.conversation_members me
    join public.messages m on m.conversation_id = me.conversation_id
   where me.user_id = p_user
     and m.created_at > coalesce(me.last_read_at, '-infinity')
     and m.created_at >= coalesce(me.cleared_at, '-infinity')
     and m.sender_id is distinct from p_user
     and m.kind <> 'system'
     and m.deleted_at is null;
$$;
revoke all on function public.total_unread_for_user(uuid) from public, anon, authenticated;
grant execute on function public.total_unread_for_user(uuid) to service_role;

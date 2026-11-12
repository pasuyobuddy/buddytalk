-- =====================================================================
-- Pasuyo Chat: standalone messaging backend
-- Tables, indexes, triggers and realtime setup.
-- Security rules (RLS) are in 20261109000002_messaging_rls.sql
-- Server functions (RPC) are in 20261109000003_messaging_functions.sql
-- Storage buckets are in 20261109000004_messaging_storage.sql
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------
-- Profiles (one per auth user). Created automatically on sign up.
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      citext not null unique
                check (username ~ '^[A-Za-z0-9_.]{3,30}$'),
  display_name  text not null check (char_length(display_name) between 1 and 60),
  avatar_path   text,                       -- path inside the "avatars" bucket
  account_type  text not null default 'customer'
                check (account_type in ('customer', 'rider')),
  about         text check (char_length(about) <= 140),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Per-user messaging preferences and presence.
create table public.user_message_settings (
  user_id               uuid primary key references public.profiles (id) on delete cascade,
  notifications_enabled boolean not null default true,
  show_message_preview  boolean not null default true,  -- message text in push notifications
  group_notifications   boolean not null default true,
  send_read_receipts    boolean not null default true,
  show_online_status    boolean not null default true,
  is_online             boolean not null default false,
  last_seen_at          timestamptz,
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Conversations and membership
-- ---------------------------------------------------------------------
create table public.conversations (
  id                     uuid primary key default gen_random_uuid(),
  kind                   text not null check (kind in ('direct', 'group')),
  name                   text check (char_length(name) between 1 and 80),
  description            text check (char_length(description) <= 500),
  avatar_path            text,
  -- "smallerUuid:largerUuid" for direct chats so each pair has exactly one chat
  direct_key             text unique,
  only_admins_can_edit   boolean not null default true,
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  last_message_at        timestamptz,
  last_message_id        uuid,
  constraint direct_has_key  check (kind <> 'direct' or direct_key is not null),
  constraint group_has_name  check (kind <> 'group' or name is not null)
);

create table public.conversation_members (
  conversation_id    uuid not null references public.conversations (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  role               text not null default 'member' check (role in ('admin', 'member')),
  joined_at          timestamptz not null default now(),
  added_by           uuid references public.profiles (id) on delete set null,
  -- private read pointer (used for unread counts)
  last_read_at       timestamptz,
  -- public read pointer (only moves when the user allows read receipts)
  read_receipt_at    timestamptz,
  last_delivered_at  timestamptz,
  muted_until        timestamptz,
  notify_level       text not null default 'all' check (notify_level in ('all', 'mentions', 'none')),
  archived           boolean not null default false,
  pinned             boolean not null default false,
  cleared_at         timestamptz,       -- "clear chat": hide older messages for this user
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

-- ---------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------
create table public.messages (
  id               uuid primary key default gen_random_uuid(),  -- clients may supply it (offline outbox)
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_id        uuid references public.profiles (id) on delete set null,
  kind             text not null default 'text'
                   check (kind in ('text', 'image', 'document', 'voice', 'system')),
  body             text check (char_length(body) <= 4000),
  reply_to_id      uuid references public.messages (id) on delete set null,
  forwarded        boolean not null default false,
  mentions         uuid[] not null default '{}',
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  edited_at        timestamptz,
  deleted_at       timestamptz,   -- "deleted for everyone"
  search_tsv       tsvector generated always as (to_tsvector('simple', coalesce(body, ''))) stored
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc, id desc);
create index messages_search_idx on public.messages using gin (search_tsv);
create index messages_mentions_idx on public.messages using gin (mentions);

alter table public.conversations
  add constraint conversations_last_message_fk
  foreign key (last_message_id) references public.messages (id) on delete set null;

create table public.message_attachments (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references public.messages (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  uploader_id      uuid references public.profiles (id) on delete set null,
  storage_path     text not null,          -- path inside the private "chat-media" bucket
  mime_type        text not null,
  size_bytes       bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  file_name        text,
  duration_ms      integer,                -- voice notes
  width            integer,
  height           integer,
  created_at       timestamptz not null default now()
);
create index message_attachments_message_idx on public.message_attachments (message_id);
create index message_attachments_path_idx on public.message_attachments (storage_path);

create table public.message_reactions (
  message_id       uuid not null references public.messages (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  emoji            text not null check (char_length(emoji) between 1 and 16),
  created_at       timestamptz not null default now(),
  primary key (message_id, user_id)       -- one reaction per person per message
);
create index message_reactions_conversation_idx on public.message_reactions (conversation_id);

-- "Delete for me"
create table public.message_hidden (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  message_id  uuid not null references public.messages (id) on delete cascade,
  hidden_at   timestamptz not null default now(),
  primary key (user_id, message_id)
);

-- ---------------------------------------------------------------------
-- Safety: blocks and reports
-- ---------------------------------------------------------------------
create table public.user_blocks (
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

create table public.user_reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reported_user_id  uuid references public.profiles (id) on delete set null,
  conversation_id   uuid references public.conversations (id) on delete set null,
  message_id        uuid references public.messages (id) on delete set null,
  reason            text not null check (reason in ('spam', 'harassment', 'scam', 'inappropriate', 'other')),
  details           text check (char_length(details) <= 1000),
  status            text not null default 'open' check (status in ('open', 'reviewing', 'closed')),
  created_at        timestamptz not null default now(),
  check (reported_user_id is not null or conversation_id is not null or message_id is not null)
);

-- ---------------------------------------------------------------------
-- Push notification device tokens (FCM)
-- ---------------------------------------------------------------------
create table public.push_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  platform    text not null check (platform in ('android', 'ios', 'web')),
  updated_at  timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

-- =====================================================================
-- Trigger functions
-- =====================================================================

-- Create profile + settings when someone signs up.
-- The app passes username, display_name and account_type as sign-up metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := nullif(new.raw_user_meta_data ->> 'username', '');
  v_display  text := nullif(new.raw_user_meta_data ->> 'display_name', '');
  v_type     text := coalesce(nullif(new.raw_user_meta_data ->> 'account_type', ''), 'customer');
begin
  if v_type not in ('customer', 'rider') then
    v_type := 'customer';
  end if;
  if v_username is null or v_username !~ '^[A-Za-z0-9_.]{3,30}$'
     or exists (select 1 from public.profiles where username = v_username::citext) then
    v_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;
  insert into public.profiles (id, username, display_name, account_type)
  values (new.id, v_username, coalesce(v_display, v_username), v_type);
  insert into public.user_message_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.user_message_settings
  for each row execute function public.touch_updated_at();
create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();

-- Users may not change their own account type or id; only the service role can.
create or replace function public.protect_profile_columns()
returns trigger language plpgsql as $$
begin
  -- Only app users (anon/authenticated roles) are restricted; service role and admins are not.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.account_type is distinct from old.account_type then
    raise exception 'account_type cannot be changed' using errcode = '42501';
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end;
$$;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- Validate and normalise every new message (server clock, reply in same chat,
-- mentions must be members, blocked direct chats cannot send).
create or replace function public.validate_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind  text;
  v_other uuid;
begin
  new.created_at := clock_timestamp();  -- distinct times even within one transaction
  new.edited_at := null;
  new.deleted_at := null;

  if new.kind = 'text' and coalesce(btrim(new.body), '') = '' then
    raise exception 'Text messages cannot be empty' using errcode = '22023';
  end if;

  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m
    where m.id = new.reply_to_id and m.conversation_id = new.conversation_id
  ) then
    raise exception 'Reply target is not in this conversation' using errcode = '22023';
  end if;

  -- Keep only mentions of current members, no duplicates.
  if cardinality(new.mentions) > 0 then
    select coalesce(array_agg(distinct cm.user_id), '{}')
      into new.mentions
      from public.conversation_members cm
     where cm.conversation_id = new.conversation_id
       and cm.user_id = any (new.mentions);
  end if;

  select kind into v_kind from public.conversations where id = new.conversation_id;
  if v_kind = 'direct' and new.kind <> 'system' then
    select cm.user_id into v_other
      from public.conversation_members cm
     where cm.conversation_id = new.conversation_id and cm.user_id <> new.sender_id
     limit 1;
    if v_other is not null and exists (
      select 1 from public.user_blocks b
       where (b.blocker_id = new.sender_id and b.blocked_id = v_other)
          or (b.blocker_id = v_other and b.blocked_id = new.sender_id)
    ) then
      raise exception 'You cannot message this user' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
create trigger messages_validate before insert on public.messages
  for each row execute function public.validate_message();

-- Bump conversation ordering and the sender's own read pointer after each message.
create or replace function public.after_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         last_message_id = new.id
   where id = new.conversation_id;

  if new.sender_id is not null then
    update public.conversation_members
       set last_read_at      = greatest(coalesce(last_read_at, new.created_at), new.created_at),
           last_delivered_at = greatest(coalesce(last_delivered_at, new.created_at), new.created_at),
           read_receipt_at   = greatest(coalesce(read_receipt_at, new.created_at), new.created_at),
           archived          = false
     where conversation_id = new.conversation_id and user_id = new.sender_id;
  end if;

  -- A new message un-archives the chat for everyone (WhatsApp-like behaviour).
  update public.conversation_members
     set archived = false
   where conversation_id = new.conversation_id and archived;
  return new;
end;
$$;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.after_message_insert();

-- Attachments: must belong to a message the uploader sent, in the same chat,
-- stored under that chat's folder.
create or replace function public.validate_attachment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.messages%rowtype;
begin
  select * into v_msg from public.messages where id = new.message_id;
  if not found then
    raise exception 'Message not found' using errcode = '22023';
  end if;
  new.conversation_id := v_msg.conversation_id;
  -- Forwarded copies are created server-side by forward_message (uploader is the forwarder).
  if not v_msg.forwarded then
    if v_msg.sender_id is distinct from new.uploader_id then
      raise exception 'Only the sender can attach files' using errcode = '42501';
    end if;
    if split_part(new.storage_path, '/', 1) <> v_msg.conversation_id::text then
      raise exception 'Attachment must be stored in the conversation folder' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger attachments_validate before insert on public.message_attachments
  for each row execute function public.validate_attachment();

-- Reactions: copy the conversation id from the message (used by realtime filters).
create or replace function public.fill_reaction_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select conversation_id into new.conversation_id from public.messages where id = new.message_id;
  if new.conversation_id is null then
    raise exception 'Message not found' using errcode = '22023';
  end if;
  if exists (select 1 from public.messages where id = new.message_id and deleted_at is not null) then
    raise exception 'Cannot react to a deleted message' using errcode = '22023';
  end if;
  new.created_at := clock_timestamp();  -- distinct times even within one transaction
  return new;
end;
$$;
create trigger reactions_fill before insert or update on public.message_reactions
  for each row execute function public.fill_reaction_conversation();

-- =====================================================================
-- Realtime: stream changes to subscribed, authorised clients.
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.messages,
      public.message_reactions,
      public.conversation_members,
      public.conversations,
      public.message_attachments;
  end if;
end;
$$;
-- Deleted rows need full identity so clients learn which row went away.
alter table public.message_reactions replica identity full;
alter table public.conversation_members replica identity full;

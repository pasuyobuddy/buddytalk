-- =====================================================================
-- Row Level Security: users can only see and touch conversations they
-- are members of. Writes that need checks across tables (creating
-- chats, admin actions, deleting, read receipts) go through the
-- SECURITY DEFINER functions in 20261109000003_messaging_functions.sql.
-- =====================================================================

-- Helper checks. SECURITY DEFINER so policies on conversation_members
-- can use them without recursing into their own policy.
create or replace function public.is_conversation_member(p_conversation uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members
     where conversation_id = p_conversation and user_id = auth.uid()
  );
$$;

create or replace function public.is_conversation_admin(p_conversation uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.conversation_members
     where conversation_id = p_conversation and user_id = auth.uid() and role = 'admin'
  );
$$;

-- Earliest message time this user may see in a conversation
-- (new group members do not see history from before they joined;
--  "clear chat" hides older messages).
create or replace function public.member_visible_from(p_conversation uuid)
returns timestamptz
language sql stable security definer set search_path = public
as $$
  select greatest(
           case when c.kind = 'group' then cm.joined_at else '-infinity'::timestamptz end,
           coalesce(cm.cleared_at, '-infinity'::timestamptz))
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
   where cm.conversation_id = p_conversation and cm.user_id = auth.uid();
$$;

create or replace function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks
     where (blocker_id = p_a and blocked_id = p_b)
        or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

revoke all on function public.is_conversation_member(uuid)  from public, anon;
revoke all on function public.is_conversation_admin(uuid)   from public, anon;
revoke all on function public.member_visible_from(uuid)     from public, anon;
revoke all on function public.is_blocked_between(uuid, uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid)  to authenticated;
grant execute on function public.is_conversation_admin(uuid)   to authenticated;
grant execute on function public.member_visible_from(uuid)     to authenticated;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

alter table public.profiles              enable row level security;
alter table public.user_message_settings enable row level security;
alter table public.conversations         enable row level security;
alter table public.conversation_members  enable row level security;
alter table public.messages              enable row level security;
alter table public.message_attachments   enable row level security;
alter table public.message_reactions     enable row level security;
alter table public.message_hidden        enable row level security;
alter table public.user_blocks           enable row level security;
alter table public.user_reports          enable row level security;
alter table public.push_tokens           enable row level security;

-- Start from zero privileges on the messaging tables (Supabase grants ALL by
-- default), then grant back only what each role needs below.
revoke all on public.profiles, public.user_message_settings, public.conversations,
  public.conversation_members, public.messages, public.message_attachments,
  public.message_reactions, public.message_hidden, public.user_blocks,
  public.user_reports, public.push_tokens
  from anon, authenticated;

-- ---------------- profiles ----------------
-- Signed-in users can look each other up (needed to start chats and show names).
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------------- settings ----------------
-- Own row only. Other people's online status is read through get_presence().
create policy settings_select_own on public.user_message_settings
  for select to authenticated using (user_id = auth.uid());
create policy settings_update_own on public.user_message_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy settings_insert_own on public.user_message_settings
  for insert to authenticated with check (user_id = auth.uid());

-- ---------------- conversations ----------------
create policy conversations_select_member on public.conversations
  for select to authenticated using (public.is_conversation_member(id));
-- No direct insert/update/delete: use create_group / get_or_create_direct_conversation / update_group.

-- ---------------- conversation_members ----------------
-- Members can see who else is in their conversations (and their receipt pointers).
create policy members_select on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id));
-- Changes go through functions (add/remove/promote/leave/mute/mark read).

-- ---------------- messages ----------------
create policy messages_select on public.messages
  for select to authenticated using (
    public.is_conversation_member(conversation_id)
    and created_at >= public.member_visible_from(conversation_id)
    and not exists (
      select 1 from public.message_hidden h
       where h.message_id = messages.id and h.user_id = auth.uid())
  );
create policy messages_insert on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and kind <> 'system'
    and forwarded = false
    and public.is_conversation_member(conversation_id)
  );
-- No direct update/delete: use delete_message().

-- ---------------- attachments ----------------
create policy attachments_select on public.message_attachments
  for select to authenticated using (
    exists (select 1 from public.messages m where m.id = message_attachments.message_id)
  );
create policy attachments_insert on public.message_attachments
  for insert to authenticated with check (
    uploader_id = auth.uid()
    and exists (
      select 1 from public.messages m
       where m.id = message_attachments.message_id
         and m.sender_id = auth.uid()
         and m.deleted_at is null)
  );

-- ---------------- reactions ----------------
create policy reactions_select on public.message_reactions
  for select to authenticated using (
    exists (select 1 from public.messages m where m.id = message_reactions.message_id)
  );
create policy reactions_insert on public.message_reactions
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.messages m where m.id = message_reactions.message_id)
  );
create policy reactions_update on public.message_reactions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy reactions_delete on public.message_reactions
  for delete to authenticated using (user_id = auth.uid());

-- ---------------- hidden ("delete for me") ----------------
create policy hidden_select on public.message_hidden
  for select to authenticated using (user_id = auth.uid());
-- Insert via delete_message().

-- ---------------- blocks ----------------
create policy blocks_select on public.user_blocks
  for select to authenticated using (blocker_id = auth.uid());
create policy blocks_insert on public.user_blocks
  for insert to authenticated with check (blocker_id = auth.uid());
create policy blocks_delete on public.user_blocks
  for delete to authenticated using (blocker_id = auth.uid());

-- ---------------- reports ----------------
create policy reports_select_own on public.user_reports
  for select to authenticated using (reporter_id = auth.uid());
create policy reports_insert_own on public.user_reports
  for insert to authenticated with check (
    reporter_id = auth.uid()
    and status = 'open'
    and (conversation_id is null or public.is_conversation_member(conversation_id))
    and (message_id is null or exists (select 1 from public.messages m where m.id = user_reports.message_id))
  );

-- ---------------- push tokens ----------------
create policy push_select_own on public.push_tokens
  for select to authenticated using (user_id = auth.uid());
create policy push_insert_own on public.push_tokens
  for insert to authenticated with check (user_id = auth.uid());
create policy push_update_own on public.push_tokens
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_delete_own on public.push_tokens
  for delete to authenticated using (user_id = auth.uid());

-- Table privileges for signed-in users (RLS above still applies row by row).
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.user_message_settings to authenticated;
grant select on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;
grant select, insert on public.messages to authenticated;
grant select, insert on public.message_attachments to authenticated;
grant select, insert, update, delete on public.message_reactions to authenticated;
grant select on public.message_hidden to authenticated;
grant select, insert, delete on public.user_blocks to authenticated;
grant select, insert on public.user_reports to authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;
-- Column-level limits: users may only edit these profile fields.
revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_path, about) on public.profiles to authenticated;
revoke update on public.user_message_settings from authenticated;
grant update (notifications_enabled, show_message_preview, group_notifications,
              send_read_receipts, show_online_status) on public.user_message_settings to authenticated;

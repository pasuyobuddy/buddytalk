-- =====================================================================
-- Storage buckets
--   chat-media (private): <conversation_id>/<uploader_id>/<file>
--   avatars    (public):  users/<user_id>/<file>   or   groups/<conversation_id>/<file>
-- =====================================================================

-- Safe text -> uuid (bad folder names must not error out the whole query).
create or replace function public.try_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- Who may change a group's photo/name: admins, or anyone if the group allows it.
create or replace function public.can_edit_group(p_conversation uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.conversations c
      join public.conversation_members cm on cm.conversation_id = c.id and cm.user_id = auth.uid()
     where c.id = p_conversation and c.kind = 'group'
       and (cm.role = 'admin' or not c.only_admins_can_edit));
$$;
revoke all on function public.can_edit_group(uuid) from public, anon;
grant execute on function public.can_edit_group(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('chat-media', 'chat-media', false, 26214400, array[
     'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
     'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/3gpp',
     'application/pdf', 'text/plain', 'text/csv',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.ms-powerpoint',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'application/zip', 'application/octet-stream']),
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ---------------- chat-media (private) ----------------
-- Read: members of the conversation folder, or of any chat the file was forwarded into.
create policy "chat media: members can read" on storage.objects
  for select to authenticated using (
    bucket_id = 'chat-media'
    and (
      public.is_conversation_member(public.try_uuid((storage.foldername(name))[1]))
      or exists (
        select 1 from public.message_attachments a
         where a.storage_path = storage.objects.name
           and public.is_conversation_member(a.conversation_id))
    )
  );

-- Upload: only into a chat you belong to, under your own user folder.
create policy "chat media: members can upload" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'chat-media'
    and public.is_conversation_member(public.try_uuid((storage.foldername(name))[1]))
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Delete: only files you uploaded.
create policy "chat media: uploader can delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ---------------- avatars (public read) ----------------
create policy "avatars: public read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars: write own or admin group" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars'
    and (
      ((storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = auth.uid()::text)
      or ((storage.foldername(name))[1] = 'groups'
          and public.can_edit_group(public.try_uuid((storage.foldername(name))[2])))
    )
  );

create policy "avatars: update own or admin group" on storage.objects
  for update to authenticated using (
    bucket_id = 'avatars'
    and (
      ((storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = auth.uid()::text)
      or ((storage.foldername(name))[1] = 'groups'
          and public.can_edit_group(public.try_uuid((storage.foldername(name))[2])))
    )
  );

create policy "avatars: delete own or admin group" on storage.objects
  for delete to authenticated using (
    bucket_id = 'avatars'
    and (
      ((storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = auth.uid()::text)
      or ((storage.foldername(name))[1] = 'groups'
          and public.can_edit_group(public.try_uuid((storage.foldername(name))[2])))
    )
  );

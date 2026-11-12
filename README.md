# BuddyTalk

<img src="app/assets/icon.png" width="160" alt="BuddyTalk logo">

A standalone, WhatsApp-style messaging app for customers and riders, with private chats, groups, photos, documents, voice messages, read receipts, reactions, @mentions, push notifications and offline sending.

- **App:** Expo (React Native, TypeScript), Android first, iOS-ready. Folder `app/`.
- **Backend:** its own Supabase project (database, auth, realtime, storage, edge function). Folder `supabase/`.
- **Push:** Firebase Cloud Messaging (FCM HTTP v1).

It does not touch the Pasuyo Buddy app or its Supabase project.

---

## What's included

| Area | Features |
|---|---|
| Private chats | Real-time text, photos (gallery or camera), documents, voice messages, timestamps, sent / delivered / read ticks, reply, forward, copy, delete for me / for everyone, online and last-seen status |
| Groups | Create, name, description, photo, add / remove members, admins, reactions, @mentions, leave group, mute and "mentions only" notifications, many groups per user. New members don't see older history. |
| Users | Email sign-up with name, @username and account type (Customer or Rider). Profile photos, names and account-type badges everywhere. Block and report. |
| Notifications | FCM push for private and group messages, respects mute, notification level, blocks and "show preview". App icon badge with unread total. Notifications for the chat you have open are not shown. |
| Chats screen | Unread counters, @ indicator, pinned, archived, muted, filters (All / Unread / Groups / Archived), long-press to pin / archive / mute |
| Search | Search chats by name; search message text across all chats or inside one chat |
| Settings | Edit profile and photo, notification switches, read receipts on/off, online status on/off, blocked list, sign out |
| Offline | Messages are saved on the phone first and sent automatically when the connection returns, with no duplicates. Failed messages show "Tap to retry". |
| Performance | One realtime connection for the whole app; history loads 40 messages at a time as you scroll up; the chat catches up automatically after reconnecting or returning from the background |

## Security (Row Level Security)

All rules live in the database, so they hold even if someone modifies the app:

- Only members can read a conversation, its members, messages, reactions and files.
- Messages can only be sent as yourself, into chats you belong to. Direct messages are refused when either person has blocked the other.
- Message edits and deletes, admin actions, mute settings and read receipts only go through checked server functions; the tables cannot be changed directly.
- Only group admins can add or remove members, appoint admins, or (by default) edit group info. The last admin leaving hands admin to the longest-standing member.
- Files are in a private bucket under `<chat id>/<your id>/…`. You can upload only into chats you're in, and read only files from chats you're in (forwarded files stay readable in the chat they were forwarded to).
- People can't change their own account type.
- Signed-out users can read nothing.

`supabase/tests/` contains 82 automated checks covering these rules (see "Testing" below).

---

## Setup

You need: a Supabase account, a Firebase account, Node.js 20+, and an Android phone.

### 1. Create the Supabase project

1. Create a **new** project at https://supabase.com/dashboard (keep it separate from Pasuyo Buddy).
2. Install the CLI and link it:
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   ```
3. Push the database:
   ```bash
   npx supabase db push
   ```
   This creates all tables, security rules, server functions, the `chat-media` and `avatars` storage buckets, and turns on realtime for the chat tables.
4. In **Authentication › Providers › Email**, choose whether new users must confirm their email. Both work.

### 2. Set up Firebase push notifications

1. Create a project at https://console.firebase.google.com.
2. Add an **Android app** with package name `com.buddytalk.app` (or change `android.package` in `app/app.json` first). Download `google-services.json` into the `app/` folder.
3. In **Project settings › Service accounts**, click **Generate new private key**. Keep this JSON file secret.

### 3. Deploy the push function

```bash
npx supabase secrets set FCM_SERVICE_ACCOUNT="$(cat path/to/service-account.json)"
npx supabase secrets set PUSH_WEBHOOK_SECRET="$(openssl rand -hex 24)"
npx supabase functions deploy send-chat-push --no-verify-jwt
```

Then in the Supabase dashboard: **Database › Webhooks › Create a new hook**

- Table: `public.messages`, events: **Insert**
- Type: **Supabase Edge Functions**, function: `send-chat-push`, method POST
- Add an HTTP header `x-webhook-secret` with the same value you set for `PUSH_WEBHOOK_SECRET`

### 4. Run the app

```bash
cd app
cp .env.example .env        # paste your project URL and anon key (Project Settings › API)
npm install
npx expo run:android        # builds a development app on a connected phone or emulator
```

Push notifications, voice recording and the camera need this development build (Expo Go does not include them).

To build an installable APK / Play Store bundle in the cloud:

```bash
npx eas-cli@latest build -p android --profile preview      # APK for testing
npx eas-cli@latest build -p android --profile production   # AAB for Play Store
```

Upload `google-services.json` as an EAS file secret, or commit it to a private repo, so cloud builds can find it.

### 5. Branding

- Logo and icons are in `app/assets/`: `icon.png` (app icon), `android-icon-foreground.png` + `android-icon-background.png` (Android launcher icon), `android-icon-monochrome.png` (Android themed icon), `splash-icon.png` (launch screen), `logo.png` (sign-in screen).
- Colours from the logo are in `app/src/lib/theme.ts` (blue `#0B4AE0`, orange `#FF8A00`, yellow `#FFC21A`, green `#2BC24A`).
- App name `BuddyTalk` and Android package `com.buddytalk.app` are in `app/app.json`. Change the package before you create the Firebase app if you want a different one; it cannot be changed after you publish on Google Play.

---

## Testing

**Database rules** (needs a local Postgres 15+; no Supabase account needed):

```bash
PGHOST=localhost PGUSER=postgres ./supabase/tests/run_tests.sh
```

It creates a throwaway database, applies the migrations on a small Supabase stand-in, and runs 82 checks with four test users (customer, rider, group member, outsider).

**End-to-end** against a running Supabase (for example `npx supabase start` locally, with email confirmation off):

```bash
cd app && SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... node ../supabase/tests/e2e.mjs
```

It signs up three users and checks realtime delivery, unread counts, read receipts, private file access, group admin rules, forwarding, reactions, delete for everyone, blocking and search (25 checks).

**App type-check:** `cd app && npx tsc --noEmit`

**Browser preview** (handy for a quick look; photos, voice and push need a phone): `cd app && npx expo start --web`

**Manual test plan on two phones** (one Customer account, one Rider account):

1. Sign up both. Start a private chat from the + button by searching the other's @username.
2. Send text, a photo, a document and a voice message both ways. Check one grey tick (sent), two grey ticks (delivered), two blue ticks (read).
3. Long-press a message: react, reply, copy, forward to another chat, delete for me, delete for everyone.
4. Turn on airplane mode, send two messages (clock icon), turn it off. They send in order, once each.
5. Create a group with a third account. Rename it, change photo and description, make someone admin, remove and re-add a member, @mention someone, leave the group.
6. Mute the group, set "Only @mentions", and check which messages notify. Close the app and check push notifications open the right chat.
7. Block the other person and confirm messages are refused and online status is hidden. Report a message.

---

## Project layout

```
supabase/
  migrations/
    …01_messaging_schema.sql      tables, indexes, triggers, realtime
    …02_messaging_rls.sql         row level security + table privileges
    …03_messaging_functions.sql   server functions (create group, admin, read receipts, search…)
    …04_messaging_storage.sql     storage buckets and file access rules
  functions/send-chat-push/       FCM push notification edge function
  tests/                          automated permission tests
app/
  src/app/                        screens (Expo Router)
    (auth)/sign-in, sign-up
    (app)/index                   chats list
    (app)/chat/[id]/index         conversation (private and group)
    (app)/chat/[id]/info          contact / group info, members, mute, block, report
    (app)/chat/[id]/add-members
    (app)/new-chat, new-group, forward, search, settings, blocked
  src/lib/                        Supabase client, API calls, realtime, offline outbox, push
  src/hooks/                      chat list and conversation data
  src/components/                 message bubble, composer, voice player, avatars
```

## Database tables

`profiles`, `user_message_settings`, `conversations`, `conversation_members`, `messages`, `message_attachments`, `message_reactions`, plus `message_hidden` (delete for me), `user_blocks`, `user_reports` and `push_tokens`.

Reports land in `user_reports` with status `open`; review them in the Supabase table editor.

## iOS later

The app code is cross-platform. For iOS push: add an iOS app in Firebase, upload an APNs key to Firebase, add `GoogleService-Info.plist`, and switch the token in `app/src/lib/push.ts` to an FCM token (for example with `@react-native-firebase/messaging`), because on iOS Expo returns an Apple token rather than an FCM one. The push function already sends iOS badge counts. Then build with `eas build -p ios`.

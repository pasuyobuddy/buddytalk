import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { markAllDelivered, setPresence } from '../../lib/api';
import { BrandTitle } from '../../components/BrandTitle';
import { useAuth } from '../../lib/auth';
import { processOutbox, startOutbox } from '../../lib/outbox';
import { listenForNotifications, registerForPush } from '../../lib/push';
import { onChatEvent, requestResync, startRealtime, stopRealtime } from '../../lib/realtime';
import { colors } from '../../lib/theme';

export default function AppLayout() {
  const { session } = useAuth();
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    startRealtime(userId);
    startOutbox();
    void registerForPush().catch(() => undefined);
    void markAllDelivered();
    void setPresence(true);
    const stopNotif = listenForNotifications();
    // When the live connection comes back, send anything still waiting.
    const offReconnect = onChatEvent((e) => {
      if (e.type === 'reconnected') void processOutbox();
    });

    // Online status heartbeat while the app is open.
    const beat = setInterval(() => {
      if (AppState.currentState === 'active') void setPresence(true);
    }, 60_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void setPresence(true);
        void markAllDelivered();
        void processOutbox();
        requestResync();
      } else {
        void setPresence(false);
      }
    });
    return () => {
      clearInterval(beat);
      sub.remove();
      stopNotif();
      offReconnect();
      stopRealtime();
      void setPresence(false);
    };
  }, [userId]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'BuddyTalk', headerTitle: () => <BrandTitle /> }} />
      <Stack.Screen name="new-chat" options={{ title: 'New chat' }} />
      <Stack.Screen name="new-group" options={{ title: 'New group' }} />
      <Stack.Screen name="chat/[id]/index" options={{ title: '' }} />
      <Stack.Screen name="chat/[id]/info" options={{ title: 'Info' }} />
      <Stack.Screen name="chat/[id]/add-members" options={{ title: 'Add members' }} />
      <Stack.Screen name="forward" options={{ title: 'Forward to…', presentation: 'modal' }} />
      <Stack.Screen name="search" options={{ title: 'Search messages' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="blocked" options={{ title: 'Blocked people' }} />
    </Stack>
  );
}

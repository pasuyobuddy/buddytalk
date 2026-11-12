// Firebase Cloud Messaging setup. On Android, getDevicePushTokenAsync returns the
// raw FCM token, which the send-chat-push function uses with the FCM HTTP v1 API.
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { markAllDelivered, registerPushToken, removePushToken } from './api';

let currentToken: string | null = null;
let openConversationId: string | null = null;

/** The chat on screen right now: its notifications are not shown as banners. */
export function setOpenConversation(id: string | null) {
  openConversationId = id;
}

if (Platform.OS !== 'web') Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const convId = (notification.request.content.data as Record<string, unknown> | undefined)?.conversation_id;
    const isOpenChat = Boolean(convId && convId === openConversationId);
    return {
      shouldShowBanner: !isOpenChat,
      shouldShowList: !isOpenChat,
      shouldPlaySound: !isOpenChat,
      shouldSetBadge: true,
    };
  },
});

export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      showBadge: true,
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return;

  const token = await Notifications.getDevicePushTokenAsync();
  currentToken = String(token.data);
  await registerPushToken(currentToken, Platform.OS === 'ios' ? 'ios' : 'android');
}

export async function unregisterPush() {
  if (currentToken) await removePushToken(currentToken);
  currentToken = null;
}

/** Open the right chat when a notification is tapped; mark messages delivered when one arrives. */
export function listenForNotifications(): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const open = (data: Record<string, unknown> | undefined) => {
    const id = data?.conversation_id;
    if (typeof id === 'string') router.push({ pathname: '/chat/[id]', params: { id } });
  };
  const last = Notifications.getLastNotificationResponse();
  if (last) open(last.notification.request.content.data as Record<string, unknown>);

  const a = Notifications.addNotificationResponseReceivedListener((r) =>
    open(r.notification.request.content.data as Record<string, unknown>),
  );
  const b = Notifications.addNotificationReceivedListener(() => {
    void markAllDelivered();
  });
  return () => {
    a.remove();
    b.remove();
  };
}

export async function setBadge(count: number) {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {
    // Some Android launchers do not support badges.
  }
}

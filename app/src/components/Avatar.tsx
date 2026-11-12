import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { avatarUrl } from '../lib/api';
import { colors } from '../lib/theme';

const palette = ['#1B5FAA', '#0E9F6E', '#C2410C', '#7C3AED', '#DB2777', '#0891B2', '#65A30D'];

export function Avatar({
  path,
  name,
  size = 44,
  online,
  group,
}: {
  path?: string | null;
  name?: string | null;
  size?: number;
  online?: boolean;
  group?: boolean;
}) {
  const url = avatarUrl(path);
  const label = (name ?? '?').trim();
  const initials = group
    ? '👥'
    : label
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('') || '?';
  const bg = palette[Math.abs([...label].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % palette.length];
  return (
    <View style={{ width: size, height: size }}>
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />
      ) : (
        <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
          <Text style={[styles.initials, { fontSize: size * 0.38 }]}>{initials}</Text>
        </View>
      )}
      {online ? (
        <View
          style={[
            styles.dot,
            { width: size * 0.28, height: size * 0.28, borderRadius: size * 0.14, right: 0, bottom: 0 },
          ]}
        />
      ) : null}
    </View>
  );
}

export function AccountBadge({ type }: { type: 'customer' | 'rider' | null | undefined }) {
  if (!type) return null;
  const rider = type === 'rider';
  return (
    <View style={[styles.badge, { backgroundColor: rider ? '#FEF3C7' : '#D1FAE5' }]}>
      <Text style={[styles.badgeText, { color: rider ? '#92400E' : '#065F46' }]}>{rider ? 'Rider' : 'Customer'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontWeight: '700' },
  dot: { position: 'absolute', backgroundColor: colors.online, borderWidth: 2, borderColor: '#fff' },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, marginLeft: 6 },
  badgeText: { fontSize: 11, fontWeight: '600' },
});

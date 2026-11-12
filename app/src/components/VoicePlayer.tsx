import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { mediaUrl } from '../lib/api';
import { durationLabel } from '../lib/format';
import { colors } from '../lib/theme';

export function VoicePlayer({ path, localUri, durationMs }: { path?: string; localUri?: string; durationMs?: number | null }) {
  const [uri, setUri] = useState<string | null>(localUri ?? null);
  useEffect(() => {
    if (!localUri && path) mediaUrl(path).then(setUri).catch(() => setUri(null));
  }, [path, localUri]);

  const player = useAudioPlayer(uri ? { uri } : null);
  const status = useAudioPlayerStatus(player);
  const total = status.duration ? status.duration * 1000 : durationMs ?? 0;
  const progress = total ? Math.min(1, (status.currentTime * 1000) / total) : 0;

  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      void player.seekTo(0);
    }
  }, [status.didJustFinish, player]);

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel={status.playing ? 'Pause voice message' : 'Play voice message'}
        style={styles.button}
        disabled={!uri}
        onPress={() => (status.playing ? player.pause() : player.play())}
      >
        {!uri ? <ActivityIndicator color="#fff" /> : <Text style={styles.icon}>{status.playing ? '❚❚' : '▶'}</Text>}
      </Pressable>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.time}>{durationLabel(status.playing ? status.currentTime * 1000 : total)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 200, paddingVertical: 4 },
  button: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  icon: { color: '#fff', fontSize: 14, fontWeight: '700' },
  track: { flex: 1, height: 4, backgroundColor: '#CBD5E1', borderRadius: 2, marginHorizontal: 10, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.primary },
  time: { fontSize: 12, color: colors.textMuted, minWidth: 34 },
});

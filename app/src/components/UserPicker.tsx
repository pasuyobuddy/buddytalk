import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { searchUsers } from '../lib/api';
import { colors } from '../lib/theme';
import type { Profile } from '../lib/types';
import { AccountBadge, Avatar } from './Avatar';

/** Search people by name or @username. Single tap (onPick) or multi-select (selected/onToggle). */
export function UserPicker({
  onPick,
  selected,
  onToggle,
  exclude = [],
  header,
}: {
  onPick?: (p: Profile) => void;
  selected?: Map<string, Profile>;
  onToggle?: (p: Profile) => void;
  exclude?: string[];
  header?: React.ReactElement | null;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setBusy(true);
      try {
        setResults((await searchUsers(q)).filter((p) => !exclude.includes(p.id)));
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <View style={{ flex: 1 }}>
      <TextInput
        style={styles.search}
        placeholder="Search name or @username"
        placeholderTextColor={colors.textMuted}
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
        autoFocus
      />
      {selected && selected.size ? (
        <View style={styles.chips}>
          {[...selected.values()].map((p) => (
            <Pressable key={p.id} style={styles.chip} onPress={() => onToggle?.(p)}>
              <Text style={styles.chipText}>{p.display_name} ✕</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {busy ? <ActivityIndicator style={{ marginTop: 12 }} color={colors.primary} /> : null}
      <FlatList
        data={results}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header ?? undefined}
        ListEmptyComponent={
          q.trim() && !busy ? <Text style={styles.empty}>No people found</Text> : <Text style={styles.empty}>Type to find people</Text>
        }
        renderItem={({ item }) => {
          const isSel = selected?.has(item.id);
          return (
            <Pressable style={styles.row} onPress={() => (onToggle ? onToggle(item) : onPick?.(item))}>
              <Avatar path={item.avatar_path} name={item.display_name} />
              <View style={styles.rowText}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.name}>{item.display_name}</Text>
                  <AccountBadge type={item.account_type} />
                </View>
                <Text style={styles.username}>@{item.username}</Text>
              </View>
              {onToggle ? <Text style={[styles.check, isSel && styles.checkOn]}>{isSel ? '✓' : ''}</Text> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    margin: 12, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 16, borderWidth: 1, borderColor: colors.border, color: colors.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  chip: { backgroundColor: '#DBEAFE', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, margin: 3 },
  chipText: { color: colors.primaryDark, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff' },
  rowText: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  username: { color: colors.textMuted, marginTop: 2 },
  check: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.border,
    textAlign: 'center', color: '#fff', fontWeight: '800',
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 24 },
});

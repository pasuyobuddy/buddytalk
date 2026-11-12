import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { colors } from '../lib/theme';

export function Button({
  title, onPress, busy, kind = 'primary', disabled,
}: { title: string; onPress: () => void; busy?: boolean; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean }) {
  const bg = kind === 'primary' ? colors.primary : kind === 'danger' ? colors.danger : '#fff';
  const fg = kind === 'secondary' ? colors.primary : '#fff';
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      style={[styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : 1 }, kind === 'secondary' && styles.secondary]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.textMuted} style={styles.input} {...props} />
    </View>
  );
}

export function ListRow({
  title, subtitle, onPress, right, danger,
}: { title: string; subtitle?: string; onPress?: () => void; right?: React.ReactNode; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, danger && { color: colors.danger }]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

export function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginVertical: 6 },
  secondary: { borderWidth: 1, borderColor: colors.primary },
  buttonText: { fontSize: 16, fontWeight: '700' },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.text,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#fff', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  rowTitle: { fontSize: 16, color: colors.text },
  rowSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  section: { marginTop: 18 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.primary, marginLeft: 16, marginBottom: 6, textTransform: 'uppercase' },
  sectionBody: { backgroundColor: '#fff' },
});

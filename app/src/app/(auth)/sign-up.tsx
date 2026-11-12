import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Field } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';
import type { AccountType } from '../../lib/types';

export default function SignUp() {
  const { signUp } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('customer');
  const [busy, setBusy] = useState(false);

  const usernameOk = /^[A-Za-z0-9_.]{3,30}$/.test(username);

  const submit = async () => {
    if (!usernameOk) {
      Alert.alert('Username', 'Use 3 to 30 letters, numbers, dots or underscores.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Password', 'Use at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      const signedIn = await signUp({ email, password, username, displayName, accountType });
      if (!signedIn) {
        Alert.alert('Check your email', 'Confirm your email address, then sign in.');
        router.replace('/sign-in');
      }
    } catch (e) {
      Alert.alert('Could not create account', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
      <Field label="Your name" value={displayName} onChangeText={setDisplayName} autoComplete="name" />
      <Field label="Username (for @mentions)" value={username} onChangeText={setUsername} autoCapitalize="none" />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <Text style={styles.label}>I am a</Text>
      <View style={styles.types}>
        {(['customer', 'rider'] as const).map((t) => (
          <Pressable key={t} onPress={() => setAccountType(t)} style={[styles.type, accountType === t && styles.typeOn]}>
            <Text style={[styles.typeText, accountType === t && { color: '#fff' }]}>{t === 'customer' ? 'Customer' : 'Rider'}</Text>
          </Pressable>
        ))}
      </View>
      <Button title="Create account" onPress={submit} busy={busy} disabled={!displayName || !username || !email || !password} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: '600' },
  types: { flexDirection: 'row', marginBottom: 20 },
  type: {
    flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.primary,
    alignItems: 'center', marginRight: 8, backgroundColor: '#fff',
  },
  typeOn: { backgroundColor: colors.primary },
  typeText: { fontWeight: '700', color: colors.primary },
});

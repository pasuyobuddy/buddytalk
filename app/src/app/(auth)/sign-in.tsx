import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { Button, Field } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (e) {
      Alert.alert('Could not sign in', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <Image source={require('../../../assets/logo.png')} style={styles.logo} contentFit="contain" />
        <Text style={styles.tag}>Chat with your buddies, customers and riders</Text>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
        <Button title="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
        <Link href="/sign-up" style={styles.link}>
          New here? Create an account
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 24, paddingTop: 32 },
  logo: { width: 150, height: 150, alignSelf: 'center', borderRadius: 32 },
  tag: { textAlign: 'center', color: colors.textMuted, marginBottom: 32, marginTop: 4 },
  link: { textAlign: 'center', color: colors.primary, marginTop: 18, fontWeight: '600', fontSize: 15 },
});

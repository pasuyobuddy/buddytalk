import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { AccountBadge, Avatar } from '../../components/Avatar';
import { Button, Field, ListRow, Section } from '../../components/ui';
import { getMySettings, setPresence, updateMyProfile, updateMySettings, uploadAvatar } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { unregisterPush } from '../../lib/push';
import { colors } from '../../lib/theme';
import type { MessageSettings } from '../../lib/types';

export default function Settings() {
  const { session, profile, refreshProfile, signOut } = useAuth();
  const me = session!.user.id;
  const [settings, setSettings] = useState<MessageSettings | null>(null);
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [about, setAbout] = useState(profile?.about ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMySettings(me).then(setSettings).catch(() => undefined);
  }, [me]);

  const toggle = async (key: keyof Omit<MessageSettings, 'user_id'>, value: boolean) => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    try {
      await updateMySettings(me, { [key]: value });
    } catch (e) {
      setSettings((s) => (s ? { ...s, [key]: !value } : s));
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  };

  const saveProfile = async () => {
    setBusy(true);
    try {
      await updateMyProfile(me, { display_name: displayName.trim(), about: about.trim() || null });
      await refreshProfile();
      Alert.alert('Saved');
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const changePhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
    if (res.canceled || !res.assets[0]) return;
    try {
      const path = await uploadAvatar(`users/${me}`, res.assets[0].uri);
      await updateMyProfile(me, { avatar_path: path });
      await refreshProfile();
    } catch (e) {
      Alert.alert('Could not update photo', e instanceof Error ? e.message : String(e));
    }
  };

  const logout = async () => {
    await setPresence(false).catch(() => undefined);
    await unregisterPush().catch(() => undefined);
    await signOut();
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={styles.top}>
        <Pressable onPress={changePhoto}>
          <Avatar path={profile?.avatar_path} name={profile?.display_name} size={96} />
          <Text style={styles.change}>Change photo</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          <Text style={styles.username}>@{profile?.username}</Text>
          <AccountBadge type={profile?.account_type} />
        </View>
      </View>
      <View style={{ padding: 16 }}>
        <Field label="Name" value={displayName} onChangeText={setDisplayName} maxLength={60} />
        <Field label="About" value={about} onChangeText={setAbout} maxLength={140} placeholder="Available" />
        <Button title="Save profile" onPress={saveProfile} busy={busy} disabled={!displayName.trim()} />
      </View>

      {settings ? (
        <>
          <Section title="Notifications">
            <ListRow title="Message notifications" right={<Switch value={settings.notifications_enabled} onValueChange={(v) => toggle('notifications_enabled', v)} />} />
            <ListRow title="Group notifications" subtitle="You still get @mentions" right={<Switch value={settings.group_notifications} onValueChange={(v) => toggle('group_notifications', v)} />} />
            <ListRow title="Show message preview" subtitle="Message text in notifications" right={<Switch value={settings.show_message_preview} onValueChange={(v) => toggle('show_message_preview', v)} />} />
          </Section>
          <Section title="Privacy">
            <ListRow title="Read receipts" subtitle="If off, others won't see blue ticks from you" right={<Switch value={settings.send_read_receipts} onValueChange={(v) => toggle('send_read_receipts', v)} />} />
            <ListRow title="Show when I'm online" right={<Switch value={settings.show_online_status} onValueChange={(v) => toggle('show_online_status', v)} />} />
            <ListRow title="Blocked people" onPress={() => router.push('/blocked')} />
          </Section>
        </>
      ) : null}

      <Section>
        <ListRow title="Sign out" danger onPress={logout} />
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  top: { alignItems: 'center', paddingVertical: 20, backgroundColor: '#fff' },
  change: { color: colors.primary, marginTop: 6, textAlign: 'center', fontWeight: '600' },
  username: { color: colors.textMuted, fontSize: 15 },
});

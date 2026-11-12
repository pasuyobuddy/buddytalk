import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Button, Field } from '../../components/ui';
import { UserPicker } from '../../components/UserPicker';
import { createGroup, updateGroup, uploadAvatar } from '../../lib/api';
import { colors } from '../../lib/theme';
import type { Profile } from '../../lib/types';

export default function NewGroup() {
  const [step, setStep] = useState<'members' | 'details'>('members');
  const [selected, setSelected] = useState<Map<string, Profile>>(new Map());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (p: Profile) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p);
      return next;
    });

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
    if (!res.canceled && res.assets[0]) setPhoto(res.assets[0].uri);
  };

  const create = async () => {
    setBusy(true);
    try {
      const id = await createGroup(name, description, [...selected.keys()]);
      if (photo) {
        const path = await uploadAvatar(`groups/${id}`, photo);
        await updateGroup(id, { avatarPath: path });
      }
      router.replace({ pathname: '/chat/[id]', params: { id } });
    } catch (e) {
      Alert.alert('Could not create group', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'members') {
    return (
      <View style={{ flex: 1 }}>
        <UserPicker selected={selected} onToggle={toggle} />
        <View style={{ padding: 12 }}>
          <Button title={selected.size ? `Next (${selected.size} selected)` : 'Next'} onPress={() => setStep('details')} disabled={!selected.size} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <Pressable onPress={pickPhoto} style={styles.photo}>
        {photo ? <Avatar path={null} name={name} size={96} /> : null}
        <Text style={styles.photoText}>{photo ? 'Photo selected ✓ (tap to change)' : '📷 Add group photo'}</Text>
      </Pressable>
      <Field label="Group name" value={name} onChangeText={setName} maxLength={80} />
      <Field label="Description (optional)" value={description} onChangeText={setDescription} multiline maxLength={500} />
      <Text style={styles.members}>Members: You, {[...selected.values()].map((p) => p.display_name).join(', ')}</Text>
      <Button title="Create group" onPress={create} busy={busy} disabled={!name.trim()} />
      <Button title="Back" kind="secondary" onPress={() => setStep('members')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  photo: { alignItems: 'center', marginBottom: 20 },
  photoText: { color: colors.primary, fontWeight: '600', marginTop: 8 },
  members: { color: colors.textMuted, marginBottom: 16 },
});

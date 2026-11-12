import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { Button } from '../../../../components/ui';
import { UserPicker } from '../../../../components/UserPicker';
import { addGroupMembers, getMembers } from '../../../../lib/api';
import type { Profile } from '../../../../lib/types';

export default function AddMembers() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [existing, setExisting] = useState<string[]>([]);
  const [selected, setSelected] = useState<Map<string, Profile>>(new Map());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMembers(id).then((m) => setExisting(m.map((x) => x.user_id)));
  }, [id]);

  const toggle = (p: Profile) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p);
      return next;
    });

  const add = async () => {
    setBusy(true);
    try {
      const added = (await addGroupMembers(id, [...selected.keys()])) as number;
      if (added < selected.size) {
        Alert.alert('Some people were not added', 'They may already be in the group or have blocked you.');
      }
      router.back();
    } catch (e) {
      Alert.alert('Could not add members', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <UserPicker selected={selected} onToggle={toggle} exclude={existing} />
      <View style={{ padding: 12 }}>
        <Button title={`Add ${selected.size || ''}`.trim()} onPress={add} busy={busy} disabled={!selected.size} />
      </View>
    </View>
  );
}

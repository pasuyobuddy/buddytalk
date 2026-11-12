import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text } from 'react-native';
import { ListRow } from '../../components/ui';
import { getProfiles, listBlocked, unblockUser } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';
import type { Profile } from '../../lib/types';

export default function Blocked() {
  const { session } = useAuth();
  const me = session!.user.id;
  const [people, setPeople] = useState<Profile[]>([]);

  const load = useCallback(async () => {
    const ids = await listBlocked();
    const map = await getProfiles(ids);
    setPeople([...map.values()]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <FlatList
      data={people}
      keyExtractor={(p) => p.id}
      ListEmptyComponent={<Text style={{ textAlign: 'center', marginTop: 40, color: colors.textMuted }}>You have not blocked anyone.</Text>}
      renderItem={({ item }) => (
        <ListRow
          title={item.display_name}
          subtitle={`@${item.username} · tap to unblock`}
          onPress={() => unblockUser(me, item.id).then(load)}
        />
      )}
    />
  );
}

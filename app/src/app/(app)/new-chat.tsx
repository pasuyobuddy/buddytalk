import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { UserPicker } from '../../components/UserPicker';
import { openDirectChat } from '../../lib/api';
import { colors } from '../../lib/theme';

export default function NewChat() {
  return (
    <UserPicker
      header={
        <Pressable style={styles.group} onPress={() => router.replace('/new-group')}>
          <View style={styles.groupIcon}>
            <Text style={{ fontSize: 22 }}>👥</Text>
          </View>
          <Text style={styles.groupText}>New group</Text>
        </Pressable>
      }
      onPick={async (p) => {
        try {
          const id = await openDirectChat(p.id);
          router.replace({ pathname: '/chat/[id]', params: { id } });
        } catch (e) {
          Alert.alert('Could not open chat', e instanceof Error ? e.message : String(e));
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#fff', marginBottom: 8 },
  groupIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  groupText: { marginLeft: 12, fontSize: 16, fontWeight: '700', color: colors.primary },
});

import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { durationLabel, messagePreview } from '../lib/format';
import { colors } from '../lib/theme';
import type { Member, UiMessage } from '../lib/types';
import { Avatar } from './Avatar';

export interface PickedFile {
  uri: string;
  mimeType: string;
  name: string;
  size?: number;
  width?: number;
  height?: number;
  durationMs?: number;
}

interface Props {
  isGroup: boolean;
  members: Member[];
  myId: string;
  replyTo: UiMessage | null;
  replyName?: string;
  onCancelReply: () => void;
  onSendText: (text: string, mentions: string[]) => void;
  onSendFile: (kind: 'image' | 'document', file: PickedFile, caption: string) => void;
  onSendVoice: (file: PickedFile) => void;
  disabledReason?: string | null;
}

const MAX_BYTES = 25 * 1024 * 1024;

export function Composer(p: Props) {
  const [text, setText] = useState('');
  const [showAttach, setShowAttach] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 250);

  // "@ab" at the end of the text opens the member picker.
  const mentionQuery = useMemo(() => {
    if (!p.isGroup) return null;
    const m = /(^|\s)@([A-Za-z0-9_.]*)$/.exec(text);
    return m ? m[2].toLowerCase() : null;
  }, [text, p.isGroup]);

  const mentionOptions = useMemo(() => {
    if (mentionQuery === null) return [];
    return p.members
      .filter((m) => m.user_id !== p.myId && m.profile)
      .filter(
        (m) =>
          m.profile!.username.toLowerCase().startsWith(mentionQuery) ||
          m.profile!.display_name.toLowerCase().includes(mentionQuery),
      )
      .slice(0, 6);
  }, [mentionQuery, p.members, p.myId]);

  const pickMention = (m: Member) => {
    setText((t) => t.replace(/@([A-Za-z0-9_.]*)$/, `@${m.profile!.username} `));
  };

  const mentionsIn = (value: string) => {
    const names = new Set([...value.matchAll(/@([A-Za-z0-9_.]{3,30})/g)].map((x) => x[1].toLowerCase()));
    return p.members.filter((m) => m.profile && names.has(m.profile.username.toLowerCase())).map((m) => m.user_id);
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    p.onSendText(value, mentionsIn(value));
    setText('');
  };

  const pickImage = async (camera: boolean) => {
    setShowAttach(false);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', camera ? 'Allow camera access to take photos.' : 'Allow photo access to send pictures.');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, exif: false };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    if (a.fileSize && a.fileSize > MAX_BYTES) {
      Alert.alert('Too large', 'Photos must be under 25 MB.');
      return;
    }
    p.onSendFile(
      'image',
      { uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg', name: a.fileName ?? 'photo.jpg', size: a.fileSize, width: a.width, height: a.height },
      text.trim(),
    );
    setText('');
  };

  const pickDocument = async () => {
    setShowAttach(false);
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    if (a.size && a.size > MAX_BYTES) {
      Alert.alert('Too large', 'Files must be under 25 MB.');
      return;
    }
    p.onSendFile('document', { uri: a.uri, mimeType: a.mimeType ?? 'application/octet-stream', name: a.name, size: a.size }, '');
  };

  const startRecording = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow microphone access to send voice messages.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const stopRecording = async (sendIt: boolean) => {
    const durationMs = recState.durationMillis;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false });
    const uri = recorder.uri;
    if (sendIt && uri && durationMs > 700) {
      p.onSendVoice({ uri, mimeType: 'audio/mp4', name: 'voice.m4a', durationMs });
    }
  };

  if (p.disabledReason) {
    return (
      <View style={styles.disabled}>
        <Text style={styles.disabledText}>{p.disabledReason}</Text>
      </View>
    );
  }

  return (
    <View>
      {mentionOptions.length ? (
        <View style={styles.mentionBox}>
          <FlatList
            keyboardShouldPersistTaps="always"
            data={mentionOptions}
            keyExtractor={(m) => m.user_id}
            renderItem={({ item }) => (
              <Pressable style={styles.mentionRow} onPress={() => pickMention(item)}>
                <Avatar path={item.profile?.avatar_path} name={item.profile?.display_name} size={28} />
                <Text style={styles.mentionName}>{item.profile?.display_name}</Text>
                <Text style={styles.mentionUser}>@{item.profile?.username}</Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}

      {p.replyTo ? (
        <View style={styles.replyBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.replyName}>Replying to {p.replyName}</Text>
            <Text numberOfLines={1} style={styles.replyText}>
              {messagePreview(p.replyTo.kind, p.replyTo.body)}
            </Text>
          </View>
          <Pressable onPress={p.onCancelReply} hitSlop={10} accessibilityLabel="Cancel reply">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {showAttach ? (
        <View style={styles.attachMenu}>
          <AttachButton icon="🖼️" label="Gallery" onPress={() => pickImage(false)} />
          <AttachButton icon="📷" label="Camera" onPress={() => pickImage(true)} />
          <AttachButton icon="📄" label="Document" onPress={pickDocument} />
        </View>
      ) : null}

      {recState.isRecording ? (
        <View style={styles.bar}>
          <Pressable onPress={() => stopRecording(false)} style={styles.iconButton} accessibilityLabel="Cancel recording">
            <Text style={[styles.icon, { color: colors.danger }]}>🗑</Text>
          </Pressable>
          <View style={styles.recording}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>Recording {durationLabel(recState.durationMillis)}</Text>
          </View>
          <Pressable onPress={() => stopRecording(true)} style={styles.send} accessibilityLabel="Send voice message">
            <Text style={styles.sendIcon}>➤</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.bar}>
          <Pressable onPress={() => setShowAttach((s) => !s)} style={styles.iconButton} accessibilityLabel="Attach">
            <Text style={styles.icon}>📎</Text>
          </Pressable>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Message"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={4000}
          />
          {text.trim() ? (
            <Pressable onPress={send} style={styles.send} accessibilityLabel="Send">
              <Text style={styles.sendIcon}>➤</Text>
            </Pressable>
          ) : (
            <Pressable onPress={startRecording} style={styles.send} accessibilityLabel="Record voice message">
              <Text style={styles.sendIcon}>🎤</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function AttachButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.attachItem} onPress={onPress}>
      <Text style={styles.attachIcon}>{icon}</Text>
      <Text style={styles.attachLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'flex-end', padding: 6, backgroundColor: colors.chatBackground },
  input: {
    flex: 1, backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    fontSize: 16, maxHeight: 140, color: colors.text,
  },
  iconButton: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 22 },
  send: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, marginLeft: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  sendIcon: { color: '#fff', fontSize: 20 },
  replyBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 8, marginTop: 6,
    padding: 8, borderRadius: 10, borderLeftWidth: 4, borderLeftColor: colors.accent,
  },
  replyName: { fontWeight: '700', color: colors.accent, fontSize: 13 },
  replyText: { color: colors.textMuted, fontSize: 13 },
  close: { fontSize: 18, color: colors.textMuted, paddingHorizontal: 6 },
  attachMenu: {
    flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#fff', margin: 8, paddingVertical: 12, borderRadius: 14,
  },
  attachItem: { alignItems: 'center', width: 80 },
  attachIcon: { fontSize: 28 },
  attachLabel: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  recording: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 46, paddingHorizontal: 12, backgroundColor: '#fff', borderRadius: 22 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger, marginRight: 8 },
  recText: { fontSize: 15, color: colors.text },
  mentionBox: { maxHeight: 220, backgroundColor: '#fff', marginHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  mentionRow: { flexDirection: 'row', alignItems: 'center', padding: 8 },
  mentionName: { marginLeft: 8, fontWeight: '600', color: colors.text },
  mentionUser: { marginLeft: 6, color: colors.textMuted },
  disabled: { padding: 16, backgroundColor: colors.chatBackground, alignItems: 'center' },
  disabledText: { color: colors.textMuted, textAlign: 'center' },
});

import { Text } from 'react-native';
import { colors } from '../lib/theme';

/** "Buddy" in white and "Talk" in yellow, like the logo. */
export function BrandTitle({ size = 22, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <Text style={{ fontSize: size, fontWeight: '800', color: dark ? colors.primary : '#fff' }}>
      Buddy<Text style={{ color: dark ? colors.accent : colors.highlight }}>Talk</Text>
    </Text>
  );
}

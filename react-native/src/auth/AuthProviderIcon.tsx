import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { usePreferences } from '../preferences/PreferencesProvider';
import { colors, radii, spacing } from '../theme/tokens';

export type AuthProviderName = 'apple' | 'google' | 'github' | 'phone';

type Props = Readonly<{
  name: AuthProviderName;
  label: string;
  enabled?: boolean;
  onPress: () => void;
}>;

export function AuthProviderIcon({
  name,
  label,
  enabled = true,
  onPress,
}: Props) {
  const { palette } = usePreferences();
  return (
    <View style={providerStyles.item}>
      <Pressable
        accessibilityLabel={`${label}登录`}
        accessibilityRole="button"
        disabled={!enabled}
        onPress={onPress}
        style={[
          providerStyles.button,
          { backgroundColor: palette.surface, borderColor: palette.border },
          !enabled && providerStyles.disabled,
        ]}
      >
        <BrandMark name={name} />
      </Pressable>
      <Text style={[providerStyles.label, { color: palette.textSecondary }]}>{label}</Text>
    </View>
  );
}

function BrandMark({ name }: Readonly<{ name: AuthProviderName }>) {
  const { palette } = usePreferences();
  if (name === 'google') {
    return (
      <Svg width={24} height={24} viewBox="0 0 24 24">
        <Path fill="#4285F4" d="M21.6 12.23c0-.75-.07-1.47-.2-2.16H12v4.09h5.37a4.6 4.6 0 0 1-2 3.01v2.65h3.24c1.9-1.75 2.99-4.33 2.99-7.59Z" />
        <Path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.64-2.43l-3.24-2.65c-.9.6-2.05.96-3.4.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.74A10 10 0 0 0 12 22Z" />
        <Path fill="#FBBC05" d="M6.39 13.75A6 6 0 0 1 6.08 12c0-.61.11-1.2.31-1.75V7.51H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.49l3.35-2.74Z" />
        <Path fill="#EA4335" d="M12 6.12c1.47 0 2.79.5 3.82 1.5l2.88-2.87A9.67 9.67 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.74C7.18 7.88 9.39 6.12 12 6.12Z" />
      </Svg>
    );
  }
  const path = name === 'apple'
    ? 'M16.7 12.9c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.7-1.7-3.3-1.7-1.4-.1-2.7.8-3.4.8-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.1 0 1.6-.7 3.1-.7 1.4 0 1.9.7 3.1.7 1.3 0 2.1-1.1 2.8-2.2.9-1.3 1.2-2.6 1.2-2.7-.1 0-2.7-1-2.7-3.9ZM14.4 6.3c.6-.8 1.1-1.9 1-3-.9 0-2 .6-2.7 1.3-.6.7-1.1 1.8-1 2.9 1 .1 2-.5 2.7-1.2Z'
    : name === 'github'
      ? 'M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0 1 12 6.82c.85 0 1.71.11 2.51.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.86v2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2Z'
      : 'M6.6 2.8 9.1 2l2 5-2.3 1.4a15.4 15.4 0 0 0 6.8 6.8l1.4-2.3 5 2-1 2.6c-.5 1.3-1.8 2.1-3.2 1.9C9.9 18.3 3.7 12.1 2.6 4.2c-.2-1.4.7-2.8 2-3.2Z';
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24">
      <Path d={path} fill={palette.text} />
    </Svg>
  );
}

const providerStyles = StyleSheet.create({
  item: { alignItems: 'center', gap: spacing.x1 },
  button: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.round,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  disabled: { opacity: 0.38 },
  label: { color: colors.textSecondary, fontSize: 12 },
});

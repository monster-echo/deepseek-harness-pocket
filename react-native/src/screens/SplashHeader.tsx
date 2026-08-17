import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { styles } from '../theme/styles';

type SplashHeaderProps = Readonly<{
  canSkip: boolean;
  countdown: number;
  onSkip: () => void;
  surfaceColor: string;
}>;

export function SplashHeader({
  canSkip,
  countdown,
  onSkip,
  surfaceColor,
}: SplashHeaderProps) {
  return (
    <View style={headerStyles.header}>
      <View
        accessibilityLabel={`倒计时 ${countdown}`}
        accessibilityLiveRegion="polite"
        style={[headerStyles.countdown, { backgroundColor: surfaceColor }]}
      >
        <Text style={headerStyles.countdownNumber}>{countdown}</Text>
      </View>
      {canSkip ? (
        <Pressable
          accessibilityLabel="跳过宣传页"
          accessibilityRole="button"
          onPress={onSkip}
          style={headerStyles.skip}
        >
          <Text style={styles.secondary}>跳过</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const headerStyles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  skip: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.x3,
  },
  countdown: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    borderRadius: radii.round,
  },
  countdownNumber: { fontSize: 18, fontWeight: '700', color: colors.brand },
});

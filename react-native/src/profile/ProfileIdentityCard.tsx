import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppCard } from '../design-system/components';
import { usePreferences } from '../preferences/PreferencesProvider';
import { colors, radii, spacing } from '../theme/tokens';
import { styles } from '../theme/styles';

export function ProfileIdentityCard({
  displayName,
  username,
  email,
  bio,
  avatarUrl,
  onAvatarPress,
}: Readonly<{
  displayName: string;
  username: string;
  email: string;
  bio: string;
  avatarUrl?: string | null;
  onAvatarPress?: () => void;
}>) {
  const { palette } = usePreferences();
  const avatar = (
    <ProfileAvatar
      avatarUrl={avatarUrl}
      label={displayName.slice(0, 1).toUpperCase()}
    />
  );
  return (
    <AppCard>
      <View style={identityStyles.container}>
        {onAvatarPress ? (
          <Pressable
            accessibilityLabel="更换头像"
            accessibilityRole="button"
            onPress={onAvatarPress}
            style={identityStyles.avatarAction}
          >
            {avatar}
            <Text style={identityStyles.avatarHint}>点击更换</Text>
          </Pressable>
        ) : avatar}
        <View style={identityStyles.copy}>
          <Text style={styles.heading}>{displayName}</Text>
          <Text style={styles.caption}>@{username}</Text>
          <Text style={styles.secondary}>{email}</Text>
        </View>
        <Text
          style={[
            identityStyles.bio,
            { backgroundColor: palette.surfaceMuted, color: palette.textSecondary },
          ]}
        >
          {bio || '这个人还没有填写简介。'}
        </Text>
      </View>
    </AppCard>
  );
}

function ProfileAvatar({
  avatarUrl,
  label,
}: Readonly<{ avatarUrl?: string | null; label: string }>) {
  const { palette } = usePreferences();
  if (avatarUrl) {
    return (
      <Image
        accessibilityLabel="用户头像"
        source={{ uri: avatarUrl }}
        style={identityStyles.avatar}
      />
    );
  }
  return (
    <View style={[identityStyles.avatar, { backgroundColor: palette.brandSoft }]}>
      <Text style={identityStyles.avatarText}>{label}</Text>
    </View>
  );
}

const identityStyles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing.x3, paddingVertical: spacing.x3 },
  copy: { alignItems: 'center', gap: spacing.x1 },
  bio: {
    color: colors.textSecondary,
    textAlign: 'center',
    width: '100%',
    padding: spacing.x3,
    borderRadius: radii.control,
    backgroundColor: colors.surfaceMuted,
  },
  avatarAction: { alignItems: 'center', gap: spacing.x2 },
  avatarHint: { color: colors.brand, fontWeight: '700' },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: radii.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  avatarText: { color: colors.brand, fontSize: 20, fontWeight: '700' },
});

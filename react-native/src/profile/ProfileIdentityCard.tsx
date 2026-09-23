import React from 'react';
import { Image, Pressable, View } from 'react-native';
import { Card, CardContent } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

function AppCard({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="gap-3 py-4">{children}</CardContent>
    </Card>
  );
}

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
  const avatar = (
    <ProfileAvatar
      avatarUrl={avatarUrl}
      label={displayName.slice(0, 1).toUpperCase()}
    />
  );
  return (
    <AppCard>
      <View className="items-center gap-3 py-3">
        {onAvatarPress ? (
          <Pressable
            accessibilityLabel="更换头像"
            accessibilityRole="button"
            className="items-center gap-2"
            onPress={onAvatarPress}
          >
            {avatar}
            <Text className="text-primary font-bold">点击更换</Text>
          </Pressable>
        ) : avatar}
        <View className="items-center gap-1">
          <Text className="text-foreground text-xl font-bold">{displayName}</Text>
          <Text className="text-muted-foreground text-xs">@{username}</Text>
          <Text className="text-muted-foreground text-sm">{email}</Text>
        </View>
        <Text className="bg-muted text-muted-foreground w-full rounded-xl p-3 text-center">
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
  if (avatarUrl) {
    return (
      <Image
        accessibilityLabel="用户头像"
        source={{ uri: avatarUrl }}
        className="size-24 rounded-full"
      />
    );
  }
  return (
    <View className="bg-primary/10 size-24 items-center justify-center rounded-full">
      <Text className="text-primary text-xl font-bold">{label}</Text>
    </View>
  );
}

import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useCSSVariable } from 'uniwind';
import { invalidateAssetUrl, resolveAssetUrl } from '../data/apiClient';
import * as ImagePicker from 'expo-image-picker';
import { Avatar as AvatarPrimitive, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useApp } from '../state/AppStore';
import { AvatarCropEditor } from '../profile/AvatarCropEditor';
import { ProfileIdentityCard } from '../profile/ProfileIdentityCard';
import { AppIcon, IconName } from '../design-system/AppIcon';
import { telemetry } from '../telemetry/Telemetry';
import type { AppRoute } from '../navigation/routes';

type ActionButtonVariant = 'primary' | 'secondary' | 'danger';

function AppButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled = false,
  analyticsId,
  testID,
}: Readonly<{
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: ActionButtonVariant;
  disabled?: boolean;
  analyticsId?: string;
  testID?: string;
}>) {
  const foreground = useCSSVariable([
    '--color-primary-foreground',
    '--color-foreground',
    '--color-destructive-foreground',
  ]) as [string, string, string];
  const iconColor =
    variant === 'secondary' ? foreground[1] : variant === 'danger' ? foreground[2] : foreground[0];
  return (
    <Button
      accessibilityRole="button"
      className="min-h-[52px] w-full"
      disabled={disabled}
      testID={testID}
      variant={variant === 'primary' ? 'default' : variant === 'danger' ? 'destructive' : 'outline'}
      onPress={() => {
        telemetry.track('ui_action', { action_id: analyticsId ?? `button.${label}` });
        onPress();
      }}
    >
      {icon ? <AppIcon name={icon} color={iconColor} size={20} /> : null}
      <Text>{label}</Text>
    </Button>
  );
}

function PageHeader({ title }: Readonly<{ title: string }>) {
  const navigation = useNavigation();
  const canGoBack = navigation.canGoBack();
  return (
    <View className="border-border/60 h-[58px] flex-row items-center justify-between border-b px-2">
      <View className="w-[88px] items-start">
        {canGoBack ? (
          <Button
            accessibilityLabel="返回"
            onPress={() => navigation.goBack()}
            size="icon"
            variant="ghost"
          >
            <AppIcon name="arrow-left" size={20} />
          </Button>
        ) : null}
      </View>
      <Text className="absolute left-[88px] right-[88px] text-center text-[17px] font-bold">
        {title}
      </Text>
      <View className="w-[88px] items-end" />
    </View>
  );
}

function AppCard({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="gap-3 py-4">{children}</CardContent>
    </Card>
  );
}

function OfflineBanner() {
  const { online, refreshBootstrap } = useApp();
  if (online) return null;
  return (
    <Pressable
      accessibilityRole="button"
      className="bg-muted min-h-10 flex-row items-center justify-center gap-2 px-4"
      onPress={() => void refreshBootstrap()}
    >
      <AppIcon name="alert" size={18} />
      <Text className="text-xs font-semibold">当前离线，正在使用本地配置 · 点击重试</Text>
    </Pressable>
  );
}

function ListRow({
  label,
  route,
  icon,
  value,
}: Readonly<{ label: string; route: AppRoute; icon?: IconName; value?: string }>) {
  const { navigate } = useApp();
  return (
    <Pressable
      className="border-border/50 min-h-[54px] flex-row items-center gap-3 border-b px-4 active:bg-accent/50"
      onPress={() => {
        telemetry.track('ui_action', { action_id: route });
        navigate(route);
      }}
    >
      {icon ? <AppIcon name={icon} size={20} /> : null}
      <Text className="flex-1 text-base">{label}</Text>
      {value ? <Text className="text-muted-foreground text-sm">{value}</Text> : null}
      <AppIcon name="chevron-right" size={18} />
    </Pressable>
  );
}

export function ProfileScreen() {
  const { user, config, navigate, signOut, showConfirm } = useApp();
  if (!user) return <SignedOutProfile />;
  const tier = config.tiers.find((item) => item.id === user.tierId);
  const requestSignOut = () => showConfirm({
    title: '退出登录？',
    message: '服务端会撤销当前会话，本机敏感凭据也会清除。',
    confirmLabel: '退出',
    onConfirm: signOut,
  });
  return (
    <View className="bg-background flex-1">
      <OfflineBanner />
      <PageHeader title="我的" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <ProfileIdentityCard
          displayName={user.displayName}
          username={user.username}
          email={user.hasEmail && user.email ? user.email : '未绑定邮箱'}
          bio={user.bio}
          avatarUrl={user.avatarUrl}
        />
        <View className="bg-foreground gap-3 rounded-2xl p-5">
          <Text className="text-background text-[22px] font-bold">{tier?.name ?? user.tierId}</Text>
          <Text className="text-muted-foreground text-sm">
            {tier?.summary ?? '会员信息由服务端动态配置'}
          </Text>
          <AppButton
            label="查看会员权益"
            icon="crown"
            onPress={() => navigate('membership.home')}
          />
        </View>
        <AppCard>
          <ListRow label="个人资料" route="profile.edit" icon="user" />
          {config.features.statistics ? (
            <ListRow label="使用统计" route="profile.statistics" icon="home" />
          ) : null}
          {config.features.coupons ? (
            <ListRow label="优惠券" route="profile.coupons" icon="gift" />
          ) : null}
          {config.features.invites ? (
            <ListRow label="邀请好友" route="profile.invite" icon="gift" />
          ) : null}
          <ListRow label="订单管理" route="membership.orders" icon="crown" />
          <ListRow label="设置" route="settings.home" icon="settings" />
        </AppCard>
        <AppButton label="退出登录" variant="danger" onPress={requestSignOut} />
      </ScrollView>
    </View>
  );
}

function SignedOutProfile() {
  const { navigate } = useApp();
  return (
    <View className="bg-background flex-1">
      <PageHeader title="我的" />
      <View className="flex-1 items-center justify-center gap-4 p-6">
        <Avatar label="M" />
        <Text className="text-foreground text-[28px] font-bold">登录后同步你的数据</Text>
        <Text className="text-muted-foreground text-sm">会员、订单与设置会安全同步。</Text>
        <View className="w-full">
          <AppButton label="登录或注册" onPress={() => navigate('auth.signIn')} />
        </View>
      </View>
    </View>
  );
}

// 头像显示：兼容 objectKey（→ presigned 24h）/ http(s) / data: 三种形态。
function Avatar({ avatarUrl, label }: Readonly<{ avatarUrl?: string | null; label: string }>) {
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!avatarUrl) return;
    void resolveAssetUrl(avatarUrl).then(url => {
      if (alive) setResolved(url);
    });
    return () => { alive = false; };
  }, [avatarUrl]);
  if (resolved) {
    return (
      <Image
        accessibilityLabel="用户头像"
        source={{ uri: resolved }}
        className="size-14 rounded-full"
        onError={() => {
          if (avatarUrl) invalidateAssetUrl(avatarUrl);
          setResolved(null);
        }}
      />
    );
  }
  return (
    <AvatarPrimitive alt="用户头像" className="size-14">
      <AvatarFallback>
        <Text className="text-primary text-xl font-bold">{label}</Text>
      </AvatarFallback>
    </AvatarPrimitive>
  );
}

export function EditProfileScreen() {
  const { user, updateProfile, busy, showToast } = useApp();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [cropAsset, setCropAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const chooseAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast('需要相册权限才能选择头像', 'error');
      return;
    }
    const selection = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
    const asset = selection.assets?.[0];
    if (selection.canceled || !asset) return;
    setCropAsset(asset);
  };
  const save = async () => {
    if (await updateProfile({ displayName, bio, avatarUrl: avatarUrl || null })) {
      showToast('个人资料已保存到服务端', 'success');
    }
  };
  return (
    <View className="bg-background flex-1">
      <PageHeader title="个人资料" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <ProfileIdentityCard
          displayName={displayName || user?.username || 'M'}
          username={user?.username ?? ''}
          email={user?.hasEmail && user?.email ? user.email : '未绑定邮箱'}
          bio={bio}
          avatarUrl={avatarUrl}
          onAvatarPress={() => void chooseAvatar()}
        />
        <Text className="text-muted-foreground ml-1 text-xs font-bold tracking-wide">用户名（不可修改）</Text>
        <Text className="text-muted-foreground text-sm">@{user?.username}</Text>
        <Text className="text-muted-foreground ml-1 text-xs font-bold tracking-wide">显示名称</Text>
        <Input
          accessibilityLabel="显示名称"
          className="min-h-[52px]"
          maxLength={40}
          onChangeText={setDisplayName}
          value={displayName}
        />
        <Text className="text-muted-foreground ml-1 text-xs font-bold tracking-wide">个人简介</Text>
        <Input
          accessibilityLabel="个人简介"
          className="min-h-[96px]"
          maxLength={160}
          multiline
          onChangeText={setBio}
          placeholder="介绍一下自己"
          style={{ textAlignVertical: 'top' }}
          value={bio}
        />
        <Text className="text-muted-foreground text-xs">点击上方头像选择图片，可拖动和缩放裁剪为 512×512。</Text>
        <AppButton
          disabled={busy}
          label={busy ? '保存中…' : '保存资料'}
          icon="check"
          onPress={() => void save()}
        />
      </ScrollView>
      {cropAsset ? (
        <AvatarCropEditor
          asset={cropAsset}
          onCancel={() => setCropAsset(null)}
          onConfirm={(value) => {
            setAvatarUrl(value);
            setCropAsset(null);
          }}
        />
      ) : null}
    </View>
  );
}

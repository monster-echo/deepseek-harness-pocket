import React, { ReactNode } from 'react';
import {
  Pressable,
  Switch,
  Text,
  View,
} from 'react-native';
import { AppRoute } from '../navigation/routes';
import { useApp } from '../state/AppStore';
import { colors } from '../theme/tokens';
import { styles } from '../theme/styles';
import { AppIcon, IconName } from './AppIcon';
import { telemetry } from '../telemetry/Telemetry';
import { usePreferences } from '../preferences/PreferencesProvider';
import { buttonStyles, componentStyles } from './componentStyles';

export function AppButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled = false,
  analyticsId,
}: Readonly<{
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  analyticsId?: string;
}>) {
  const { palette } = usePreferences();
  const variantStyle = variant === 'primary'
    ? buttonStyles.primary
    : variant === 'danger'
      ? buttonStyles.danger
      : buttonStyles.secondary;
  const foreground = variant === 'secondary' ? palette.text : colors.surface;
  const background = variant === 'secondary'
    ? palette.surface
    : variant === 'danger' ? colors.error : colors.brand;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        telemetry.track('ui_action', { action_id: analyticsId ?? `button.${label}` });
        onPress();
      }}
      style={({ pressed }) => [
        buttonStyles.base,
        variantStyle,
        {
          backgroundColor: background,
          borderColor: variant === 'secondary' ? palette.border : background,
        },
        pressed && buttonStyles.pressed,
        disabled && buttonStyles.disabled,
      ]}
    >
      {icon ? <AppIcon name={icon} color={foreground} size={20} /> : null}
      <Text style={[buttonStyles.label, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function OfflineBanner() {
  const { online, refreshBootstrap } = useApp();
  const { palette } = usePreferences();
  if (online) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => void refreshBootstrap()}
      style={componentStyles.offline}
    >
      <AppIcon name="alert" color={colors.warning} size={18} />
      <Text style={[componentStyles.offlineText, { color: palette.text }]}>
        当前离线，正在使用本地配置 · 点击重试
      </Text>
    </Pressable>
  );
}

export function IconButton({
  label,
  icon,
  onPress,
}: Readonly<{ label: string; icon: IconName; onPress: () => void }>) {
  const { palette } = usePreferences();
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} style={buttonStyles.icon}>
      <AppIcon name={icon} color={palette.text} />
    </Pressable>
  );
}

type PageHeaderAction = Readonly<{
  label: string;
  onPress: () => void;
  disabled?: boolean;
}>;

export function PageHeader({
  title,
  rightAction,
}: Readonly<{ title: string; rightAction?: PageHeaderAction }>) {
  const { back, canGoBack } = useApp();
  const { palette } = usePreferences();
  return (
    <View style={[
      componentStyles.header,
      { backgroundColor: palette.background, borderBottomColor: palette.border },
    ]}>
      <View style={componentStyles.headerSide}>
        {canGoBack ? (
          <IconButton label="返回" icon="arrow-left" onPress={back} />
        ) : null}
      </View>
      <Text style={[componentStyles.headerTitle, { color: palette.text }]}>{title}</Text>
      <View style={[componentStyles.headerSide, componentStyles.headerRight]}>
        {rightAction ? (
          <Pressable
            accessibilityLabel={rightAction.label}
            accessibilityRole="button"
            disabled={rightAction.disabled}
            onPress={rightAction.onPress}
            style={componentStyles.headerAction}
          >
            <Text style={[
              componentStyles.headerActionText,
              { color: palette.brand },
              rightAction.disabled && buttonStyles.disabled,
            ]}>
              {rightAction.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function AppCard({ children }: Readonly<{ children: ReactNode }>) {
  const { palette } = usePreferences();
  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      {children}
    </View>
  );
}

export function ListRow({
  label,
  route,
  icon,
  iconColor,
  value,
  destructive = false,
  onPress,
  analyticsId,
}: Readonly<{
  label: string;
  route?: AppRoute;
  icon?: IconName;
  iconColor?: string;
  value?: string;
  destructive?: boolean;
  onPress?: () => void;
  analyticsId?: string;
}>) {
  const { navigate } = useApp();
  const { palette } = usePreferences();
  const action = onPress ?? (route ? () => navigate(route) : undefined);
  return (
    <Pressable
      onPress={action ? () => {
        telemetry.track('ui_action', {
          action_id: analyticsId ?? route ?? `row.${label}`,
        });
        action();
      } : undefined}
      disabled={!action}
      style={styles.row}
    >
      {icon ? (
        <AppIcon
          name={icon}
          color={destructive ? colors.error : iconColor ?? palette.textSecondary}
          size={20}
        />
      ) : null}
      <Text style={[styles.rowText, destructive && componentStyles.destructive]}>{label}</Text>
      {value ? <Text style={styles.secondary}>{value}</Text> : null}
      {action ? <AppIcon name="chevron-right" color={palette.textSecondary} size={18} /> : null}
    </Pressable>
  );
}

export function ToggleRow({
  label,
  value,
  onChange,
}: Readonly<{ label: string; value: boolean; onChange: (value: boolean) => void }>) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowText}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.brand }}
      />
    </View>
  );
}

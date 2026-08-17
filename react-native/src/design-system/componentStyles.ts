import { StyleSheet } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

export const buttonStyles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radii.control,
    paddingHorizontal: spacing.x4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x2,
  },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  danger: { backgroundColor: colors.error },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.46 },
  label: { fontSize: 16, fontWeight: '700' },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

export const componentStyles = StyleSheet.create({
  header: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerSide: { width: 88, alignItems: 'flex-start' },
  headerRight: { alignItems: 'flex-end' },
  headerTitle: {
    position: 'absolute',
    left: 88,
    right: 88,
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerAction: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: spacing.x3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionText: { fontSize: 14, fontWeight: '700' },
  destructive: { color: colors.error },
  offline: {
    minHeight: 40,
    paddingHorizontal: spacing.x4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x2,
    backgroundColor: colors.warningSoft,
  },
  offlineText: { color: colors.warning, fontSize: 12, fontWeight: '600' },
});

import { StyleSheet } from 'react-native';
import { colors, radii, spacing, ThemeColors } from './tokens';

export let styles = createStyles(colors, 1);

export function applyTheme(palette: ThemeColors, textScale: number) {
  styles = createStyles(palette, textScale);
}

function createStyles(palette: ThemeColors, textScale: number) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  page: { flex: 1, backgroundColor: palette.background },
  scrollContent: { padding: spacing.x4, gap: spacing.x4 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.x6,
    gap: spacing.x4,
  },
  title: { color: palette.text, fontSize: 28 * textScale, fontWeight: '700' },
  heading: { color: palette.text, fontSize: 20 * textScale, fontWeight: '700' },
  body: { color: palette.text, fontSize: 16 * textScale },
  secondary: { color: palette.textSecondary, fontSize: 14 * textScale },
  caption: { color: palette.textSecondary, fontSize: 12 * textScale },
  card: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: radii.card,
    borderWidth: 1,
    padding: spacing.x4,
    gap: spacing.x3,
  },
  sectionLabel: {
    color: palette.textSecondary,
    fontSize: 13 * textScale,
    fontWeight: '600',
    marginLeft: spacing.x1,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    paddingHorizontal: spacing.x4,
    borderBottomColor: palette.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, color: palette.text, fontSize: 16 * textScale },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.control,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.x4,
    color: palette.text,
    fontSize: 16 * textScale,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radii.small,
    borderWidth: 2,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMark: {
    width: 10,
    height: 6,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: palette.surface,
    transform: [{ rotate: '-45deg' }, { translateY: -2 }],
  },
  checkboxChecked: {
    backgroundColor: palette.brand,
    borderColor: palette.brand,
  },
  });
}

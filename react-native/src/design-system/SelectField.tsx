import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreferences } from '../preferences/PreferencesProvider';
import { colors, radii, spacing } from '../theme/tokens';
import { AppIcon } from './AppIcon';

type SelectOption<T extends string | number> = Readonly<{ value: T; label: string }>;

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
}>) {
  const { palette } = usePreferences();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <>
      <View style={selectStyles.field}>
        <Text style={[selectStyles.label, { color: palette.textSecondary }]}>{label}</Text>
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          onPress={() => setOpen(true)}
          style={[selectStyles.control, {
            backgroundColor: palette.surface,
            borderColor: palette.border,
          }]}
        >
          <Text style={[selectStyles.value, { color: palette.text }]}>
            {selected?.label ?? '请选择'}
          </Text>
          <AppIcon name="chevron-right" color={palette.textSecondary} size={18} />
        </Pressable>
      </View>
      <Modal animationType="fade" transparent visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable style={selectStyles.scrim} onPress={() => setOpen(false)}>
          <View
            style={[
              selectStyles.sheet,
              {
                backgroundColor: palette.surface,
                // RN Modal 在全局 SafeAreaView 之外，底部自避手势条
                paddingBottom: insets.bottom + spacing.x4,
              },
            ]}
          >
            <Text style={[selectStyles.title, { color: palette.text }]}>{label}</Text>
            {options.map((option) => (
              <Pressable
                accessibilityRole="button"
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={[selectStyles.option, { borderBottomColor: palette.border }]}
              >
                <Text style={[selectStyles.value, { color: palette.text }]}>{option.label}</Text>
                {option.value === value ? (
                  <AppIcon name="check" color={palette.brand} size={20} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const selectStyles = StyleSheet.create({
  field: { gap: spacing.x2 },
  label: { fontSize: 13, fontWeight: '600' },
  control: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: radii.control,
    paddingHorizontal: spacing.x4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  value: { flex: 1, fontSize: 16 },
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.scrim,
  },
  sheet: {
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    padding: spacing.x4,
  },
  title: { fontSize: 18, fontWeight: '700', padding: spacing.x3 },
  option: {
    minHeight: 56,
    paddingHorizontal: spacing.x3,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

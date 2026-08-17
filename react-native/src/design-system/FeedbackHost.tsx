import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../state/AppStore';
import { usePreferences } from '../preferences/PreferencesProvider';
import { colors, radii, spacing } from '../theme/tokens';
import { styles } from '../theme/styles';
import { AppIcon } from './AppIcon';
import { AppButton } from './components';

export function FeedbackHost() {
  const { toast, confirm, closeConfirm } = useApp();
  const { palette } = usePreferences();
  const toastColor = toast?.tone === 'success'
    ? colors.success
    : toast?.tone === 'error'
      ? colors.error
      : colors.info;
  return (
    <>
      {toast ? (
        <View
          accessibilityLiveRegion="polite"
          style={[feedbackStyles.toast, { backgroundColor: palette.surface, borderColor: palette.border }]}
        >
          <AppIcon name={toast.tone === 'error' ? 'alert' : 'check'} color={toastColor} size={20} />
          <Text style={styles.body}>{toast.message}</Text>
        </View>
      ) : null}
      <Modal visible={Boolean(confirm)} transparent animationType="fade">
        <Pressable style={feedbackStyles.scrim} onPress={closeConfirm}>
          <Pressable
            style={[feedbackStyles.dialog, { backgroundColor: palette.surface }]}
            onPress={() => undefined}
          >
            <View style={[feedbackStyles.alertIcon, { backgroundColor: palette.brandSoft }]}>
              <AppIcon name="alert" color={colors.warning} size={28} />
            </View>
            <Text style={styles.heading}>{confirm?.title}</Text>
            <Text style={[styles.secondary, feedbackStyles.center]}>{confirm?.message}</Text>
            <View style={feedbackStyles.actions}>
              <View style={feedbackStyles.action}>
                <AppButton label="取消" variant="secondary" onPress={closeConfirm} />
              </View>
              <View style={feedbackStyles.action}>
                <AppButton
                  label={confirm?.confirmLabel ?? '确认'}
                  variant="danger"
                  onPress={() => {
                    confirm?.onConfirm();
                    closeConfirm();
                  }}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const feedbackStyles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.x4,
    right: spacing.x4,
    bottom: spacing.x6,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.x4,
  },
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
    padding: spacing.x6,
  },
  dialog: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: spacing.x3,
    padding: spacing.x5,
    borderRadius: radii.sheet,
    backgroundColor: colors.surface,
  },
  alertIcon: {
    width: 52,
    height: 52,
    borderRadius: radii.round,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  center: { textAlign: 'center' },
  actions: { width: '100%', flexDirection: 'row', gap: spacing.x3 },
  action: { flex: 1 },
});

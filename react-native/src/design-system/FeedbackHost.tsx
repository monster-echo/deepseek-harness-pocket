import React, { useEffect } from 'react';
import { View } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { showSystemToast } from '../lib/system-toast';
import { useApp } from '../state/AppStore';

export function FeedbackHost() {
  const { toast, confirm, closeConfirm } = useApp();

  // 提示改用系统呈现（Android ToastAndroid / iOS Alert）：
  // 自绘浮层无法感知灵动岛，必然压住状态栏区域。
  const toastId = toast?.id;
  useEffect(() => {
    if (!toast) return;
    showSystemToast(toast.message, toast.tone);
    // 同一 id 只提示一次；toast 对象 2.4s 后由 store 置空
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toastId]);

  return (
    <>
      <AlertDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) closeConfirm();
        }}
      >
        <AlertDialogContent>
          <View className="items-center gap-3">
            <View className="bg-muted h-[52px] w-[52px] items-center justify-center rounded-full">
              <Icon as={TriangleAlert} className="text-destructive size-7" />
            </View>
            <AlertDialogHeader className="items-center gap-2">
              <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
              <AlertDialogDescription className="text-center">
                {confirm?.message}
              </AlertDialogDescription>
            </AlertDialogHeader>
          </View>
          <AlertDialogFooter className="flex-row gap-3">
            <AlertDialogCancel className="flex-1" onPress={closeConfirm}>
              <Text>取消</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive flex-1"
              onPress={() => {
                confirm?.onConfirm();
                closeConfirm();
              }}
            >
              <Text>{confirm?.confirmLabel ?? '确认'}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

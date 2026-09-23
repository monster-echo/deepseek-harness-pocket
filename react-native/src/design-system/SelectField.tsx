import React, { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';

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
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <>
      <View className="gap-2">
        <Text className="text-muted-foreground text-[13px] font-semibold">{label}</Text>
        <Button
          accessibilityLabel={label}
          className="min-h-[52px] w-full justify-between px-4"
          onPress={() => setOpen(true)}
          variant="outline"
        >
          <Text className={selected ? 'flex-1 text-base' : 'text-muted-foreground flex-1 text-base'}>
            {selected?.label ?? '请选择'}
          </Text>
          <Icon as={ChevronRight} className="text-muted-foreground size-[18px]" />
        </Button>
      </View>
      <Modal animationType="fade" transparent visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/50" onPress={() => setOpen(false)}>
          <View
            className="bg-card rounded-t-3xl p-4"
            // RN Modal 在全局 SafeAreaView 之外，底部自避手势条
            style={{ paddingBottom: insets.bottom + 16 }}
          >
            <Text className="p-3 text-lg font-bold">{label}</Text>
            {options.map((option) => (
              <Pressable
                accessibilityRole="button"
                className="border-border active:bg-accent min-h-14 flex-row items-center gap-2 border-b px-3"
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <Text className="flex-1 text-base">{option.label}</Text>
                {option.value === value ? (
                  <Icon as={Check} className="text-primary size-5" />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

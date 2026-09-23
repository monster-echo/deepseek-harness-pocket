/**
 * 远程目录树选择器：浏览 Worker 电脑的目录（fs.list），选择一个作为 workspace。
 */

import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronRight, Folder, X } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { useDshStore } from "@/state/dshStore";

export function DirectoryPickerSheet(
  props: Readonly<{
    visible: boolean;
    onClose: () => void;
    onPicked: (path: string) => void;
  }>,
) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<string>("/");
  const [dirs, setDirs] = useState<readonly { name: string; path: string }[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<readonly string[]>([]);
  const listDir = useDshStore((s) => s.listDir);
  const fsHome = useDshStore((s) => s.fsHome);
  const notice = useDshStore((s) => s.notice);

  const listRef = React.useRef<ScrollView>(null);
  const load = useCallback(
    (path: string) => {
      setLoading(true);
      void listDir(path).then((entries) => {
        setDirs(entries);
        setLoading(false);
        // iOS 滚动条仅滚动时可见：加载后闪烁提示可滚动
        setTimeout(() => listRef.current?.flashScrollIndicators(), 120);
      });
    },
    [listDir],
  );

  useEffect(() => {
    if (!props.visible) return;
    void fsHome().then((home) => {
      setCurrent(home);
      load(home);
    });
  }, [props.visible, fsHome, load]);

  const enter = (dir: { name: string; path: string }): void => {
    setHistory((h) => [...h, current]);
    setCurrent(dir.path);
    load(dir.path);
  };

  const back = (): void => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1]!;
      setCurrent(prev);
      load(prev);
      return h.slice(0, -1);
    });
  };

  const crumbs = current.split("/").filter(Boolean);

  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      onRequestClose={props.onClose}
    >
      <View
        className="bg-background flex-1"
        style={{
          paddingTop: insets.top + 4,
          paddingBottom: insets.bottom,
        }}
      >
        {/* 顶栏 */}
        <View className="border-border flex-row items-center gap-3 border-b px-3 pb-2">
          <Pressable onPress={props.onClose} hitSlop={12}>
            <Icon as={X} className="text-foreground size-[22px]" />
          </Pressable>
          <Text className="text-foreground flex-1 text-base font-semibold">
            选择电脑上的目录
          </Text>
          <Pressable onPress={props.onClose} hitSlop={12}>
            <Text className="text-muted-foreground text-sm">取消</Text>
          </Pressable>
        </View>

        {/* 面包屑 */}
        <ScrollView
          horizontal
          style={{ flexGrow: 0 }}
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="flex-row items-center gap-1 px-3 py-2"
        >
          <Crumb
            label="/"
            path="/"
            current={current === "/"}
            onPress={() => {
              setCurrent("/");
              load("/");
              setHistory([]);
            }}
          />
          {crumbs.map((label, i) => {
            const path = `/${crumbs.slice(0, i + 1).join("/")}`;
            return (
              <Crumb
                key={path}
                label={label}
                path={path}
                current={current === path}
                onPress={() => {
                  setCurrent(path);
                  load(path);
                  setHistory([]);
                }}
              />
            );
          })}
        </ScrollView>
        <View
          className="px-4 pb-2"
        >
          {!loading && dirs.length > 0 && (
            <Text className="text-muted-foreground pb-2 text-xs">
              共 {dirs.length} 个子目录
            </Text>
          )}
        </View>
        {/* 目录列表 */}
        <ScrollView
          ref={listRef}
          className="flex-1 px-3"
          showsVerticalScrollIndicator
          scrollIndicatorInsets={{ right: 1 }}
          contentContainerClassName="pb-6"
        >
          {loading && (
            <Text className="text-muted-foreground p-3 text-[13px]">
              加载中…
            </Text>
          )}
          {!loading && dirs.length === 0 && history.length === 0 && (
            <Text
              className={cn(
                "p-3 text-[13px]",
                notice !== null ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {notice !== null ? `读取失败：${notice}` : "没有子目录"}
            </Text>
          )}
          {!loading && (dirs.length > 0 || history.length > 0) && (
            <View className="bg-card border-border overflow-hidden rounded-xl border">
              {history.length > 0 && (
                <>
                  <Row name=".." detail="返回上级" onPress={back} />
                  <View className="bg-border h-px w-full" />
                </>
              )}
              {dirs.map((dir, index) => (
                <React.Fragment key={dir.path}>
                  {index > 0 && <View className="bg-border h-px w-full" />}
                  <Row name={dir.name} detail="" onPress={() => enter(dir)} chevron />
                </React.Fragment>
              ))}
            </View>
          )}
        </ScrollView>

        {/* 底部固定选择栏（避开 home indicator 由容器 paddingBottom 处理） */}
        <View
          className="bg-card border-border flex-row items-center gap-3 border-t px-3 py-2"
        >
          <Text
            className="text-muted-foreground flex-1 font-mono text-xs"
            numberOfLines={1}
          >
            {current}
          </Text>
          <Button
            className="h-auto px-4 py-2"
            onPress={() => {
              props.onPicked(current);

              // 选择后关闭
              props.onClose();
            }}
          >
            <Text className="text-[13px]">选这个目录</Text>
          </Button>
        </View>
      </View>
    </Modal>
  );
}

function Crumb(
  props: Readonly<{
    label: string;
    path: string;
    current: boolean;
    onPress: () => void;
  }>,
) {
  return (
    <Pressable
      className={cn(
        "rounded-md px-2 py-1",
        props.current && "bg-muted",
      )}
      onPress={props.onPress}
    >
      <Text
        className={cn(
          "max-w-[140px] text-xs",
          props.current ? "text-foreground font-medium" : "text-muted-foreground",
        )}
        numberOfLines={1}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function Row(
  props: Readonly<{
    name: string;
    detail: string;
    onPress: () => void;
    chevron?: boolean;
  }>,
) {
  return (
    <Pressable
      className="active:bg-accent flex-row items-center gap-3 px-4 py-3"
      onPress={props.onPress}
    >
      <View className="bg-muted h-8 w-8 items-center justify-center rounded-md">
        <Icon as={Folder} className="text-muted-foreground size-4" />
      </View>
      <View className="flex-1">
        <Text
          className="text-foreground text-sm font-medium"
          numberOfLines={1}
        >
          {props.name}
        </Text>
        {props.detail.length > 0 && (
          <Text
            className="text-muted-foreground mt-0.5 text-xs"
            numberOfLines={1}
          >
            {props.detail}
          </Text>
        )}
      </View>
      {props.chevron === true && (
        <Icon as={ChevronRight} className="text-muted-foreground size-4" />
      )}
    </Pressable>
  );
}

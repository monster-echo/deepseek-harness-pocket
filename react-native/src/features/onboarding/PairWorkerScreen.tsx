/**
 * 我的电脑（Worker 管理）：worker 列表（可选/切换）+ 右上角「+」添加（配对）。
 * 侧边栏点「选择电脑」进入本页，选择后返回；「+」进入安装指引 + 配对码表单。
 * 视觉：shadcn 风格（DeviceRow + ListGroup + 默认按钮圆角）。
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ArrowLeft, Check, Copy, Plus, ScanLine } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { DeviceRow, ListGroup } from '@/components/app';
import { Sheet } from '@/design-system/Sheet';
import { useApp } from '@/state/AppStore';
import { useDshStore } from '@/state/dshStore';
import { bindWorkerByCode } from '@/dsh/connection';
import type { WorkerPresence } from '@deepseek-harness-pocket/bridge-protocol';

const INSTALL_STEPS: readonly { title: string; command: string }[] = [
  { title: '1. 安装（电脑端，需 Node.js）', command: 'npm i -g @deepseek-harness-pocket/bridge' },
  { title: '2. 启动并守护 dsh', command: 'dshc start' },
  { title: '3. 开机自启（推荐）', command: 'dshc install' },
]

/** 机器信息摘要：`macOS 14.6 · 8 核 16GB`（host 由 bridge 注册帧上送）。 */
function hostLine(worker: WorkerPresence): string {
  const host = worker.host
  const parts: string[] = []
  if (host?.osVersion !== undefined) parts.push(host.osVersion)
  if (host?.cpuCores !== undefined) parts.push(`${host.cpuCores} 核`)
  if (host?.memoryBytes !== undefined) parts.push(`${Math.round(host.memoryBytes / 1024 ** 3)}GB`)
  return parts.length > 0 ? parts.join(' · ') : worker.online ? '在线' : '离线'
}

export function PairWorkerScreen() {
  const { back, navigate } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const workers = useDshStore((s) => s.workers);
  const activeWorkerId = useDshStore((s) => s.activeWorkerId);
  const openWorker = useDshStore((s) => s.openWorker);

  return (
    <View className="bg-background flex-1">
      <View className="border-border flex-row items-center justify-between border-b px-3 pb-2 pt-6">
        <Pressable onPress={() => back()} hitSlop={12}>
          <Icon as={ArrowLeft} className="text-foreground size-[22px]" />
        </Pressable>
        <Text className="text-foreground text-[17px] font-semibold">我的电脑</Text>
        <View className="flex-row items-center gap-3">
          {/* 扫码配对：扫电脑上 dshc qr 打印的二维码 */}
          <Pressable onPress={() => navigate('dsh.scanPair')} hitSlop={12} accessibilityLabel="扫码配对">
            <Icon as={ScanLine} className="text-foreground size-[22px]" />
          </Pressable>
          {/* 右上角 +：进入添加/配对 */}
          <Pressable onPress={() => setShowAdd(true)} hitSlop={12} accessibilityLabel="添加电脑">
            <Icon as={Plus} className="text-foreground size-[22px]" />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerClassName="p-4">
        {workers.length === 0 && (
          <View className="items-center py-8">
            <Text className="text-muted-foreground text-center text-sm leading-[21px]">
              还没有电脑。点右上角「+」安装并配对一台电脑。
            </Text>
          </View>
        )}
        {workers.length > 0 && (
          <ListGroup header="已关联的电脑">
            {workers.map((worker, index) => (
              <React.Fragment key={worker.workerId}>
                {index > 0 && <View className="bg-border h-px w-full" />}
                <DeviceRow
                  className="rounded-none border-0 shadow-none"
                  selected={worker.workerId === activeWorkerId}
                  status={{ label: worker.online ? '在线' : '离线', tone: worker.online ? 'online' : 'offline' }}
                  subtitle={hostLine(worker)}
                  title={worker.name}
                  onPress={() => {
                    openWorker(worker.workerId);
                    back();
                  }}
                />
              </React.Fragment>
            ))}
          </ListGroup>
        )}
      </ScrollView>

      {/* 添加电脑：2/3 底部弹层；scrollable 保证键盘弹出后表单可滚动到可视区 */}
      <Sheet visible={showAdd} title="添加电脑" onClose={() => setShowAdd(false)} scrollable snapPoints={['66%', '92%']}>
        <AddWorkerForm onDone={() => setShowAdd(false)} />
      </Sheet>
    </View>
  )
}

function AddWorkerForm({ onDone }: Readonly<{ onDone: () => void }>) {
  const { showToast, navigate } = useApp();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const connectGateway = useDshStore((s) => s.connectGateway);

  const copyCommand = (command: string): void => {
    void Clipboard.setStringAsync(command).then(() => {
      setCopied(command)
      showToast('已复制命令', 'success')
      setTimeout(() => setCopied((c) => (c === command ? null : c)), 2000)
    })
  };

  const bind = async (): Promise<void> => {
    if (!/^\d{6}$/.test(code)) {
      setError('请输入电脑终端显示的 6 位配对码')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await bindWorkerByCode(code, name.trim().length > 0 ? name.trim() : undefined)
      connectGateway()
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View>
      <ListGroup header="电脑端安装步骤" footer="电脑终端会打印二维码与 6 位配对码；此处先手输配对码完成绑定（扫码即将上线）。">
        {INSTALL_STEPS.map((step, index) => (
          <React.Fragment key={step.command}>
            {index > 0 && <View className="bg-border h-px w-full" />}
            <Pressable
              className="active:bg-accent gap-2 px-4 py-3"
              onPress={() => copyCommand(step.command)}
            >
              <Text className="text-foreground text-sm font-medium">{step.title}</Text>
              <View className="flex-row items-center gap-2">
                <Text className="text-muted-foreground flex-1 font-mono text-[13px]" selectable>
                  {step.command}
                </Text>
                <Icon as={copied === step.command ? Check : Copy} className="text-muted-foreground size-[15px]" />
              </View>
            </Pressable>
          </React.Fragment>
        ))}
      </ListGroup>

      <Button
        className="mb-1 py-3"
        variant="outline"
        onPress={() => {
          onDone();
          navigate('dsh.scanPair');
        }}
      >
        <Icon as={ScanLine} className="text-foreground size-[18px]" />
        <Text>扫码配对（推荐）</Text>
      </Button>

      <ListGroup header="或用配对码手动绑定">
        <View className="gap-3 p-4">
          <Input
            className="h-auto py-3 text-center text-[22px] tracking-[8px]"
            placeholder="6 位配对码"
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={setCode}
          />
          <Input
            className="h-auto px-3 py-2 text-sm"
            placeholder="给这台电脑起个名字（可选）"
            value={name}
            onChangeText={setName}
          />
          {error !== null && <Text className="text-destructive text-[13px]">{error}</Text>}
          <Button className="py-3" disabled={busy} onPress={() => void bind()}>
            <Text>{busy ? '绑定中…' : '绑定到我的账号'}</Text>
          </Button>
        </View>
      </ListGroup>
    </View>
  )
}

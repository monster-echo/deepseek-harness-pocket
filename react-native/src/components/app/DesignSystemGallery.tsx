import React from 'react';
import { View } from 'react-native';
import {
  Bell,
  CheckCircle2,
  Camera,
  Cpu,
  FileText,
  Folder,
  Globe,
  Image as ImageIcon,
  MemoryStick,
  Monitor,
  Play,
  Plug,
  SquareCheck,
  Terminal,
  Wrench,
} from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import {
  ActionSheetContent,
  DeviceRow,
  IconBadge,
  ListGroup,
  ListRow,
  ListSeparator,
  SectionHeader,
  SegmentedControl,
  StatBar,
  type IconBadgeHue,
} from '@/components/app';

const LOGO = require('../../../assets/brand/logo.png'); // eslint-disable-line @typescript-eslint/no-require-imports

/**
 * 设计稿原语总览（`states.gallery` 里的一屏）。
 *
 * 目的：批次 1/2 每加一个原语都在这里挂一份，明/暗各看一次，
 * 避免视觉回归只靠单测（单测看不见颜色）。
 */
export function DesignSystemGallery() {
  const [segment, setSegment] = React.useState<'all' | 'running' | 'todo'>('all');
  const [toggle, setToggle] = React.useState(true);
  const [device, setDevice] = React.useState('mini');
  const [lastAction, setLastAction] = React.useState('—');

  return (
    <View className="gap-1">
      <SectionHeader>色板</SectionHeader>
      <View className="bg-card border-hairline flex-row flex-wrap gap-2 rounded-2xl border p-3">
        <Swatch className="bg-canvas" label="canvas" />
        <Swatch className="bg-card border-hairline border" label="card" />
        <Swatch className="bg-primary" label="primary" />
        <Swatch className="bg-accent-soft" label="accent-soft" />
        <Swatch className="bg-success" label="success" />
        <Swatch className="bg-warning" label="warning" />
        <Swatch className="bg-destructive" label="destructive" />
        <Swatch className="bg-muted" label="muted" />
        <Swatch className="bg-hairline" label="hairline" />
      </View>

      <SectionHeader>图标彩块</SectionHeader>
      <View className="bg-card border-hairline flex-row flex-wrap items-center gap-2 rounded-2xl border p-3">
        {(['blue', 'violet', 'orange', 'green', 'teal', 'red', 'neutral'] as const).map(
          (hue: IconBadgeHue) => (
            <View key={hue} className="items-center gap-1">
              <IconBadge as={Plug} hue={hue} size="lg" />
              <Text className="text-muted-foreground text-[10px]">{hue}</Text>
            </View>
          ),
        )}
      </View>

      <SectionHeader>分段控件</SectionHeader>
      <View className="gap-3">
        <SegmentedControl
          items={[
            { value: 'all', label: '全部', badge: 6 },
            { value: 'running', label: '运行中' },
            { value: 'todo', label: '需要处理', badge: 2 },
          ]}
          value={segment}
          onChange={setSegment}
        />
        <SegmentedControl
          items={[
            { value: 'all', label: '全部' },
            { value: 'running', label: '模型' },
            { value: 'todo', label: '工具' },
          ]}
          value={segment}
          onChange={setSegment}
        />
      </View>

      <SectionHeader>分组列表</SectionHeader>
      <ListGroup header="通用" footer="这是组尾说明文案，用于解释整组设置的影响。">
        <ListRow
          title="语言"
          leading={<IconBadge as={Globe} hue="blue" />}
          value="中文"
          showChevron
          onPress={() => setLastAction('语言')}
        />
        <ListSeparator />
        <ListRow
          title="外观"
          leading={<IconBadge as={Camera} hue="violet" />}
          value="跟随系统"
          showChevron
          onPress={() => setLastAction('外观')}
        />
        <ListSeparator />
        <ListRow
          title="任务完成推送"
          subtitle="任务完成时推送通知"
          leading={<IconBadge as={Bell} hue="orange" />}
          switchValue={toggle}
          onSwitchChange={setToggle}
        />
        <ListSeparator />
        <ListRow
          title="从账号移除 Worker"
          leading={<IconBadge as={Wrench} hue="red" />}
          danger
          showChevron
          onPress={() => setLastAction('移除')}
        />
      </ListGroup>
      <Text className="text-muted-foreground px-4 text-[13px]">最近点击：{lastAction}</Text>

      <SectionHeader>指标条</SectionHeader>
      <ListGroup>
        <View className="px-4">
          <StatBar icon={Cpu} label="CPU" value={0.32} valueLabel="32%" />
          <StatBar icon={MemoryStick} label="内存" tone="success" value={0.26} valueLabel="8.4 / 32 GB" />
        </View>
      </ListGroup>

      <SectionHeader>设备行</SectionHeader>
      <View className="gap-2">
        <DeviceRow
          image={LOGO}
          title="Mac mini"
          subtitle="macOS 14.6 · 8 核 16GB"
          status={{ label: '在线', tone: 'online' }}
          selected={device === 'mini'}
          onPress={() => setDevice('mini')}
        />
        <DeviceRow
          title="MacBook Pro"
          subtitle="macOS 14.5 · 空闲"
          status={{ label: '2 小时前在线', tone: 'offline' }}
          selected={device === 'mbp'}
          onPress={() => setDevice('mbp')}
        />
        <DeviceRow
          title="Cloud Worker"
          subtitle="正在检查…"
          status={{ label: '检查中', tone: 'pending' }}
          onPress={() => setDevice('cloud')}
        />
      </View>

      <SectionHeader>动作面板内容</SectionHeader>
      <ActionSheetContent
        footer="选择后会返回输入框，你仍可编辑内容"
        sections={[
          {
            title: '添加上下文',
            items: [
              { key: 'camera', label: '拍照', icon: Camera, hue: 'blue', cell: true, onPress: () => setLastAction('拍照') },
              { key: 'photo', label: '从相册选择', icon: ImageIcon, hue: 'blue', cell: true, onPress: () => setLastAction('相册') },
              { key: 'file', label: '上传文件', icon: FileText, hue: 'violet', cell: true, onPress: () => setLastAction('文件') },
              { key: 'ws', label: '工作区文件', icon: Folder, hue: 'violet', cell: true, onPress: () => setLastAction('工作区') },
            ],
          },
          {
            title: '让 Harness 执行',
            items: [
              { key: 'task', label: '创建任务', icon: SquareCheck, hue: 'green', cell: true, onPress: () => setLastAction('任务') },
              { key: 'goal', label: '设置目标', icon: Play, hue: 'orange', cell: true, onPress: () => setLastAction('目标') },
              { key: 'run', label: '运行指令', icon: Terminal, hue: 'neutral', cell: true, onPress: () => setLastAction('指令') },
            ],
          },
          {
            title: '会话',
            items: [
              { key: 'center', label: '运行中心', icon: Play, hue: 'green', onPress: () => setLastAction('运行中心') },
              { key: 'open', label: '在电脑上打开', icon: Monitor, hue: 'blue', onPress: () => setLastAction('电脑打开') },
            ],
          },
        ]}
      />

      <SectionHeader>其它</SectionHeader>
      <ListGroup>
        <ListRow
          title="图标 + 箭头（无彩块）"
          leading={<Icon as={CheckCircle2} className="text-success size-5" />}
          showChevron
        />
        <ListSeparator />
        <ListRow title="纯文本行" value="值" showChevron />
      </ListGroup>
    </View>
  );
}

function Swatch({ className, label }: Readonly<{ className: string; label: string }>) {
  return (
    <View className="items-center gap-1">
      <View className={cn('h-10 w-10 rounded-lg', className)} />
      <Text className="text-muted-foreground text-[10px]">{label}</Text>
    </View>
  );
}

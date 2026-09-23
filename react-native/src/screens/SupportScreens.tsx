import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Bell, ChevronRight, TriangleAlert } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import { AsyncState } from '../state/asyncState';
import { useApp } from '../state/AppStore';
import { useSupport } from '../support/SupportStore';
import { telemetry } from '../telemetry/Telemetry';

export function SupportHomeScreen() {
  const { navigate } = useApp();
  const { help, tickets, loadHome, openTicket } = useSupport();
  useEffect(() => { void loadHome(); }, [loadHome]);
  return (
    <View className="bg-background flex-1">
      <OfflineBanner />
      <ScreenHeader title="帮助与反馈" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <View className="gap-3">
          <Button
            className="min-h-[52px] w-full"
            onPress={() => {
              telemetry.track('ui_action', { action_id: 'support.new_ticket' });
              navigate('support.newTicket');
            }}
          >
            <Icon as={Bell} className="size-5" />
            <Text>联系客服</Text>
          </Button>
          <Button
            className="min-h-[52px] w-full"
            onPress={() => {
              telemetry.track('ui_action', { action_id: 'support.feedback' });
              navigate('support.feedback');
            }}
            variant="outline"
          >
            <Text>产品反馈</Text>
          </Button>
        </View>
        <Text className="text-muted-foreground ml-1 text-xs font-bold tracking-[0.6px]">我的工单</Text>
        <TicketList state={tickets} onOpen={(id) => void openTicket(id)} />
        <Text className="text-muted-foreground ml-1 text-xs font-bold tracking-[0.6px]">常见问题</Text>
        <HelpList state={help} onRetry={() => void loadHome()} />
      </ScrollView>
    </View>
  );
}

export function TicketDetailScreen() {
  const { detail, busy, reply } = useSupport();
  const [message, setMessage] = useState('');
  if (detail.status !== 'success') {
    return (
      <View className="bg-background flex-1">
        <ScreenHeader title="工单详情" />
        <StateMessage state={detail} />
      </View>
    );
  }
  const send = async () => {
    if (await reply(message)) setMessage('');
  };
  return (
    <SupportPage title="工单详情">
      <Card className="gap-0 py-0">
        <CardContent className="gap-3 py-4">
          <Text className="text-foreground text-xl font-bold">{detail.data.subject}</Text>
          <Text className="text-muted-foreground text-xs">
            {statusLabel(detail.data.status)} · {detail.data.queueId}
          </Text>
        </CardContent>
      </Card>
      {detail.data.messages.map((item) => (
        <Card key={item.id} className="gap-0 py-0">
          <CardContent className="gap-3 py-4">
            <Text className="text-muted-foreground text-xs">
              {item.authorType === 'user' ? '我' : '客服'} · {formatDate(item.createdAt)}
            </Text>
            <Text className="text-foreground text-base">{item.body}</Text>
          </CardContent>
        </Card>
      ))}
      <Textarea
        accessibilityLabel="回复内容"
        className="min-h-[132px] pt-4"
        maxLength={2000}
        onChangeText={setMessage}
        placeholder="继续补充问题"
        value={message}
      />
      <Button
        className="min-h-[52px] w-full"
        disabled={busy || !message.trim()}
        onPress={() => {
          telemetry.track('ui_action', { action_id: `button.${busy ? '发送中…' : '发送回复'}` });
          void send();
        }}
      >
        <Text>{busy ? '发送中…' : '发送回复'}</Text>
      </Button>
    </SupportPage>
  );
}

export function SupportPage({ title, children }: Readonly<{
  title: string;
  children: React.ReactNode;
}>) {
  return (
    <View className="bg-background flex-1">
      <OfflineBanner />
      <ScreenHeader title={title} />
      <ScrollView contentContainerClassName="gap-4 p-4">{children}</ScrollView>
    </View>
  );
}

function TicketList({ state, onOpen }: Readonly<{
  state: AsyncState<readonly { id: string; subject: string; status: string }[]>;
  onOpen: (id: string) => void;
}>) {
  if (state.status !== 'success') return <StateMessage state={state} />;
  return (
    <Card className="gap-0 py-0">
      <CardContent className="gap-3 py-4">
        {state.data.map((ticket) => (
          <Pressable
            key={ticket.id}
            className="border-border/50 active:bg-accent/50 min-h-[54px] flex-row items-center gap-3 border-b px-4"
            onPress={() => {
              telemetry.track('ui_action', { action_id: `row.${ticket.subject}` });
              onOpen(ticket.id);
            }}
          >
            <Text className="flex-1 text-base">{ticket.subject}</Text>
            <Text className="text-muted-foreground text-sm">{statusLabel(ticket.status)}</Text>
            <Icon as={ChevronRight} className="text-foreground size-[18px]" />
          </Pressable>
        ))}
      </CardContent>
    </Card>
  );
}

function HelpList({ state, onRetry }: Readonly<{
  state: AsyncState<readonly { id: string; title: string; body: string }[]>;
  onRetry: () => void;
}>) {
  if (state.status !== 'success') return <StateMessage state={state} onRetry={onRetry} />;
  return <>{state.data.map((article) => (
    <Card key={article.id} className="gap-0 py-0">
      <CardContent className="gap-3 py-4">
        <Text className="text-foreground text-xl font-bold">{article.title}</Text>
        <Text className="text-foreground text-base">{article.body}</Text>
      </CardContent>
    </Card>
  ))}</>;
}

function StateMessage<T>({ state, onRetry }: Readonly<{
  state: AsyncState<T>;
  onRetry?: () => void;
}>) {
  const message = state.status === 'loading' ? '加载中…'
    : state.status === 'empty' ? '暂无内容'
      : state.status === 'error' ? state.message : '请重新打开一个工单';
  return (
    <Card className="gap-0 py-0">
      <CardContent className="gap-3 py-4">
        <Text className="text-muted-foreground text-sm">{message}</Text>
        {onRetry && state.status === 'error'
          ? (
            <Button
              className="min-h-[52px] w-full"
              onPress={() => {
                telemetry.track('ui_action', { action_id: 'button.重试' });
                onRetry();
              }}
              variant="outline"
            >
              <Text>重试</Text>
            </Button>
          ) : null}
      </CardContent>
    </Card>
  );
}

function OfflineBanner() {
  const { online, refreshBootstrap } = useApp();
  if (online) return null;
  return (
    <Pressable
      accessibilityRole="button"
      className="bg-muted min-h-10 flex-row items-center justify-center gap-2 px-4"
      onPress={() => void refreshBootstrap()}
    >
      <Icon as={TriangleAlert} className="size-[18px]" />
      <Text className="text-xs font-semibold">当前离线，正在使用本地配置 · 点击重试</Text>
    </Pressable>
  );
}

function ScreenHeader({ title }: Readonly<{ title: string }>) {
  const navigation = useNavigation();
  return (
    <View className="border-border/60 h-[58px] flex-row items-center justify-between border-b px-2">
      <View className="w-[88px] items-start">
        {navigation.canGoBack() ? (
          <Button
            accessibilityLabel="返回"
            onPress={() => navigation.goBack()}
            size="icon"
            variant="ghost"
          >
            <Icon as={ArrowLeft} className="size-5" />
          </Button>
        ) : null}
      </View>
      <Text className="absolute left-[88px] right-[88px] text-center text-[17px] font-bold">
        {title}
      </Text>
      <View className="w-[88px] items-end" />
    </View>
  );
}

function statusLabel(status: string) {
  return {
    submitted: '已提交', triaged: '已分流', in_progress: '处理中',
    waiting_for_user: '等待回复', waiting_for_support: '等待客服',
    resolved: '已解决', closed: '已关闭',
  }[status] ?? status;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

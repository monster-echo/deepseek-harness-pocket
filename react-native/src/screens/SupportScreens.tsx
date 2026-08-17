import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  AppButton, AppCard, ListRow, OfflineBanner, PageHeader,
} from '../design-system/components';
import { AsyncState } from '../state/asyncState';
import { useApp } from '../state/AppStore';
import { useSupport } from '../support/SupportStore';
import { styles } from '../theme/styles';
import { spacing } from '../theme/tokens';

export function SupportHomeScreen() {
  const { navigate } = useApp();
  const { help, tickets, loadHome, openTicket } = useSupport();
  useEffect(() => { void loadHome(); }, [loadHome]);
  return (
    <View style={styles.page}>
      <OfflineBanner />
      <PageHeader title="帮助与反馈" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={localStyles.actions}>
          <AppButton
            analyticsId="support.new_ticket"
            icon="bell"
            label="联系客服"
            onPress={() => navigate('support.newTicket')}
          />
          <AppButton
            analyticsId="support.feedback"
            label="产品反馈"
            onPress={() => navigate('support.feedback')}
            variant="secondary"
          />
        </View>
        <Text style={styles.sectionLabel}>我的工单</Text>
        <TicketList state={tickets} onOpen={(id) => void openTicket(id)} />
        <Text style={styles.sectionLabel}>常见问题</Text>
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
      <View style={styles.page}>
        <PageHeader title="工单详情" />
        <StateMessage state={detail} />
      </View>
    );
  }
  const send = async () => {
    if (await reply(message)) setMessage('');
  };
  return (
    <SupportPage title="工单详情">
      <AppCard>
        <Text style={styles.heading}>{detail.data.subject}</Text>
        <Text style={styles.caption}>
          {statusLabel(detail.data.status)} · {detail.data.queueId}
        </Text>
      </AppCard>
      {detail.data.messages.map((item) => (
        <AppCard key={item.id}>
          <Text style={styles.caption}>
            {item.authorType === 'user' ? '我' : '客服'} · {formatDate(item.createdAt)}
          </Text>
          <Text style={styles.body}>{item.body}</Text>
        </AppCard>
      ))}
      <TextInput
        accessibilityLabel="回复内容"
        maxLength={2000}
        multiline
        onChangeText={setMessage}
        placeholder="继续补充问题"
        style={[styles.input, localStyles.multiline]}
        textAlignVertical="top"
        value={message}
      />
      <AppButton
        disabled={busy || !message.trim()}
        label={busy ? '发送中…' : '发送回复'}
        onPress={() => void send()}
      />
    </SupportPage>
  );
}

export function SupportPage({ title, children }: Readonly<{
  title: string;
  children: React.ReactNode;
}>) {
  return (
    <View style={styles.page}>
      <OfflineBanner />
      <PageHeader title={title} />
      <ScrollView contentContainerStyle={styles.scrollContent}>{children}</ScrollView>
    </View>
  );
}

function TicketList({ state, onOpen }: Readonly<{
  state: AsyncState<readonly { id: string; subject: string; status: string }[]>;
  onOpen: (id: string) => void;
}>) {
  if (state.status !== 'success') return <StateMessage state={state} />;
  return (
    <AppCard>
      {state.data.map((ticket) => (
        <ListRow
          key={ticket.id}
          label={ticket.subject}
          onPress={() => onOpen(ticket.id)}
          value={statusLabel(ticket.status)}
        />
      ))}
    </AppCard>
  );
}

function HelpList({ state, onRetry }: Readonly<{
  state: AsyncState<readonly { id: string; title: string; body: string }[]>;
  onRetry: () => void;
}>) {
  if (state.status !== 'success') return <StateMessage state={state} onRetry={onRetry} />;
  return <>{state.data.map((article) => (
    <AppCard key={article.id}>
      <Text style={styles.heading}>{article.title}</Text>
      <Text style={styles.body}>{article.body}</Text>
    </AppCard>
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
    <AppCard>
      <Text style={styles.secondary}>{message}</Text>
      {onRetry && state.status === 'error'
        ? <AppButton label="重试" onPress={onRetry} variant="secondary" /> : null}
    </AppCard>
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

const localStyles = StyleSheet.create({
  actions: { gap: spacing.x3 },
  multiline: { minHeight: 132, paddingTop: spacing.x4 },
});

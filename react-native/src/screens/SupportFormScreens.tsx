import React, { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { AppButton } from '../design-system/components';
import { SelectField } from '../design-system/SelectField';
import { useApp } from '../state/AppStore';
import { FeedbackScreenshots } from '../support/FeedbackScreenshots';
import type { FeedbackScreenshot } from '../support/FeedbackScreenshots';
import { useSupport } from '../support/SupportStore';
import { styles } from '../theme/styles';
import { SupportPage } from './SupportScreens';

export function NewTicketScreen() {
  const { config } = useApp();
  const { busy, createTicket } = useSupport();
  const [category, setCategory] = useState(config.support.categories[0]?.id ?? 'technical');
  const [severity, setSeverity] = useState<'normal' | 'high' | 'urgent'>('normal');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const valid = subject.trim().length >= 4 && message.trim().length >= 4;
  return (
    <SupportPage title="联系客服">
      <Text style={styles.heading}>告诉我们遇到了什么</Text>
      <Text style={styles.secondary}>请先填写问题内容，我们会根据描述安排处理。</Text>
      <TextInput
        accessibilityLabel="问题标题"
        maxLength={100}
        onChangeText={setSubject}
        placeholder="简要说明问题"
        style={styles.input}
        value={subject}
      />
      <TextInput
        accessibilityLabel="问题详情"
        maxLength={2000}
        multiline
        onChangeText={setMessage}
        placeholder="描述发生步骤、预期结果与实际结果，请勿填写密码或验证码"
        style={styles.input}
        textAlignVertical="top"
        value={message}
      />
      <Text style={styles.sectionLabel}>补充信息（可选）</Text>
      <SelectField
        label="问题分类"
        onChange={setCategory}
        options={config.support.categories.map((item) => ({
          value: item.id,
          label: item.label,
        }))}
        value={category}
      />
      <SelectField
        label="紧急程度"
        onChange={setSeverity}
        options={[
          { value: 'normal', label: '普通' },
          { value: 'high', label: '较高' },
          { value: 'urgent', label: '紧急' },
        ]}
        value={severity}
      />
      <AppButton
        disabled={!valid || busy}
        icon="check"
        label={busy ? '提交中…' : '提交工单'}
        onPress={() => void createTicket({ category, severity, subject, message })}
      />
    </SupportPage>
  );
}

export function ProductFeedbackScreen() {
  const { back } = useApp();
  const { busy, submitFeedback } = useSupport();
  const [category, setCategory] = useState<
    'suggestion' | 'experience' | 'feature_request' | 'other'
  >('suggestion');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [rating, setRating] = useState(5);
  const [screenshots, setScreenshots] = useState<readonly FeedbackScreenshot[]>([]);
  const submit = async () => {
    if (await submitFeedback({ category, title, body, rating, screenshots })) back();
  };
  const categories = [
    ['suggestion', '产品建议'], ['experience', '体验问题'],
    ['feature_request', '功能需求'], ['other', '其他'],
  ] as const;
  return (
    <SupportPage title="产品反馈">
      <Text style={styles.heading}>你的意见很重要</Text>
      <Text style={styles.secondary}>先写下想法或遇到的问题，分类与评分可以稍后选择。</Text>
      <TextInput
        accessibilityLabel="反馈标题"
        maxLength={100}
        onChangeText={setTitle}
        placeholder="反馈标题"
        style={styles.input}
        value={title}
      />
      <TextInput
        accessibilityLabel="反馈详情"
        maxLength={3000}
        multiline
        onChangeText={setBody}
        placeholder="告诉我们哪里可以做得更好"
        style={styles.input}
        textAlignVertical="top"
        value={body}
      />
      <FeedbackScreenshots value={screenshots} onChange={setScreenshots} />
      <Text style={styles.sectionLabel}>补充信息（可选）</Text>
      <SelectField
        label="反馈类型"
        onChange={setCategory}
        options={categories.map(([value, label]) => ({ value, label }))}
        value={category}
      />
      <SelectField
        label="体验评分"
        onChange={setRating}
        options={[5, 4, 3, 2, 1].map((value) => ({
          value,
          label: `${value} 分`,
        }))}
        value={rating}
      />
      <AppButton
        disabled={busy || title.trim().length < 4 || body.trim().length < 4}
        icon="check"
        label={busy ? '提交中…' : '提交反馈'}
        onPress={() => void submit()}
      />
    </SupportPage>
  );
}

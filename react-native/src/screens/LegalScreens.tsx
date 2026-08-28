import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppCard, ListRow, PageHeader } from '../design-system/components';
import {
  LegalDocument,
  privacyPolicy,
  subscriptionTerms,
  termsOfService,
} from '@deepseek-harness-pocket/legal';
import { usePreferences } from '../preferences/PreferencesProvider';
import { styles } from '../theme/styles';
import { radii, spacing } from '../theme/tokens';

export function LegalIndexScreen() {
  return (
    <View style={styles.page}>
      <PageHeader title="协议与政策" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heading}>透明、清晰地说明我们的规则</Text>
        <Text style={styles.secondary}>
          你可以分别查看隐私数据处理方式和使用服务时适用的条款。
        </Text>
        <AppCard>
          <ListRow
            label="隐私政策"
            route="settings.privacyPolicy"
            value="数据与隐私权利"
          />
          <ListRow
            label="用户协议"
            route="settings.termsOfService"
            value="账号与订阅规则"
          />
          <ListRow
            label="订阅与自动续期说明"
            route="settings.subscriptionTerms"
            value="付款、续期与取消规则"
          />
        </AppCard>
        <Text style={styles.caption}>生效日期：2026 年 7 月 30 日 · 简体中文</Text>
      </ScrollView>
    </View>
  );
}

export function PrivacyPolicyScreen() {
  return <LegalDocumentScreen document={privacyPolicy} />;
}

export function TermsOfServiceScreen() {
  return <LegalDocumentScreen document={termsOfService} />;
}

export function SubscriptionTermsScreen() {
  return <LegalDocumentScreen document={subscriptionTerms} />;
}

function LegalDocumentScreen({ document }: Readonly<{ document: LegalDocument }>) {
  const { palette } = usePreferences();
  return (
    <View style={styles.page}>
      <PageHeader title={document.title} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[legalStyles.hero, { backgroundColor: palette.brandSoft }]}>
          <Text style={styles.title}>{document.title}</Text>
          <Text style={styles.secondary}>生效日期：{document.effectiveDate}</Text>
          <Text style={styles.body}>{document.summary}</Text>
        </View>
        {document.sections.map((section) => (
          <View key={section.title} style={legalStyles.section}>
            <Text style={styles.heading}>{section.title}</Text>
            {section.paragraphs.map((paragraph) => (
              <Text key={paragraph} style={[styles.body, legalStyles.copy]}>{paragraph}</Text>
            ))}
            {section.bullets?.map((item) => (
              <View key={item} style={legalStyles.bulletRow}>
                <View style={[legalStyles.bullet, { backgroundColor: palette.brand }]} />
                <Text style={[styles.body, legalStyles.bulletText]}>{item}</Text>
              </View>
            ))}
          </View>
        ))}
        <Text style={styles.caption}>文档版本：2026-07-30 · zh-CN</Text>
      </ScrollView>
    </View>
  );
}

const legalStyles = StyleSheet.create({
  hero: {
    borderRadius: radii.card,
    padding: spacing.x5,
    gap: spacing.x3,
  },
  section: { gap: spacing.x3, paddingVertical: spacing.x2 },
  copy: { lineHeight: 25 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.x3 },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: radii.round,
    marginTop: 9,
  },
  bulletText: { flex: 1, lineHeight: 25 },
});

import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, ChevronRight } from 'lucide-react-native';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import {
  LegalDocument,
  privacyPolicy,
  subscriptionTerms,
  termsOfService,
} from '@deepseek-harness-pocket/legal';
import { AppRoute } from '../navigation/routes';
import { useApp } from '../state/AppStore';
import { telemetry } from '../telemetry/Telemetry';

export function LegalIndexScreen() {
  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="协议与政策" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Text className="text-foreground text-xl font-bold">透明、清晰地说明我们的规则</Text>
        <Text className="text-muted-foreground text-sm">
          你可以分别查看隐私数据处理方式和使用服务时适用的条款。
        </Text>
        <Card className="gap-0 py-0">
          <CardContent className="gap-3 py-4">
            <LegalRow
              label="隐私政策"
              route="settings.privacyPolicy"
              value="数据与隐私权利"
            />
            <LegalRow
              label="用户协议"
              route="settings.termsOfService"
              value="账号与订阅规则"
            />
            <LegalRow
              label="订阅与自动续期说明"
              route="settings.subscriptionTerms"
              value="付款、续期与取消规则"
            />
          </CardContent>
        </Card>
        <Text className="text-muted-foreground text-xs">生效日期：2026 年 7 月 30 日 · 简体中文</Text>
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
  return (
    <View className="bg-background flex-1">
      <ScreenHeader title={document.title} />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <View className="bg-muted gap-3 rounded-2xl p-5">
          <Text className="text-foreground text-[28px] font-bold">{document.title}</Text>
          <Text className="text-muted-foreground text-sm">生效日期：{document.effectiveDate}</Text>
          <Text className="text-foreground text-base">{document.summary}</Text>
        </View>
        {document.sections.map((section) => (
          <View key={section.title} className="gap-3 py-2">
            <Text className="text-foreground text-xl font-bold">{section.title}</Text>
            {section.paragraphs.map((paragraph) => (
              <Text key={paragraph} className="text-foreground text-base leading-[25px]">
                {paragraph}
              </Text>
            ))}
            {section.bullets?.map((item) => (
              <View key={item} className="flex-row items-start gap-3">
                <View className="bg-primary mt-[9px] h-1.5 w-1.5 rounded-full" />
                <Text className="text-foreground flex-1 text-base leading-[25px]">{item}</Text>
              </View>
            ))}
          </View>
        ))}
        <Text className="text-muted-foreground text-xs">文档版本：2026-07-30 · zh-CN</Text>
      </ScrollView>
    </View>
  );
}

function LegalRow({
  label,
  route,
  value,
}: Readonly<{ label: string; route: AppRoute; value: string }>) {
  const { navigate } = useApp();
  return (
    <Pressable
      className="border-border/50 active:bg-accent/50 min-h-[54px] flex-row items-center gap-3 border-b px-4"
      onPress={() => {
        telemetry.track('ui_action', { action_id: route });
        navigate(route);
      }}
    >
      <Text className="flex-1 text-base">{label}</Text>
      <Text className="text-muted-foreground text-sm">{value}</Text>
      <Icon as={ChevronRight} className="text-foreground size-[18px]" />
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

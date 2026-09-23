/**
 * Worker 配置（设置类）：对齐 Web 的 Models / Plugins 设置面板。
 *
 * 数据来自 Worker 的 settings / credentials 服务：
 *   - 凭据只展示记录地址与类型（宿主从不下发秘密值）
 *   - 设置命名空间展示生效时机、是否被用户层覆盖、当前值预览（秘密字段已由宿主打码）
 *
 * 可写能力：
 *   - 凭据：设置 / 更新 / 删除 API Key（走 credentials.set/unset）
 *   - 设置命名空间：JSON 写回 + CAS 修订号校验（走 settings.update）
 * 含密钥字段的命名空间一律只读——打码占位值回写会覆盖真实密钥，那类密钥走凭据区。
 */
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Eye, EyeOff, KeyRound, Plus, Trash2 } from 'lucide-react-native';
import { ScreenHeader } from '@/components/app/screen-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import { useDshStore } from '../state/dshStore';

export function WorkerConfigScreen() {
  const sections = useDshStore((s) => s.workerSections);
  const credentials = useDshStore((s) => s.workerCredentials);
  const loadWorkerConfig = useDshStore((s) => s.loadWorkerConfig);
  const setCredential = useDshStore((s) => s.setCredential);
  const unsetCredential = useDshStore((s) => s.unsetCredential);
  const updateSetting = useDshStore((s) => s.updateSetting);
  // 编辑态：ref 为空串表示「新增」，null 表示未在编辑
  const [editingRef, setEditingRef] = useState<string | null>(null);
  const [draftRef, setDraftRef] = useState('');
  const [draftValue, setDraftValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  // 命名空间编辑态
  const [editingNs, setEditingNs] = useState<string | null>(null);
  const [draftJson, setDraftJson] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    void loadWorkerConfig();
  }, [loadWorkerConfig]);

  const beginEdit = (ref: string): void => {
    setEditingRef(ref);
    setDraftRef(ref);
    setDraftValue('');
    setReveal(false);
  };

  const cancelEdit = (): void => {
    setEditingRef(null);
    setDraftRef('');
    setDraftValue('');
    setReveal(false);
  };

  const save = async (): Promise<void> => {
    const ref = draftRef.trim();
    if (ref.length === 0 || draftValue.length === 0) return;
    setBusy(true);
    const ok = await setCredential(ref, draftValue);
    setBusy(false);
    // 无论成败都清掉本地明文
    setDraftValue('');
    if (ok) cancelEdit();
  };

  const remove = (ref: string): void => {
    void unsetCredential(ref);
  };

  const beginEditNs = (ns: string, valueJson: string): void => {
    setEditingNs(ns);
    setDraftJson(valueJson);
    setEditError(null);
  };

  const saveNs = async (revision: number): Promise<void> => {
    if (editingNs === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(draftJson);
    } catch {
      setEditError('JSON 格式不合法，请检查后再保存');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setEditError('配置必须是 JSON 对象');
      return;
    }
    setBusy(true);
    const result = await updateSetting(editingNs, parsed as Record<string, unknown>, revision);
    setBusy(false);
    if (result === null) {
      setEditingNs(null);
      setEditError(null);
      return;
    }
    setEditError(
      result === 'error'
        ? '写入被拒绝：请确认字段符合该命名空间的 schema'
        : `已被其他端修改（当前修订 ${result}），请刷新后重试`,
    );
  };

  return (
    <View className="bg-background flex-1">
      <ScreenHeader title="Worker 配置" />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <View className="gap-2">
          <Text className="text-muted-foreground text-xs font-bold">
            凭据（{credentials.length}）
          </Text>
          <View className="border-border/60 bg-card overflow-hidden rounded-xl border">
            {credentials.length === 0 ? (
              <Text className="text-muted-foreground p-3 text-sm">
                这台电脑还没有登记任何凭据
              </Text>
            ) : (
              credentials.map((record) => (
                <View key={record.key} className="border-border/50 border-b">
                  <View className="flex-row items-center gap-2 px-3 py-2.5">
                    <Icon as={KeyRound} className="text-muted-foreground size-[13px]" />
                    <Text className="text-foreground flex-1 font-mono text-xs" numberOfLines={1}>
                      {record.key}
                    </Text>
                    {record.configured ? (
                      <Badge variant="secondary">
                        <Text>{record.source ?? '已配置'}</Text>
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <Text>未配置</Text>
                      </Badge>
                    )}
                  </View>
                  <View className="flex-row justify-end gap-2 px-3 pb-2.5">
                    {record.writable && (
                      <Button size="sm" variant="outline" onPress={() => beginEdit(record.key)}>
                        <Text>{record.configured ? '更新密钥' : '设置密钥'}</Text>
                      </Button>
                    )}
                    {record.configured && (
                      <Button size="sm" variant="ghost" onPress={() => remove(record.key)}>
                        <Icon as={Trash2} className="text-destructive size-3.5" />
                        <Text className="text-destructive">删除</Text>
                      </Button>
                    )}
                  </View>
                </View>
              ))
            )}
          </View>
          <Button variant="outline" onPress={() => beginEdit('')}>
            <Icon as={Plus} className="size-4" />
            <Text>新增 / 更新密钥</Text>
          </Button>

          {editingRef !== null && (
            <View className="border-primary/40 gap-2 rounded-xl border p-3">
              <Text className="text-muted-foreground text-[11px]">
                凭据地址格式为 <Text className="font-mono">{'<插件>/<id>'}</Text>，
                例如 deepseek-api/deepseek。写入后立即生效于这台电脑。
              </Text>
              <Input
                autoCapitalize="none"
                autoCorrect={false}
                editable={editingRef === ''}
                placeholder="deepseek-api/deepseek"
                value={draftRef}
                onChangeText={setDraftRef}
              />
              <View className="flex-row items-center gap-2">
                <Input
                  className="flex-1"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="粘贴 API Key"
                  secureTextEntry={!reveal}
                  value={draftValue}
                  onChangeText={setDraftValue}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={reveal ? '隐藏密钥' : '显示密钥'}
                  className="p-2"
                  hitSlop={6}
                  onPress={() => setReveal((v) => !v)}
                >
                  <Icon as={reveal ? EyeOff : Eye} className="text-muted-foreground size-4" />
                </Pressable>
              </View>
              <View className="flex-row justify-end gap-2">
                <Button size="sm" variant="ghost" onPress={cancelEdit}>
                  <Text className="text-muted-foreground">取消</Text>
                </Button>
                <Button
                  size="sm"
                  disabled={busy || draftRef.trim().length === 0 || draftValue.length === 0}
                  onPress={() => void save()}
                >
                  <Text>{busy ? '保存中…' : '保存到电脑'}</Text>
                </Button>
              </View>
            </View>
          )}

          <Text className="text-muted-foreground text-[11px]">
            只显示凭据地址与来源；密钥值保存在你的电脑上，不会下发到手机。
          </Text>
        </View>

        <View className="gap-2">
          <Text className="text-muted-foreground text-xs font-bold">
            设置命名空间（{sections.length}）
          </Text>
          {sections.length === 0 && (
            <Text className="text-muted-foreground text-sm">
              没有可读的设置（需要活跃 Worker）
            </Text>
          )}
          {sections.map((section) => (
            <View
              key={section.ns}
              className="border-border/60 bg-card gap-1.5 rounded-xl border p-3"
            >
              <View className="flex-row items-center gap-2">
                <Text className="text-foreground flex-1 font-mono text-xs font-semibold" numberOfLines={1}>
                  {section.ns}
                </Text>
                {section.overridden && (
                  <Badge variant="secondary">
                    <Text>已覆盖</Text>
                  </Badge>
                )}
              </View>
              <Text className="text-muted-foreground text-[11px]">
                生效时机 {section.applies} · 修订 {section.revision}
              </Text>
              <Text className="text-muted-foreground font-mono text-[11px] leading-[16px]" numberOfLines={4}>
                {section.preview}
              </Text>
              {section.editable && section.valueJson !== undefined && (
                <View className="flex-row justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={() => beginEditNs(section.ns, section.valueJson!)}
                  >
                    <Text>{editingNs === section.ns ? '编辑中…' : '编辑'}</Text>
                  </Button>
                </View>
              )}
              {editingNs === section.ns && (
                <View className="border-primary/40 mt-1 gap-2 rounded-xl border p-2">
                  <Textarea
                    className="min-h-[120px] font-mono text-[11px]"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={draftJson}
                    onChangeText={setDraftJson}
                    numberOfLines={8}
                  />
                  {editError !== null && (
                    <Text className="text-destructive text-[11px]">{editError}</Text>
                  )}
                  <View className="flex-row justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        setEditingNs(null);
                        setEditError(null);
                      }}
                    >
                      <Text className="text-muted-foreground">取消</Text>
                    </Button>
                    <Button size="sm" disabled={busy} onPress={() => void saveNs(section.revision)}>
                      <Text>{busy ? '写入中…' : '写回电脑'}</Text>
                    </Button>
                  </View>
                  <Text className="text-muted-foreground text-[10.5px]">
                    只发送你改动的字段；写入前会校验修订号（当前 {section.revision}），
                    避免覆盖其他端的修改。
                  </Text>
                </View>
              )}
            </View>
          ))}
        </View>

        <Text className="text-muted-foreground text-[11px]">
          含密钥字段的命名空间在手机上只读（避免打码占位值覆盖真实密钥），请用上方凭据页管理密钥。Agent 预设创作将在后续版本支持。
        </Text>
      </ScrollView>
    </View>
  );
}

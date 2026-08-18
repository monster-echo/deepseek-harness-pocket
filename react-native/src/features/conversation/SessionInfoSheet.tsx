/**
 * 会话信息 Sheet（#21）：当前会话的完整统计。
 * 数据来自 reducer 从 dsh 事件流解析的 sessionView.stats；缺失字段显示「—」。
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sheet } from '../../design-system/Sheet';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { useDshStore } from '../../state/dshStore';
import { spacing } from '../../theme/tokens';

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function dash(n: number, suffix = ''): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  const v = n < 10 && Math.floor(n) !== n ? n.toFixed(1) : Math.round(n)
  return `${v}${suffix}`
}

function ms(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1000) return `${Math.round(n)}ms`
  const s = n / 1000
  return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`
}

export function SessionInfoSheet(props: Readonly<{ visible: boolean; onClose: () => void }>): React.JSX.Element {
  const { palette } = usePreferences()
  const stats = useDshStore((s) => s.sessionView.stats)
  const totalUsage = useDshStore((s) => s.sessionView.totalUsage)

  const rows: ReadonlyArray<{ label: string; value: string }> = [
    { label: '轮数', value: dash(stats.turns) },
    { label: '步数', value: dash(stats.steps) },
    { label: 'LLM 耗时', value: ms(stats.lastTurnMs) },
    { label: '首 token 平均', value: ms(stats.firstTokenMs) },
    { label: '输出速率', value: dash(stats.tokPerSec, ' tok/s') },
    { label: '缓存命中', value: Number.isFinite(stats.cacheHitPct) ? `${Math.round(stats.cacheHitPct)}%` : '—' },
    { label: '回合输入', value: compact(stats.turnInput) + ' tok' },
    { label: '回合输出', value: compact(stats.turnOutput) + ' tok' },
    { label: '累计输入', value: compact(totalUsage.input) + ' tok' },
    { label: '累计输出', value: compact(totalUsage.output) + ' tok' },
  ]

  return (
    <Sheet visible={props.visible} title="会话信息" onClose={props.onClose} snapPoints={['50%', '80%']}>
      <View style={[styles.card, { backgroundColor: palette.surfaceMuted }]}>
        {rows.map((row) => (
          <View key={row.label} style={[styles.row, { borderBottomColor: palette.border }]}>
            <Text style={[styles.label, { color: palette.textSecondary }]}>{row.label}</Text>
            <Text style={[styles.value, { color: palette.text, fontFamily: 'Menlo' }]}>{row.value}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.hint, { color: palette.textSecondary }]}>
        统计来自当前会话最近一回合（缺失字段因 dsh 事件未下发显示 —）。
      </Text>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, paddingHorizontal: spacing.x4, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.x2, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 14 },
  value: { fontSize: 14 },
  hint: { fontSize: 12, marginTop: spacing.x3, textAlign: 'center' },
})

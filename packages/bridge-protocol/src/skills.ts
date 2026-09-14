/**
 * 技能目录（对齐 Web 的 `/` skill source）。
 *
 * 宿主侧 `ctx.skills.list()` 返回技能元信息；`invocation` 决定该技能
 * 是否可被模型调用 / 用户调用（Web 的 "user-only" 标记）。
 */

export interface SkillInfo {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  /** 模型可自行调用 */
  readonly modelInvocable: boolean
  /** 用户可用 `/name` 调用 */
  readonly userInvocable: boolean
  readonly provider: string
}

/** 宽松解析技能列表；整体非法返回 null，单条非法跳过。 */
export function parseSkills(value: unknown): readonly SkillInfo[] | null {
  if (!Array.isArray(value)) return null
  const skills: SkillInfo[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const s = raw as Record<string, unknown>
    if (typeof s['name'] !== 'string' || s['name'].length === 0) continue
    const invocation = (s['invocation'] ?? {}) as Record<string, unknown>
    skills.push({
      name: s['name'],
      description: typeof s['description'] === 'string' ? s['description'] : '',
      ...(typeof s['whenToUse'] === 'string' && s['whenToUse'].length > 0 ? { whenToUse: s['whenToUse'] } : {}),
      modelInvocable: invocation['modelInvocable'] !== false,
      userInvocable: invocation['userInvocable'] !== false,
      provider: typeof s['provider'] === 'string' ? s['provider'] : '',
    })
  }
  return skills
}

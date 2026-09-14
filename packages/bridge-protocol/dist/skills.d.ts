/**
 * 技能目录（对齐 Web 的 `/` skill source）。
 *
 * 宿主侧 `ctx.skills.list()` 返回技能元信息；`invocation` 决定该技能
 * 是否可被模型调用 / 用户调用（Web 的 "user-only" 标记）。
 */
export interface SkillInfo {
    readonly name: string;
    readonly description: string;
    readonly whenToUse?: string;
    /** 模型可自行调用 */
    readonly modelInvocable: boolean;
    /** 用户可用 `/name` 调用 */
    readonly userInvocable: boolean;
    readonly provider: string;
}
/** 宽松解析技能列表；整体非法返回 null，单条非法跳过。 */
export declare function parseSkills(value: unknown): readonly SkillInfo[] | null;

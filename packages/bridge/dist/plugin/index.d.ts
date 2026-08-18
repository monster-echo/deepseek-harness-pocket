/**
 * deepseek-harness-pocket 桥接插件（mobile/v1 协议服务端）。
 *
 * 安装（轻模式）：在目标 profile 里
 *   dsh plugin add @deepseek-harness-pocket/bridge
 * 或 cordis.patch.yml 手工插入（见 cordis.example.yml）。
 *
 * 形态遵循 dsh 插件规范：命名导出 name/inject/Config/apply，不用默认导出。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type PluginConfig } from './config.js';
export declare const name = "deepseek-harness-pocket-bridge";
/** sessions 为核心依赖；persistence/agents/approval 等经 ctx.get 优雅降级。 */
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
    listen: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
        host: import("@deepseek-ai/schemastery").default<string, string>;
        port: import("@deepseek-ai/schemastery").default<number, number>;
    }>, Schemastery.ObjectT<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
        host: import("@deepseek-ai/schemastery").default<string, string>;
        port: import("@deepseek-ai/schemastery").default<number, number>;
    }>>;
    gateway: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
        url: import("@deepseek-ai/schemastery").default<string, string>;
        hostKey: import("@deepseek-ai/schemastery").default<string, string>;
        reconnectMinMs: import("@deepseek-ai/schemastery").default<number, number>;
        reconnectMaxMs: import("@deepseek-ai/schemastery").default<number, number>;
    }>, Schemastery.ObjectT<{
        url: import("@deepseek-ai/schemastery").default<string, string>;
        hostKey: import("@deepseek-ai/schemastery").default<string, string>;
        reconnectMinMs: import("@deepseek-ai/schemastery").default<number, number>;
        reconnectMaxMs: import("@deepseek-ai/schemastery").default<number, number>;
    }>>;
    caps: import("@deepseek-ai/schemastery").default<"m1" | "m2" | "m3", "m1" | "m2" | "m3">;
    stateFile: import("@deepseek-ai/schemastery").default<string, string>;
    name: import("@deepseek-ai/schemastery").default<string, string>;
    readOnly: import("@deepseek-ai/schemastery").default<boolean, boolean>;
}>, Schemastery.ObjectT<{
    listen: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
        host: import("@deepseek-ai/schemastery").default<string, string>;
        port: import("@deepseek-ai/schemastery").default<number, number>;
    }>, Schemastery.ObjectT<{
        enabled: import("@deepseek-ai/schemastery").default<boolean, boolean>;
        host: import("@deepseek-ai/schemastery").default<string, string>;
        port: import("@deepseek-ai/schemastery").default<number, number>;
    }>>;
    gateway: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
        url: import("@deepseek-ai/schemastery").default<string, string>;
        hostKey: import("@deepseek-ai/schemastery").default<string, string>;
        reconnectMinMs: import("@deepseek-ai/schemastery").default<number, number>;
        reconnectMaxMs: import("@deepseek-ai/schemastery").default<number, number>;
    }>, Schemastery.ObjectT<{
        url: import("@deepseek-ai/schemastery").default<string, string>;
        hostKey: import("@deepseek-ai/schemastery").default<string, string>;
        reconnectMinMs: import("@deepseek-ai/schemastery").default<number, number>;
        reconnectMaxMs: import("@deepseek-ai/schemastery").default<number, number>;
    }>>;
    caps: import("@deepseek-ai/schemastery").default<"m1" | "m2" | "m3", "m1" | "m2" | "m3">;
    stateFile: import("@deepseek-ai/schemastery").default<string, string>;
    name: import("@deepseek-ai/schemastery").default<string, string>;
    readOnly: import("@deepseek-ai/schemastery").default<boolean, boolean>;
}>>;
export declare function apply(ctx: Context, config: PluginConfig): void;

/**
 * 插件配置（schemastery）。
 *
 * cordis.patch.yml / profile 配置示例：
 *   - id: deepseek-harness-pocket-bridge
 *     name: '@deepseek-harness-pocket/bridge'
 *     config:
 *       listen:
 *         host: 0.0.0.0
 *         port: 3780
 *       gateway:
 *         url: wss://gateway.example.com
 */
import z from '@deepseek-ai/schemastery';
export declare const pluginConfig: z<Schemastery.ObjectS<{
    /** 直连模式：自起 http/ws server（独立端口，不依赖 ctx.webServer） */
    listen: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        host: z<string, string>;
        port: z<number, number>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        host: z<string, string>;
        port: z<number, number>;
    }>>;
    /** uplink 模式：反向连接 gateway */
    gateway: z<Schemastery.ObjectS<{
        url: z<string, string>;
        /** 由 dshc 生成并注入，避免与状态文件双源 */
        hostKey: z<string, string>;
        reconnectMinMs: z<number, number>;
        reconnectMaxMs: z<number, number>;
    }>, Schemastery.ObjectT<{
        url: z<string, string>;
        /** 由 dshc 生成并注入，避免与状态文件双源 */
        hostKey: z<string, string>;
        reconnectMinMs: z<number, number>;
        reconnectMaxMs: z<number, number>;
    }>>;
    /** 能力面：按里程碑声明，handshake 下发给 app */
    caps: z<"m1" | "m2" | "m3", "m1" | "m2" | "m3">;
    /** 状态文件路径（hostKey/pairingToken） */
    stateFile: z<string, string>;
    /** Worker 显示名（默认取 hostname） */
    name: z<string, string>;
    /** 禁用一切写操作（只读模式开关） */
    readOnly: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    /** 直连模式：自起 http/ws server（独立端口，不依赖 ctx.webServer） */
    listen: z<Schemastery.ObjectS<{
        enabled: z<boolean, boolean>;
        host: z<string, string>;
        port: z<number, number>;
    }>, Schemastery.ObjectT<{
        enabled: z<boolean, boolean>;
        host: z<string, string>;
        port: z<number, number>;
    }>>;
    /** uplink 模式：反向连接 gateway */
    gateway: z<Schemastery.ObjectS<{
        url: z<string, string>;
        /** 由 dshc 生成并注入，避免与状态文件双源 */
        hostKey: z<string, string>;
        reconnectMinMs: z<number, number>;
        reconnectMaxMs: z<number, number>;
    }>, Schemastery.ObjectT<{
        url: z<string, string>;
        /** 由 dshc 生成并注入，避免与状态文件双源 */
        hostKey: z<string, string>;
        reconnectMinMs: z<number, number>;
        reconnectMaxMs: z<number, number>;
    }>>;
    /** 能力面：按里程碑声明，handshake 下发给 app */
    caps: z<"m1" | "m2" | "m3", "m1" | "m2" | "m3">;
    /** 状态文件路径（hostKey/pairingToken） */
    stateFile: z<string, string>;
    /** Worker 显示名（默认取 hostname） */
    name: z<string, string>;
    /** 禁用一切写操作（只读模式开关） */
    readOnly: z<boolean, boolean>;
}>>;
/** 与 schema 对应的手写类型（schemastery 无 infer 辅助）。 */
export interface PluginConfig {
    listen: {
        enabled: boolean;
        host: string;
        port: number;
    };
    gateway: {
        url: string;
        hostKey: string;
        reconnectMinMs: number;
        reconnectMaxMs: number;
    };
    caps: 'm1' | 'm2' | 'm3';
    stateFile: string;
    name: string;
    readOnly: boolean;
}

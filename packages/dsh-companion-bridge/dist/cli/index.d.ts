#!/usr/bin/env node
/**
 * dshc — DSH Companion Worker CLI。
 *
 * 用法：
 *   dshc install [--gateway wss://…]     安装开机自启（launchd / systemd user）
 *   dshc uninstall                       移除自启
 *   dshc start [--gateway wss://…] [--port 3780] [--host 0.0.0.0]
 *        [--caps m1|m2|m3] [--name <名称>] [--dsh <路径>] [--detached]
 *                                        拉起并守护 dsh（companion profile），打印配对码
 *   dshc stop                            停止 supervisor 与 dsh
 *   dshc status                          查看运行状态
 *   dshc token                           rotate 配对 token 与配对码
 *   dshc qr [--gateway wss://…]          重新打印配对二维码
 */
export {};

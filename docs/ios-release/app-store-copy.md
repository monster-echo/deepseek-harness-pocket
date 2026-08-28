# 掌鲸 DSH Pocket — App Store 提交文案与披露

> 供 App Store Connect 表单直接粘贴使用。法务文档公网地址见文末「提交核对清单」。

## 一、审批链路披露（必读）

**产品行为（代码事实，`packages/bridge/src/plugin/hub.ts:531-539`、`adapter-dsh.ts:775-781`）：**
工具调用审批请求会推送到手机；以下任一情况，审批交还给你电脑上 DeepSeek Harness
的原有审批流程（Web 控制台确认，或按其默认安全策略处理），手机端不会单方面允许或拒绝：

1. 手机不在线（App 未连接 gateway）；
2. 手机 30 秒内未做出决策；
3. worker 重启/停止时存在未决审批。

**简体中文披露（用于 App 描述尾部 / 审核备注）：**

> 安全提示：掌鲸通过你自行部署的中转服务连接你电脑上的 AI 助手。涉及敏感操作时，
> 电脑端会向你发送审批请求。若手机不在线或你未在 30 秒内响应，审批将交还给你电脑上
> DeepSeek Harness 的原有审批流程处理，掌鲸不会代替你自动允许或拒绝任何操作。

**English disclosure:**

> Safety note: DSH Pocket connects to the AI assistant running on your own computer
> through a gateway service you deploy. For sensitive operations, your computer sends an
> approval request to your phone. If the phone is offline or you do not respond within 30
> seconds, the approval falls back to the original approval flow of DeepSeek Harness on
> your computer. DSH Pocket never automatically allows or denies operations on your behalf.

## 二、App 描述（中文，ASC「描述」字段）

掌鲸（DSH Pocket）是你电脑上 AI 助手的随身遥控器。

在手机上：
• 随时随地与运行在电脑上的 DSH 会话对话，上下文完全同步；
• 敏感工具调用实时推送到手机，一键允许或拒绝；
• 浏览电脑端工作区产生的作品（网页、代码、文件），全屏预览；
• 拍照或从相册选取图片发送给会话，支持视觉理解模型。

安全与隐私：
• 连接你自行部署的中转服务与电脑助手，数据不经第三方；
• 登录支持 Sign in with Apple；
• 审批请求若超时或离线，交还电脑端原有流程，详见应用内「协议与政策」。

需要：一台运行 DeepSeek Harness 的电脑，以及对应的中转服务账号。

## 三、版本发布说明（v1.0.0，ASC「What's New」）

首个公开版本：远程会话、实时审批、作品预览、图片理解。

## 四、审核备注（App Review Notes，中英）

本应用是 DeepSeek Harness（开发者自有开源 AI 助手框架）的移动客户端，需连接用户自行
部署的服务端才能使用。审核时若无可用后端，可使用演示账号连接我们的演示环境：

- Demo Account：（提交前填写演示账号）
- 演示环境说明：（提交前填写）

This app is a mobile client for DeepSeek Harness, an AI assistant framework running on the
user's own computer. A user-deployed backend is required. Demo credentials for review:
(see above).

## 五、提交核对清单（发布前逐项打勾）

- [ ] 隐私政策 URL：`https://dsh-pocket.zhongbei.tech/legal/privacy`（gateway 部署后验证可公网访问）
- [ ] 用户协议 URL：`https://dsh-pocket.zhongbei.tech/legal/terms`
- [ ] 订阅说明 URL：`https://dsh-pocket.zhongbei.tech/legal/subscription`
- [ ] 隐私营养标签问卷：按 `@deepseek-harness-pocket/legal` 隐私政策第 2 节勾选数据类型
- [ ] 审批链路披露（上文第一节）粘贴至 App 描述尾部与审核备注
- [ ] 演示账号就绪（审核员需能连上后端体验核心流程）
- [ ] 截图：6.7" 与 5.5"（或 6.5"）两套，可用 Maestro 流程截取
- [ ] ASC API Key（.p8）+ `eas.json submit` + TestFlight 提交
- [ ] 显式 App ID 专属 profile（Associated Domains + Sign In with Apple 能力）

## 附：本目录文档与代码的对应关系

| 文档 | 代码位置 |
| --- | --- |
| 审批超时/离线回退 | `packages/bridge/src/plugin/hub.ts`（registerApproval/dispose）、`packages/bridge/src/plugin/adapter-dsh.ts`（30s 超时交还瀑布） |
| 隐私政策/协议/订阅文案 | `packages/legal/src/index.ts`（App 内嵌与公网页面同源） |
| 公网页面路由 | `gateway/src/app/legal/` |

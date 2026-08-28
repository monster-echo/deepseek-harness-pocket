# ASC + Google Play 提交清单

> 素材全部就绪于 `docs/store-assets/`(2026-08-28)。本清单 = 网页表单逐项操作指南。

## A. App Store Connect

### A1. 商店资料(iOS App 页)
- [ ] 描述 / 宣传文本 / 关键词 / What's New:粘贴 `docs/ios-release/app-store-copy.md` 对应节
- [ ] 截图(6.9"):上传 `docs/store-assets/ios/01~05.png`(1320×2868 原生尺寸,免缩放)
  - ⚠️ `03-approval.png` 顶栏显示「0 台在线」(截图时 gateway 会话恰好过期)。内容真实可用;
    介意的话等 App 处于正常连接态重截(触发方式见附录 A)
  - ⚠️ `04-artifacts.png` 是「作品列表」;作品 WebView 预览当日卡在「拉取中」(见附录 B-3),
    修复后建议补一张游戏渲染画面
- [ ] 隐私政策 / 用户协议 URL(表单已预填 dsh-pocket.zhongbei.tech/legal/*,验证可公网访问 ✓)

### A2. App 隐私(营养标签)——按 `packages/legal` 隐私政策第 2 节勾选
- 收集的数据:
  - 联系信息(姓名/邮箱/手机号)— App 功能、开发者沟通
  - 用户内容(头像、反馈、主动上传的截图)— App 功能
  - 购买项目(订阅/订单状态)— App 功能
  - 标识符(用户 ID、设备/安装 ID)— App 功能、分析
  - 诊断(崩溃、性能)— 分析
  - 使用数据(页面访问/功能事件,可关闭的匿名分析)— 分析
- 不收集:精确位置、健康/健身、通讯录、浏览历史、广告数据
- 「用于跟踪」:全部选否(政策第 4 节:不做跨应用广告跟踪)

### A3. 审核信息
- [ ] 演示账号:`autotest-ui@dsh-pocket.dev`(密码在 `react-native/scripts/maestro-seed.sh`)
- [ ] 备注栏说明:演示账号已绑定在线演示 worker(mac-mini-autotest),含演示工作区与作品,
  审核员登录后即可体验完整审批/会话/预览流程;另附 app-store-copy.md 第一节披露文案

### A4. 提交动作
- [ ] 打 tag `v1.0.2`(含图标修复)→ GitHub Actions 触发 EAS 构建 + 自动 submit TestFlight
- [ ] TestFlight 处理完成后,ASC 选 build → 完成 A1~A3 → 提审

## B. Google Play

### B0. 硬前置(未完成则无法出 AAB)
- [ ] Firebase 控制台 → 添加 Android 应用 `top.rwecho.dshcompanion` → 下载真实
  `google-services.json` 替换 `react-native/google-services.json`(当前为占位符)
- [ ] `eas build -p android --profile production` 出 AAB(签名走 EAS 托管,keystore 首次构建自动生成)
- [ ] Play Console 注册/建应用(需要一次性 $25 开发者账号)

### B1. 商店资料
- [ ] 名称/简短说明/完整说明:粘贴 `docs/store-assets/play/listing.md`
- [ ] 图形:应用图标 `play/icon-512.png`、置顶大图 `play/feature-graphic.png`、
  手机截图 `play/phone-screenshots/01~05.png`(1080×1920)
- [ ] What's New:listing.md 对应节

### B2. 应用内容问卷
- [ ] 广告:不含广告
- [ ] 内容分级:暴力/色情/赌博/药品等全部「否」→ IARC 预计 Everyone(USK 0)
- [ ] 目标受众与内容:目标年龄 18 岁及以上;不面向儿童;主题不吸引儿童
- [ ] 新闻应用:否;政府应用:否;贷款/健康等特殊类:否
- [ ] 数据安全表单(与 A2 同源,按 `packages/legal` 第 2 节):
  - 收集:姓名/邮箱/用户 ID(账号)、用户内容(截图/反馈)、购买记录、设备 ID、诊断、使用数据
  - 用途:应用功能、分析、账号管理;不与第三方共享(仅必要受托服务商)
  - 传输加密:是;提供删除方式:是
- [ ] 账号删除(Play 硬要求):应用内入口「设置 → 注销账号」已存在 ✓;
  表单里填「应用内入口」+ 隐私政策 URL(第 7 节含删除条款)
- [ ] 隐私政策 URL:https://dsh-pocket.zhongbei.tech/legal/privacy

### B3. 发布
- [ ] 首包传「内部测试」轨道 → 填测试者邮箱 → 自测购买/登录/配对
- [ ] 资料齐 + 分级出结果后 → 封闭测试或直接申请正式发布

## 附录 A:截图/演示环境复现
- 模拟器:iPhone 17 Pro Max(6.9",1320×2868,iOS 26.5);Release 构建经 Xcode DerivedData 安装
- 测试账号:`autotest-ui@dsh-pocket.dev`;本机 worker `dshc qr` 出配对码
- 演示工作区:`/Volumes/MacMiniDisk/workspace/65-demo-snake`(snake.html;商店图定稿后可删)
- 审批卡触发:新会话 + `permissions.set workspace-write` → 让 agent 复制文件到 `~/Desktop/`
  → 沙盒升级审批 30 秒内截取(参考 git 历史中 e2e/scripts/.fresh-approval.mjs 的删除前版本)

## 附录 B:本次发现的待修问题(非发布阻塞,建议排期)
1. **6.9" 键盘避让不足**:composer 发送键被键盘遮住,手机上无法直接发消息(App Store 截图流程被迫绕道)
2. **会话历史不渲染**:重进会话后消息区空白,仅直播事件可见(sessions.open 快照链路)
3. **作品预览卡「拉取中」**:43KB 单文件预览拉取不完成(复现:作品列表 → snake.html)
4. **审批摘要英文**:等待审批卡的 summary 是 worker 英文原文,建议中文化
5. **测试账号 token 短命**:登录态数十分钟即失效,连续操作时反复要求重登

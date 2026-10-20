# Worker 环境：为什么读不到 `.zshrc`，以及正确通道是什么

> 对象：`desktop-tauri`（Tauri 2）+ 本机已装的 dsh 0.2.1-alpha.1
> 结论一句话：**Worker 环境由 GUI 进程继承，而 GUI 从不读 `.zshrc`；PATH 只能由客户端注入，
> 其余变量走 dsh 自己的 `$DSH_HOME/.env`——不要自造第二套。**
> 相关：[worker-ui-feature-scorecard.md](worker-ui-feature-scorecard.md)、[desktop-boot-and-console-redesign.md](desktop-boot-and-console-redesign.md)

---

## 1. 现象与实测

用户在 `.zshrc` 里配的东西（PATH 增强、代理、密钥）对桌面端 **完全不生效**；同一台机器在终端里
手跑 dshc 却一切正常。本机实测（`ps eww`，只取键名与 PATH，不打印值）：

| 进程 | PATH |
|---|---|
| `/Applications/DSH Pocket.app/Contents/MacOS/dsh-pocket`（GUI） | `/usr/bin:/bin:/usr/sbin:/sbin` |
| dshc supervisor（修复前） | `…/runtimes/node/v24.21.0/bin : …/runtimes/tools/node_modules/.bin : /usr/bin : /bin : /usr/sbin : /sbin`（**4 段**） |
| 应用进程的完整环境键 | 只有 launchd 给的 12 个（`COMMAND_MODE HOME LOGNAME PATH SHELL SSH_AUTH_SOCK TMPDIR USER XPC_FLAGS XPC_SERVICE_NAME __CF_USER_TEXT_ENCODING`），**没有一个用户自定义变量** |
| 自启 plist | `ProgramArguments` 只有二进制 + `--minimized`，**没有 `EnvironmentVariables`** |

**根因**：进程链是 `launchd → .app → node dshc → dsh`，**全程没有 shell**。`.zshrc` 只被
**交互式** zsh 读取（`.zprofile`/`.zlogin` 只被 login shell 读），GUI 进程两者都不是。
即使改成 `zsh -c` 也读不到（非交互非登录只读 `.zshenv`）。

## 2. 上游 dsh 已有的机制（不要重复造）

### 2.1 三层启动环境（`@deepseek-ai/dsh-launch-environment` + `dsh-app-boot`）

`dsh-app-boot/lib/index.js` 的 `loadLayeredEnv()`：

```js
const home = resolveDshHome();                 // 显式 > $DSH_HOME > ~/.dsh（dsh-home-paths）
const inherited = { ...process.env };
const project = readEnvLayer(binName, cwd, …); // <调用目录>/.env
const user = readEnvLayer(binName, home, …);   // $DSH_HOME/.env ← 用户机器级默认值
for (const layer of [project, user])
  for (const [name, value] of Object.entries(layer.values))
    if (process.env[name] === void 0) process.env[name] = value;   // ← 继承层优先
```

可信度顺序：**继承的进程环境 > `<cwd>/.env` > `$DSH_HOME/.env`**，快照带来源（provenance），
且每一层都会被复制进 `process.env`（所以会影响子进程，包括模型 shell 调用）。

### 2.2 拒绝名单：这些名字**任何** `.env` 都不许设

`readEnvLayer` 在应用任何值之前检查，命中即 **throw → dsh 拒绝启动**：

- **名字**（49 个）：`PATH`、`HOME`、`USERPROFILE`、`SHELL`、`NODE_OPTIONS`、`NODE_PATH`、
  `NODE_EXTRA_CA_CERTS`、`LD_*`、`BASH_ENV`、`ENV`、`SHELLOPTS`、`BASHOPTS`、`PERL5*`、
  `PYTHONSTARTUP`、`PYTHONPATH`、`RUBY*`、`JAVA_TOOL_OPTIONS`、`_JAVA_OPTIONS`、
  `JDK_JAVA_OPTIONS`、`PYTHONHOME`、`GIT_SSH`、`GIT_SSH_COMMAND`、`GIT_EXTERNAL_DIFF`、
  `GIT_PAGER`、`GIT_EDITOR`、`GIT_ASKPASS`、`SSH_ASKPASS`、`GIT_CONFIG_*`、`EDITOR`、`VISUAL`、
  `PAGER`、`BROWSER`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_SEARCH_BASE_URL`、`SSL_CERT_FILE`、
  `SSL_CERT_DIR`、`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`、`REQUESTS_CA_BUNDLE`、
  `CURL_CA_BUNDLE`、`NODE_TLS_REJECT_UNAUTHORIZED`
- **前缀**：`DSH_`、`XDG_`、`DYLD_`、`BASH_FUNC_`
- **唯一例外**：四个代理名（`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`）**允许出现在
  `$DSH_HOME/.env`**（用户自己的那层）；项目 `.env` 仍然不许（"随 clone 来的文件不能决定流量去哪"）。
  CA/TLS 类名字**没有任何例外**（"改变的是信任什么，而不是流量去哪"）。

> **推论**：`PATH` 唯一合法通道就是**继承层**——也就是我们 spawn dshc 时给的那个 PATH。
> 让用户把 PATH 写进 `.env` 不是"没效果"，而是**直接起不来**。

### 2.3 出站代理（`dsh-http-proxy`）

- 读 `http_proxy`/`https_proxy`/`no_proxy`/`all_proxy`，**小写优先、大写兜底**，空值视为未设置；
- 取值来源：**导出的环境变量 → `$DSH_HOME/.env`**；项目 `.env` 不许带这些名字；
- **loopback 始终直连**（`localhost`、`127.0.0.0/8`、`::1`、`0.0.0.0` 及其 IPv4 映射写法）。
  ——这和我们 Rust 侧 `http_client()` 对 loopback 强制 `no_proxy()` 是同一个结论。

## 3. 我们的处置

### 3.1 修什么：继承层的 PATH（唯一属于我们的 bug）

`run_dshc_worker()`（只有**启动/重启 Worker** 走这条路）把 PATH 构造成：

```
[受管 node bin] + [受管 tools bin] + 登录 shell PATH + 继承 PATH（去重、保序）
```

- `-i -l -c` + 标记夹取（**必须 `-i -l`** 才读 `.zshrc`/`.zprofile`）；
- 超时 5s、失败**回退继承 PATH**（绝不阻塞启动）；stderr 丢弃、stdin 关闭；
- 结果缓存 300s（本机实测一次解析 **1441ms**，所以启动时后台预热一次）；
- `status`/`stop`/`free-port` 仍用便宜的 PATH——它们只跑 dshc 自己，且 `status` 每 3 秒一次，
  绝不能让它去起 shell。

**修复效果**（本机 `cargo test --lib -- --ignored --nocapture worker_env_probe`）：

```
登录 shell PATH：51 段（含 /opt/homebrew）
Worker PATH    ：45 段，前缀 = 受管 node bin → 受管 tools bin → 用户 shell 的第一段
```

### 3.2 不做什么

- **不做** VS Code 式的"整份 env 快照"：Worker 是**可被手机远程驾驶**的守护进程，
  把用户整份环境（`AWS_*`、`GITHUB_TOKEN`…）灌进去是**权限升级**，不是便利。
- **不自造 `worker.env`**：上游已经认 `$DSH_HOME/.env`，自造就是给用户两个真相源；
  而且自造的文件迟早会踩 2.2 的拒绝名单。
- **不把密钥放进 Worker 全局环境**：密钥走 dsh 的凭据/账号体系；每个插件（MCP）的 env
  放在它自己的配置里。

### 3.3 可见性（让这类问题自证）

| 入口 | 内容 |
|---|---|
| 控制台「运行 → 高级 → Worker 环境」 | ① 会让 Worker **起不来**的键（红）② 写了也**不生效**的键（橙，被继承层挡住）③ PATH 来源（登录 shell 段数 / 是否含 Homebrew / 回退）④ `~/.dsh/.env` 的键名清单 |
| 导出诊断 `workerEnv` | 同上（**只有键名，没有值**——报告会外发） |
| `dsh-pocket --dump-worker-env` | 命令行打印登录 shell 段数 + Worker PATH 全量 + 是否含 Homebrew |

`inspect_*` 一律只回**键名**；单测 `inspect_env_file_flags_refused_and_shadowed` 明确断言
报告里不出现值（防止将来有人"顺手"把值带出去）。

## 4. 本机验明的四个问题（原先列为"待确认"）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 我们的启动路径算不算"产品 CLI 引导"（`.env` 层会不会被发现）？ | **算**。`dshc` spawn 的是 `node_modules/.bin/dsh`，即 dsh launcher → `loadLayeredEnv` 会读 `$DSH_HOME/.env` |
| 2 | `.env` 里的 PATH 会作用到模型 shell 调用吗？ | **不会——而且更糟**：PATH 属 bootstrap-only，写进任何 `.env` 会让 dsh **拒绝启动** |
| 3 | 代理变量大小写？ | dsh 侧**小写优先、大写兜底**；建议写小写（或两写） |
| 4 | 项目 `.env` 带代理名会怎样？ | **拒绝启动**（上游安全设计）。诊断里要把这条说清楚，否则会变成新的"神秘起不来" |

## 5. 启动引导：把导入做成了产品功能（已实现）

普通用户不会去手写 `~/.dsh/.env`，所以导入被做成**三处共用同一个组件**
（`desktop-tauri/src/components/EnvImportPanel.tsx`）：

| 落点 | 形态 | 行为 |
|---|---|---|
| **主窗口启动横幅** | 引导面顶部一条 | 检测到候选（`pendingCount > 0`）就出现：「检测到终端里有 N 个环境变量可导入（Flutter/Android/Homebrew/代理等）」+「一键导入 / 选择… / 稍后」。导入完或点稍后即消失 |
| **向导「环境变量」步骤** | 引导向导第 5 步（harness 之后、account 之前） | 分组勾选 + 现状说明；**可选步骤**：不阻断「下一步」，也不被自动推进跳过（`OPTIONAL_STEPS`） |
| **控制台 运行 → 高级** | 折叠区内 | 同上，外加 PATH 来源与 `.env` 现状；`focus=env` 深链可直接展开 |

### 5.1 设计要点

- **发现 → 分类 → 勾选 → 写入**，不是整份灌入：
  - 分组：移动开发 / 语言运行时 / 包管理与镜像 / 网络与代理 / IDE 与 JVM / shell 现场 / 其他；
  - 默认勾选：四个工具类分组；**shell 现场类与 IDE 类默认不勾**；
  - **密钥类**（`*_API_KEY`/`*_TOKEN`/`*_SECRET`/`AWS_*`…）默认不勾并标 ⚠️；
  - **上游禁止类**（`PATH`/`HOME`/`GIT_PAGER`/`PAGER`…）勾不动，标「不可导入」并说明
    （PATH 已由客户端启动时注入）。
- **值从不经过前端**：`env_scan` 只回键名；`env_import(keys)` 只收键名，值由 Rust 从
  登录 shell 取出后直接写文件。单测 `scan_report_lists_keys_never_values_*` 断言报告里
  不出现任何值（它可能进导出诊断）。
- **写入是"受管块"**：`# >>> DSH Pocket 导入的终端环境` … `# <<< DSH Pocket`，
  替换旧块、**保留用户手写的行**、文件 0600、重复导入不堆积（单测覆盖）。
- **一次 shell 捕获全量**：`login_shell_env_cached()` 用 `zsh -i -l -c "…; command env; …"`
  拿全部键值并缓存 300s；PATH 也从这里取（`worker_path_env` 用），避免起两次 shell。
  `BASH_FUNC_*`（导出成变量的 shell 函数）在捕获处丢弃。
- **生效方式**：环境在 `dshc start` 时固化 → 导入后提示「重启 Worker」。

### 5.2 还没做的

- 导入后**自动重启 Worker**（目前提示用户去运行页点「停止 → 启动」）；
- 「终端环境变了」的主动提醒（用户后装了新工具时，除重新扫描外没有提示）；
- 代理的单独一键配置（现在包含在「网络与代理」分组里，随导入一起走）。
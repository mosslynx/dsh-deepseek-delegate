# DeepSeek 委派

DeepSeek Harness 插件：在原生侧边栏派发和管理任务，通过 stdio MCP 让 Codex 等客户端使用同一队列。任务由本机 Harness CLI 执行，支持第三方模型路由、原生会话续聊和取消。

模型路由在设置中配置，格式为 `provider/model`。插件复用 Harness 的供应商声明和已保存凭据。

## 安装

要求 DeepSeek Harness `>=0.2.1-rc.2 <0.3.0`。当前 CLI 自动检测和进程管理主要面向 Windows。

**推荐：Harness 内安装。** 打开 Harness 的插件管理页面（侧边栏 → 添加插件），在弹窗中填入：

```text
https://github.com/mosslynx/dsh-deepseek-delegate.git
```

也可以填 npm 包名或本机已有的项目目录路径。Harness 会通过自带的 pnpm 完成安装并注册插件，**不需要 Node.js、不需要构建**（仓库自带构建产物）。安装后重启 Harness，在侧边栏选择 **DeepSeek 委派**。

**备选：npm 脚本安装**（适合开发者，需要 Node.js 22 以上）。它通过官方 `dsh plugin --profile desktop add <项目目录>` 链接此目录，并在 desktop profile 下备份依赖清单：

```powershell
git clone https://github.com/mosslynx/dsh-deepseek-delegate.git
cd dsh-deepseek-delegate
npm ci
npm run build
npm run plugin:install
```

等待安装命令结束后启动或重启 Harness。安装后请保留项目目录；移动后需要重新安装，并更新 MCP 路径。

CLI 默认从当前 Harness 进程、`DSH_EXECUTABLE`、常见安装位置和 PATH 检测。如果没有找到，可设置环境变量后安装：

```powershell
$env:DSH_EXECUTABLE = 'C:\path\to\DSH Desktop.exe'
npm run plugin:install
```

## 使用界面

- **任务**：派发任务，查看状态、回答、工作目录、Token 用量和执行日志；取消排队或运行任务。列表每页 50 条，支持按任务状态筛选。
- **继续对话**：接续已完成任务的 Harness 原生会话，要求模型路由与工作目录一致。
- **重试任务**：仅失败或中断的任务显示此入口。它在原任务记录之外新建一次执行尝试，沿用原任务的提示、目录、模型、思考强度和权限快照，但使用全新会话。
- **设置**：选择模型路由、默认思考强度、CLI、工作目录、权限、并发数、超时和历史保留数；控制是否复用登录和第三方供应商。思考强度支持跟随模型默认、关闭、低、中、高和最高，实际档位由所选模型/供应商决定。
- **MCP 连接**：复制当前机器适用的 Codex TOML 或通用 MCP JSON。
- **连通性测试**：发送要求不调用工具、不访问文件的测试提示，预期回答 `DEEPSEEK_PLUGIN_OK`。

如果 Harness CLI 返回 ACP `usage`，任务会保存 `totalTokens`、`inputTokens`、`outputTokens`，以及可用的思考和缓存 Token 字段。兼容 Harness 当前使用的 `uncachedInputTokens`、`reasoningTokens`、`cacheReadTokens` 和 `cacheWriteTokens` 别名；有多个执行步骤时会累加每个步骤的 usage。任务列表和详情会显示用量，侧边栏会汇总已报告任务的 Token。ACP `usage_update` 的 `used/size` 只表示上下文占用，会单独显示为“上下文占用”，不会计入账单 Token。没有返回 usage 的 Harness 版本会显示“未报告”，不会用字符数估算。

续聊任务可能收到 Harness 按会话累计的 usage，因此侧边栏的累计值适合比较独立任务；把同一会话的多次续聊直接相加可能重复计算。

默认只读、单任务并发、1200 秒超时，最多保留 1000 条已结束任务。后台任务无法处理交互审批，因此审批策略为 `never`，文件访问仍由所选 Harness 沙箱模式控制。允许写入后，任务可能使用工具修改工作目录。

第三方供应商默认从 `~/.dsh/profiles/desktop/cordis.patch.yml` 的 `llm-pi-ai` 配置读取。只引入供应商声明，凭据由 Harness 自己加载。请先确认相同路由能在 Harness 中使用。

## 连接 Codex

保持 Harness 运行，并启用插件。执行以下命令获取配置，或在管理页面复制：

```powershell
npm run config
```

将输出加入 Codex 的 `config.toml`。以下仅展示结构，请替换占位路径：

```toml
[mcp_servers.deepseek_delegate]
command = "node"
args = ["/absolute/path/to/dsh-deepseek-delegate/lib/cli.js", "mcp"]
startup_timeout_sec = 30
tool_timeout_sec = 60

[mcp_servers.deepseek_delegate.env]
DEEPSEEK_MCP_DATA = "/absolute/path/to/delegate-data"
```

路径以本机生成的配置为准。重新加载客户端的 MCP 连接，或在新对话中验证工具。插件不自动修改 Codex 配置。

| 工具 | 用途 |
| --- | --- |
| `delegate_to_deepseek` | 立即返回任务 ID；传入 `continueTaskId` 可续聊；可用 `reasoningEffort` 覆盖思考强度、`timeoutSeconds` 覆盖本次超时、`idempotencyKey` 防重复派发 |
| `get_task` | 获取完整状态、提示、回答、会话 ID、Token 用量和日志 |
| `wait_task` | 默认等待最多 30 秒；只返回状态、回答、`partialAnswer`、用量和 `progress`，不含 prompt/cwd/日志；`includeLogs: true` 可显式取日志 |
| `resume_task` | 续跑超时或中断的任务，复用原会话；可选 `prompt`、`timeoutSeconds`、`idempotencyKey` |
| `cancel_task` | 取消任务，并终止该任务拥有的进程树 |
| `retry_task` | 手动重试失败或中断的任务，返回新任务 ID（全新会话） |
| `list_tasks` | 分页列出任务摘要；支持 `limit`、`offset`、`status` |
| `get_deepseek_settings` | 读取委派设置 |

示例参数（省略 `reasoningEffort` 时使用管理页面的默认设置；传入 `default` 时跟随模型/供应商默认。可选值：`default`、`off`、`low`、`medium`、`high`、`max`；`timeoutSeconds` 范围 10–3600，省略时使用设置值）：

```json
{"prompt":"分析此项目的入口和主要模块，不修改文件。","cwd":"/absolute/path/to/workspace","reasoningEffort":"high","timeoutSeconds":1800}
```

MCP 初始化不要求 Harness 在线；调用业务工具时才发现插件。关闭或重启 Harness 后，下次调用会重新读取服务地址。超时或服务重启中断的任务可以用 `resume_task` 在原会话继续；普通失败使用 `retry_task` 开启新会话；两者都不会自动触发。重新派发前应先检查日志和工作目录。

### 防重复派发

客户端为一次新的任务生成唯一 `idempotencyKey`（建议 UUID），遇到连接中断或响应丢失时，使用**相同键和相同参数**重新调用：

```json
{"prompt":"分析项目入口，不修改文件。","reasoningEffort":"high","idempotencyKey":"review-entry-20261026-001"}
```

- 同一数据目录内，相同键与相同参数返回原任务及当前状态，不新增任务、不重新启动 CLI；插件重启后也有效。
- 同一键传入不同提示、工作目录、续聊来源、思考强度或超时会报错；需要开展新工作时使用新键。
- 未传工作目录、思考强度或超时时，重发不会因默认设置已改变而创建另一项任务，仍返回第一次提交时的执行快照。
- 不传键仍允许重复提示创建多个独立任务。超时后可用 `resume_task` 继续原会话；普通失败使用 `retry_task` 开启新任务。
- 键与请求指纹以 SHA-256 摘要写在任务记录里，不保存键原文或为了去重额外保存未脱敏提示。**幂等保护只覆盖仍保留的任务记录**；历史清理会同时移除对应键，清理后再用旧键会创建新任务。不要把它作为永久的业务执行锁。

管理页面提交任务也会在响应失败后保留当前请求的键；不改动任务参数直接再次点击派发，会取回同一任务。

### 分页与结构化结果

从 1.1.0 起，`list_tasks` 返回分页对象，而不是旧版的裸数组；读取任务列表时请使用 `result.tasks`：

```json
{"limit":20,"offset":0,"status":"completed"}
```

结果包含 `tasks`、`total`、`limit`、`offset`、`hasMore`、`nextOffset`。默认每页 50 条，最大 100 条；按创建顺序从新到旧排列，先按状态筛选再分页。`nextOffset: null` 表示没有下一页。提示在摘要里最多保留 500 个字符，完整提示、回答和日志通过 `get_task` 读取。新任务或历史清理会改变偏移量，连续翻页时可能需要从第一页重新读取。

协商 MCP `2025-06-18` 或更新版本时，工具定义提供 `outputSchema`，成功调用同时返回 `structuredContent` 和内容相同的 JSON 文本。使用旧版协议的客户端仍收到 JSON 文本结果，不附加不受其版本支持的字段。工具执行错误保持 `isError: true`，不会伪装成符合成功 schema 的结果。

`wait_task` 默认长轮询 30000 毫秒，`timeoutMs` 可设置为 0–30000。运行中的任务不会因一次日志更新就结束等待；等待到终态或超时后只返回 `id`、`status`、`answer`、`partialAnswer`、`error`、`errorCode`、`usage`、`contextUsage`、`resumable` 和 `progress`，不再重复返回 prompt、cwd、sessionId。`progress` 包含事件条数、最近一条事件、排队位置、已运行秒数和任务超时。默认省略完整 `events`、`stderr`；需要排查时使用 `get_task`，或显式传 `includeLogs: true`。这些优化减少客户端往返和重复结果，不承诺提高模型上游的缓存命中率。

### 历史保留

在管理页面的“已结束任务保留数”设置 `historyLimit`，范围 0–10000，默认 1000，0 表示不限。启动、任务状态持久化或保存设置时会保留最近结束的指定条数，超出的较旧记录会从 `tasks.json` 和任务列表中移除，包括其回答、日志与幂等键。排队、运行中以及进程仍在退出的任务不计入该上限，也不会被清理。

旧配置中没有此字段时也使用默认值；升级前如果需要完整保留已有记录，可先在 `config.json` 加入 `"historyLimit": 0`。要长期保存记录，请备份数据目录。界面 Token 汇总只统计当前仍保留的记录，不作为全量历史账单；清理不会删除 Harness 原生会话，也不会更改任务曾经修改过的工作文件。

### 超时与续跑

任务默认超时 1200 秒，可在设置或 `delegate_to_deepseek` 的 `timeoutSeconds` 覆盖（10–3600）。到点先优雅终止，5 秒未退出再强杀；任务标 `failed` + `errorCode: "timeout"`，保留 `sessionId`，并把最后一段 `text` 存为 `partialAnswer`，`answer` 保持为空。

- `resume_task` 只接受 `failed + errorCode=timeout` 或 `interrupted` 且有 `sessionId` 的任务；`cancelled`、`completed` 和普通失败拒绝。
- 续跑新建一条任务，`continueTaskId` 指向原任务，复用原会话、模型、目录、权限和提示快照；`prompt` 省略时使用默认续跑文案，`timeoutSeconds` 省略时继承原任务。
- 同一会话已有活跃任务会被拒绝；相同 `idempotencyKey` 与相同参数会返回原续跑任务。续跑失败时新任务标 `failed`，请改用 `retry_task`。
- 管理页面对超时/中断任务显示「继续运行」，对普通失败显示「重试任务」；已完成任务仍用「继续对话」。
- 如果 CLI 拒绝恢复被强杀的会话，续跑任务会失败并提示改用 `retry_task`，不会自动重派。

```json
{"taskId":"3a6af931-...","prompt":"继续完成原型，不要重复已完成的工作","timeoutSeconds":1800}
```

### 手动重试

`retry_task`（界面上是任务详情里的「重试任务」按钮）不会自动触发，也不会被任何超时或失败路径调用：

- 只有 `failed` 和 `interrupted` 可以重试。`queued`、`running`、`completed`、`cancelled` 一律返回错误，不会创建任务或启动进程；已完成的任务请用 `continueTaskId` 续聊。超时或中断的任务优先用 `resume_task` 续跑；`retry_task` 始终开启新会话。
- 重试会新建一个任务并返回新的任务 ID。原任务的状态、回答和日志保持不变，重试任务用 `retryOf` 指向原任务，用 `attempt` 记录尝试次数（原任务为 1，第一次重试为 2）。
- 新任务复制原任务的执行快照：提示、`cwd`、`modelRoute`、思考强度、`permissionMode`、超时和供应商设置都取自原任务，而不是当前设置。提示来自已持久化的记录，因此是脱敏后的文本。
- 重试始终是一次全新的执行尝试：它不会带上原任务的 `sessionId`，也不会用 `continueTaskId` 续聊。
- 重试关系写入 `tasks.json`，重启后仍可在任务详情里看到来源和尝试次数。

## 数据与连接

默认数据目录是 `~/.dsh/deepseek-delegate`，可用 `DEEPSEEK_MCP_DATA` 修改。插件和 MCP 需要使用同一目录。

- `config.json`：委派设置，包括默认超时和可选的 `allowedRoots` 工作区允许列表。
- `tasks.json`：任务及结果，包含提示、回答、`partialAnswer`、执行日志、Harness Token 用量、`errorCode`，以及续聊/续跑/重试关系（`continueTaskId`、`retryOf`、`attempt`）。
- `runtime.json`：运行时本地地址和随机连接令牌，关闭插件时清理。
- `server.lock/`：防止同一数据目录被重复使用。

`usage.totalTokens` 是累计处理量，包含缓存读取；`usage.billableTokens` 才是输入加输出的新增 Token，界面和侧边栏汇总使用后者。`allowedRoots` 为空时不限制工作目录；非空时 `delegate`、`resume` 和 `retry` 的目录必须落在其中一个根目录下。

任务记录对常见密钥格式进行脱敏，但不应依赖它保存任意敏感数据。临时运行 patch 在任务结束后删除。外部 MCP 通过仅监听 `127.0.0.1`、要求随机令牌的 HTTP 通道连接插件。管理界面使用 Harness 自带的认证连接通道；重新启用插件或重启 Host 后会自动恢复连接。

## 开发与验证

```powershell
npm run build
npm test
```

测试覆盖真实子进程事件处理、续聊参数、失败与退出时日志、取消、插件卸载与启动中停用、保留页面连接后的反复启停、桌面来源检查、令牌验证以及 stdio MCP 的离线初始化/在线发现。`test/retry.test.mjs` 另外覆盖：失败和中断任务可手动重试、其他状态被拒绝且不启动进程、重试复制执行快照、重试不继承原会话、重试关系持久化重启后仍可见，以及 `retry_task` 在 MCP 与面板接口上的一致性。`test/timeout-resume.test.mjs` 覆盖按任务超时、超时状态与 `partialAnswer`、原会话续跑、续跑拒绝与幂等、3 秒落盘、`allowedRoots` 以及 `wait_task` 的精简投影。

`test/task-features.test.mjs` 覆盖幂等重发与冲突、设置变更及重启后的幂等保护、满队列重发、分页筛选与摘要限制、历史上限及运行任务保护、精简等待结果，以及新旧 MCP 协议的结构化返回兼容性。这些测试使用临时目录和本地 CLI fixture，不调用模型。

```powershell
npm run test:lifecycle
```

启停验证使用已安装的 Harness 桌面运行时，创建独立的临时 Host 和内存认证，不读取用户凭据、不调用模型。它通过官方客户端 RPC 验证三轮插件启停与重载、Host 更换后的连接恢复、设置持久化和路由认证。可用 `DSH_EXECUTABLE` 指定 `DSH Desktop.exe`、`DeepSeek Harness.exe` 或官方 `dsh.cmd`。

```powershell
npm run test:smoke
```

真实冒烟测试要求 Harness 正在运行并已启用本插件，会使用当前模型供应商额度。它验证 MCP 派发、会话记忆续聊、取消和共享任务列表；测试提示要求不调用工具和不访问文件。

修改后重新构建，并重启 Harness 载入 Host/Client 新代码。项目包含构建后的 `lib/client.js`（侧边栏）、`lib/plugin.js`（Host 入口）和 `lib/cli.js`（MCP 入口，已内联 `yaml`），因此直接复制目录即可运行，无需安装依赖；开发依赖仍需安装。

```text
src/plugin.mjs       Harness 插件生命周期
src/server.mjs       本地传输、界面接口和 MCP 配置
src/harness.mjs      官方 CLI 启动与供应商 overlay
src/tasks.mjs        持久化队列、会话、进程和事件处理
src/mcp.mjs          stdio JSON-RPC 入口
src/ui/             原生侧边栏 React 页面
scripts/            构建、安装/卸载、真实冒烟测试
test/               集成测试和 CLI fixture
```

## 故障排查与卸载

- **cannot resolve profile bundle**：确认安装已经成功结束、项目目录仍存在。用 Harness 内的插件管理重新安装，或运行 `npm run plugin:install` 修复链接，然后重启 Harness。
- **Cannot find package 'yaml'**：旧版本从 zip 或目录链接安装时缺少运行时依赖。更新到包含 `lib/plugin.js` 与 `lib/cli.js` 的版本后重新安装；或在插件目录运行 `npm ci` 临时修复。
- **页面无法连接**：确认插件已启用；页面会自动重连。更新插件代码后，运行 `npm run build` 并重启 Harness，以载入新版本。
- **找不到 CLI**：在设置中填入官方 `dsh.cmd`、`DeepSeek Harness.exe` 或 `DSH Desktop.exe` 的绝对路径。
- **供应商未注册或鉴权失败**：检查设置中的供应商文件和模型路由，以及 Harness 已保存的对应凭据。错误会保留在任务日志里。
- **服务已在运行**：同一数据目录只能启用一个实例。正常退出旧实例后重试；不要在进程仍运行时手动删除锁目录。
- **Codex 调到了其他 MCP 的同名工具**：如果同时使用 Codex++，它的 `codex_plus_collaboration` 也会暴露 `delegate_to_deepseek`、`wait_task` 等同名工具，且不会写入本插件队列。确认调用的是 `mcp__deepseek_delegate__*`；不需要 Codex++ 的协作工具时，在 Codex 的 `config.toml` 里给对应 server 加 `enabled = false`。

```powershell
npm run plugin:uninstall
```

卸载保留任务数据。许可证为 [AGPL-3.0-only](LICENSE)，参考项目见 [NOTICE.md](NOTICE.md)。本项目是第三方插件，与 DeepSeek、OpenAI 无隶属关系。

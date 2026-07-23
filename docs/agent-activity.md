# AgentActivity

桌面端把 agent 的"会话状态"分成 8 类,与 TUI `crates/codegen/xai-grok-pager/src/views/dashboard/{state,row}.rs::RowState` 对齐。本文档描述状态机、与 TUI 的差异、以及 Background Work 残留事项。

## 状态机

| 状态 | 触发 | UI |
|---|---|---|
| `idle` | 无 turn / 无等待 | 不显示徽章 |
| `working` | `sendPrompt()` 进行中(turn / compact) | 蓝脉动(实心圆点,1.2s 周期) |
| `loading` | `replaying=true`(加载历史) | 蓝旋转(空心环,2.4s 周期) |
| `needsInput` | 等待用户决策 | 4 种 reason 子色(见下) |
| `completed` | 上一 turn 成功完成 | 绿色 ✓,2s 后淡出 |
| `failed` | 上一 turn 因异常结束 | 红色 ✗,5s 后淡出 |
| `cancelled` | 上一 turn 被用户取消 | 灰色 —,2s 后淡出 |
| `blocked` | 上一 turn 因权限被拒 / 阻塞结束 | 橙色 ⊘,5s 后淡出 |

终态染色只在 renderer 内部显示,不影响 `activity` 的下一次计算 —— `sendPrompt()` 启动新 turn 时直接清掉 `lastTurnResult`,activity 立刻回到 idle / working。

## 与 TUI 的差异

- **Inactive / roster 路径:未引入** —— desktop 单进程,无多 leader / 远程 session 视角。
- **子 agent `classify_subagent`:未引入** —— desktop 不表面化 task tool fork。
- **`has_background_work` (BgTaskStatus + scheduled /loop):未实现** —— 见下文"Background Work (TBD)"。

## loading vs working 语义边界

两个状态**有意识地分开**:`isBusyLike(activity) === activity === "working"`(只看 `working`,**不包括** `loading`)。

| | 触发 | `isBusyLike` | composer 表现 | 流式 caret | loading bar |
|---|---|---|---|---|---|
| `working` | `sendPrompt()` 进行中 | **true** | Stop 按钮 + 输入框锁 | 显示 | 显示 |
| `loading` | `replaying=true` 加载历史 | **false** | Send 按钮照常 | 不显示 | 显示 |

理由:`loading` 期间用户**可以**继续输入 / 发送新消息,只是历史还在补全;如果把 `loading` 算成 busy,会让用户误以为 agent 正在跑 turn(实际上只是从 agent 那边拉历史记录),Stop 按钮反而会误导成"停止当前 turn"。

这个语义边界与 TUI `classify_top_level` 的"loading_replay 也算 Working"**有意不同**——desktop 的 UI 表面比 TUI 的 dashboard 更靠近用户操作(composer 是直接交互界面),不能让用户失去"立即发送"的能力。

视觉上仍然分开:

| | working | loading |
|---|---|---|
| 形状 | 实心蓝色圆点 | 空心蓝色环 |
| 动画 | `scale(1) ↔ scale(1.18)` 脉动 | 旋转 360° |
| 节奏 | 1.2s 周期(快,"心跳") | 2.4s 周期(慢,"加载") |
| 语义 | "agent 在思考 / 在工作" | "app 在读盘 / 加载历史" |

## needsInputReason 配色

| reason | 颜色 | 图标 | 文案(en / zh) |
|---|---|---|---|
| `permission` | 橙色 ⚠ | `!` | Awaiting permission / 等待权限 |
| `question` | 紫色 ? | `?` | Awaiting answer / 等待回答 |
| `trust` | 黄色 🔒 | 🔒 | Awaiting trust / 等待信任 |
| `plan` | 蓝灰 ☑ | `☑` | Plan approval / 等待计划审批 |

**`plan` 单独配色**(蓝灰),与 `permission`(橙)、`question`(紫)、`trust`(黄)区分。理由:plan 审批不是"危险操作",而是"用户审阅计划"的不同语境;混在一起用户难以快速识别。

## 字段位置

- **类型**:`src/shared/types.ts:AgentActivity` / `NeedsInputReason` / `isBusyLike` / `isTerminal`
- **派生**:`Backend.classifyActive()` + `Backend.refreshActivity()`(`src/main/backend.ts`)
- **写入**:终态由 `Backend.sendPrompt()` 的 `finally` 块按 RPC 结果写入 `lastTurnResult`;cancel / cancelSession 写入 `"cancelled"`
- **消费**:
  - `<AgentActivityBadge>`(`src/renderer/App.tsx`)—— header 状态徽章
  - 侧边栏 `<SessionStatusIcon>`(`src/renderer/App.tsx`)
  - `<WaitingSessionsBanner>`(`src/renderer/WaitingSessionsBanner.tsx`)—— 后台会话等待通知
  - composer / queue / streaming caret 内部判断全部用 `isBusyLike(snap.activity)`

## 已删除的旧 API

| 旧 | 新 |
|---|---|
| `RendererState.busy: boolean` | `RendererState.activity: AgentActivity` |
| `SessionRunStatus` 枚举(6 值) | `AgentActivity` 枚举(8 值,含 reason 子字段) |
| `Backend.sessionRunStatus(id)` | `Backend.classifyActive(id): { activity, needsInputReason? }` |
| `i18n.sessionStatusRunning` | `i18n.sessionStatusWorking` |
| `i18n.sessionStatusNeeds{Permission,Question,Trust}` | `i18n.needsInputReason{Permission,Question,Trust,Plan}` |

## Background Work (TBD)

TUI 的 `has_background_work` 当前**未在 desktop 实现**。当需要支持时:

### 数据源
- **BgTaskStatus::Running**:tool 调用启动时,主进程 fork 子进程并跟踪其 PID / 退出码;agent 透传 `x.ai/bg_task_update` 事件
- **scheduled `/loop`**:`/loop <interval>` 命令持久化到 session metadata(`~/.grok/sessions/<sid>/loop-schedule.json`),由主进程定时器唤醒

### 派生逻辑
`Backend.classifyActive()` 第 3 步(在 needsInput / replaying / busy∨compacting 之后):
```ts
if (hasBackgroundWork(sessionId)) return { activity: "working" };
```

### IPC 接口预留
`RendererState` 加:
```ts
backgroundWork?: {
  pids: number[];           // 后台子进程 PID 列表
  loopSchedule?: string;    // 活跃 /loop schedule 的 interval token
};
```

### UI 表面
- Header 徽章:有 background work 时,`working` 徽章加一个二级图标(终端 / 时钟)
- 侧边栏:每个有 background work 的 session 加 `.session-item.has-bg-work` 装饰条
- 关闭 session 时的二次确认:有 background work 时提醒用户"还有 N 个后台进程在跑"

## 验证清单

- [x] tsc --noEmit -p tsconfig.json pass
- [x] tsc --noEmit -p tsconfig.web.json pass
- [x] 全仓 grep `snap.busy` / `RendererState.busy` 残留为 0
- [x] `SessionRunStatus` 已删除,无引用
- [x] `<AgentActivityBadge>` 接入 chat header
- [x] `<SessionStatusIcon>` 支持 `needsInput` reason 4 种 + 4 种终态
- [x] `<WaitingSessionsBanner>` 切到 `AgentActivity`
- [x] i18n 中英文 14 条 key 落地(`Working`/`Loading`/`Idle`/`Awaiting input`/`Awaiting permission/answer/trust`/`Plan approval`/`Completed`/`Failed`/`Cancelled`/`Blocked`)
- [x] CSS:11 个新状态样式 + plan 单独配色
- [ ] 桌面端 UI 走查(working 实心脉动 vs loading 空心旋转是否清晰可辨)
- [ ] 终态徽章淡出时长(2s/5s)是否符合预期
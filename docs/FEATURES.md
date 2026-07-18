# Grok Build Desktop — 能力清单

**状态：** 对照代码与 [`DESIGN.md`](./DESIGN.md) 维护的产品能力表  
**更新：** 2026-07-18  
**标注：** ✅ 已做 · 🟡 部分 · ⬜ 未做

---

## 1. 核心架构与连接

| 能力 | 状态 | 备注 |
|------|------|------|
| Electron + React 桌面壳 | ✅ | Claude 风格侧边栏 + 文件树 + 主区 + 输入框 |
| 启动 `grok agent serve`（loopback + secret） | ✅ | 仅 `127.0.0.1`，退出杀子进程 |
| ACP JSON-RPC（initialize / authenticate / prompt） | ✅ | `cached_token`，失败提示 `grok login` |
| 连接状态（starting / ready / error…）与重试 | ✅ | 首页错误卡 + Retry |
| 与 CLI 共用 `~/.grok`（auth / sessions / config） | ✅ | 无独立账号体系 |
| 二进制解析（`GROK_BINARY` → `~/.grok/bin` → PATH） | ✅ | 打包内置 binary 路径已预留，未真正打包 |
| 应用菜单 / 窗口 chrome | ✅ | Win/Linux：隐藏菜单条但保留 Edit 角色（Ctrl+C/V…）+ 选区右键复制；macOS 精简 app/edit/window |
| 桌面内多会话并发 + 侧栏运行状态 | ✅ | 切换会话不取消其它 turn；侧栏 spinner / 等待审批点 |
| 多窗口 / 挂接正在跑的 TUI live session | ⬜ | 不能 attach 外部 CLI 进程（leader-socket 仍 Later） |

---

## 2. 会话与项目管理

| 能力 | 状态 | 备注 |
|------|------|------|
| 新建会话（选工作区） | ✅ | 顶栏「新建会话」+「打开工作区」 |
| 按项目新建会话 | ✅ | 项目行旁 ＋ → 在该 cwd 下 `session/new` |
| 恢复会话 `session/load` | ✅ | 侧边栏点击 |
| 按项目分组 + 折叠 | ✅ | 组头显示项目名 |
| 会话搜索（本地过滤 + FTS） | ✅ | `x.ai/session/search`，snippet |
| 重命名 | ✅ | 双击 / 右键 |
| 删除 | ✅ | 右键确认 |
| Fork | ✅ | 右键 → fork 后自动 load 新会话 |
| 最近会话列表刷新 | ✅ | `_x.ai/session_summaries/workspace_list_recent` |
| 会话标题随首条消息自动生成 | ✅ | 后端简写截断 |

---

## 3. 对话与时间线

| 能力 | 状态 | 备注 |
|------|------|------|
| 用户消息 / 助手流式输出 | ✅ | `agent_message_chunk` |
| 思考过程（可折叠） | ✅ | `agent_thought_chunk` |
| Markdown 渲染（GFM） | ✅ | `react-markdown` + remark-gfm |
| 工具卡片（标题 / 状态 / kind） | ✅ | 可展开；状态着色；diff 数摘要（`ToolCard`） |
| Diff 查看器 | ✅ | ACP `type:diff` → 行级 LCS +/-/gutter；多文件；超大截断（`DiffView`） |
| 工具输出可展开详情 | ✅ | ACP `type:content` 文本/stdout；可折叠；80k 截断 |
| 工作区文件树 | ✅ | 侧栏「文件」开关；懒加载展开；过滤；隐藏 node_modules/.git 等 |
| 文件内容预览 | ✅ | 主区分栏预览；行号；二进制提示；512KB 截断；`@` 插入路径 |
| 语法高亮 | ✅ | highlight.js：Go/Java/JS/TS/Python/Rust/CSS/HTML/Vue/MD/JSON/YAML 等；主题 token 随 dark/light |
| Markdown 预览切换 | ✅ | `.md` 可在渲染预览与源码高亮间切换 |
| Compact（手动 `/compact` + 自动） | ✅ | 进度卡、tokens before/after |
| Cancel 中断当前 turn | ✅ | 忙碌时 Stop 按钮 |
| 忙碌时消息队列 / 排队发送 | ✅ | 忙时 Enter 入队；回合结束后 FIFO 自动发送；Ctrl+Enter /「立即发送」取消当前 turn 并优先发出；可移除/清空；按会话隔离 |
| 复制单条 / 导出对话 Markdown | ✅ | 悬停复制用户/助手/思考；顶栏「导出」→ 复制 MD / 下载 .md |
| Plan / TODO 可视化面板 | ✅ | 右侧面板：Todos 列表 + plan.md 预览；`sessionUpdate: plan` 实时更新；`x.ai/exit_plan_mode` 审批（批准 / 请求修改 / 退出）；`/view-plan` · Ctrl+Shift+P；composer chip |

---

## 4. 输入与附件

| 能力 | 状态 | 备注 |
|------|------|------|
| 文本 composer + Enter 发送 | ✅ | 自动增高 |
| Prompt 历史 | ✅ | 空输入 ↑/↓ 回放；`/history` / Ctrl+R 模糊搜索填入；数据源 agent `x.ai/prompt_history` + 本地发送缓存 + timeline 回退 |
| 附件（文件选择） | ✅ | 路径以 `@path` 注入 prompt |
| `@` 路径补全 | ✅ | 键盘 ↑↓ / 滚动跟随 |
| 粘贴图片 | ✅ | 模型支持时走 image block，否则当文件 mention |
| 斜杠命令补全 | ✅ | 本地命令 + ACP/skills 合并（含 `/history`） |
| 拖拽文件进输入框 | ✅ | composer 拖放；`webUtils.getPathForFile` + attachPaths |

---

## 5. 模型 / 模式 / 上下文

| 能力 | 状态 | 备注 |
|------|------|------|
| 模型切换 chip | ✅ | `session/set_model` |
| Agent / Plan / Ask 模式 | ✅ | chip + `/plan` `/ask` `/agent` |
| Reasoning effort 选择 | ✅ | 模型支持时显示 chip |
| 上下文 token 用量 | ✅ | effort 右侧 `已用/窗口`；≥70% 黄、≥85% 红 |
| Token 数据源 | ✅ | `_meta.totalTokens` + 模型窗口 + `session/info` 校正 |

---

## 6. 权限与安全（YOLO）

| 能力 | 状态 | 备注 |
|------|------|------|
| 权限确认面板 | ✅ | 与输入框等宽；选项一行一个；默认项；↑↓/鼠标；Enter/Esc |
| Ask user question 问卷 | ✅ | 居中 Modal 分步向导；radio/checkbox + Other；plan 四路径；优先于权限面板；侧栏 `needs_question` |
| 多权限请求排队 | ✅ | 显示「还有 n 个」 |
| Always-approve / YOLO | ✅ | 工具栏 Ask/Always chip；设置页开关；`/always-approve` `/yolo` |
| 与 CLI 配置同步 | ✅ | `~/.grok/config.toml` `[ui] permission_mode` + `yolo` |
| 通知 agent YOLO 状态 | ✅ | `x.ai/yolo_mode_changed` + `session/new\|load` `_meta.yoloMode` |
| YOLO 时自动 allow-once（跳过「开 YOLO」那项） | ✅ | 队列清空时一并处理 |
| 细粒度 allow_always（按工具/路径会话级）UI | 🟡 | 协议选项可点，无独立策略管理页 |
| 沙箱 / 能力边界设置 UI | ⬜ | 依赖 agent/CLI |

---

## 7. 斜杠命令与 Skills

| 能力 | 状态 | 备注 |
|------|------|------|
| 本地：`/new` `/clear` `/model` `/m` `/effort` | ✅ | 桌面直接处理 |
| 本地：`/plan` `/ask` `/agent` | ✅ | 切模式，plan 可带后续文字发出 |
| 本地：`/always-approve` `/yolo` | ✅ | on/off/toggle |
| ACP 命令透传（如 `/compact`、skills） | ✅ | 当普通 prompt 发给 agent |
| 命令目录刷新 | ✅ | `_x.ai/commands/list` + `available_commands_update` |
| `Ctrl+K` 命令面板 / 完整 palette | ⬜ | 目前仅输入框 `/` 补全 |

---

## 8. 设置与本地化

| 能力 | 状态 | 备注 |
|------|------|------|
| 语言 en / 中文 / 跟随系统 | ✅ | 设置页 + 账户菜单 |
| 主题 dark / light / 跟随系统 | ✅ | 同上 |
| 账户信息展示 | ✅ | 邮箱 / 认证方式 / 过期 / 团队 / API Key 来源 |
| 应用内登录（浏览器 OAuth） | ✅ | `grok login --oauth`，成功后自动重连 agent |
| 应用内设备码登录 | ✅ | `grok login --device-auth`；展示 URL + code，可复制/取消 |
| 应用内登出 | ✅ | `grok logout`；清除 `~/.grok/auth.json` 会话 |
| API Key（桌面持久化） | ✅ | `~/.grok/desktop-api-key`（0600），启动 agent 时注入 `XAI_API_KEY` |
| 重连 Agent | ✅ | 凭据变更后手动/登录后自动 reconnect |
| 订阅 / credit 用量 | ✅ | ACP `x.ai/billing`（同 CLI `/usage`）；侧栏账号区 + 设置页；自动轮询；管理账单外链 |
| Permissions 设置（YOLO） | ✅ | Settings 独立区块 |
| MCP 服务器管理 UI | ✅ | 侧栏入口；list/add/remove/enable；`grok mcp` + config.toml |
| Skills / Plugins / Hooks 管理 UI | ✅ | 侧栏「扩展」页签；技能禁用、插件装卸、Hook 预览 |
| 自定义模型配置 UI | ✅ | 侧栏「模型」；多提供商（国内外预设 + 自定义）；拉取 `/models` 或手动录入；写入 `config.toml` `[model.dp_*]`；输入框按提供商分组切换 |

---

## 9. 产品化 / 分发

| 能力 | 状态 | 备注 |
|------|------|------|
| 开发运行 `pnpm dev` | ✅ | electron-vite |
| electron-builder 多目标打包 | ✅ | macOS dmg/zip、Linux deb/rpm/AppImage、Windows NSIS/portable；`pnpm dist:mac` · `dist:linux` · `dist:win` |
| 内置 `grok` 二进制安装包 | ⬜ | README 与 DESIGN 仍为待办 |
| 登录引导（浏览器 / 设备码） | ✅ | 设置 → 账号 + 侧栏账号菜单 |
| 自动更新 | ⬜ | — |
| 代码签名 / 公证 | ⬜ | — |
| 内嵌终端 | ✅ | 右侧栏 xterm.js + PTY；会话在标签切换时保活 |
| 全局快捷键体系 | 🟡 | 局部有：权限、补全、Enter 发送、忙时排队、Ctrl+Enter 立即发送、Ctrl+B 侧栏、右栏工具等 |

---

## 10. 安全模型（已落地部分）

| 能力 | 状态 | 备注 |
|------|------|------|
| 仅 loopback 绑定 | ✅ | |
| 每进程随机 secret | ✅ | 不暴露给 renderer |
| contextIsolation + preload 白名单 IPC | ✅ | |
| 不实现 ACP 反向 FS/terminal 通道 | ✅ | 刻意：文件/shell 由 agent 本地执行 |

---

## 相对路线图的进度

| 设计 / 优先项 | 状态 |
|---------------|------|
| MVP 聊天 + agent serve | ✅ |
| 会话 load / rename / delete / search / fork | ✅ |
| 模型 / 模式 / effort / token 用量 | ✅ |
| 权限确认弹窗 + 队列 | ✅ |
| Always-approve 全链路（chip / 设置 / slash / config / agent） | ✅ |
| 按项目新建会话 | ✅ |
| Diff 查看器 | ✅ |
| 工具输出详情 | ✅ |
| 工作区文件树 + 语法高亮预览 | ✅ |
| 复制单条 / 导出对话 Markdown | ✅ |
| 忙碌时消息队列 / 立即发送 | ✅ |
| Prompt 历史（↑ / `/history`） | ✅ |
| Plan / TODO 面板 + 计划审批 | ✅ |
| 登录引导（浏览器 / 设备码） | ✅ |
| 内嵌终端（xterm + PTY） | ✅ |
| 安装包 + 内置 binary | ⬜ |
| MCP / Skills 设置 UI | ✅ |
| 自定义模型 / 多提供商配置 UI | ✅ |
| 自动更新 / multi-client attach | ⬜ |

---

## 建议下一波

1. **打包内置 binary + 自动更新** — 从「开发者能跑」到「能装」  
2. **文件树增强**（搜索全文、从 tool/diff 跳转打开、只读→可编辑）— 可选  
3. **Diff 语法高亮** — 可选  
4. **完整命令面板 `Ctrl+K` / `/rewind`** — 可选  

---

## 维护说明

- 实现新功能或显著改状态时，同步更新本表对应行的 **状态** 与 **备注**。  
- 架构决策、协议细节仍以 [`DESIGN.md`](./DESIGN.md) 为准；本文件只做能力与完成度索引。  
- README 的 scope 表保持精简，并链接到本文。

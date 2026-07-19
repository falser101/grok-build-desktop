# 桌面端交互性能审查

> 范围:`src/renderer/` 下的视图与样式(以 `App.tsx`、`MarkdownBody.tsx`、
> `ToolCard.tsx`、`FileTree.tsx`、`FileViewer.tsx`、`PlanPanel.tsx`、
> `TerminalPanel.tsx`、`ModelsView.tsx`、`SettingsView.tsx`、
> `ExtensionsView.tsx`、`styles.css` 为重点)。

整体上项目有不少 **正确的优化意识** —— RAF 节流 resize、`React.memo`
覆盖多数面板、`useDeferredValue` 用于 Markdown、xterm 输出不入 React state、
面板拖拽期间跳过 refit 等。但流式渲染、大列表、编辑器表单和 CSS 合成成本
方面仍存在显著瓶颈。

---

## 🔴 高严重程度(优先修复)

### 1. 流式 Markdown 每个 token 都全量重解析

**位置:** `src/renderer/MarkdownBody.tsx:170-208` + 透明覆盖层
`styles.css` 中的 `.md-streaming-fresh`

- `useDeferredValue` 只是降级优先级,不是 throttle。高频 token 流下,
  每个 chunk 都会触发整棵 `ReactMarkdown + remarkGfm` 重建。
- 流式阶段同时渲染 **完整解析 DOM + 完整原文透明覆盖层**,后者只
  `color: transparent`,但仍参与排版、字体测量、换行,长消息时代价巨大。
- `memo` 无法阻止 `text` 引用变化带来的重渲染。

**建议:**

- 显式按 50–100ms 节流解析快照;或按"已闭合 block + 未闭合 tail"做增量渲染。
- 移除透明完整原文层,改用 caret 或仅渲染新增尾巴。
- 超长流可降级为纯文本层,流结束再切回 Markdown。

---

### 2. FileTree / FileViewer 行号 / Models 列表都没有虚拟化

**位置:** `src/renderer/FileTree.tsx:120-176, 323-345`、
`FileViewer.tsx:160-179`、`ModelsView.tsx:763-824`

- 树节点递归一次性挂载,展开大型 monorepo / `node_modules` 时全部 DOM 常驻。
- `TreeNode` 没有 `memo`,且 `onToggle` 因依赖 `nodeState` 频繁变引用。
- FileViewer 用 `Array.from({length}).map` 给每一行生成一个 `<span>` 行号
  DOM,数万行 → 数万 DOM。
- ModelsView 的列表/搜索过滤没虚拟化,且单条切换 O(n) 数据复制 + 整列表
  re-render。

**建议:**

- 三处都接虚拟滚动(react-window / @tanstack/react-virtual)。这结构性
  收益最大、最确定。
- FileViewer 行号改用 CSS counter 或 canvas;大文件直接走 Worker 高亮并
  设置阈值(如 > 5000 行禁用高亮)。
- FileTree 的 `TreeNode` 包 `memo`,`onToggle` 用 ref 保持稳定;`useDeferredValue`
  或 150ms debounce 处理 filter。

---

### 3. ModelsView / SettingsView 表单每次按键整页重渲染

**位置:** `src/renderer/ModelsView.tsx:410-435, 763-824, 994-1024`、
`SettingsView.tsx:98-100, 275-700`

- `editor` 是包含所有 provider/models/apiKey 的大对象;`editorModelsVisible`
  依赖整个 `editor`,输入 API Key 时连带过滤全模型列表。
- SettingsView 的 `apiKeyDraft` 在顶层,改一个字符就让账户/用量/安装器/
  语言/主题/权限全部重渲染。
- 内联 `onChange`、`onClick`、未 memo 的 `OptionCard` / `InfoRow` 雪上加霜。

**建议:**

- 拆 `ConnectionEditor` / `AuthEditor` / `ModelList` / `ProviderGrid` 各自 `memo`。
- 模型行提取 `memo(ModelRow)`,`toggleModel` 用 normalized state
  (`Map<id, model>` + enabled Set)。
- API Key 拆为独立子组件,局部 state;`localeOptions` / `themeOptions` 移到
  组件外或 `useMemo`。
- Models 搜索接 `useDeferredValue` 或 debounce。

---

## 🟠 中严重程度

### 4. xterm 输出未做应用层批处理

**位置:** `src/renderer/TerminalPanel.tsx:204-218`

- 每个 PTY `data` 事件直接 `xterm.write()`,IPC 拆小 chunk 时形成大量
  解析/调度调用。
- `termResize` 也没比较上次的 `{cols, rows}` 是否真变化,ResizeObserver
  同尺寸通知可能发冗余 IPC。

**建议:** 同终端 chunk 进 `useRef` buffer,RAF 合并后一次 `write`;
resize 前比较缓存。

### 5. PlanPanel / ExtensionsView 列表行无 memo

**位置:** `PlanPanel.tsx:67-88, 178-246`、
`ExtensionsView.tsx:270-275, 420-714`

- todo / 插件列表每项状态变化都让整列重建,无 `memo(TodoRow)` /
  `memo(ExtensionRow)`。
- Extensions 搜索每次按键重渲染整个页面。

**建议:** 抽 `memo(TodoRow)` / `memo(ExtensionRow)`,大列表虚拟化,
filter 用 `useDeferredValue`。

### 6. FileTree 搜索无节流,展开依赖链不稳

**位置:** `FileTree.tsx:226-262`

- `filter` 受控,每个 keystroke 全树扫描,无 `useDeferredValue` / debounce,
  `visibleChildren` 未 memo。
- `refresh()` 先清空 `nodeState` 再并发 `loadDir`,展开目录多时产生多轮
  全树重建。

### 7. ToolCard 默认展开 + 大输出直接进 DOM

**位置:** `ToolCard.tsx:70-129`

- 大 stdout 直接进 `<pre>`,大 diff 一次性挂载。
- `<details open={defaultOpen}>` 完全由 props 控制,流式工具 status 变化会
  反复干扰用户手动折叠的状态(应当用内部 state)。

### 8. CSS 合成成本:`backdrop-filter` blur 持续运行

**位置:** `styles.css:4166-4169`、`:7767`

- `.settings-header` 在滚动期间持续 blur 10px,需要持续重采样合成;Models /
  Extensions 长列表页全程承担。
- 模型卡片 hover 同时动画 transform + 18px 阴影,大型 grid 移动鼠标会叠加
  重绘。

**建议:** 把 sticky header 改成不透明背景(或 `color-mix` 但不带 blur);
hover 仅改 border/background。

---

## 🟡 低严重程度(锦上添花)

| 问题 | 位置 |
| --- | --- |
| Markdown 每渲染递归提取整段代码文本做 copy button | `MarkdownBody.tsx:23-29, 112-135` |
| copy 状态 `setTimeout` 未清理,快速连点会建立多个 timer | `MarkdownBody.tsx:52-61` |
| FileViewer 切换文件未取消旧读取,大文件继续传输 | `FileViewer.tsx:26-48` |
| 终端 `onBinary` 逐字符拼接字符串,建议直接传 `Uint8Array` | `TerminalPanel.tsx:163-177` |
| `panel-resize-end` 的 RAF 没保存 ID,cleanup 无法取消 | `TerminalPanel.tsx:265-270` |
| Settings / Extensions 静态 options 数组每次 render 重建 | `SettingsView.tsx:235-245` |

---

## ✅ 值得肯定的现有优化

- `MarkdownBody` / `ToolCard` / `FileTree` / `FileViewer` 都已 `React.memo`。
- Markdown plugins / components 在组件外定义,引用稳定。
- Terminal xterm 实例和高频数据全在 `useRef`,输出 **不入 React state**(正确)。
- Terminal resize 用 `ResizeObserver + RAF`,面板拖拽期间跳过 fit。
- 没有在 render 中调用 `getBoundingClientRect()` / scroll listener,没有发现
  明确的 layout thrashing。
- 面板拖拽期间通过 CSS 类隐藏 xterm/FileViewer/FileTree,有效避免持续重绘。
- App.tsx 把 composer 文本放 `useRef + draftRef` + 仅 `hasDraft` 入 state,
  避免每键重渲染整树(很好的设计)。

---

## 🎯 Top 5 优化建议(按 ROI 排序)

1. **流式 Markdown 节流 + 移除透明全文覆盖层** — 高 token 下整页最重的源头。
2. **FileTree / FileViewer / Models 列表虚拟化** — 大目录、大文件、大型模型数据下
   结构性收益最大。
3. **拆分 ModelsView / SettingsView 表单与列表,加 `React.memo` + stable
   callbacks** — 每键重渲染整编辑器是日常交互最痛的点。
4. **xterm 输出应用层批处理 + resize 变化检测** — 高吞吐终端场景下的体验提升。
5. **移除 sticky header 的 `backdrop-filter: blur(10px)`** — 单点改动即可消除长列表
   滚动时的合成成本,所有平台直接受益。
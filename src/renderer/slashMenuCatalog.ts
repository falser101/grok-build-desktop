/**
 * Desktop slash-menu whitelist: localized titles + selection action.
 * Hand-typed /commands still work outside this list.
 */

export type SlashMenuAction = "execute" | "fill" | "set_mode" | "set_intent";

export type SlashMenuModeId = "plan" | "ask" | "default";

/** One-shot composer intent (chip beside always-approve). */
export type SlashMenuIntentId = "goal" | "loop";

export interface SlashMenuDef {
  /** Canonical name without leading `/`. */
  name: string;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  action: SlashMenuAction;
  /** For set_mode */
  modeId?: SlashMenuModeId;
  /** For set_intent (goal / loop chips) */
  intentId?: SlashMenuIntentId;
  /**
   * When true, only show if ACP advertised this command name.
   * Local-only modes (plan/ask/agent) and compact stay always available.
   */
  requireAcp?: boolean;
}

/** Ordered command-zone entries (not skills). */
export const DESKTOP_SLASH_MENU: SlashMenuDef[] = [
  {
    name: "compact",
    titleZh: "压缩对话",
    titleEn: "Compact conversation",
    descZh: "压缩历史以腾出上下文空间",
    descEn: "Compress history to free context space",
    action: "execute",
  },
  {
    name: "plan",
    titleZh: "计划模式",
    titleEn: "Plan mode",
    descZh: "只读规划，不直接改代码",
    descEn: "Read-only planning without applying edits",
    action: "set_mode",
    modeId: "plan",
  },
  {
    name: "ask",
    titleZh: "问答模式",
    titleEn: "Ask mode",
    descZh: "只读问答，不执行写操作",
    descEn: "Read-only Q&A without write tools",
    action: "set_mode",
    modeId: "ask",
  },
  {
    name: "agent",
    titleZh: "Agent 模式",
    titleEn: "Agent mode",
    descZh: "默认代理，可使用工具改代码",
    descEn: "Default agent with tools enabled",
    action: "set_mode",
    modeId: "default",
  },
  {
    name: "goal",
    titleZh: "目标模式",
    titleEn: "Goal",
    descZh: "设定或管理自主目标",
    descEn: "Set or manage an autonomous goal",
    action: "set_intent",
    intentId: "goal",
    requireAcp: true,
  },
  {
    name: "loop",
    titleZh: "定时循环",
    titleEn: "Loop",
    descZh: "按间隔重复执行提示词",
    descEn: "Run a prompt on a recurring interval",
    action: "set_intent",
    intentId: "loop",
    requireAcp: true,
  },
  {
    name: "deep-research",
    titleZh: "深度研究",
    titleEn: "Deep research",
    descZh: "并行调研并生成带引用的报告",
    descEn: "Research with evidence and a cited report",
    action: "fill",
    requireAcp: true,
  },
  {
    name: "rewind",
    titleZh: "回滚对话",
    titleEn: "Rewind conversation",
    descZh: "回到更早的用户轮次，可还原文件",
    descEn: "Roll back to an earlier turn; optionally restore files",
    action: "execute",
  },
];

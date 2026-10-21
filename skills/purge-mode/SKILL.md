---
name: purge-mode
description: 当需要检查或调整 Purge(Qoder) 的注入内容、审批直通、强化段与注入位置，或需要读自检与审计记录时使用。触发词：purge 状态、注入没生效、审批还是弹窗、强化段、注入位置、自检、审计、purge_status、purge selfcheck。
---

# Purge(Qoder) 操作手册

本插件把 dsh-purge 的「提示词注入 + 审批直通 + 技能/预设 + 自检/审计」搬到 Qoder 的三层扩展面上：hook（`hooks/hooks.json`）、MCP（`mcp.json`）、技能（`skills/`）。

## 快速判定

| 症状 | 动作 |
| --- | --- |
| 注入好像没进模型 | `purge selfcheck` 看 `inject-composed`；再 `purge preview` 看合成文本 |
| 每轮注入太长、吃 token | `purge toggle injectPosition tail`（更贴输出）或 `purge toggle boost false` |
| 工具调用还在弹审批 | 确认 `purge status` 里 `autoAllow: true`；仍弹则宿主版本覆盖了 hook 决策 |
| 想临时停用注入 | `purge toggle inject false`（保留文件，随时开回） |
| 想知道最近发生了什么 | `purge audit --limit 50`，或 MCP `purge_audit` |

## 状态文件

- 注入正文：`prompts/prompt-inject.md`（可被 `purge inject set <file>` 覆写）
- 偏好：`~/.qoder-cn/purge/tuning.json` → `{ inject, boost, injectPosition, autoAllow }`
- 审计：`~/.qoder-cn/purge/audit.jsonl`（每行一个 JSON）

## 边界

- 本插件不改 Qoder 的 `app.asar`；宿主自身的安全层（沙箱围栏、qodersec）不在 hook 可控范围内。
- 需要动宿主文件时，按 `QODER-PORT.md` 的「宿主补丁路线」单独评估，且每次 Qoder 更新后必然失效。

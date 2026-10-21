# Purge (Qoder)

把 [dsh-purge](https://github.com/kingcharleslzy-ai/dsh-purge) 的「提示词注入 + 审批直通 + 技能/预设 + 自检/审计」搬到 Qoder 的官方扩展面上——**不修改宿主 `app.asar`**。

移植可行性与逐项映射见 **[QODER-PORT.md](QODER-PORT.md)**（含 Qoder 插件/hook/MCP 契约的逆向取证结果）。

## 做了什么

| 能力 | 实现 |
| --- | --- |
| 每轮提示词注入 | `UserPromptSubmit` hook → `hookSpecificOutput.additionalContext` |
| 尾部强化段 / 注入位置 | `prompts/prompt-inject.md` + `tuning.json`（`head` / `tail` / `both`） |
| 审批直通 | `PreToolUse` / `PermissionRequest` → `permissionDecision: "allow"` |
| MCP 工具 | `purge_status` `purge_selfcheck` `purge_inject_get/set` `purge_preview` `purge_toggle` `purge_audit` |
| 技能 | `skills/purge-mode/SKILL.md`（操作手册） |
| 自检 / 审计 | 10 层自检；`~/.qoder-cn/purge/audit.jsonl` |

## 用法

```sh
node bin/purge.mjs status
node bin/purge.mjs selfcheck          # 加 --json 出机读
node bin/purge.mjs preview            # 看下一轮实际注入的合成文本
node bin/purge.mjs toggle boost false # 关强化段
node bin/purge.mjs toggle injectPosition tail
node bin/purge.mjs audit --limit 50
node test/smoke.mjs                   # 8 项冒烟
```

偏好文件：`~/.qoder-cn/purge/tuning.json`

```json
{ "inject": true, "boost": true, "injectPosition": "head", "autoAllow": true }
```

## 安装

见 [QODER-PORT.md · 第 5 节](QODER-PORT.md#五安装方式三选一)。最简路径：把本目录复制到
`%USERPROFILE%\.qoder-cn\plugins\cache\local\purge-qoder\0.1.0\`，在 `installed_plugins_v2.json`
与 `settings.json` 里登记为 `purge-qoder@local`，重启 Qoder。

## 运行时启动器（为什么不直接用 `${QODER_NODE_RUNTIME}`）

Qoder 内置插件在 `mcp.json` 里写 `${QODER_NODE_RUNTIME}`，但宿主只对**部分**配置注入该变量
（`app.asar` 里的转换函数是 `if (命令命中哨兵 || 标志位为 true) 才注入`）。hooks 侧没有证据能保证
它被注入，一旦为空，`command` 直接 spawn 失败、注入静默消失。

所以 hooks 与 MCP 统一走 `cmd.exe → bin/purge-hook.cmd / bin/purge-mcp.cmd`，由 `.cmd` 自己按
以下顺序解析 JS 运行时（照抄内置 `qoder-context` 的 `bin/qoder-context.cmd` 策略）：

1. `%QODER_NODE_RUNTIME%`（宿主若注入了就用它）
2. `%ProgramFiles%\nodejs\node.exe`、`%ProgramW6432%\nodejs\node.exe`、`%LOCALAPPDATA%\Programs\nodejs\node.exe`
3. `where node.exe`
4. `Qoder CN.exe` + `ELECTRON_RUN_AS_NODE=1`（没装 Node 的机器也能跑）

全部失败时 hook 打印 `{}` 并 `exit /b 0`——**fail open**，绝不让宿主因插件异常而卡住。

## 不做的事

- 不改 `app.asar`、不动 `qodersec` 沙箱、不关宿主 fs 围栏：这些在 Qoder 上只能靠打补丁，升级即失效，故障面远大于收益。
- 不伪造宿主备份/回滚：不再修改宿主文件后，备份对象只剩本插件自己的状态。

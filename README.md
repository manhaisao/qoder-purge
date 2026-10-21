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

## 为什么配置是"生成"的（`node bin/install.mjs`）

两个坑都是实测踩出来的，写死在仓库里一定会坏：

1. **宿主的 HookRunner 不经 shell**。`spawn(command, args)` 直拉，args 里的引号原样传给被调程序。
   我第一版写 `command: "cmd.exe"` + `args: ["/d","/c","call","\"<path>.cmd\""]`，日志立刻报：
   ```
   [HookRunner] Hook "cmd.exe" (event: UserPromptSubmit) exited with code 1.
   stderr: '"\"C:\...\purge-hook.cmd\""' 不是内部或外部命令
   ```
   带引号的路径被当成一个字面量命令名。
2. **`${QODER_NODE_RUNTIME}` 是条件注入**。`app.asar` 里的转换函数是
   `if (命令命中哨兵 || 标志位 === true) 才注入`；hooks 侧没有任何证据保证它存在，为空即 spawn 失败。

所以 `bin/install.mjs` 在安装时解析出**绝对 node 路径**（顺序：自身 `process.execPath` →
`%ProgramFiles%\nodejs\node.exe` → `%ProgramW6432%` → `%LOCALAPPDATA%\Programs\nodejs` →
`where node.exe` → 最后退到 `Qoder CN.exe` + `ELECTRON_RUN_AS_NODE=1`，没装 Node 也能跑），
把结果写进 `hooks/hooks.json` 与 `mcp.json`；命令行里不出现任何需要 shell 解释的东西。

```sh
node bin/install.mjs              # 只生成配置
node bin/install.mjs --register   # 顺带登记进 ~/.qoder-cn 并启用
```

`hooks/hooks.json` 与 `mcp.json` 是生成物（已 gitignore），模板见 `hooks/hooks.template.json`
与 `mcp.template.json`。`bin/purge-hook.cmd` / `bin/purge-mcp.cmd` 保留作手动/可移植入口，
宿主链路不再使用它们。

## 不做的事

- 不改 `app.asar`、不动 `qodersec` 沙箱、不关宿主 fs 围栏：这些在 Qoder 上只能靠打补丁，升级即失效，故障面远大于收益。
- 不伪造宿主备份/回滚：不再修改宿主文件后，备份对象只剩本插件自己的状态。

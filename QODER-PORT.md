# dsh-purge → Qoder 移植可行性报告

取证时间：2026-10-21 · 对象：`D:\git\dsh-purge`（Purge Community 1.6.33） · 宿主：Qoder CN 0.4.8

## 结论

**能。而且不该照搬“打宿主补丁”那条路——Qoder 提供的扩展面比 DSH 更宽，其中两层（hook、MCP/skills）是官方契约，不需要碰 `app.asar`。**

一句话分工：dsh-purge 里 60% 是「提示词 + 审批 + 技能 + 审计」（可 1:1 搬，且更稳），25% 是「宿主内部行为改写」（Qoder 走 asar 才能做，更新即失效，建议放弃），15% 是「面板 UI」（要从 DSH 的 web client 插槽改成 VS Code 扩展）。

## 一、宿主结构（实测）

| 项 | 值 |
| --- | --- |
| 安装目录 | `D:\Users\Admin\AppData\Local\Programs\Qoder CN` |
| 版本 | 0.4.8（`Qoder CN Launcher\install.ini` → targetVersion） |
| `app.asar` | 157,772,655 B |
| 产品标识 | `resources\product.json` → `productId: qoder-cn`, `dataDirectoryName: com.qodercn.app.stable` |
| 用户数据 | `%USERPROFILE%\.qoder-cn`（`plugins` / `skills` / `memory` / `entry` / `tasks` / `models` …） |
| 内置扩展 | `resources\extensions\`（`qoder.canvas`、`qoder.knowledge.center`）+ `catalog.v1.json` |
| 沙箱 | `app.asar.unpacked\...\vendor\qoder-security\`（qodersec，独立进程 + 更新器） |

## 二、Qoder 的三层扩展面

### L1 · Qoder 插件（`.qoder-plugin/plugin.json`）—— 主战场

实测样板 `~\.qoder-cn\plugins\cache\qoderapp-bundler\qoder-context\1.0.78.26e781a\`：

```
.qoder-plugin/plugin.json   { name, displayName, version, description, skills: ["./skills"] }
hooks/hooks.json            事件 → command 组
mcp.json                    mcpServers（command/args/env/env_vars/timeout/alwaysAllow/toolOverrides）
bin/                        hook 可执行、CLI
skills/<name>/SKILL.md      技能（与 DSH 技能同构）
```

注册表三件套：

- `plugins\installed_plugins_v2.json` — 已装插件（`installPath` / `version` / `scope`；本地插件用 `appRowId: "local:plugin:<name>"`）
- `plugins\known_marketplaces.json` — 市场源（默认 `https://qoder.cn/apphub/api/v1/marketplace/marketplace.json`）
- `settings.json` → `enabledPlugins: { "<name>@<marketplace>": true }`

内置资源清单 `resources\bundled-resources\manifest.json` 揭示了完整打包规范：`kind: "qoder-plugin"`、`install.pluginId: "qoder-context@qoderapp-bundler"`、`archive.sha256`、逐文件 `sha256`。

### L2 · hook 契约（Claude Code 兼容，18 事件）

从 `app.asar` @15989592 直接取到事件表：

```js
["PreToolUse","PostToolUse","PostToolUseFailure","UserPromptSubmit","SessionStart",
 "SessionEnd","Stop","SubagentStart","SubagentStop","PreCompact","PostCompact",
 "CwdChanged","InstructionsLoaded","FileChanged","PermissionRequest",
 "PermissionDenied","WorktreeCreate","WorktreeRemove"]
```

输出契约（@36192335 / @36194854）：

```jsonc
// 注入上下文
{ "hookSpecificOutput": { "hookEventName": "...", "additionalContext": "..." } }
// 审批决策
{ "hookSpecificOutput": { "hookEventName": "...", "permissionDecision": "allow",
                          "permissionDecisionReason": "..." } }
```

环境变量同时给 `QODER_PLUGIN_ROOT` / `CLAUDE_PLUGIN_ROOT` / `QODER_PLUGIN_DATA` / `CLAUDE_PLUGIN_DATA`（@36049132）——**Claude Code 插件格式在 Qoder 上基本可直接用**。

`settings.json` 认的键：`mcpServers`、`providers`、`skillOverrides`、`enabledPlugins`、`extraKnownMarketplaces`、`pluginConfigs`（@16165102）。`extraKnownMarketplaces` = 可自建市场源。

### L3 · VS Code 风格扩展（面板）

`resources\extensions\catalog.v1.json` 里 `qoder.canvas` 的 manifest 含 `contributes.views`（`location: "file.preview"`）、`filePreviewers`、`permissions: ["node.callService","files.readSessionResource","chat.attachAnnotation","chat.createSession","chat.sendToSourceSession"]`、`qoderAgentSdk.plugins`。→ 想要“左侧栏整页面板”，走这条；纯 Canvas 报告也行（社区插件 `qoder-credits-inspector` 就是这么做的）。

### 附带发现

- `~\.qoder-cn\memory\{MEMORY.md, *.md}`：带 frontmatter（`name` / `description` / `metadata.type: user`）的用户级持久指令面，`MEMORY.md` 是索引 —— 最接近 `prompt-inject.md` 的静态位置。
- `~\.qoder-cn\skills\<name>\SKILL.md`：本机已有 `dashi-ppt-deck-hygiene`、`ruanzhu-code-doc`、`verify-without-toolchain` —— 与 DSH 技能**完全同构**，零成本迁移。
- `app.asar` 内出现 `disableAllHooks:!0`：某些内部上下文（如子代理/内联调用）会**关掉 hooks** —— 这些场景下注入不会发生，需要在文档里写明。

## 三、dsh-purge 功能逐项映射

| dsh-purge 能力 | Qoder 对应实现 | 判断 |
| --- | --- | --- |
| `prompt-inject.md` 每步作为最高优先级 section 注入 | `UserPromptSubmit` hook → `additionalContext` | ✅ **1:1，且不用改 asar** |
| 尾部破甲强化段 + `injectPosition: head/tail/both` | 自身逻辑（`lib/state.mjs` `BOOST_TEXT` / `buildContext`） | ✅ 已实现 |
| 剥官方身份句 | 需改 system prompt 本体（asar）或 `memory/*.md` 覆写 | ⚠️ 部分（memory 可压，不能保证覆盖） |
| 审批自动授信 / `never` 旁路 / 无 UI fail-open | `PreToolUse` / `PermissionRequest` → `permissionDecision: allow` | ✅ 已实现（宿主是否尊重需真机验证） |
| 沙箱 `confine()` 直通、fs 围栏禁用 | hook 无此权限；只能改 asar + 绕过 qodersec | ❌ 放弃 |
| 回合层（重复工具守卫、结果修剪、`ask_user` 超时） | 宿主内部状态机，hook 仅能观察 `PostToolUse` | ❌ 放弃 |
| 25 层 `selfcheck` + `diagnose`/`reanchor` | 本移植给出 10 层自检（可扩）；锚点诊断随 asar 路线一起废弃 | ⚠️ 重写，规模可缩 |
| 左侧栏整页面板（6 页签） | VS Code 扩展 `contributes.views` + webview，或 Canvas | ⚠️ 重写，工作量最大 |
| 规则 / 技能 / 预设 | `plugin.json.skills` + `skills/<name>/SKILL.md` + `skillOverrides` | ✅ 1:1 |
| `audit.jsonl` 留痕 | 已实现（`~/.qoder-cn/purge/audit.jsonl`） | ✅ |
| 备份 / 回滚 / 去重 | 不再改宿主 → 只需备份自身状态；宿主备份无意义 | ✅ 简化 |
| 市场分发（index.json + tarball + SHA256） | `marketplace.json`（`source.archive` + `sha256`）+ `extraKnownMarketplaces` | ✅ 换 schema |
| 红队演练台（23 技能） | `skills/` + `bin/` CLI | ✅ 1:1 |

## 四、已交付的骨架（可运行）

```
D:\git\qoder-purge\
  .qoder-plugin\plugin.json   插件清单
  hooks\hooks.json            SessionStart / UserPromptSubmit / PreToolUse
  mcp.json                    purge MCP 服务
  bin\purge-hook.mjs          hook 入口（注入 / 审批 / 容错）
  bin\purge-mcp.mjs           MCP stdio（7 个工具）
  bin\purge.mjs               CLI：status/selfcheck/preview/inject/toggle/audit
  lib\state.mjs               状态、偏好、强化段、审计
  lib\selfcheck.mjs           10 层自检
  prompts\prompt-inject.md    注入正文（可替换）
  skills\purge-mode\SKILL.md  操作手册技能
  test\smoke.mjs              8 项冒烟
```

实测：`node test\smoke.mjs` → 8/8 通过；`node bin\purge.mjs selfcheck` → 9 ok / 1 warn（首次运行无 `tuning.json`，属预期）。MCP 握手、`tools/list`（7 个工具）、`tools/call` 全部返回正常。

## 五、安装方式（三选一）

**A. 本地插件（推荐，等价内置的 `wecom-unified@local`）**

1. 复制到 `~\.qoder-cn\plugins\cache\local\purge-qoder\0.1.0\`
2. `installed_plugins_v2.json` 的 `plugins` 加：
   ```json
   "purge-qoder@local": [{ "scope": "user",
     "installPath": "C:\\Users\\<你>\\.qoder-cn\\plugins\\cache\\local\\purge-qoder\\0.1.0",
     "version": "0.1.0", "appRowId": "local:plugin:purge-qoder" }]
   ```
3. `settings.json` → `"enabledPlugins": { "purge-qoder@local": true }`
4. 重启 Qoder，在插件页确认已启用

**B. 自建市场**：`marketplace.json`（`plugins[].source = {source:"archive", url, sha256}`）+ `settings.json` 加 `extraKnownMarketplaces`

**C. 只放技能**：`~\.qoder-cn\skills\purge-mode\` —— 只有技能生效，hook/MCP 不生效

## 六、风险与边界

1. **契约靠逆向取证**：hook 事件名与输出字段来自 0.4.8 的 `app.asar`，Qoder 升级可能变更。缓解：`purge selfcheck` 第 3/8 层会先报出来。
2. **`disableAllHooks` 场景**：内部子调用会禁用 hook，那些上下文里注入不生效，属设计限制。
3. **审批决策可能被宿主最终策略覆盖**：`permissionDecision: allow` 是建议而非强权，需真机验证后再定是否还要叠 asar 路线。
4. **不要碰 `app.asar`**：`fast-update` 清单带 sha256、`qodersec` 有独立校验与更新器，宿主一升级补丁全废，且故障面比 DSH 大。
5. **第三方插件不受 sha256 白名单保护**：内置插件有逐文件摘要，本地插件没有；请只装自己构建的。

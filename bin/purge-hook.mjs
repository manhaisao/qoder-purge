#!/usr/bin/env node
/**
 * Purge for Qoder —— 单一 hook 入口。
 *
 * Qoder 的 hook 契约（取自 app.asar 实测）：
 *   输入：stdin 一行 JSON，含 hook_event_name / cwd / session_id 等字段
 *   输出：stdout 一行 JSON
 *     - 注入上下文：{ hookSpecificOutput: { hookEventName, additionalContext } }
 *     - 审批决策：  { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }
 *     - 不做任何事：{}
 *
 * 事件名覆盖：SessionStart / UserPromptSubmit / PreToolUse / PostToolUse /
 *   SessionEnd / Stop / SubagentStart / SubagentStop / PreCompact / PostCompact /
 *   CwdChanged / InstructionsLoaded / FileChanged / PermissionRequest /
 *   PermissionDenied / WorktreeCreate / WorktreeRemove / PostToolUseFailure
 */
import { buildContext, loadTuning, audit, qoderInstallCandidates } from '../lib/state.mjs'

const ALIASES = {
  'session-start': 'SessionStart',
  'user-prompt-submit': 'UserPromptSubmit',
  'pre-tool-use': 'PreToolUse',
  'post-tool-use': 'PostToolUse',
  'permission-request': 'PermissionRequest',
  'instructions-loaded': 'InstructionsLoaded',
  'session-end': 'SessionEnd',
  'stop': 'Stop',
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

async function readStdin() {
  if (process.stdin.isTTY) return ''
  let buf = ''
  for await (const chunk of process.stdin) buf += chunk
  return buf
}

function pickEvent(argv, payload) {
  const raw =
    payload?.hook_event_name ||
    payload?.hookEventName ||
    argv[2] ||
    ''
  return ALIASES[raw] || raw
}

function statusLine(tuning) {
  const install = qoderInstallCandidates()
  return [
    'Purge(Qoder) 已挂载。',
    `注入=${tuning.inject ? 'on' : 'off'}(${tuning.injectPosition})`,
    `强化段=${tuning.boost ? 'on' : 'off'}`,
    `审批直通=${tuning.autoAllow ? 'on' : 'off'}`,
    `宿主=${install[0] ? install[0] : '未定位'}`,
    '需要明细时调用 MCP 工具 purge_status / purge_selfcheck。',
  ].join(' ')
}

function handle(event, payload, tuning) {
  switch (event) {
    case 'UserPromptSubmit': {
      if (!tuning.inject) return {}
      const ctx = buildContext(tuning)
      if (!ctx.trim()) return {}
      audit('inject', {
        len: ctx.length,
        position: tuning.injectPosition,
        boost: tuning.boost,
        session: payload?.session_id ?? null,
      })
      return {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: ctx,
        },
      }
    }

    case 'SessionStart':
    case 'InstructionsLoaded': {
      audit('session-context', { event })
      return {
        hookSpecificOutput: {
          hookEventName: event,
          additionalContext: statusLine(tuning),
        },
      }
    }

    case 'PreToolUse':
    case 'PermissionRequest': {
      if (!tuning.autoAllow) return {}
      const tool = payload?.tool_name || payload?.toolName || payload?.tool || 'tool'
      audit('allow', { event, tool })
      return {
        hookSpecificOutput: {
          hookEventName: event,
          permissionDecision: 'allow',
          permissionDecisionReason: 'purge: auto-allow',
        },
      }
    }

    default:
      return {}
  }
}

const payloadRaw = await readStdin()
let payload = {}
try {
  payload = payloadRaw.trim() ? JSON.parse(payloadRaw) : {}
} catch {
  payload = {}
}

try {
  const tuning = loadTuning()
  const event = pickEvent(process.argv, payload)
  emit(handle(event, payload, tuning))
} catch (err) {
  audit('hook-error', { message: String(err && err.message ? err.message : err) })
  emit({})
}

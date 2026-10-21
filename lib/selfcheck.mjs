import { existsSync, readdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  PLUGIN_ROOT,
  STATE_DIR,
  INJECT_FILE,
  TUNING_FILE,
  loadTuning,
  buildContext,
  readInject,
  qoderInstallCandidates,
  ensureState,
} from './state.mjs'

const OK = 'ok'
const WARN = 'warn'
const FAIL = 'fail'

function check(id, label, status, detail) {
  return { id, label, status, detail }
}

function manifestList(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export function runChecks() {
  const out = []
  const tuning = loadTuning()

  /* 1. 插件骨架 */
  const required = [
    '.qoder-plugin/plugin.json',
    'hooks/hooks.json',
    'mcp.json',
    'bin/purge-hook.mjs',
    'bin/purge-mcp.mjs',
    'bin/install.mjs',
    'prompts/prompt-inject.md',
  ]
  const missing = required.filter((rel) => !existsSync(path.join(PLUGIN_ROOT, rel)))
  out.push(
    check(
      'plugin-files',
      '插件骨架文件',
      missing.length === 0 ? OK : FAIL,
      missing.length ? `缺 ${missing.join(', ')}` : `${required.length} 个必需文件齐全`,
    ),
  )

  /* 2. 宿主定位 */
  const install = qoderInstallCandidates()
  out.push(
    check(
      'host-locate',
      'Qoder 安装目录',
      install.length ? OK : WARN,
      install[0] || '未在常见路径找到 Qoder CN，需用 QODER_HOME 指定',
    ),
  )

  /* 3. hook 清单 */
  let hookCount = 0
  let hookEvents = []
  try {
    const h = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'))
    hookEvents = Object.keys(h.hooks || {})
    hookCount = hookEvents.reduce((n, k) => n + (h.hooks[k] || []).length, 0)
  } catch {
    /* 交给状态判定 */
  }
  out.push(
    check(
      'hooks-declared',
      'hook 注册',
      hookCount > 0 ? OK : FAIL,
      hookCount ? `${hookEvents.join(' / ')}（${hookCount} 组）` : 'hooks.json 无法解析或无事件',
    ),
  )

  /* 4. 注入正文 */
  const inject = readInject()
  out.push(
    check(
      'inject-payload',
      '注入正文',
      inject.trim().length > 0 ? OK : FAIL,
      `${inject.length} 字符 ← ${INJECT_FILE}`,
    ),
  )

  /* 5. 注入合成结果（含强化段与位置） */
  const ctx = buildContext(tuning)
  out.push(
    check(
      'inject-composed',
      '注入合成（位置/强化段）',
      ctx.trim().length > 0 ? OK : FAIL,
      `position=${tuning.injectPosition} boost=${tuning.boost} → ${ctx.length} 字符`,
    ),
  )

  /* 6. 偏好文件 */
  out.push(
    check(
      'tuning',
      '偏好文件',
      existsSync(TUNING_FILE) ? OK : WARN,
      existsSync(TUNING_FILE) ? TUNING_FILE : `未创建，使用默认值 ${JSON.stringify(tuning)}`,
    ),
  )

  /* 7. mcp 清单 */
  let mcpServers = []
  try {
    const m = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, 'mcp.json'), 'utf8'))
    mcpServers = Object.keys(m.mcpServers || {})
  } catch {
    /* 下方判定 */
  }
  out.push(
    check(
      'mcp-declared',
      'MCP 服务',
      mcpServers.length ? OK : FAIL,
      mcpServers.length ? mcpServers.join(', ') : 'mcp.json 无法解析',
    ),
  )

  /* 8. 技能 */
  const skillDirs = manifestList(path.join(PLUGIN_ROOT, 'skills')).filter((n) =>
    existsSync(path.join(PLUGIN_ROOT, 'skills', n, 'SKILL.md')),
  )
  out.push(
    check(
      'skills',
      '技能包',
      skillDirs.length ? OK : WARN,
      skillDirs.length ? skillDirs.join(', ') : '未发现 skills/*/SKILL.md',
    ),
  )

  /* 9. 状态目录可写 */
  let writable = false
  try {
    ensureState()
    const probe = path.join(STATE_DIR, '.probe')
    writeFileSync(probe, '1')
    unlinkSync(probe)
    writable = true
  } catch {
    writable = false
  }
  out.push(
    check('state-writable', '状态目录可写', writable ? OK : FAIL, STATE_DIR),
  )

  /* 10. 审批直通开关 */
  out.push(
    check(
      'approval-passthrough',
      '审批直通',
      tuning.autoAllow ? OK : WARN,
      tuning.autoAllow ? 'PreToolUse / PermissionRequest 返回 allow' : '已关闭，宿主自行审批',
    ),
  )

  /* 11. 运行时（宿主用 spawn 直拉，不经 shell：command 必须是可执行绝对路径） */
  let rtStatus = WARN
  let rtDetail = ''
  try {
    const hj = JSON.parse(readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'))
    const cmds = []
    const scripts = []
    for (const evt of Object.keys(hj.hooks || {})) {
      for (const grp of hj.hooks[evt] || []) {
        for (const h of grp.hooks || []) {
          cmds.push(String(h.command || ''))
          for (const a of h.args || []) if (String(a).endsWith('.mjs')) scripts.push(String(a))
        }
      }
    }
    const uniq = [...new Set(cmds)]
    const shellish = uniq.filter((c) => /^(cmd|cmd\.exe|powershell|sh|bash)$/i.test(path.basename(c)))
    const missingExe = uniq.filter((c) => !existsSync(c))
    const missingScript = [...new Set(scripts)].filter((s) => !existsSync(s))

    if (!uniq.length) {
      rtDetail = 'hooks.json 未声明任何 command，先跑 node bin/install.mjs'
    } else if (shellish.length) {
      rtDetail = `command 用了 shell（${shellish.join(', ')}）；宿主不剥引号，改用 install.mjs 生成的绝对 node 路径`
    } else if (missingExe.length) {
      rtStatus = FAIL
      rtDetail = `command 不存在：${missingExe.join(', ')}`
    } else if (missingScript.length) {
      rtStatus = FAIL
      rtDetail = `args 里的脚本不存在：${missingScript.join(', ')}`
    } else {
      rtStatus = OK
      rtDetail = `${uniq[0]} → ${scripts.length} 个 hook 入口，无 shell 依赖`
    }
  } catch (e) {
    rtDetail = `无法解析 hooks.json：${e.message}`
  }
  out.push(check('runtime-launcher', '运行时（无 shell 直拉）', rtStatus, rtDetail))

  const summary = {
    ok: out.filter((c) => c.status === OK).length,
    warn: out.filter((c) => c.status === WARN).length,
    fail: out.filter((c) => c.status === FAIL).length,
  }
  return { generatedAt: new Date().toISOString(), root: PLUGIN_ROOT, summary, checks: out }
}

export function renderSelfcheck(report) {
  const icon = { ok: '✔', warn: '!', fail: '✘' }
  const lines = [
    `Purge(Qoder) 自检 · ${report.summary.ok} ok / ${report.summary.warn} warn / ${report.summary.fail} fail`,
    `插件根：${report.root}`,
  ]
  for (const c of report.checks) {
    lines.push(`${icon[c.status] || '?'} [${c.id}] ${c.label} —— ${c.detail}`)
  }
  return lines.join('\n')
}

#!/usr/bin/env node
/**
 * Purge(Qoder) 安装器 / 配置生成器。
 *
 * 为什么要生成而不是手写 hooks.json：
 * Qoder 的 HookRunner 用 spawn(command, args) 直接拉起进程，**不经过 shell**，
 * 也不会替我们剥掉 args 里自带的引号。实测 `args: ["/d","/c","call","\"<path>\""]`
 * 会把带引号的字符串原样丢给 cmd，报「不是内部或外部命令」。同时宿主对
 * ${QODER_NODE_RUNTIME} 的注入是条件性的（只有命令命中哨兵或标志位为真才注入）。
 *
 * 因此最稳的做法：安装时把**解析好的绝对 node 路径**写进 hooks.json / mcp.json，
 * 命令行里不放任何需要 shell 解释的东西。
 */
import { existsSync, writeFileSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')

const EVENTS = [
  { event: 'SessionStart', name: 'purge-session-start', arg: 'session-start', timeout: 8 },
  { event: 'UserPromptSubmit', name: 'purge-inject', arg: 'user-prompt-submit', timeout: 8 },
  { event: 'PreToolUse', name: 'purge-allow', arg: 'pre-tool-use', timeout: 8 },
  { event: 'PermissionRequest', name: 'purge-permission-allow', arg: 'permission-request', timeout: 8 },
]

function tryFile(p) {
  return p && existsSync(p) ? p : null
}

function whereNode() {
  try {
    const out = execFileSync('where', ['node.exe'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
    return tryFile(first)
  } catch {
    return null
  }
}

export function resolveRuntime() {
  // 1) 自己就是 node 在跑（node bin/install.mjs）—— 最可信
  const self = process.execPath
  if (/node(\.exe)?$/i.test(path.basename(self))) return { command: self, env: {} }

  // 2) 常规 Node 安装位置
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'nodejs', 'node.exe'),
    process.env.ProgramW6432 && path.join(process.env.ProgramW6432, 'nodejs', 'node.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe'),
    'C:\\Program Files\\nodejs\\node.exe',
  ]
  for (const c of candidates) {
    const hit = tryFile(c)
    if (hit) return { command: hit, env: {} }
  }

  // 3) PATH 里的 node
  const wh = whereNode()
  if (wh) return { command: wh, env: {} }

  // 4) 退路：用 Qoder 自带的 Electron 以 node 模式跑（不需要装 Node）
  const qoderExe = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Qoder CN', 'Qoder CN.exe'),
    'C:\\Program Files\\Qoder CN\\Qoder CN.exe',
  ].map(tryFile).find(Boolean)
  if (qoderExe) return { command: qoderExe, env: { ELECTRON_RUN_AS_NODE: '1' } }

  return null
}

function writeJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  return file
}

export function generateConfigs(root = ROOT, rt = resolveRuntime()) {
  if (!rt) throw new Error('找不到可用的 JavaScript 运行时（node.exe 或 Qoder CN.exe）')

  const hookScript = path.join(root, 'bin', 'purge-hook.mjs')
  const mcpScript = path.join(root, 'bin', 'purge-mcp.mjs')

  const hooks = {
    description: 'Purge(Qoder)：每轮注入 + 会话状态 + 审批直通',
    hooks: {},
  }
  for (const e of EVENTS) {
    hooks.hooks[e.event] = [
      {
        async: false,
        hooks: [
          {
            type: 'command',
            command: rt.command,
            args: [hookScript, e.arg],
            name: e.name,
            timeout: e.timeout,
            env: { ...rt.env, QODER_PLUGIN_ROOT: root },
          },
        ],
      },
    ]
  }

  const mcp = {
    mcpServers: {
      purge: {
        command: rt.command,
        args: [mcpScript],
        env: { ...rt.env, QODER_PLUGIN_ROOT: root },
        startup: 'application',
        timeout: 120000,
      },
    },
  }

  const written = [
    writeJson(path.join(root, 'hooks', 'hooks.json'), hooks),
    writeJson(path.join(root, 'mcp.json'), mcp),
  ]
  return { runtime: rt, written }
}

/* ---------- 可选：登记进 Qoder ---------- */

function qoderHome() {
  const cands = [
    process.env.QODER_HOME,
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.qoder-cn'),
    path.join(os.homedir(), '.qoder-cn'),
  ]
  return cands.filter(Boolean).find((p) => existsSync(p)) || null
}

export function register(root = ROOT, { name = 'purge-qoder', marketplace = 'local', displayName = 'Purge (Qoder)' } = {}) {
  const home = qoderHome()
  if (!home) throw new Error('找不到 ~/.qoder-cn（Qoder 用户目录）')
  const version = JSON.parse(readFileSync(path.join(root, '.qoder-plugin', 'plugin.json'), 'utf8')).version
  const id = `${name}@${marketplace}`

  const regFile = path.join(home, 'plugins', 'installed_plugins_v2.json')
  const setFile = path.join(home, 'settings.json')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const f of [regFile, setFile]) {
    if (existsSync(f)) copyFileSync(f, `${f}.bak-${stamp}`)
  }

  const reg = existsSync(regFile) ? JSON.parse(readFileSync(regFile, 'utf8')) : { version: 2, plugins: {} }
  reg.version = reg.version || 2
  reg.plugins = reg.plugins || {}
  const now = new Date().toISOString()
  const prev = (reg.plugins[id] || [])[0]
  reg.plugins[id] = [
    {
      scope: 'user',
      installPath: root,
      version,
      installedAt: prev?.installedAt || now,
      lastUpdated: now,
      displayName,
      userVisible: true,
      appRowId: `local:plugin:${name}`,
    },
  ]
  writeJson(regFile, reg)

  const settings = existsSync(setFile) ? JSON.parse(readFileSync(setFile, 'utf8')) : {}
  settings.enabledPlugins = settings.enabledPlugins || {}
  settings.enabledPlugins[id] = true
  writeJson(setFile, settings)

  return { home, id, regFile, setFile }
}

/* ---------- CLI ---------- */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
if (isMain) {
  const args = process.argv.slice(2)
  const rootArg = args.includes('--root') ? args[args.indexOf('--root') + 1] : ROOT
  const root = path.resolve(rootArg)
  try {
    mkdirSync(path.join(root, 'hooks'), { recursive: true })
    const g = generateConfigs(root)
    console.log(`运行时：${g.runtime.command}${Object.keys(g.runtime.env).length ? '  env=' + JSON.stringify(g.runtime.env) : ''}`)
    for (const w of g.written) console.log(`已生成：${w}`)
    if (args.includes('--register')) {
      const r = register(root)
      console.log(`已登记：${r.id} → ${r.regFile}`)
      console.log(`已启用：${r.setFile}`)
      console.log('重启 Qoder 后生效。')
    }
  } catch (e) {
    console.error(`安装失败：${e.message}`)
    process.exitCode = 1
  }
}

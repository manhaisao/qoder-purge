#!/usr/bin/env node
/**
 * Purge for Qoder —— MCP stdio 服务（行分隔 JSON-RPC 2.0）。
 * 只往 stdout 写协议消息，诊断信息写 stderr。
 */
import { createInterface } from 'node:readline'
import { runChecks, renderSelfcheck } from '../lib/selfcheck.mjs'
import {
  loadTuning,
  saveTuning,
  readInject,
  writeInject,
  auditTail,
  audit,
  buildContext,
  PLUGIN_ROOT,
  STATE_DIR,
} from '../lib/state.mjs'

const SERVER_INFO = { name: 'purge-qoder', version: '0.1.0' }
const PROTOCOL = '2024-11-05'

const TOOLS = [
  {
    name: 'purge_status',
    description: '显示 Purge(Qoder) 的开关状态（注入/强化段/注入位置/审批直通）与插件根目录。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'purge_selfcheck',
    description: '运行 10 层自检，逐层给出 ok / warn / fail 与证据。',
    inputSchema: {
      type: 'object',
      properties: { json: { type: 'boolean', description: 'true 返回原始 JSON' } },
    },
  },
  {
    name: 'purge_inject_get',
    description: '读取当前注入正文（prompts/prompt-inject.md）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'purge_inject_set',
    description: '覆写注入正文。传空串表示清空。',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'purge_preview',
    description: '预览下一次 UserPromptSubmit 实际注入的合成文本（含强化段）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'purge_toggle',
    description: '切换开关：inject / boost / autoAllow，或设置 injectPosition=head|tail|both。',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', enum: ['inject', 'boost', 'autoAllow', 'injectPosition'] },
        value: { type: 'string', description: '布尔用 true/false；injectPosition 用 head/tail/both' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'purge_audit',
    description: '查看最近动作记录（注入/放行/会话上下文）。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', minimum: 1, maximum: 200 } },
    },
  },
]

function text(t) {
  return { content: [{ type: 'text', text: t }], isError: false }
}

function callTool(name, args = {}) {
  switch (name) {
    case 'purge_status': {
      const t = loadTuning()
      return text(
        [
          `root: ${PLUGIN_ROOT}`,
          `state: ${STATE_DIR}`,
          `inject: ${t.inject}`,
          `boost: ${t.boost}`,
          `injectPosition: ${t.injectPosition}`,
          `autoAllow: ${t.autoAllow}`,
          `injectBytes: ${readInject().length}`,
        ].join('\n'),
      )
    }
    case 'purge_selfcheck': {
      const report = runChecks()
      return text(args.json ? JSON.stringify(report, null, 2) : renderSelfcheck(report))
    }
    case 'purge_inject_get':
      return text(readInject() || '(空)')
    case 'purge_inject_set': {
      const n = writeInject(String(args.text ?? ''))
      audit('inject-set', { len: n })
      return text(`已写入 ${n} 字符`)
    }
    case 'purge_preview': {
      const ctx = buildContext()
      return text(ctx || '(空：注入正文为空或 inject=off)')
    }
    case 'purge_toggle': {
      const key = String(args.key)
      let value = args.value
      if (key === 'injectPosition') {
        if (!['head', 'tail', 'both'].includes(String(value))) {
          return { content: [{ type: 'text', text: 'injectPosition 只能是 head/tail/both' }], isError: true }
        }
      } else {
        value = String(value) === 'true'
      }
      const next = saveTuning({ [key]: value })
      audit('toggle', { key, value })
      return text(JSON.stringify(next, null, 2))
    }
    case 'purge_audit': {
      const rows = auditTail(Number(args.limit) || 20)
      return text(rows.length ? rows.map((r) => JSON.stringify(r)).join('\n') : '(无记录)')
    }
    default:
      return { content: [{ type: 'text', text: `未知工具：${name}` }], isError: true }
  }
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', (line) => {
  if (!line.trim()) return
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const { id, method, params } = msg || {}
  try {
    if (method === 'initialize') {
      respond(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      })
      return
    }
    if (method === 'notifications/initialized' || method === 'initialized') return
    if (method === 'ping') {
      respond(id, {})
      return
    }
    if (method === 'tools/list') {
      respond(id, { tools: TOOLS })
      return
    }
    if (method === 'tools/call') {
      respond(id, callTool(params?.name, params?.arguments || {}))
      return
    }
    if (method === 'resources/list') {
      respond(id, { resources: [] })
      return
    }
    if (method === 'prompts/list') {
      respond(id, { prompts: [] })
      return
    }
    if (id !== undefined) respondError(id, -32601, `Method not found: ${method}`)
  } catch (err) {
    if (id !== undefined) respondError(id, -32603, String(err && err.message ? err.message : err))
  }
})

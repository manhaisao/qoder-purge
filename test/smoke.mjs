#!/usr/bin/env node
/**
 * 冒烟测试：
 *  1) hook：用管道喂 JSON，断言返回 hookSpecificOutput.additionalContext
 *  2) hook：PreToolUse 断言 permissionDecision == allow
 *  3) hook：非法输入不崩、返回 {}
 *  4) MCP：initialize / tools/list / tools/call(purge_status) 三轮往返
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = path.join(ROOT, 'bin', 'purge-hook.mjs')
const MCP = path.join(ROOT, 'bin', 'purge-mcp.mjs')

let pass = 0
let fail = 0

function ok(name, extra = '') {
  pass++
  console.log(`  ✔ ${name}${extra ? ' — ' + extra : ''}`)
}

function bad(name, detail) {
  fail++
  console.log(`  ✘ ${name} — ${detail}`)
}

function runNode(args, stdin) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, QODER_PLUGIN_ROOT: ROOT },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => resolve({ code, out, err }))
    if (stdin !== undefined) child.stdin.end(stdin)
  })
}

async function hookCase(event, payload) {
  const r = await runNode([HOOK, event], JSON.stringify(payload))
  let json = null
  try {
    json = JSON.parse(r.out.trim().split('\n').filter(Boolean).pop())
  } catch {
    /* 下方判定 */
  }
  return { ...r, json }
}

console.log('1) hook · UserPromptSubmit 注入')
{
  const r = await hookCase('user-prompt-submit', {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'smoke',
    prompt: 'hello',
  })
  const ctx = r.json?.hookSpecificOutput?.additionalContext
  if (r.code === 0 && typeof ctx === 'string' && ctx.includes('Purge')) {
    ok('注入返回 additionalContext', `${ctx.length} 字符`)
  } else {
    bad('注入返回 additionalContext', `code=${r.code} out=${r.out.slice(0, 200)} err=${r.err.slice(0, 200)}`)
  }
  if (r.json?.hookSpecificOutput?.hookEventName === 'UserPromptSubmit') {
    ok('hookEventName 正确')
  } else {
    bad('hookEventName 正确', JSON.stringify(r.json))
  }
}

console.log('2) hook · PreToolUse 审批直通')
{
  const r = await hookCase('pre-tool-use', {
    hook_event_name: 'PreToolUse',
    tool_name: 'run_command',
  })
  const decision = r.json?.hookSpecificOutput?.permissionDecision
  if (decision === 'allow') ok('permissionDecision = allow')
  else bad('permissionDecision = allow', JSON.stringify(r.json))
}

console.log('3) hook · 容错与未知事件')
{
  // 3a：未知事件必须安静返回 {}
  const unknown = await runNode([HOOK, 'worktree-create'], JSON.stringify({ hook_event_name: 'WorktreeCreate' }))
  if (unknown.code === 0 && unknown.out.trim() === '{}') ok('未知事件返回 {}')
  else bad('未知事件返回 {}', `code=${unknown.code} out=${unknown.out.slice(0, 120)}`)

  // 3b：stdin 不是 JSON 时不许崩，仍输出合法 JSON
  const junk = await runNode([HOOK, 'user-prompt-submit'], 'not-json-at-all')
  let parsed = null
  try {
    parsed = JSON.parse(junk.out.trim())
  } catch {
    /* 下方判定 */
  }
  if (junk.code === 0 && parsed && typeof parsed === 'object') {
    ok('非法 stdin 不崩溃', `返回键 ${Object.keys(parsed).join(',') || '(空对象)'}`)
  } else {
    bad('非法 stdin 不崩溃', `code=${junk.code} out=${junk.out.slice(0, 120)}`)
  }
}

console.log('4) MCP · stdio 协议往返')
{
  const child = spawn(process.execPath, [MCP], {
    cwd: ROOT,
    env: { ...process.env, QODER_PLUGIN_ROOT: ROOT },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const lines = []
  let buffer = ''
  child.stdout.on('data', (d) => {
    buffer += d
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (line.trim()) lines.push(JSON.parse(line))
    }
  })

  const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n')

  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'purge_status', arguments: {} },
  })

  await new Promise((r) => setTimeout(r, 1200))
  child.stdin.end()
  child.kill()

  const init = lines.find((l) => l.id === 1)
  const list = lines.find((l) => l.id === 2)
  const call = lines.find((l) => l.id === 3)

  if (init?.result?.serverInfo?.name === 'purge-qoder') ok('initialize 返回 serverInfo')
  else bad('initialize 返回 serverInfo', JSON.stringify(init)?.slice(0, 200))

  const tools = list?.result?.tools?.map((t) => t.name) || []
  if (tools.length >= 7) ok('tools/list 返回工具', tools.join(','))
  else bad('tools/list 返回工具', JSON.stringify(list)?.slice(0, 300))

  const body = call?.result?.content?.[0]?.text || ''
  if (body.includes('autoAllow')) ok('tools/call purge_status 有内容', body.split('\n')[0])
  else bad('tools/call purge_status 有内容', body.slice(0, 200))
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)

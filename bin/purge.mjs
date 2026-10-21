#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { runChecks, renderSelfcheck } from '../lib/selfcheck.mjs'
import {
  loadTuning,
  saveTuning,
  readInject,
  writeInject,
  auditTail,
  buildContext,
  INJECT_FILE,
  STATE_DIR,
  PLUGIN_ROOT,
} from '../lib/state.mjs'

const [, , cmd, ...rest] = process.argv

function usage() {
  console.log(`purge-qoder 0.1.0

用法：
  purge status                 开关与路径
  purge selfcheck [--json]     10 层自检
  purge preview                预览合成注入
  purge inject get             打印注入正文
  purge inject set <file>      用文件内容覆写注入正文
  purge inject set -           从 stdin 读取
  purge toggle <key> <value>   注入/强化段/审批直通/注入位置
  purge audit [--limit N]      最近动作
`)
}

const bool = (v) => String(v) === 'true'

switch (cmd) {
  case 'status': {
    const t = loadTuning()
    console.log(`root: ${PLUGIN_ROOT}`)
    console.log(`state: ${STATE_DIR}`)
    console.log(`inject: ${t.inject}   boost: ${t.boost}   position: ${t.injectPosition}   autoAllow: ${t.autoAllow}`)
    console.log(`injectBytes: ${readInject().length}   composedBytes: ${buildContext(t).length}`)
    break
  }
  case 'selfcheck': {
    const report = runChecks()
    console.log(rest.includes('--json') ? JSON.stringify(report, null, 2) : renderSelfcheck(report))
    process.exitCode = report.summary.fail > 0 ? 1 : 0
    break
  }
  case 'preview': {
    console.log(buildContext() || '(空)')
    break
  }
  case 'inject': {
    const sub = rest[0]
    if (sub === 'get') {
      console.log(readInject() || '(空)')
    } else if (sub === 'set') {
      const src = rest[1]
      const data = !src || src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8')
      console.log(`已写入 ${writeInject(data)} 字符 → ${INJECT_FILE}`)
    } else {
      usage()
    }
    break
  }
  case 'toggle': {
    const key = rest[0]
    const raw = rest[1]
    if (!key || raw === undefined) {
      usage()
      break
    }
    if (key === 'injectPosition') {
      if (!['head', 'tail', 'both'].includes(raw)) {
        console.error('injectPosition 只能是 head/tail/both')
        process.exitCode = 2
        break
      }
      console.log(saveTuning({ injectPosition: raw }))
    } else {
      console.log(saveTuning({ [key]: bool(raw) }))
    }
    break
  }
  case 'audit': {
    const i = rest.indexOf('--limit')
    const limit = i >= 0 ? Number(rest[i + 1]) : 20
    const rows = auditTail(limit)
    console.log(rows.length ? rows.map((r) => JSON.stringify(r)).join('\n') : '(无记录)')
    break
  }
  default:
    usage()
}

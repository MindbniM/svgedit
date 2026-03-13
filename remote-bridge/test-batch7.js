/**
 * @file test-batch7.js
 * @description 只测试第 7 批：克隆/复制/粘贴（含差集检测备用方案）
 *
 * 运行: node test-batch7.js
 */

import { SvgRemoteClient } from './client.js'
import * as readline from 'readline'

function sleep (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

function waitForEnter (prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase())
    })
  })
}

function log (msg) { console.log(msg) }
function logStep (msg) { log('  \x1b[33m▸\x1b[0m ' + msg) }
function logOk (msg) { log('  \x1b[32m✅\x1b[0m ' + msg) }
function logInfo (msg) { log('  \x1b[90mℹ ' + msg + '\x1b[0m') }

async function main () {
  log('')
  log('\x1b[1m╔═════════════════════════════════════════════════════════════╗\x1b[0m')
  log('\x1b[1m║   第 7 批测试：克隆/复制/粘贴（差集检测）                   ║\x1b[0m')
  log('\x1b[1m╚═════════════════════════════════════════════════════════════╝\x1b[0m')

  log('\n  ▶ 连接到中继服务 ws://localhost:9527 ...')
  const client = new SvgRemoteClient('ws://localhost:9527', {
    timeout: 15000, autoReconnect: false
  })

  try {
    await client.connect()
  } catch (err) {
    log('  ❌ 无法连接: ' + err.message)
    process.exit(1)
  }
  log('  ✅ 已连接 (编辑器在线: ' + client.isEditorOnline() + ')')

  if (!client.isEditorOnline()) {
    log('  ⏳ 等待编辑器连接...')
    await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 60000)
      client.on('editor_connected', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
    if (!client.isEditorOnline()) {
      log('  ❌ 超时')
      client.close()
      process.exit(1)
    }
    log('  ✅ 编辑器已连接！')
  }
  await sleep(500)

  // ================================================================
  //  第 7 批：克隆/复制/粘贴
  // ================================================================
  log('\x1b[36m' + '━'.repeat(64) + '\x1b[0m')
  log('\x1b[36m  第 7 批：克隆/复制/粘贴\x1b[0m')
  log('\x1b[36m' + '━'.repeat(64) + '\x1b[0m')

  await client.clear()
  await sleep(300)
  await client.setResolution(800, 600)
  await sleep(200)

  logStep('创建紫色圆角矩形')
  const cloneSrc = await client.addElement('rect', {
    x: '100', y: '150', width: '150', height: '100',
    fill: '#9B59B6', stroke: '#7D3C98', 'stroke-width': '3', rx: '15'
  })
  logOk('原始元素: ' + cloneSrc.id)

  logStep('克隆 (偏移 dx=200)')
  const cloneRes = await client.cloneSelectedElements({
    ids: [cloneSrc.id], dx: 200, dy: 0
  })
  logOk('克隆: ' + (cloneRes.ids || []).join(', '))

  logStep('再克隆 (偏移 dx=400)')
  const cloneRes2 = await client.cloneSelectedElements({
    ids: [cloneSrc.id], dx: 400, dy: 0
  })
  logOk('克隆2: ' + (cloneRes2.ids || []).join(', '))

  log('')
  log('\x1b[35m  ┌───────────────────────────────────────────────────────────┐\x1b[0m')
  log('\x1b[35m  │  🔍 请在浏览器中查看效果：                                │\x1b[0m')
  log('\x1b[35m  │    • 3 个紫色圆角矩形从左到右排列                         │\x1b[0m')
  log('\x1b[35m  │    • 第 1 个原始，后 2 个克隆                             │\x1b[0m')
  log('\x1b[35m  └───────────────────────────────────────────────────────────┘\x1b[0m')
  let answer = await waitForEnter('  \x1b[1m按回车继续测试粘贴 (输入 q 退出) ▸ \x1b[0m')
  if (answer === 'q') { client.close(); return }

  logStep('复制第一个元素')
  await client.copySelectedElements([cloneSrc.id])
  logOk('已复制')

  // 记录粘贴前的所有元素 ID
  const preIds = (await client.getAllElements()).map(e => e.id)
  logInfo('粘贴前元素 IDs: ' + preIds.join(', '))

  logStep('粘贴')
  await sleep(200)
  const pasteRes = await client.pasteElements('in_place')
  await sleep(300)

  // 获取粘贴后的新元素 ID：优先用返回结果，否则用差集方法
  let pastedId = null
  if (pasteRes.ids && pasteRes.ids.length > 0) {
    pastedId = pasteRes.ids[0]
    logOk('粘贴 (从返回值): ' + pasteRes.ids.join(', '))
  } else {
    // 差集方式查找新元素
    const postIds = (await client.getAllElements()).map(e => e.id)
    logInfo('粘贴后元素 IDs: ' + postIds.join(', '))
    const newIds = postIds.filter(id => !preIds.includes(id))
    if (newIds.length > 0) {
      pastedId = newIds[0]
      logOk('粘贴 (差集检测): ' + newIds.join(', '))
    } else {
      log('  \x1b[31m⚠ 粘贴未检测到新元素！\x1b[0m')
      logInfo('粘贴返回值: ' + JSON.stringify(pasteRes))
    }
  }

  if (pastedId) {
    logStep('移动粘贴元素到下方 (x:100, y:350)')
    await client.moveElement(pastedId, { x: 100, y: 350 })
    await sleep(200)
    logOk('已移动粘贴元素')
  } else {
    log('  \x1b[31m⚠ 无法移动：未找到粘贴的元素\x1b[0m')
  }

  log('')
  log('\x1b[35m  ┌───────────────────────────────────────────────────────────┐\x1b[0m')
  log('\x1b[35m  │  🔍 请在浏览器中查看效果：                                │\x1b[0m')
  log('\x1b[35m  │    • 底部应多了一个粘贴的紫色矩形                         │\x1b[0m')
  log('\x1b[35m  │    • 共 4 个紫色圆角矩形                                  │\x1b[0m')
  log('\x1b[35m  └───────────────────────────────────────────────────────────┘\x1b[0m')

  await waitForEnter('  \x1b[1m按回车结束 ▸ \x1b[0m')

  client.close()
  log('\n  \x1b[90m连接已关闭，测试结束\x1b[0m\n')
}

main().catch(err => {
  console.error('测试脚本意外错误:', err)
  process.exit(1)
})

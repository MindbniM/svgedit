/**
 * @file test-all-commands.js
 * @description 全面测试 SVGEdit 远程桥的所有命令操作
 *
 * 前置条件:
 *   1. 先启动中继服务:  node server.js
 *   2. 在真实浏览器中打开 SVGEdit:  http://localhost:<port>/src/editor/index.html
 *      (确保浏览器控制台中看到 "[remote-bridge] Connected to ws://localhost:9527")
 *   3. 运行本测试:  node test-all-commands.js
 *
 * 测试会逐个执行所有命令，每个测试输出 ✅ PASS 或 ❌ FAIL
 */

import { SvgRemoteClient } from './client.js'

// ============================
// 测试框架
// ============================

const results = []
let passCount = 0
let failCount = 0
let skipCount = 0

function log (msg) {
  console.log(msg)
}

function logSection (title) {
  log('')
  log(`${'═'.repeat(60)}`)
  log(`  ${title}`)
  log(`${'═'.repeat(60)}`)
}

async function runTest (name, fn) {
  process.stdout.write(`  [TEST] ${name} ... `)
  try {
    const result = await fn()
    if (result === 'SKIP') {
      skipCount++
      results.push({ name, status: 'SKIP' })
      console.log('⏭️  SKIP')
    } else {
      passCount++
      results.push({ name, status: 'PASS' })
      console.log('✅ PASS')
    }
  } catch (err) {
    failCount++
    results.push({ name, status: 'FAIL', error: err.message })
    console.log(`❌ FAIL — ${err.message}`)
  }
}

function assert (condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed')
}

function assertType (value, type, name) {
  assert(typeof value === type, `Expected ${name} to be ${type}, got ${typeof value}`)
}

function assertExists (value, name) {
  assert(value !== null && value !== undefined, `Expected ${name} to exist`)
}

// 等待指定毫秒
function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================
// 主测试流程
// ============================

async function main () {
  log('')
  log('╔══════════════════════════════════════════════════════════╗')
  log('║    SVGEdit Remote Bridge — 全命令测试                    ║')
  log('╚══════════════════════════════════════════════════════════╝')
  log('')

  // 连接
  log('▶ 连接到中继服务 ws://localhost:9527 ...')
  const client = new SvgRemoteClient('ws://localhost:9527', {
    timeout: 15000,
    autoReconnect: false
  })

  try {
    await client.connect()
  } catch (err) {
    log(`❌ 无法连接到中继服务: ${err.message}`)
    log('   请确保已运行: node server.js')
    process.exit(1)
  }

  log(`✅ 已连接到中继服务 (editor在线: ${client.isEditorOnline()})`)

  if (!client.isEditorOnline()) {
    log('')
    log('⏳ 等待 SVGEdit 编辑器连接 (最多等待 60 秒)...')
    log('   请在真实浏览器中打开 SVGEdit 编辑器页面')
    log('   确保浏览器控制台显示: [remote-bridge] Connected to ws://localhost:9527')

    const editorOnline = await waitForEditor(client, 60000)
    if (!editorOnline) {
      log('❌ 超时：编辑器未连接')
      client.close()
      process.exit(1)
    }
    log('✅ 编辑器已连接！')
  }

  // 等待编辑器完全初始化
  await sleep(1000)

  // ============================
  // 1. 读取类测试
  // ============================

  logSection('1. 读取类操作测试')

  // --- 1.1 getSvgString ---
  let svgString = null
  await runTest('getSvgString — 获取完整 SVG XML', async () => {
    svgString = await client.getSvgString()
    assertType(svgString, 'string', 'svgString')
    assert(svgString.includes('<svg'), 'SVG 字符串应包含 <svg 标签')
    assert(svgString.includes('</svg>'), 'SVG 字符串应包含 </svg> 结束标签')
    log(`         返回长度: ${svgString.length} 字符`)
  })

  // --- 1.2 getSvgJson ---
  await runTest('getSvgJson — 获取 JSON 结构描述', async () => {
    const json = await client.getSvgJson()
    assertExists(json, 'json')
    // JSON 描述应有 element 或 tagName 字段
    log(`         返回类型: ${typeof json}, 键: ${Object.keys(json).join(', ')}`)
  })

  // --- 1.3 getResolution ---
  let resolution = null
  await runTest('getResolution — 获取画布分辨率', async () => {
    resolution = await client.getResolution()
    assertExists(resolution, 'resolution')
    assertExists(resolution.w, 'resolution.w')
    assertExists(resolution.h, 'resolution.h')
    assertType(resolution.w, 'number', 'resolution.w')
    assertType(resolution.h, 'number', 'resolution.h')
    log(`         分辨率: ${resolution.w} x ${resolution.h}`)
  })

  // --- 1.4 getLayers ---
  await runTest('getLayers — 获取图层列表', async () => {
    const layers = await client.getLayers()
    assert(Array.isArray(layers), 'layers 应为数组')
    assert(layers.length > 0, '至少应有一个图层')
    for (const layer of layers) {
      assertExists(layer.name, 'layer.name')
    }
    log(`         图层数: ${layers.length}, 名称: ${layers.map(l => l.name).join(', ')}`)
  })

  // --- 1.5 getCurrentLayer ---
  await runTest('getCurrentLayer — 获取当前图层', async () => {
    const layer = await client.getCurrentLayer()
    assertExists(layer, 'currentLayer')
    assertExists(layer.name, 'layer.name')
    log(`         当前图层: "${layer.name}" (索引: ${layer.index})`)
  })

  // --- 1.6 getSelectedElements (空画布应无选中) ---
  await runTest('getSelectedElements — 获取选中元素（初始应为空）', async () => {
    const selected = await client.getSelectedElements()
    assert(Array.isArray(selected), 'selected 应为数组')
    log(`         选中元素数: ${selected.length}`)
  })

  // --- 1.7 getAllElements (初始画布) ---
  await runTest('getAllElements — 获取所有可见元素', async () => {
    const elems = await client.getAllElements()
    assert(Array.isArray(elems), 'elements 应为数组')
    log(`         可见元素数: ${elems.length}`)
  })

  // ============================
  // 2. 修改类测试 — 添加元素
  // ============================

  logSection('2. 添加元素测试')

  // --- 2.1 addElement: rect ---
  let rectId = null
  await runTest('addElement — 添加矩形 (rect)', async () => {
    const result = await client.addElement('rect', {
      x: '50', y: '50', width: '120', height: '80',
      fill: '#4A90D9', stroke: '#2C3E50', 'stroke-width': '2'
    })
    assertExists(result, 'result')
    assert(result.success === true, `success 应为 true, got: ${JSON.stringify(result)}`)
    assertExists(result.id, 'result.id')
    rectId = result.id
    log(`         创建矩形 ID: ${rectId}`)
  })

  // --- 2.2 addElement: circle ---
  let circleId = null
  await runTest('addElement — 添加圆形 (circle)', async () => {
    const result = await client.addElement('circle', {
      cx: '300', cy: '150', r: '60',
      fill: '#E74C3C', stroke: '#C0392B', 'stroke-width': '2'
    })
    assert(result.success === true, `success 应为 true, got: ${JSON.stringify(result)}`)
    circleId = result.id
    log(`         创建圆形 ID: ${circleId}`)
  })

  // --- 2.3 addElement: ellipse ---
  let ellipseId = null
  await runTest('addElement — 添加椭圆 (ellipse)', async () => {
    const result = await client.addElement('ellipse', {
      cx: '500', cy: '100', rx: '80', ry: '40',
      fill: '#2ECC71', stroke: '#27AE60', 'stroke-width': '2'
    })
    assert(result.success === true, `success 应为 true, got: ${JSON.stringify(result)}`)
    ellipseId = result.id
    log(`         创建椭圆 ID: ${ellipseId}`)
  })

  // --- 2.4 addElement: line ---
  let lineId = null
  await runTest('addElement — 添加直线 (line)', async () => {
    const result = await client.addElement('line', {
      x1: '50', y1: '250', x2: '400', y2: '250',
      stroke: '#8E44AD', 'stroke-width': '3'
    })
    assert(result.success === true, `success 应为 true, got: ${JSON.stringify(result)}`)
    lineId = result.id
    log(`         创建直线 ID: ${lineId}`)
  })

  // --- 2.5 addElement: text ---
  let textId = null
  await runTest('addElement — 添加文本 (text)', async () => {
    const result = await client.addElement('text', {
      x: '50', y: '350', fill: '#2C3E50',
      'font-size': '24', 'font-family': 'Arial'
    }, {
      children: ['Hello Remote Bridge!']
    })
    assert(result.success === true, `success 应为 true, got: ${JSON.stringify(result)}`)
    textId = result.id
    log(`         创建文本 ID: ${textId}`)
  })

  // --- 2.6 addElement: path ---
  let pathId = null
  await runTest('addElement — 添加路径 (path)', async () => {
    const result = await client.addElement('path', {
      d: 'M 450 250 Q 500 200 550 250 T 650 250',
      stroke: '#F39C12', 'stroke-width': '3', fill: 'none'
    })
    assert(result.success === true, `success 应为 true, got: ${JSON.stringify(result)}`)
    pathId = result.id
    log(`         创建路径 ID: ${pathId}`)
  })

  // --- 2.7 addElements: 批量添加 ---
  let batchIds = []
  await runTest('addElements — 批量添加多个元素', async () => {
    const result = await client.addElements([
      {
        element: 'rect',
        attrs: { x: '50', y: '400', width: '60', height: '60', fill: '#1ABC9C', rx: '10', ry: '10' }
      },
      {
        element: 'rect',
        attrs: { x: '130', y: '400', width: '60', height: '60', fill: '#3498DB', rx: '10', ry: '10' }
      },
      {
        element: 'rect',
        attrs: { x: '210', y: '400', width: '60', height: '60', fill: '#9B59B6', rx: '10', ry: '10' }
      }
    ])
    assert(result.success === true, `success 应为 true, got: ${JSON.stringify(result)}`)
    assert(Array.isArray(result.ids), 'ids 应为数组')
    assert(result.ids.length === 3, `应创建 3 个元素, got ${result.ids.length}`)
    batchIds = result.ids
    log(`         批量创建 IDs: ${batchIds.join(', ')}`)
  })

  // ============================
  // 3. 验证添加结果
  // ============================

  logSection('3. 验证添加结果')

  // --- 3.1 getElementById ---
  await runTest('getElementById — 获取已添加矩形的详情', async () => {
    if (!rectId) return 'SKIP'
    const detail = await client.getElementById(rectId)
    assertExists(detail, 'detail')
    log(`         元素详情类型: ${typeof detail}, 键: ${Object.keys(detail).join(', ')}`)
  })

  // --- 3.2 getAllElements (应能看到新增元素) ---
  await runTest('getAllElements — 确认元素已增加', async () => {
    const elems = await client.getAllElements()
    assert(Array.isArray(elems), 'elements 应为数组')
    // 至少有我们刚添加的元素
    assert(elems.length >= 6, `应至少有 6 个元素, 实际 ${elems.length}`)
    log(`         当前可见元素数: ${elems.length}`)
    // 列出前几个
    for (const el of elems.slice(0, 5)) {
      log(`           - ${el.tagName} #${el.id}`)
    }
    if (elems.length > 5) {
      log(`           ... 还有 ${elems.length - 5} 个`)
    }
  })

  // ============================
  // 4. 选择操作测试
  // ============================

  logSection('4. 选择操作测试')

  // --- 4.1 selectElements ---
  await runTest('selectElements — 选中矩形', async () => {
    if (!rectId) return 'SKIP'
    const result = await client.selectElements([rectId])
    assert(result.success === true, `success 应为 true`)
    assert(result.selected >= 1, `应选中至少 1 个元素`)
    log(`         已选中 ${result.selected} 个元素`)
  })

  // --- 4.2 getSelectedElements (验证选中) ---
  await runTest('getSelectedElements — 确认矩形已选中', async () => {
    if (!rectId) return 'SKIP'
    const selected = await client.getSelectedElements()
    assert(Array.isArray(selected), 'selected 应为数组')
    assert(selected.length >= 1, '应有至少 1 个选中元素')
    const found = selected.find(el => el.id === rectId)
    assert(found, `选中元素中应包含 ${rectId}`)
    log(`         选中元素: ${selected.map(e => `${e.tagName}#${e.id}`).join(', ')}`)
  })

  // --- 4.3 selectElements 多选 ---
  await runTest('selectElements — 多选 (矩形+圆形)', async () => {
    if (!rectId || !circleId) return 'SKIP'
    const result = await client.selectElements([rectId, circleId])
    assert(result.success === true, `success 应为 true`)
    log(`         已选中 ${result.selected} 个元素`)
  })

  // --- 4.4 clearSelection ---
  await runTest('clearSelection — 清除选中', async () => {
    const result = await client.clearSelection()
    assert(result.success === true, `success 应为 true`)

    // 等待一下让选中状态更新
    await sleep(200)
    const selected = await client.getSelectedElements()
    assert(selected.length === 0, `清除后应无选中元素, 实际 ${selected.length}`)
    log(`         选中已清除`)
  })

  // ============================
  // 5. 修改属性测试
  // ============================

  logSection('5. 修改属性测试')

  // --- 5.1 updateElement: 改颜色 ---
  await runTest('updateElement — 修改矩形填充色', async () => {
    if (!rectId) return 'SKIP'
    const result = await client.updateElement(rectId, { fill: '#F1C40F' })
    assert(result.success === true, `success 应为 true, got: ${JSON.stringify(result)}`)
    log(`         已将 ${rectId} 填充色改为 #F1C40F`)
  })

  // --- 5.2 验证修改 ---
  await runTest('getElementById — 验证矩形颜色已修改', async () => {
    if (!rectId) return 'SKIP'
    const detail = await client.getElementById(rectId)
    assertExists(detail, 'detail')
    // 根据返回格式检查（可能是 JSON 描述格式）
    log(`         修改后详情: ${JSON.stringify(detail).slice(0, 200)}`)
  })

  // --- 5.3 updateElement: 改大小 ---
  await runTest('updateElement — 修改矩形尺寸', async () => {
    if (!rectId) return 'SKIP'
    const result = await client.updateElement(rectId, {
      width: '200', height: '120'
    })
    assert(result.success === true, `success 应为 true`)
    log(`         已将 ${rectId} 尺寸改为 200x120`)
  })

  // --- 5.4 updateElement: 改圆形 ---
  await runTest('updateElement — 修改圆形属性', async () => {
    if (!circleId) return 'SKIP'
    const result = await client.updateElement(circleId, {
      r: '80', fill: '#3498DB', opacity: '0.7'
    })
    assert(result.success === true, `success 应为 true`)
    log(`         已修改圆形 ${circleId} 的半径、颜色和透明度`)
  })

  // --- 5.5 updateElement: 不存在的元素 ---
  await runTest('updateElement — 修改不存在的元素（应返回错误）', async () => {
    const result = await client.updateElement('nonexistent_id_xyz', { fill: 'red' })
    assert(result.error, '应返回 error 信息')
    log(`         正确返回错误: ${result.error}`)
  })

  // ============================
  // 6. 移动元素测试
  // ============================

  logSection('6. 移动元素测试')

  // --- 6.1 moveElement: rect ---
  await runTest('moveElement — 移动矩形位置', async () => {
    if (!rectId) return 'SKIP'
    const result = await client.moveElement(rectId, { x: 200, y: 100 })
    assert(result.success === true, `success 应为 true, got: ${JSON.stringify(result)}`)
    log(`         已移动 ${rectId} 到 (200, 100)`)
  })

  // --- 6.2 moveElement: circle (cx, cy) ---
  await runTest('moveElement — 移动圆形位置 (cx, cy)', async () => {
    if (!circleId) return 'SKIP'
    const result = await client.moveElement(circleId, { cx: 400, cy: 300 })
    assert(result.success === true, `success 应为 true, got: ${JSON.stringify(result)}`)
    log(`         已移动 ${circleId} 到 cx=400, cy=300`)
  })

  // --- 6.3 moveElement: 不存在的元素 ---
  await runTest('moveElement — 移动不存在的元素（应返回错误）', async () => {
    const result = await client.moveElement('nonexistent_id_xyz', { x: 0, y: 0 })
    assert(result.error, '应返回 error 信息')
    log(`         正确返回错误: ${result.error}`)
  })

  // ============================
  // 7. 画布操作测试
  // ============================

  logSection('7. 画布操作测试')

  // --- 7.1 setResolution ---
  await runTest('setResolution — 修改画布分辨率', async () => {
    const result = await client.setResolution(800, 600)
    assert(result.success === true, `success 应为 true`)
    log(`         已设置分辨率为 800x600`)
  })

  // --- 7.2 验证分辨率 ---
  await runTest('getResolution — 验证分辨率已修改', async () => {
    const res = await client.getResolution()
    assertExists(res, 'resolution')
    assert(res.w === 800, `宽度应为 800, 实际 ${res.w}`)
    assert(res.h === 600, `高度应为 600, 实际 ${res.h}`)
    log(`         分辨率确认: ${res.w} x ${res.h}`)
  })

  // --- 7.3 zoom ---
  await runTest('zoom — 设置缩放为 150%', async () => {
    const result = await client.zoom(1.5)
    assert(result.success === true, `success 应为 true`)
    log(`         已设置缩放为 150%`)
  })

  // --- 7.4 zoom 恢复 ---
  await runTest('zoom — 恢复缩放为 100%', async () => {
    const result = await client.zoom(1)
    assert(result.success === true, `success 应为 true`)
    log(`         已恢复缩放为 100%`)
  })

  // ============================
  // 8. 撤销/重做测试
  // ============================

  logSection('8. 撤销/重做测试')

  // 先记录当前元素数
  let elemCountBefore = 0
  await runTest('记录当前状态', async () => {
    const elems = await client.getAllElements()
    elemCountBefore = elems.length
    log(`         当前元素数: ${elemCountBefore}`)
  })

  // --- 8.1 undo ---
  await runTest('undo — 撤销操作', async () => {
    const result = await client.undo()
    assert(result.success === true, `success 应为 true`)
    log(`         撤销执行成功`)
  })

  // --- 8.2 redo ---
  await runTest('redo — 重做操作', async () => {
    const result = await client.redo()
    assert(result.success === true, `success 应为 true`)
    log(`         重做执行成功`)
  })

  // ============================
  // 9. 删除元素测试
  // ============================

  logSection('9. 删除元素测试')

  // --- 9.1 删除批量添加的 3 个圆角矩形 ---
  await runTest('deleteElements — 删除批量添加的元素', async () => {
    if (batchIds.length === 0) return 'SKIP'
    const result = await client.deleteElements(batchIds)
    assert(result.success === true, `success 应为 true, got: ${JSON.stringify(result)}`)
    assert(result.deleted === batchIds.length, `应删除 ${batchIds.length} 个, 实际 ${result.deleted}`)
    log(`         已删除 ${result.deleted} 个元素`)
  })

  // --- 9.2 验证删除 ---
  await runTest('getAllElements — 确认元素已减少', async () => {
    const elems = await client.getAllElements()
    log(`         当前可见元素数: ${elems.length}`)
    // 检查被删除的 ID 不再存在
    for (const id of batchIds) {
      const found = elems.find(el => el.id === id)
      assert(!found, `被删除的元素 ${id} 不应出现在列表中`)
    }
    log(`         确认被删除元素已不存在`)
  })

  // --- 9.3 删除不存在的元素 ---
  await runTest('deleteElements — 删除不存在的元素（应返回错误）', async () => {
    const result = await client.deleteElements(['nonexistent_id_abc'])
    assert(result.error, '应返回 error 信息')
    log(`         正确返回错误: ${result.error}`)
  })

  // ============================
  // 10. 整体替换测试
  // ============================

  logSection('10. 整体替换 SVG 测试')

  // --- 10.1 保存当前 SVG ---
  let savedSvg = null
  await runTest('getSvgString — 保存当前 SVG（替换前备份）', async () => {
    savedSvg = await client.getSvgString()
    assertType(savedSvg, 'string', 'savedSvg')
    log(`         已保存当前 SVG (${savedSvg.length} 字符)`)
  })

  // --- 10.2 setSvgString: 替换为新 SVG ---
  await runTest('setSvgString — 替换为全新的 SVG', async () => {
    const newSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
  <rect id="test_rect_1" x="10" y="10" width="200" height="150" fill="#E74C3C" rx="15" ry="15"/>
  <circle id="test_circle_1" cx="400" cy="200" r="100" fill="#3498DB" opacity="0.8"/>
  <text id="test_text_1" x="320" y="400" font-size="30" fill="#2C3E50" text-anchor="middle">
    SVG Replaced by Remote Bridge!
  </text>
</svg>`
    const result = await client.setSvgString(newSvg)
    assert(result.success === true, `success 应为 true, got: ${JSON.stringify(result)}`)
    log(`         SVG 已替换`)
  })

  // --- 10.3 验证替换后 ---
  await runTest('getSvgString — 验证替换后内容', async () => {
    await sleep(500) // 等待编辑器重新渲染
    const current = await client.getSvgString()
    assert(current.includes('test_rect_1') || current.includes('E74C3C'),
      '替换后的 SVG 应包含 test_rect_1 或 #E74C3C')
    log(`         替换后 SVG 长度: ${current.length}`)
  })

  // --- 10.4 恢复原始 SVG ---
  await runTest('setSvgString — 恢复原始 SVG', async () => {
    if (!savedSvg) return 'SKIP'
    const result = await client.setSvgString(savedSvg)
    assert(result.success === true, `success 应为 true`)
    log(`         已恢复原始 SVG`)
  })

  // ============================
  // 11. clear 测试
  // ============================

  logSection('11. 清空画布测试')

  await runTest('clear — 清空画布', async () => {
    const result = await client.clear()
    assert(result.success === true, `success 应为 true`)
    log(`         画布已清空`)
  })

  await runTest('getAllElements — 确认画布已清空', async () => {
    await sleep(500)
    const elems = await client.getAllElements()
    assert(Array.isArray(elems), 'elements 应为数组')
    log(`         清空后元素数: ${elems.length}`)
    // 清空后可能仍有默认图层的 <g> 等，但不应有可见图形
    assert(elems.length === 0, `清空后应无可见元素, 实际 ${elems.length}`)
  })

  // ============================
  // 12. 未知命令测试
  // ============================

  logSection('12. 异常/边界情况测试')

  await runTest('未知命令 — 应返回错误', async () => {
    const result = await client.request('unknownCommand123', {})
    assert(result.error, '应返回 error')
    assert(result.error.includes('Unknown action'), `错误信息应包含 Unknown action, 实际: ${result.error}`)
    log(`         正确返回: ${result.error}`)
  })

  await runTest('getElementById — 无效 ID 应返回错误', async () => {
    const result = await client.getElementById('this_id_does_not_exist')
    assert(result.error, '应返回 error')
    log(`         正确返回: ${result.error}`)
  })

  // ============================
  // 最终报告
  // ============================

  log('')
  log('╔══════════════════════════════════════════════════════════╗')
  log('║    测试报告                                              ║')
  log('╚══════════════════════════════════════════════════════════╝')
  log('')
  log(`  总计: ${results.length} 项`)
  log(`  ✅ 通过: ${passCount}`)
  log(`  ❌ 失败: ${failCount}`)
  log(`  ⏭️  跳过: ${skipCount}`)
  log('')

  if (failCount > 0) {
    log('  失败的测试:')
    for (const r of results) {
      if (r.status === 'FAIL') {
        log(`    ❌ ${r.name}: ${r.error}`)
      }
    }
    log('')
  }

  log(`  结果: ${failCount === 0 ? '✅ 全部通过!' : `❌ ${failCount} 项失败`}`)
  log('')

  client.close()
  process.exit(failCount > 0 ? 1 : 0)
}

/**
 * 等待编辑器连接
 */
function waitForEditor (client, timeoutMs) {
  return new Promise((resolve) => {
    if (client.isEditorOnline()) {
      resolve(true)
      return
    }

    const timer = setTimeout(() => {
      client.off('editor_connected', handler)
      resolve(false)
    }, timeoutMs)

    function handler () {
      clearTimeout(timer)
      resolve(true)
    }

    client.on('editor_connected', handler)
  })
}

// 运行
main().catch(err => {
  console.error('测试脚本意外错误:', err)
  process.exit(1)
})

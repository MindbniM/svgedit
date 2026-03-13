/**
 * @file test-new-apis.js
 * @description 测试所有新增的 Remote Bridge API
 *
 * 前置条件:
 *   1. 先启动中继服务:  node server.js
 *   2. 在真实浏览器中打开 SVGEdit
 *   3. 运行本测试:  node test-new-apis.js
 */

import { SvgRemoteClient } from './client.js'

const results = []
let passCount = 0
let failCount = 0
let skipCount = 0

function log (msg) { console.log(msg) }

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

function assert (cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed') }

function assertSuccess (r, label) {
  assert(r && r.success === true, `${label}: expected success=true, got ${JSON.stringify(r)}`)
}

function sleep (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

function waitForEditor (client, timeoutMs) {
  return new Promise((resolve) => {
    if (client.isEditorOnline()) { resolve(true); return }
    const timer = setTimeout(() => { client.off('editor_connected', handler); resolve(false) }, timeoutMs)
    function handler () { clearTimeout(timer); resolve(true) }
    client.on('editor_connected', handler)
  })
}

async function prepareCanvas (client) {
  await client.clear()
  await sleep(300)
  await client.setResolution(800, 600)
  await sleep(200)
}

async function main () {
  log('')
  log('╔══════════════════════════════════════════════════════════╗')
  log('║    SVGEdit Remote Bridge — 新增 API 测试                 ║')
  log('╚══════════════════════════════════════════════════════════╝')
  log('')

  log('▶ 连接到中继服务 ws://localhost:9527 ...')
  const client = new SvgRemoteClient('ws://localhost:9527', { timeout: 15000, autoReconnect: false })

  try { await client.connect() } catch (err) {
    log(`❌ 无法连接: ${err.message}`); process.exit(1)
  }
  log(`✅ 已连接 (editor在线: ${client.isEditorOnline()})`)

  if (!client.isEditorOnline()) {
    log('⏳ 等待编辑器连接 (最多 60 秒)...')
    if (!(await waitForEditor(client, 60000))) { log('❌ 超时'); client.close(); process.exit(1) }
    log('✅ 编辑器已连接！')
  }
  await sleep(1000)

  // ============ 1. 分组 ============
  logSection('1. 分组操作')
  await prepareCanvas(client)

  let rect1, rect2, groupId
  await runTest('groupSelectedElements — 分组', async () => {
    rect1 = await client.addElement('rect', { x: '50', y: '50', width: '100', height: '80', fill: '#E74C3C' })
    rect2 = await client.addElement('rect', { x: '200', y: '50', width: '100', height: '80', fill: '#3498DB' })
    assertSuccess(rect1, 'add rect1'); assertSuccess(rect2, 'add rect2')
    const result = await client.groupSelectedElements([rect1.id, rect2.id])
    assertSuccess(result, 'group')
    assert(result.id, '应返回分组 ID')
    groupId = result.id
    log(`         分组 ID: ${groupId}`)
  })

  await runTest('ungroupSelectedElement — 取消分组', async () => {
    if (!groupId) return 'SKIP'
    const result = await client.ungroupSelectedElement(groupId)
    assertSuccess(result, 'ungroup')
    log(`         已取消分组`)
  })

  // ============ 2. 克隆/复制/剪切/粘贴 ============
  logSection('2. 克隆/复制/剪切/粘贴')
  await prepareCanvas(client)

  let srcId
  await runTest('cloneSelectedElements — 克隆', async () => {
    const src = await client.addElement('rect', { x: '100', y: '100', width: '120', height: '80', fill: '#9B59B6' })
    assertSuccess(src, 'add rect'); srcId = src.id
    const result = await client.cloneSelectedElements({ ids: [srcId], dx: 30, dy: 30 })
    assertSuccess(result, 'clone')
    assert(Array.isArray(result.ids) && result.ids.length > 0, '应返回克隆 IDs')
    log(`         克隆 IDs: ${result.ids.join(', ')}`)
  })

  await runTest('copySelectedElements — 复制', async () => {
    if (!srcId) return 'SKIP'
    const result = await client.copySelectedElements([srcId])
    assertSuccess(result, 'copy')
  })

  await runTest('pasteElements — 粘贴', async () => {
    const result = await client.pasteElements('in_place')
    assertSuccess(result, 'paste')
    log(`         粘贴 IDs: ${result.ids.join(', ')}`)
  })

  await runTest('cutSelectedElements — 剪切', async () => {
    const c = await client.addElement('circle', { cx: '400', cy: '200', r: '50', fill: '#F39C12' })
    assertSuccess(c, 'add circle')
    const result = await client.cutSelectedElements([c.id])
    assertSuccess(result, 'cut')
  })

  await runTest('pasteElements — 粘贴剪切内容', async () => {
    const result = await client.pasteElements('in_place')
    assertSuccess(result, 'paste cut')
    log(`         粘贴 IDs: ${result.ids.join(', ')}`)
  })

  // ============ 3. Z 轴层序 ============
  logSection('3. Z 轴层序')
  await prepareCanvas(client)

  let zElem
  await runTest('moveToTopSelectedElement', async () => {
    const r1 = await client.addElement('rect', { x: '100', y: '100', width: '150', height: '100', fill: '#E74C3C' })
    await client.addElement('rect', { x: '150', y: '130', width: '150', height: '100', fill: '#3498DB' })
    assertSuccess(r1, 'add r1'); zElem = r1.id
    const result = await client.moveToTopSelectedElement(zElem)
    assertSuccess(result, 'moveToTop')
  })

  await runTest('moveToBottomSelectedElement', async () => {
    if (!zElem) return 'SKIP'
    const result = await client.moveToBottomSelectedElement(zElem)
    assertSuccess(result, 'moveToBottom')
  })

  await runTest('moveUpDownSelected — Up', async () => {
    if (!zElem) return 'SKIP'
    const result = await client.moveUpDownSelected('Up', zElem)
    assertSuccess(result, 'moveUp')
  })

  await runTest('moveUpDownSelected — Down', async () => {
    if (!zElem) return 'SKIP'
    const result = await client.moveUpDownSelected('Down', zElem)
    assertSuccess(result, 'moveDown')
  })

  // ============ 4. 变换 ============
  logSection('4. 变换操作')
  await prepareCanvas(client)

  let tId
  await runTest('setRotationAngle — 旋转 45°', async () => {
    const r = await client.addElement('rect', { x: '200', y: '150', width: '150', height: '100', fill: '#2ECC71' })
    assertSuccess(r, 'add rect'); tId = r.id
    const result = await client.setRotationAngle(45, tId)
    assertSuccess(result, 'setRotation')
  })

  await runTest('getRotationAngle — 获取旋转角度', async () => {
    if (!tId) return 'SKIP'
    const result = await client.getRotationAngle(tId)
    assert(result.angle !== undefined, `应有 angle 字段: ${JSON.stringify(result)}`)
    log(`         角度: ${result.angle}°`)
  })

  await runTest('setRotationAngle — 重置为 0°', async () => {
    if (!tId) return 'SKIP'
    assertSuccess(await client.setRotationAngle(0, tId), 'reset rotation')
  })

  await runTest('flipSelectedElements — 水平翻转', async () => {
    if (!tId) return 'SKIP'
    assertSuccess(await client.flipSelectedElements({ horizontal: true, ids: [tId] }), 'flipH')
  })

  await runTest('flipSelectedElements — 垂直翻转', async () => {
    if (!tId) return 'SKIP'
    assertSuccess(await client.flipSelectedElements({ vertical: true, ids: [tId] }), 'flipV')
  })

  await runTest('convertToPath — 转为路径', async () => {
    if (!tId) return 'SKIP'
    assertSuccess(await client.convertToPath(tId), 'convertToPath')
  })

  // ============ 5. 对齐 ============
  logSection('5. 对齐操作')
  await prepareCanvas(client)

  let aIds = []
  await runTest('准备：添加 3 个矩形', async () => {
    const r1 = await client.addElement('rect', { x: '50', y: '50', width: '80', height: '60', fill: '#E74C3C' })
    const r2 = await client.addElement('rect', { x: '200', y: '100', width: '80', height: '60', fill: '#3498DB' })
    const r3 = await client.addElement('rect', { x: '350', y: '150', width: '80', height: '60', fill: '#2ECC71' })
    aIds = [r1.id, r2.id, r3.id]
  })

  for (const [type, label] of [['l', '左对齐'], ['r', '右对齐'], ['t', '顶部对齐'], ['b', '底部对齐'], ['c', '水平居中'], ['m', '垂直居中']]) {
    await runTest(`alignSelectedElements — ${label} (${type})`, async () => {
      if (aIds.length === 0) return 'SKIP'
      assertSuccess(await client.alignSelectedElements(type, 'selected', aIds), `align ${type}`)
    })
  }

  await runTest('alignSelectedElements — 页面居中', async () => {
    if (aIds.length === 0) return 'SKIP'
    assertSuccess(await client.alignSelectedElements('c', 'page', aIds), 'align page')
  })

  // ============ 6. 样式 ============
  logSection('6. 样式操作')
  await prepareCanvas(client)

  let sId
  await runTest('准备：添加样式测试元素', async () => {
    const r = await client.addElement('rect', { x: '100', y: '100', width: '200', height: '150', fill: '#CCC', stroke: '#333', 'stroke-width': '1' })
    assertSuccess(r, 'add rect'); sId = r.id
    await client.selectElements([sId])
  })

  await runTest('setColor fill', async () => {
    if (!sId) return 'SKIP'
    assertSuccess(await client.setColor('fill', '#E74C3C'), 'setColor fill')
  })

  await runTest('setColor stroke', async () => {
    if (!sId) return 'SKIP'
    assertSuccess(await client.setColor('stroke', '#2980B9'), 'setColor stroke')
  })

  await runTest('setStrokeWidth', async () => {
    if (!sId) return 'SKIP'
    assertSuccess(await client.setStrokeWidth(5), 'setStrokeWidth')
  })

  await runTest('setStrokeAttr dasharray', async () => {
    if (!sId) return 'SKIP'
    assertSuccess(await client.setStrokeAttr('stroke-dasharray', '10,5'), 'setStrokeAttr')
  })

  await runTest('setStrokeAttr linecap', async () => {
    if (!sId) return 'SKIP'
    assertSuccess(await client.setStrokeAttr('stroke-linecap', 'round'), 'setStrokeAttr linecap')
  })

  await runTest('setOpacity', async () => {
    if (!sId) return 'SKIP'
    assertSuccess(await client.setOpacity(0.7), 'setOpacity')
  })

  await runTest('getOpacity', async () => {
    const result = await client.getOpacity()
    assert(result.opacity !== undefined, `应有 opacity: ${JSON.stringify(result)}`)
    log(`         opacity: ${result.opacity}`)
  })

  await runTest('setPaintOpacity fill', async () => {
    if (!sId) return 'SKIP'
    assertSuccess(await client.setPaintOpacity('fill', 0.5), 'setPaintOpacity')
  })

  await runTest('getPaintOpacity fill', async () => {
    const result = await client.getPaintOpacity('fill')
    assert(result.opacity !== undefined, `应有 opacity: ${JSON.stringify(result)}`)
    log(`         fill opacity: ${result.opacity}`)
  })

  await runTest('setBlur 3', async () => {
    if (!sId) return 'SKIP'
    assertSuccess(await client.setBlur(3, true), 'setBlur')
  })

  await runTest('getBlur', async () => {
    if (!sId) return 'SKIP'
    const result = await client.getBlur(sId)
    assert(result.blur !== undefined, `应有 blur: ${JSON.stringify(result)}`)
    log(`         blur: ${result.blur}`)
  })

  await runTest('setBlur 0 (清除)', async () => {
    if (!sId) return 'SKIP'
    assertSuccess(await client.setBlur(0, true), 'setBlur 0')
  })

  // ============ 7. 文字 ============
  logSection('7. 文字操作')
  await prepareCanvas(client)

  let txId
  await runTest('准备：添加文本元素', async () => {
    const r = await client.addElement('text', { x: '200', y: '200', fill: '#2C3E50', 'font-size': '20', 'font-family': 'Arial' }, { children: ['Test Text'] })
    assertSuccess(r, 'add text'); txId = r.id
    await client.selectElements([txId])
  })

  await runTest('setTextContent', async () => {
    if (!txId) return 'SKIP'
    assertSuccess(await client.setTextContent('Hello New API!', txId), 'setTextContent')
  })

  await runTest('setFontFamily', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    assertSuccess(await client.setFontFamily('serif'), 'setFontFamily')
  })

  await runTest('getFontFamily', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    const r = await client.getFontFamily()
    assert(r.family !== undefined, `应有 family: ${JSON.stringify(r)}`)
    log(`         family: ${r.family}`)
  })

  await runTest('setFontSize', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    assertSuccess(await client.setFontSize(32), 'setFontSize')
  })

  await runTest('getFontSize', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    const r = await client.getFontSize()
    assert(r.size !== undefined, `应有 size: ${JSON.stringify(r)}`)
    log(`         size: ${r.size}`)
  })

  await runTest('setBold', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    assertSuccess(await client.setBold(true), 'setBold')
  })

  await runTest('getBold', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    const r = await client.getBold()
    assert(r.bold !== undefined, `应有 bold: ${JSON.stringify(r)}`)
    log(`         bold: ${r.bold}`)
  })

  await runTest('setItalic', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    assertSuccess(await client.setItalic(true), 'setItalic')
  })

  await runTest('getItalic', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    const r = await client.getItalic()
    assert(r.italic !== undefined, `应有 italic: ${JSON.stringify(r)}`)
    log(`         italic: ${r.italic}`)
  })

  await runTest('setTextAnchor', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    assertSuccess(await client.setTextAnchor('middle'), 'setTextAnchor')
  })

  await runTest('setLetterSpacing', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    assertSuccess(await client.setLetterSpacing(2), 'setLetterSpacing')
  })

  await runTest('setWordSpacing', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    assertSuccess(await client.setWordSpacing(5), 'setWordSpacing')
  })

  await runTest('setFontColor', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    assertSuccess(await client.setFontColor('#3498DB'), 'setFontColor')
  })

  await runTest('getFontColor', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    const r = await client.getFontColor()
    assert(r.color !== undefined, `应有 color: ${JSON.stringify(r)}`)
    log(`         color: ${r.color}`)
  })

  await runTest('addTextDecoration underline', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    assertSuccess(await client.addTextDecoration('underline'), 'addTextDecoration')
  })

  await runTest('removeTextDecoration underline', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    assertSuccess(await client.removeTextDecoration('underline'), 'removeTextDecoration')
  })

  await runTest('getText', async () => {
    if (!txId) return 'SKIP'
    await client.selectElements([txId])
    const r = await client.getText()
    assert(r.text !== undefined, `应有 text: ${JSON.stringify(r)}`)
    log(`         text: "${r.text}"`)
  })

  // ============ 8. 图层管理 ============
  logSection('8. 图层管理')
  await prepareCanvas(client)

  await runTest('createLayer', async () => {
    assertSuccess(await client.createLayer('TestLayer1'), 'createLayer')
    const layers = await client.getLayers()
    assert(layers.find(l => l.name === 'TestLayer1'), '应找到 TestLayer1')
    log(`         图层数: ${layers.length}`)
  })

  await runTest('renameCurrentLayer', async () => {
    assertSuccess(await client.renameCurrentLayer('RenamedLayer'), 'rename')
    const layers = await client.getLayers()
    assert(layers.find(l => l.name === 'RenamedLayer'), '应找到 RenamedLayer')
  })

  await runTest('cloneLayer', async () => {
    assertSuccess(await client.cloneLayer('ClonedLayer'), 'clone')
  })

  await runTest('setCurrentLayer', async () => {
    const layers = await client.getLayers()
    if (layers.length < 2) return 'SKIP'
    assertSuccess(await client.setCurrentLayer(layers[0].name), 'setCurrentLayer')
    log(`         切换到: ${layers[0].name}`)
  })

  await runTest('setLayerVisibility false', async () => {
    const layers = await client.getLayers()
    if (layers.length < 2) return 'SKIP'
    assertSuccess(await client.setLayerVisibility(layers[layers.length - 1].name, false), 'hide')
  })

  await runTest('setLayerVisibility true', async () => {
    const layers = await client.getLayers()
    if (layers.length < 2) return 'SKIP'
    assertSuccess(await client.setLayerVisibility(layers[layers.length - 1].name, true), 'show')
  })

  await runTest('moveSelectedToLayer', async () => {
    const elem = await client.addElement('rect', { x: '50', y: '50', width: '60', height: '40', fill: '#E74C3C' })
    if (!elem.success) return 'SKIP'
    await client.selectElements([elem.id])
    const layers = await client.getLayers()
    if (layers.length < 2) return 'SKIP'
    assertSuccess(await client.moveSelectedToLayer(layers[layers.length - 1].name), 'moveToLayer')
  })

  await runTest('mergeAllLayers', async () => {
    assertSuccess(await client.mergeAllLayers(), 'mergeAll')
    const layers = await client.getLayers()
    log(`         合并后图层数: ${layers.length}`)
  })

  await runTest('createLayer + deleteCurrentLayer', async () => {
    await client.createLayer('ToDelete')
    assertSuccess(await client.deleteCurrentLayer(), 'delete')
    const layers = await client.getLayers()
    assert(!layers.find(l => l.name === 'ToDelete'), '不应找到 ToDelete')
  })

  // ============ 9. 超链接 ============
  logSection('9. 超链接操作')
  await prepareCanvas(client)

  let lnkId
  await runTest('makeHyperlink', async () => {
    const r = await client.addElement('rect', { x: '100', y: '100', width: '200', height: '100', fill: '#3498DB' })
    assertSuccess(r, 'add rect'); lnkId = r.id
    await client.selectElements([lnkId])
    assertSuccess(await client.makeHyperlink('https://example.com', lnkId), 'makeHyperlink')
  })

  await runTest('setLinkURL', async () => {
    if (!lnkId) return 'SKIP'
    assertSuccess(await client.setLinkURL('https://svgedit.netlify.app'), 'setLinkURL')
  })

  await runTest('removeHyperlink', async () => {
    if (!lnkId) return 'SKIP'
    assertSuccess(await client.removeHyperlink(), 'removeHyperlink')
  })

  // ============ 10. 图片操作 ============
  logSection('10. 图片操作')
  await prepareCanvas(client)

  let imgId
  await runTest('setImageURL', async () => {
    const svgData = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI0ZGNjYwMCIvPjwvc3ZnPg=='
    const r = await client.addElement('image', { x: '100', y: '100', width: '200', height: '150', href: svgData })
    assertSuccess(r, 'add image'); imgId = r.id
    await client.selectElements([imgId])
    const newUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0MCIgZmlsbD0iIzMzOTlGRiIvPjwvc3ZnPg=='
    assertSuccess(await client.setImageURL(newUrl, imgId), 'setImageURL')
  })

  // ============ 11. 路径/圆角 ============
  logSection('11. 路径/圆角')
  await prepareCanvas(client)

  let rrId
  await runTest('setRectRadius 20', async () => {
    const r = await client.addElement('rect', { x: '100', y: '100', width: '200', height: '120', fill: '#9B59B6' })
    assertSuccess(r, 'add rect'); rrId = r.id
    await client.selectElements([rrId])
    assertSuccess(await client.setRectRadius(20, rrId), 'setRectRadius')
  })

  await runTest('setRectRadius 0', async () => {
    if (!rrId) return 'SKIP'
    assertSuccess(await client.setRectRadius(0, rrId), 'setRectRadius 0')
  })

  // ============ 12. 导入/导出 ============
  logSection('12. 导入/导出')
  await prepareCanvas(client)

  await runTest('准备：添加导出测试元素', async () => {
    await client.addElement('rect', { x: '50', y: '50', width: '200', height: '100', fill: '#E74C3C', rx: '10' })
    await client.addElement('circle', { cx: '400', cy: '150', r: '80', fill: '#3498DB' })
    await client.addElement('text', { x: '300', y: '350', fill: '#2C3E50', 'font-size': '24', 'text-anchor': 'middle' }, { children: ['Export Test'] })
  })

  await runTest('importSvgString — 导入 SVG 子图', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="500" y="300" width="80" height="60" fill="#2ECC71"/></svg>'
    assertSuccess(await client.importSvgString(svg), 'importSvgString')
  })

  await runTest('rasterExport — PNG', async () => {
    const r = await client.rasterExport('PNG')
    assertSuccess(r, 'rasterExport PNG')
    assert(r.dataUrl, '应返回 dataUrl')
    assert(r.dataUrl.startsWith('data:image/png'), '应以 data:image/png 开头')
    log(`         PNG dataUrl 长度: ${r.dataUrl.length}`)
  })

  await runTest('rasterExport — JPEG', async () => {
    const r = await client.rasterExport('JPEG', 0.8)
    assertSuccess(r, 'rasterExport JPEG')
    assert(r.dataUrl, '应返回 dataUrl')
    log(`         JPEG dataUrl 长度: ${r.dataUrl.length}`)
  })

  // ============ 13. 其他操作 ============
  logSection('13. 其他操作')
  await prepareCanvas(client)

  await runTest('setMode rect', async () => {
    assertSuccess(await client.setMode('rect'), 'setMode rect')
  })

  await runTest('getMode', async () => {
    const r = await client.getMode()
    assert(r.mode !== undefined, `应有 mode: ${JSON.stringify(r)}`)
    log(`         mode: ${r.mode}`)
  })

  await runTest('setMode select', async () => {
    assertSuccess(await client.setMode('select'), 'setMode select')
  })

  await runTest('setDocumentTitle', async () => {
    assertSuccess(await client.setDocumentTitle('Test Doc'), 'setDocumentTitle')
  })

  await runTest('setBackground', async () => {
    assertSuccess(await client.setBackground('#F5F5F5'), 'setBackground')
    assertSuccess(await client.setBackground('#FFFFFF'), 'setBackground reset')
  })

  await runTest('selectAllInCurrentLayer', async () => {
    await client.addElement('rect', { x: '50', y: '50', width: '100', height: '80', fill: '#E74C3C' })
    await client.addElement('circle', { cx: '300', cy: '100', r: '50', fill: '#3498DB' })
    await client.clearSelection()
    await sleep(200)
    const r = await client.selectAllInCurrentLayer()
    assertSuccess(r, 'selectAll')
    assert(Array.isArray(r.ids), '应返回 ids')
    log(`         选中 ${r.ids.length} 个元素`)
  })

  // ============ 14. 批量+撤销重做 ============
  logSection('14. 批量+撤销重做')
  await prepareCanvas(client)

  await runTest('beginBatch + endBatch', async () => {
    assertSuccess(await client.beginBatch(), 'beginBatch')
    await client.addElement('rect', { x: '50', y: '50', width: '100', height: '80', fill: '#E74C3C' })
    await client.addElement('circle', { cx: '300', cy: '100', r: '60', fill: '#3498DB' })
    await client.addElement('text', { x: '200', y: '300', fill: '#2C3E50', 'font-size': '20' }, { children: ['Batch'] })
    assertSuccess(await client.endBatch('test batch'), 'endBatch')
    log(`         批量操作完成`)
  })

  await runTest('undo 批量操作', async () => {
    assertSuccess(await client.undo(), 'undo')
    await sleep(300)
    const elems = await client.getAllElements()
    log(`         撤销后元素数: ${elems.length}`)
  })

  await runTest('redo 批量操作', async () => {
    assertSuccess(await client.redo(), 'redo')
    await sleep(300)
    const elems = await client.getAllElements()
    log(`         重做后元素数: ${elems.length}`)
  })

  // ============ 最终报告 ============
  log('')
  log('╔══════════════════════════════════════════════════════════╗')
  log('║    新增 API 测试报告                                     ║')
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
      if (r.status === 'FAIL') log(`    ❌ ${r.name}: ${r.error}`)
    }
    log('')
  }

  log(`  结果: ${failCount === 0 ? '✅ 全部通过!' : `❌ ${failCount} 项失败`}`)
  log('')

  await client.clear()
  client.close()
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch(err => { console.error('测试脚本意外错误:', err); process.exit(1) })

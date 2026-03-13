/**
 * @file test-interactive.js
 * @description 交互式分批测试 — 每批测试后暂停，让你在浏览器上观察效果
 *
 * 运行: node test-interactive.js
 *
 * 操作方式：
 *   - 每批测试执行完后，脚本会暂停并提示 "按回车继续..."
 *   - 你可以在浏览器中查看 SVGEdit 画布上的效果
 *   - 确认后按回车键，继续执行下一批测试
 *   - 输入 'q' 退出测试
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

function logBatch (num, title, desc) {
  log('')
  log('\x1b[36m' + '━'.repeat(64) + '\x1b[0m')
  log('\x1b[36m  第 ' + num + ' 批：' + title + '\x1b[0m')
  log('\x1b[90m  ' + desc + '\x1b[0m')
  log('\x1b[36m' + '━'.repeat(64) + '\x1b[0m')
}

function logStep (msg) { log('  \x1b[33m▸\x1b[0m ' + msg) }
function logOk (msg) { log('  \x1b[32m✅\x1b[0m ' + msg) }
function logInfo (msg) { log('  \x1b[90mℹ ' + msg + '\x1b[0m') }

async function pause (batchLabel, lookFor) {
  log('')
  log('\x1b[35m  ┌───────────────────────────────────────────────────────────┐\x1b[0m')
  log('\x1b[35m  │  🔍 请在浏览器中查看效果：                                │\x1b[0m')
  for (const item of lookFor) {
    log('\x1b[35m  │    • ' + item + '\x1b[0m')
  }
  log('\x1b[35m  └───────────────────────────────────────────────────────────┘\x1b[0m')
  log('')
  const answer = await waitForEnter('  \x1b[1m按回车继续下一批 (输入 q 退出) ▸ \x1b[0m')
  if (answer === 'q') {
    log('\n  \x1b[33m⚠ 用户退出测试\x1b[0m')
    return false
  }
  return true
}

async function main () {
  log('')
  log('\x1b[1m╔═════════════════════════════════════════════════════════════╗\x1b[0m')
  log('\x1b[1m║   SVGEdit Remote Bridge — 交互式分批测试                    ║\x1b[0m')
  log('\x1b[1m║   每批测试后暂停，让你在浏览器上确认效果                     ║\x1b[0m')
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
  //  第 1 批：基础元素绘制
  // ================================================================
  logBatch(1, '基础元素绘制', '添加矩形、圆、椭圆、直线、文本')

  await client.clear()
  await sleep(300)
  await client.setResolution(800, 600)
  await sleep(200)

  logStep('添加红色矩形 (50,50 200x120)')
  const rect1 = await client.addElement('rect', {
    x: '50', y: '50', width: '200', height: '120',
    fill: '#E74C3C', stroke: '#C0392B', 'stroke-width': '3'
  })
  logOk('矩形 ID: ' + rect1.id)
  await sleep(200)

  logStep('添加蓝色圆形 (cx=400, cy=150, r=80)')
  const circle1 = await client.addElement('circle', {
    cx: '400', cy: '150', r: '80',
    fill: '#3498DB', stroke: '#2980B9', 'stroke-width': '3'
  })
  logOk('圆形 ID: ' + circle1.id)
  await sleep(200)

  logStep('添加绿色椭圆 (cx=600, cy=100)')
  const ellipse1 = await client.addElement('ellipse', {
    cx: '600', cy: '100', rx: '100', ry: '50',
    fill: '#2ECC71', stroke: '#27AE60', 'stroke-width': '2'
  })
  logOk('椭圆 ID: ' + ellipse1.id)
  await sleep(200)

  logStep('添加黄色矩形 (300, 350)')
  const rect2 = await client.addElement('rect', {
    x: '300', y: '350', width: '180', height: '100',
    fill: '#F1C40F', stroke: '#F39C12', 'stroke-width': '2'
  })
  logOk('矩形 ID: ' + rect2.id)
  await sleep(200)

  logStep('添加紫色直线')
  await client.addElement('line', {
    x1: '50', y1: '500', x2: '750', y2: '500',
    stroke: '#8E44AD', 'stroke-width': '4'
  })
  logOk('直线已添加')
  await sleep(200)

  logStep('添加标题文本 "Hello SVGEdit!"')
  const text1 = await client.addElement('text', {
    x: '400', y: '300', fill: '#2C3E50',
    'font-size': '36', 'font-family': 'Arial', 'text-anchor': 'middle'
  }, { children: ['Hello SVGEdit!'] })
  logOk('文本 ID: ' + text1.id)

  if (!await pause(1, [
    '红色矩形(左上)、蓝色圆(中上)、绿色椭圆(右上)',
    '黄色矩形(中下)、紫色直线(底部)',
    '"Hello SVGEdit!" 文本(居中)'
  ])) { client.close(); return }

  // ================================================================
  //  第 2 批：样式修改
  // ================================================================
  logBatch(2, '样式修改', '修改颜色、描边、透明度、圆角、模糊')

  logStep('红色矩形填充改为橙色 #FF6B35')
  await client.selectElements([rect1.id])
  await client.setColor('fill', '#FF6B35')
  await sleep(200)

  logStep('红色矩形描边改为深蓝 #1A237E，宽度 6')
  await client.setStrokeWidth(6)
  await client.setColor('stroke', '#1A237E')
  await sleep(200)

  logStep('红色矩形加虚线描边 dasharray=12,6')
  await client.setStrokeAttr('stroke-dasharray', '12,6')
  await sleep(200)

  logStep('蓝色圆设为半透明 opacity=0.5')
  await client.selectElements([circle1.id])
  await client.setOpacity(0.5)
  await sleep(200)

  logStep('蓝色圆填充透明度 fill-opacity=0.3')
  await client.setPaintOpacity('fill', 0.3)
  await sleep(200)

  logStep('黄色矩形添加 20px 圆角')
  await client.selectElements([rect2.id])
  await client.setRectRadius(20, rect2.id)
  await sleep(200)

  logStep('绿色椭圆添加模糊效果 blur=4')
  await client.selectElements([ellipse1.id])
  await client.setBlur(4, true)
  await sleep(200)

  if (!await pause(2, [
    '左上矩形变橙色 + 深蓝虚线粗描边',
    '蓝色圆变半透明',
    '黄色矩形有圆角',
    '绿色椭圆变模糊'
  ])) { client.close(); return }

  // ================================================================
  //  第 3 批：文字样式
  // ================================================================
  logBatch(3, '文字样式', '修改文本内容、字体、大小、粗体、斜体、颜色、下划线')

  logStep('修改文本内容为 "样式演示 Style Demo"')
  await client.setTextContent('Style Demo', text1.id)
  await sleep(300)

  logStep('设置字体 Georgia')
  await client.selectElements([text1.id])
  await sleep(100)
  await client.setFontFamily('Georgia')
  await sleep(300)

  logStep('设置字号 42')
  await client.selectElements([text1.id])
  await sleep(100)
  await client.setFontSize(42)
  await sleep(300)

  logStep('设置粗体')
  await client.selectElements([text1.id])
  await sleep(100)
  await client.setBold(true)
  await sleep(300)

  logStep('设置斜体')
  await client.selectElements([text1.id])
  await sleep(100)
  await client.setItalic(true)
  await sleep(300)

  logStep('设置文字颜色深红 #C62828')
  await client.selectElements([text1.id])
  await sleep(100)
  await client.setFontColor('#C62828')
  await sleep(300)

  logStep('添加下划线')
  await client.selectElements([text1.id])
  await sleep(100)
  await client.addTextDecoration('underline')
  await sleep(300)

  logStep('设置字间距 3')
  await client.selectElements([text1.id])
  await sleep(100)
  await client.setLetterSpacing(3)
  await sleep(300)

  if (!await pause(3, [
    '文本变为 "Style Demo"',
    '字体 Georgia、42号、粗体+斜体',
    '深红色 + 下划线 + 字间距加大'
  ])) { client.close(); return }

  // ================================================================
  //  第 4 批：变换操作
  // ================================================================
  logBatch(4, '变换操作', '旋转元素、翻转元素')

  logStep('将橙色矩形旋转 30°')
  await client.selectElements([rect1.id])
  await client.setRotationAngle(30, rect1.id)
  await sleep(300)

  logStep('获取旋转角度验证')
  const angleRes = await client.getRotationAngle(rect1.id)
  logInfo('当前角度: ' + angleRes.angle + '°')

  logStep('将黄色圆角矩形水平翻转')
  await client.selectElements([rect2.id])
  await client.flipSelectedElements({ horizontal: true, ids: [rect2.id] })
  await sleep(300)

  logStep('将黄色圆角矩形垂直翻转')
  await client.flipSelectedElements({ vertical: true, ids: [rect2.id] })
  await sleep(300)

  if (!await pause(4, [
    '左上橙色矩形旋转了 30°（倾斜）',
    '黄色圆角矩形经过了水平+垂直翻转'
  ])) { client.close(); return }

  // ================================================================
  //  第 5 批：Z 轴层序
  // ================================================================
  logBatch(5, 'Z 轴层序', '改变元素的前后叠放顺序')

  await client.clear()
  await sleep(300)
  await client.setResolution(800, 600)
  await sleep(200)

  logStep('创建 3 个重叠矩形 (红-绿-蓝)')
  const zR1 = await client.addElement('rect', {
    x: '100', y: '100', width: '250', height: '180',
    fill: '#E74C3C', stroke: '#C0392B', 'stroke-width': '2'
  })
  const zR2 = await client.addElement('rect', {
    x: '180', y: '160', width: '250', height: '180',
    fill: '#2ECC71', stroke: '#27AE60', 'stroke-width': '2'
  })
  const zR3 = await client.addElement('rect', {
    x: '260', y: '220', width: '250', height: '180',
    fill: '#3498DB', stroke: '#2980B9', 'stroke-width': '2'
  })
  logOk('红: ' + zR1.id + ', 绿: ' + zR2.id + ', 蓝: ' + zR3.id)

  await client.addElement('text', {
    x: '200', y: '200', fill: '#FFF', 'font-size': '20', 'font-weight': 'bold'
  }, { children: ['RED (bottom)'] })
  await client.addElement('text', {
    x: '270', y: '260', fill: '#FFF', 'font-size': '20', 'font-weight': 'bold'
  }, { children: ['GREEN (mid)'] })
  await client.addElement('text', {
    x: '340', y: '320', fill: '#FFF', 'font-size': '20', 'font-weight': 'bold'
  }, { children: ['BLUE (top)'] })

  if (!await pause('5a', [
    '三个重叠矩形: 红在底，绿在中，蓝在上',
    '每个矩形有白色标签'
  ])) { client.close(); return }

  logStep('将红色矩形移到最前 (moveToTop)')
  await client.moveToTopSelectedElement(zR1.id)
  await sleep(300)

  if (!await pause('5b', [
    '红色矩形现在在最上面，盖住了绿和蓝'
  ])) { client.close(); return }

  logStep('将红色矩形移到最后 (moveToBottom)')
  await client.moveToBottomSelectedElement(zR1.id)
  await sleep(300)

  logStep('将绿色矩形上移一层 (moveUp)')
  await client.moveUpDownSelected('Up', zR2.id)
  await sleep(300)

  if (!await pause('5c', [
    '红色回到底层',
    '绿色上移一层，现在在蓝色上面'
  ])) { client.close(); return }

  // ================================================================
  //  第 6 批：分组与取消分组
  // ================================================================
  logBatch(6, '分组与取消分组', '将多个元素分组为 <g>，然后取消分组')

  await client.clear()
  await sleep(300)
  await client.setResolution(800, 600)
  await sleep(200)

  logStep('创建 3 个彩色元素')
  const gR1 = await client.addElement('rect', {
    x: '100', y: '100', width: '120', height: '80',
    fill: '#E74C3C', stroke: '#333', 'stroke-width': '2'
  })
  const gR2 = await client.addElement('circle', {
    cx: '350', cy: '140', r: '50',
    fill: '#3498DB', stroke: '#333', 'stroke-width': '2'
  })
  const gR3 = await client.addElement('rect', {
    x: '450', y: '100', width: '120', height: '80',
    fill: '#2ECC71', stroke: '#333', 'stroke-width': '2'
  })
  logOk('元素: ' + gR1.id + ', ' + gR2.id + ', ' + gR3.id)

  logStep('将三个元素分组')
  const groupRes = await client.groupSelectedElements([gR1.id, gR2.id, gR3.id])
  logOk('分组 ID: ' + groupRes.id)

  if (!await pause('6a', [
    '红色矩形、蓝色圆、绿色矩形被分为一组',
    '点击任何一个元素应该选中整个组'
  ])) { client.close(); return }

  logStep('取消分组')
  if (groupRes.id) {
    await client.ungroupSelectedElement(groupRes.id)
    logOk('已取消分组')
  }

  if (!await pause('6b', [
    '分组已取消，三个元素恢复独立',
    '现在点击单个元素只选中那一个'
  ])) { client.close(); return }

  // ================================================================
  //  第 7 批：克隆/复制/粘贴
  // ================================================================
  logBatch(7, '克隆/复制/粘贴', '克隆元素、复制粘贴')

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

  if (!await pause('7a', [
    '3 个紫色圆角矩形从左到右排列',
    '第 1 个原始，后 2 个克隆'
  ])) { client.close(); return }

  logStep('复制第一个元素')
  await client.copySelectedElements([cloneSrc.id])
  logOk('已复制')

  // 记录粘贴前的所有元素 ID
  const preIds = (await client.getAllElements()).map(e => e.id)

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
    const newIds = postIds.filter(id => !preIds.includes(id))
    if (newIds.length > 0) {
      pastedId = newIds[0]
      logOk('粘贴 (差集检测): ' + newIds.join(', '))
    } else {
      log('  ⚠ 粘贴未检测到新元素')
    }
  }

  if (pastedId) {
    logStep('移动粘贴元素到下方')
    await client.moveElement(pastedId, { x: 100, y: 350 })
    await sleep(200)
  }

  if (!await pause('7b', [
    '底部多了一个粘贴的紫色矩形',
    '共 4 个紫色圆角矩形'
  ])) { client.close(); return }

  // ================================================================
  //  第 8 批：对齐操作
  // ================================================================
  logBatch(8, '对齐操作', '将散乱元素对齐')

  await client.clear()
  await sleep(300)
  await client.setResolution(800, 600)
  await sleep(200)

  logStep('创建 4 个散乱矩形')
  const a1 = await client.addElement('rect', {
    x: '50', y: '80', width: '100', height: '60', fill: '#E74C3C'
  })
  const a2 = await client.addElement('rect', {
    x: '220', y: '200', width: '100', height: '60', fill: '#3498DB'
  })
  const a3 = await client.addElement('rect', {
    x: '400', y: '120', width: '100', height: '60', fill: '#2ECC71'
  })
  const a4 = await client.addElement('rect', {
    x: '550', y: '300', width: '100', height: '60', fill: '#F39C12'
  })
  const alignIds = [a1.id, a2.id, a3.id, a4.id]

  if (!await pause('8a', [
    '4 个散乱矩形: 红(左上) 蓝(中) 绿(右上) 橙(右下)'
  ])) { client.close(); return }

  logStep('顶部对齐')
  await client.alignSelectedElements('t', 'selected', alignIds)
  await sleep(300)

  if (!await pause('8b', [
    '4 个矩形顶部对齐（在同一水平线上）'
  ])) { client.close(); return }

  logStep('恢复散乱位置')
  await client.updateElement(a1.id, { x: '50', y: '80' })
  await client.updateElement(a2.id, { x: '220', y: '200' })
  await client.updateElement(a3.id, { x: '400', y: '120' })
  await client.updateElement(a4.id, { x: '550', y: '300' })
  await sleep(200)

  logStep('页面居中 (水平+垂直)')
  await client.alignSelectedElements('c', 'page', alignIds)
  await sleep(200)
  await client.alignSelectedElements('m', 'page', alignIds)
  await sleep(300)

  if (!await pause('8c', [
    '4 个矩形在页面正中央叠在一起'
  ])) { client.close(); return }

  // ================================================================
  //  第 9 批：图层管理
  // ================================================================
  logBatch(9, '图层管理', '创建/切换/隐藏图层')

  await client.clear()
  await sleep(300)
  await client.setResolution(800, 600)
  await sleep(200)

  logStep('默认图层添加红色矩形')
  await client.addElement('rect', {
    x: '100', y: '100', width: '200', height: '150',
    fill: '#E74C3C', stroke: '#333', 'stroke-width': '2'
  })
  await client.addElement('text', {
    x: '200', y: '190', fill: '#FFF', 'font-size': '18',
    'text-anchor': 'middle', 'font-weight': 'bold'
  }, { children: ['Layer 1'] })

  logStep('创建新图层')
  await client.createLayer('FrontLayer')
  await sleep(200)

  logStep('新图层添加蓝色圆')
  await client.addElement('circle', {
    cx: '500', cy: '200', r: '100',
    fill: '#3498DB', stroke: '#333', 'stroke-width': '2'
  })
  await client.addElement('text', {
    x: '500', y: '210', fill: '#FFF', 'font-size': '18',
    'text-anchor': 'middle', 'font-weight': 'bold'
  }, { children: ['Layer 2'] })

  const lyrs = await client.getLayers()
  logInfo('图层: ' + lyrs.map(function (l) { return l.name }).join(', '))

  if (!await pause('9a', [
    '红色矩形在默认图层',
    '蓝色圆在 FrontLayer 图层'
  ])) { client.close(); return }

  logStep('隐藏 FrontLayer')
  await client.setLayerVisibility('FrontLayer', false)
  await sleep(300)

  if (!await pause('9b', [
    '蓝色圆消失了（图层被隐藏）',
    '只剩红色矩形'
  ])) { client.close(); return }

  logStep('恢复显示 + 合并所有图层')
  await client.setLayerVisibility('FrontLayer', true)
  await sleep(200)
  await client.mergeAllLayers()
  await sleep(200)

  if (!await pause('9c', [
    '蓝色圆重新出现',
    '所有图层已合并'
  ])) { client.close(); return }

  // ================================================================
  //  第 10 批：超链接和图片
  // ================================================================
  logBatch(10, '超链接和图片', '添加超链接、内嵌图片')

  await client.clear()
  await sleep(300)
  await client.setResolution(800, 600)
  await sleep(200)

  logStep('创建矩形并添加超链接')
  const linkRect = await client.addElement('rect', {
    x: '100', y: '100', width: '250', height: '80',
    fill: '#3498DB', stroke: '#2980B9', 'stroke-width': '2', rx: '10'
  })
  await client.addElement('text', {
    x: '225', y: '150', fill: '#FFF', 'font-size': '18', 'text-anchor': 'middle'
  }, { children: ['Link Button'] })
  await client.selectElements([linkRect.id])
  await client.makeHyperlink('https://github.com', linkRect.id)
  logOk('超链接已添加')

  logStep('添加 SVG 内嵌图片')
  const svgData = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI0ZGNjYwMCIgcng9IjEwIi8+PHRleHQgeD0iNTAiIHk9IjU1IiBmaWxsPSIjRkZGIiBmb250LXNpemU9IjE0IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXdlaWdodD0iYm9sZCI+U1ZHIEltZzwvdGV4dD48L3N2Zz4='
  await client.addElement('image', {
    x: '400', y: '80', width: '200', height: '200', href: svgData
  })
  logOk('图片已添加')

  if (!await pause(10, [
    '左边: 蓝色圆角矩形 (已添加超链接，编辑器中不可见但 DOM 中有 <a> 包裹)',
    '可在浏览器 DevTools 中查看元素被 <a xlink:href="..."> 包裹',
    '右边: 内嵌 SVG 图片 (橙色方块)'
  ])) { client.close(); return }

  // ================================================================
  //  第 11 批：导入 SVG + 转换路径
  // ================================================================
  logBatch(11, '导入 SVG + 转换路径', '导入外部 SVG、将形状转为 path')

  await client.clear()
  await sleep(300)
  await client.setResolution(800, 600)
  await sleep(200)

  logStep('添加橙色矩形')
  const pathRect = await client.addElement('rect', {
    x: '100', y: '200', width: '200', height: '120',
    fill: '#E67E22', stroke: '#D35400', 'stroke-width': '3'
  })
  await client.addElement('text', {
    x: '200', y: '270', fill: '#FFF', 'font-size': '16', 'text-anchor': 'middle'
  }, { children: ['Original Rect'] })

  logStep('导入 SVG 子图')
  const importSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120"><rect x="0" y="0" width="100" height="100" fill="#1ABC9C" rx="10"/><circle cx="150" cy="50" r="40" fill="#E74C3C"/><rect x="220" y="10" width="80" height="80" fill="#3498DB" rx="5"/></svg>'
  await client.importSvgString(importSvg)
  await sleep(500)
  logOk('SVG 子图已导入')

  if (!await pause('11a', [
    '左: 橙色矩形 ("Original Rect")',
    '右: 导入的子图 (绿色方块+红色圆+蓝色方块)'
  ])) { client.close(); return }

  logStep('将橙色矩形转换为 path')
  await client.selectElements([pathRect.id])
  await client.convertToPath(pathRect.id)
  logOk('已转为 path（外观相同）')

  if (!await pause('11b', [
    '橙色矩形外观不变，底层已转为 <path>',
    '可在开发者工具 DOM 中确认'
  ])) { client.close(); return }

  // ================================================================
  //  第 12 批：导出测试
  // ================================================================
  logBatch(12, '位图导出', '导出 PNG/JPEG')

  logStep('导出 PNG...')
  try {
    const pngRes = await client.rasterExport('PNG')
    if (pngRes && pngRes.dataUrl) {
      logOk('PNG 导出成功! dataUrl 长度: ' + pngRes.dataUrl.length)
      logInfo('格式: ' + pngRes.dataUrl.substring(0, 30) + '...')
    } else {
      logOk('PNG 导出返回: ' + JSON.stringify(pngRes).substring(0, 100))
    }
  } catch (err) {
    log('  ⚠ PNG 导出异常: ' + err.message)
  }

  logStep('导出 JPEG (quality=0.8)...')
  try {
    const jpegRes = await client.rasterExport('JPEG', 0.8)
    if (jpegRes && jpegRes.dataUrl) {
      logOk('JPEG 导出成功! dataUrl 长度: ' + jpegRes.dataUrl.length)
    } else {
      logOk('JPEG 导出返回: ' + JSON.stringify(jpegRes).substring(0, 100))
    }
  } catch (err) {
    log('  ⚠ JPEG 导出异常: ' + err.message)
  }

  logStep('获取 SVG 字符串')
  try {
    const svgStr = await client.getSvgString()
    logOk('SVG 长度: ' + svgStr.length + ' 字符')
  } catch (err) {
    log('  ⚠ 获取 SVG 异常: ' + err.message)
  }

  if (!await pause(12, [
    '导出结果已在终端显示',
    '画布内容不变'
  ])) { client.close(); return }

  // ================================================================
  //  第 13 批：批量操作 + 撤销重做
  // ================================================================
  logBatch(13, '批量操作 + 撤销重做', 'beginBatch/endBatch + undo/redo')

  await client.clear()
  await sleep(300)
  await client.setResolution(800, 600)
  await sleep(200)

  logStep('开始批量操作')
  await client.beginBatch()

  logStep('批量添加 5 个元素')
  await client.addElement('rect', {
    x: '50', y: '100', width: '150', height: '100', fill: '#E74C3C', rx: '8'
  })
  await client.addElement('circle', {
    cx: '350', cy: '150', r: '70', fill: '#3498DB'
  })
  await client.addElement('ellipse', {
    cx: '550', cy: '150', rx: '90', ry: '50', fill: '#2ECC71'
  })
  await client.addElement('text', {
    x: '400', y: '350', fill: '#34495E',
    'font-size': '28', 'text-anchor': 'middle', 'font-weight': 'bold'
  }, { children: ['Batch Demo'] })
  await client.addElement('line', {
    x1: '50', y1: '400', x2: '750', y2: '400',
    stroke: '#95A5A6', 'stroke-width': '3', 'stroke-dasharray': '8,4'
  })

  logStep('结束批量操作')
  await client.endBatch('batch test')
  logOk('批量完成 — 可一次撤销')

  if (!await pause('13a', [
    '红色矩形 + 蓝色圆 + 绿色椭圆',
    '"Batch Demo" 文本',
    '底部灰色虚线'
  ])) { client.close(); return }

  logStep('撤销 (undo) — 一次撤销全部')
  await client.undo()
  await sleep(500)

  if (!await pause('13b', [
    '画布应该变空 — 批量操作整体撤销'
  ])) { client.close(); return }

  logStep('重做 (redo) — 恢复全部')
  await client.redo()
  await sleep(500)

  if (!await pause('13c', [
    '所有元素恢复 — 批量操作整体重做'
  ])) { client.close(); return }

  // ================================================================
  //  第 14 批：综合演示 — 小房子场景
  // ================================================================
  logBatch(14, '综合演示 — 小房子场景', '用全部 API 绘制一个完整场景')

  await client.clear()
  await sleep(300)
  await client.setResolution(800, 600)
  await sleep(200)

  logStep('设置背景色')
  await client.setBackground('#F0F4F8')
  await sleep(200)

  logStep('绘制天空')
  await client.addElement('rect', {
    x: '0', y: '0', width: '800', height: '350', fill: '#87CEEB'
  })

  logStep('绘制草地')
  await client.addElement('rect', {
    x: '0', y: '350', width: '800', height: '250', fill: '#4CAF50'
  })

  logStep('绘制太阳')
  const sun = await client.addElement('circle', {
    cx: '680', cy: '80', r: '50',
    fill: '#FFD700', stroke: '#FFA500', 'stroke-width': '3'
  })

  logStep('绘制房子')
  await client.addElement('rect', {
    x: '100', y: '220', width: '200', height: '180',
    fill: '#D2691E', stroke: '#8B4513', 'stroke-width': '2'
  })
  await client.addElement('path', {
    d: 'M80,220 L200,120 L320,220 Z',
    fill: '#B22222', stroke: '#8B0000', 'stroke-width': '2'
  })
  await client.addElement('rect', {
    x: '170', y: '320', width: '60', height: '80',
    fill: '#4A2D0A', rx: '5'
  })
  await client.addElement('rect', {
    x: '120', y: '260', width: '50', height: '40',
    fill: '#87CEEB', stroke: '#333', 'stroke-width': '2'
  })
  await client.addElement('rect', {
    x: '230', y: '260', width: '50', height: '40',
    fill: '#87CEEB', stroke: '#333', 'stroke-width': '2'
  })

  logStep('绘制树')
  await client.addElement('rect', {
    x: '460', y: '280', width: '30', height: '120', fill: '#8B4513'
  })
  await client.addElement('circle', {
    cx: '475', cy: '250', r: '60', fill: '#228B22'
  })
  await client.addElement('circle', {
    cx: '440', cy: '270', r: '45', fill: '#2E8B57'
  })
  await client.addElement('circle', {
    cx: '510', cy: '265', r: '48', fill: '#32CD32'
  })

  logStep('绘制云朵')
  await client.addElement('ellipse', {
    cx: '200', cy: '80', rx: '60', ry: '25', fill: '#FFF', opacity: '0.9'
  })
  await client.addElement('ellipse', {
    cx: '240', cy: '70', rx: '45', ry: '20', fill: '#FFF', opacity: '0.9'
  })
  await client.addElement('ellipse', {
    cx: '450', cy: '60', rx: '70', ry: '28', fill: '#FFF', opacity: '0.85'
  })
  await client.addElement('ellipse', {
    cx: '500', cy: '50', rx: '50', ry: '22', fill: '#FFF', opacity: '0.85'
  })

  logStep('太阳添加模糊发光')
  await client.selectElements([sun.id])
  await client.setBlur(3, true)
  await sleep(200)

  logStep('添加标题')
  await client.addElement('text', {
    x: '400', y: '550', fill: '#2C3E50',
    'font-size': '22', 'font-family': 'Georgia',
    'text-anchor': 'middle', 'font-weight': 'bold'
  }, { children: ['SVGEdit Remote API - All Tests Complete!'] })

  log('')
  log('\x1b[32m  ┌──────────────────────────────────────────────────────┐\x1b[0m')
  log('\x1b[32m  │  🎉 所有 14 批测试全部完成！                         │\x1b[0m')
  log('\x1b[32m  │                                                      │\x1b[0m')
  log('\x1b[32m  │  最终场景：一个用 API 绘制的小房子风景画              │\x1b[0m')
  log('\x1b[32m  │  天空 + 太阳 + 云朵 + 房子 + 树 + 草地               │\x1b[0m')
  log('\x1b[32m  └──────────────────────────────────────────────────────┘\x1b[0m')
  log('')

  await waitForEnter('  按回车结束 ▸ ')

  client.close()
  log('\n  \x1b[90m连接已关闭，测试结束\x1b[0m\n')
}

main().catch(err => {
  console.error('测试脚本意外错误:', err)
  process.exit(1)
})

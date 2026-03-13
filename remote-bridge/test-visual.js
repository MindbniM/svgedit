/**
 * @file test-visual.js
 * @description 视觉验证测试：只添加元素，不清除，用于检查画布上是否可见
 *
 * 运行: node test-visual.js
 */

import { SvgRemoteClient } from './client.js'

async function main () {
  console.log('▶ 连接到中继服务...')
  const client = new SvgRemoteClient('ws://localhost:9527', {
    timeout: 15000,
    autoReconnect: false
  })

  await client.connect()
  console.log(`✅ 已连接 (editor在线: ${client.isEditorOnline()})`)

  if (!client.isEditorOnline()) {
    console.log('❌ 编辑器未连接，请先在浏览器中打开 SVGEdit')
    client.close()
    process.exit(1)
  }

  // 等待编辑器初始化
  await sleep(500)

  // 先清空画布
  console.log('\n▶ 清空画布...')
  await client.clear()
  await sleep(500)

  // 设置合理的画布大小
  console.log('▶ 设置画布 800x600...')
  await client.setResolution(800, 600)
  await sleep(300)

  // 1. 添加一个大红色矩形
  console.log('▶ 添加红色矩形...')
  const rect = await client.addElement('rect', {
    x: '50', y: '50', width: '200', height: '150',
    fill: '#E74C3C', stroke: '#C0392B', 'stroke-width': '3'
  })
  console.log(`  矩形 ID: ${rect.id}, success: ${rect.success}`)
  await sleep(300)

  // 2. 添加一个蓝色圆
  console.log('▶ 添加蓝色圆形...')
  const circle = await client.addElement('circle', {
    cx: '400', cy: '200', r: '80',
    fill: '#3498DB', stroke: '#2980B9', 'stroke-width': '3'
  })
  console.log(`  圆形 ID: ${circle.id}, success: ${circle.success}`)
  await sleep(300)

  // 3. 添加绿色椭圆
  console.log('▶ 添加绿色椭圆...')
  const ellipse = await client.addElement('ellipse', {
    cx: '600', cy: '100', rx: '100', ry: '50',
    fill: '#2ECC71', stroke: '#27AE60', 'stroke-width': '2'
  })
  console.log(`  椭圆 ID: ${ellipse.id}, success: ${ellipse.success}`)
  await sleep(300)

  // 4. 添加文本
  console.log('▶ 添加文本...')
  const text = await client.addElement('text', {
    x: '400', y: '400', fill: '#2C3E50',
    'font-size': '32', 'font-family': 'Arial',
    'text-anchor': 'middle'
  }, {
    children: ['Hello SVGEdit!']
  })
  console.log(`  文本 ID: ${text.id}, success: ${text.success}`)
  await sleep(300)

  // 5. 添加紫色直线
  console.log('▶ 添加紫色直线...')
  const line = await client.addElement('line', {
    x1: '50', y1: '500', x2: '750', y2: '500',
    stroke: '#8E44AD', 'stroke-width': '4'
  })
  console.log(`  直线 ID: ${line.id}, success: ${line.success}`)
  await sleep(300)

  // 验证元素已添加
  console.log('\n▶ 验证 getAllElements...')
  const elems = await client.getAllElements()
  console.log(`  画布上共 ${elems.length} 个元素:`)
  for (const el of elems) {
    console.log(`    - ${el.tagName}#${el.id}`)
  }

  // 获取 SVG 内容
  console.log('\n▶ 获取当前 SVG 字符串...')
  const svgStr = await client.getSvgString()
  console.log(`  SVG 长度: ${svgStr.length} 字符`)
  console.log(`  SVG 内容:\n${svgStr}`)

  console.log('\n════════════════════════════════════════')
  console.log('  ✅ 元素已添加，请查看浏览器画布！')
  console.log('  画布上应显示：红色矩形、蓝色圆、绿色椭圆、文本、紫色直线')
  console.log('  （此脚本不会清除画布，你可以在浏览器中确认）')
  console.log('════════════════════════════════════════')

  client.close()
  process.exit(0)
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(err => {
  console.error('错误:', err)
  process.exit(1)
})

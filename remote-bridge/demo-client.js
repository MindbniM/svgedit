/**
 * @file demo-client.js
 * @description 演示脚本：远程获取和修改 SVGEdit 中的图像
 *
 * 使用方法：
 *   1. 启动中继服务：   node server.js
 *   2. 启动 SVGEdit：   cd .. && npm run start
 *   3. 在浏览器中打开 SVGEdit，扩展会自动连接
 *   4. 运行此脚本：     node demo-client.js
 */

import { SvgRemoteClient } from './client.js'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

async function main () {
  const client = new SvgRemoteClient('ws://localhost:9527')

  // 监听事件
  client.on('changed', (data) => {
    console.log('📝 [event] SVG changed:', data)
  })

  client.on('selected', (data) => {
    console.log('🎯 [event] Selection changed:', data)
  })

  client.on('editor_disconnected', () => {
    console.log('⚠️  Editor disconnected')
  })

  // 连接
  console.log('🔌 Connecting to relay server...')
  try {
    await client.connect()
  } catch (err) {
    console.error('❌ Failed to connect. Make sure the relay server is running (node server.js)')
    console.error('   Error:', err.message)
    process.exit(1)
  }

  console.log('✅ Connected! Editor online:', client.isEditorOnline())

  if (!client.isEditorOnline()) {
    console.log('⏳ Waiting for editor to connect... Open SVGEdit in browser.')
    await new Promise((resolve) => {
      client.on('editor_connected', resolve)
    })
    console.log('✅ Editor is now online!')
  }

  await sleep(500) // 给 editor 扩展一点初始化时间

  try {
    // ===== 1. 读取当前 SVG 信息 =====
    console.log('\n' + '='.repeat(60))
    console.log('📖 Step 1: 读取当前 SVG 信息')
    console.log('='.repeat(60))

    const resolution = await client.getResolution()
    console.log('  画布分辨率:', resolution)

    const layers = await client.getLayers()
    console.log('  图层列表:', layers)

    const svgString = await client.getSvgString()
    console.log('  SVG 内容 (前200字符):', svgString?.substring(0, 200) + '...')

    const allElements = await client.getAllElements()
    console.log('  元素数量:', allElements?.length || 0)
    if (allElements?.length > 0) {
      console.log('  现有元素:', allElements.map(e => `${e.tagName}#${e.id}`).join(', '))
    }

    // ===== 2. 添加图形元素 =====
    console.log('\n' + '='.repeat(60))
    console.log('✏️  Step 2: 添加图形元素')
    console.log('='.repeat(60))

    // 添加一个蓝色矩形
    const rect = await client.addElement('rect', {
      x: 50, y: 50, width: 200, height: 100,
      fill: '#4A90D9', stroke: '#2C5F8A', 'stroke-width': 2, rx: 8
    })
    console.log('  ✅ 添加矩形:', rect)

    await sleep(300)

    // 添加一个橙色圆形
    const circle = await client.addElement('circle', {
      cx: 400, cy: 100, r: 50,
      fill: '#FF9500', stroke: '#CC7600', 'stroke-width': 2
    })
    console.log('  ✅ 添加圆形:', circle)

    await sleep(300)

    // 添加一条连线
    const line = await client.addElement('line', {
      x1: 250, y1: 100, x2: 350, y2: 100,
      stroke: '#333333', 'stroke-width': 2
    })
    console.log('  ✅ 添加连线:', line)

    await sleep(300)

    // 添加文本
    const text = await client.addElement('text', {
      x: 100, y: 110, fill: 'white', 'font-size': 16, 'font-family': 'Arial',
      'text-anchor': 'middle'
    }, {
      children: ['Hello SVGEdit!']
    })
    console.log('  ✅ 添加文本:', text)

    // ===== 3. 修改元素 =====
    console.log('\n' + '='.repeat(60))
    console.log('🔧 Step 3: 修改元素属性')
    console.log('='.repeat(60))

    if (rect.id) {
      await sleep(500)
      const updated = await client.updateElement(rect.id, {
        fill: '#7ED321', rx: 15
      })
      console.log(`  ✅ 修改矩形 ${rect.id} 颜色为绿色:`, updated)
    }

    // ===== 4. 再次读取，验证修改 =====
    console.log('\n' + '='.repeat(60))
    console.log('🔍 Step 4: 验证修改结果')
    console.log('='.repeat(60))

    await sleep(300)
    const updatedElements = await client.getAllElements()
    console.log('  当前元素数量:', updatedElements?.length || 0)
    if (updatedElements?.length > 0) {
      for (const el of updatedElements) {
        console.log(`    - ${el.tagName}#${el.id}`, el.attrs)
      }
    }

    // ===== 5. 获取最终 SVG =====
    console.log('\n' + '='.repeat(60))
    console.log('💾 Step 5: 获取最终 SVG')
    console.log('='.repeat(60))

    const finalSvg = await client.getSvgString()
    console.log('  最终 SVG 长度:', finalSvg?.length, '字符')
    console.log('  SVG 内容 (前500字符):')
    console.log('  ' + finalSvg?.substring(0, 500))

    console.log('\n✨ 演示完成！')
  } catch (err) {
    console.error('❌ Error:', err.message)
  }

  // 关闭连接
  client.close()
  process.exit(0)
}

main()

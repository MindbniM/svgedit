/**
 * @file test-draw-arch.js
 * @description 通过远程桥在 SVGEdit 中绘制"实时协作文档系统"架构图
 *
 * 运行:
 *   1. node server.js
 *   2. 在浏览器中打开 SVGEdit
 *   3. node test-draw-arch.js
 */

import { SvgRemoteClient } from './client.js'

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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

  await sleep(500)

  // ==============================
  // 构建 SVG 架构图
  // ==============================

  // 画布尺寸
  const W = 1200
  const H = 500

  // 通用参数
  const boxStroke = '#333'
  const boxStrokeWidth = 1.5
  const boxFill = '#fff'
  const lineStroke = '#333'
  const lineStrokeWidth = 1.5
  const fontFamily = 'Microsoft YaHei, SimHei, sans-serif'

  // ---- 第一层：根节点 ----
  const root = { label: '实时协作文档\n系统', x: 530, y: 30, w: 140, h: 50 }

  // ---- 第二层：4 个模块 ----
  const level2 = [
    { label: '文档管理模块', x: 140, y: 140, w: 130, h: 36 },
    { label: '编辑协作模块', x: 430, y: 140, w: 130, h: 36 },
    { label: '版本管理模块', x: 730, y: 140, w: 130, h: 36 },
    { label: '评论协助模块', x: 1000, y: 140, w: 130, h: 36 }
  ]

  // ---- 第三层：叶子节点 ----
  const level3Groups = [
    // 文档管理模块的子节点
    {
      parent: 0,
      items: [
        { label: '用户\n注册', x: 30, y: 260, w: 50, h: 50 },
        { label: '用户\n登录', x: 90, y: 260, w: 50, h: 50 },
        { label: '文档\n创建', x: 150, y: 260, w: 50, h: 50 },
        { label: '文档\n删除', x: 210, y: 260, w: 50, h: 50 },
        { label: '文档\n搜索', x: 270, y: 260, w: 50, h: 50 },
        { label: '权限\n设置', x: 330, y: 260, w: 50, h: 50 }
      ]
    },
    // 编辑协作模块的子节点
    {
      parent: 1,
      items: [
        { label: '富文\n本编辑', x: 400, y: 260, w: 50, h: 50 },
        { label: '实时\n同步', x: 460, y: 260, w: 50, h: 50 },
        { label: '冲突\n解决', x: 520, y: 260, w: 50, h: 50 },
        { label: '光标\n显示', x: 580, y: 260, w: 50, h: 50 }
      ]
    },
    // 版本管理模块的子节点
    {
      parent: 2,
      items: [
        { label: '版本\n保存', x: 660, y: 260, w: 50, h: 50 },
        { label: '历史\n查看', x: 720, y: 260, w: 50, h: 50 },
        { label: '版本\n对比', x: 780, y: 260, w: 50, h: 50 },
        { label: '版本\n回滚', x: 840, y: 260, w: 50, h: 50 }
      ]
    },
    // 评论协助模块的子节点
    {
      parent: 3,
      items: [
        { label: '添加\n评论', x: 950, y: 260, w: 50, h: 50 },
        { label: '评论\n提及', x: 1010, y: 260, w: 50, h: 50 },
        { label: '评论\n回复', x: 1070, y: 260, w: 50, h: 50 }
      ]
    }
  ]

  // ==============================
  // 生成 SVG
  // ==============================

  let svgParts = []

  // 辅助函数：生成带文本的矩形框
  function addBox (box, id, fontSize = 14) {
    // 矩形
    svgParts.push(
      `<rect id="${id}_box" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" ` +
      `fill="${boxFill}" stroke="${boxStroke}" stroke-width="${boxStrokeWidth}" />`
    )

    // 文本（支持多行）
    const lines = box.label.split('\n')
    const lineHeight = fontSize * 1.3
    const textX = box.x + box.w / 2
    const totalTextH = lines.length * lineHeight
    const startY = box.y + (box.h - totalTextH) / 2 + fontSize

    for (let i = 0; i < lines.length; i++) {
      svgParts.push(
        `<text id="${id}_t${i}" x="${textX}" y="${startY + i * lineHeight}" ` +
        `text-anchor="middle" font-family="${fontFamily}" font-size="${fontSize}" fill="#333">` +
        `${lines[i]}</text>`
      )
    }
  }

  // 辅助函数：画连线
  function addLine (x1, y1, x2, y2, id) {
    svgParts.push(
      `<line id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ` +
      `stroke="${lineStroke}" stroke-width="${lineStrokeWidth}" />`
    )
  }

  // 1. 画根节点
  addBox(root, 'root', 15)

  // 2. 画第二层节点
  level2.forEach((box, i) => {
    addBox(box, `l2_${i}`, 14)
  })

  // 3. 画第三层叶子节点
  level3Groups.forEach((group, gi) => {
    group.items.forEach((box, ii) => {
      addBox(box, `l3_${gi}_${ii}`, 12)
    })
  })

  // 4. 画根到第二层的连线（树状）
  const rootCx = root.x + root.w / 2
  const rootBottom = root.y + root.h
  const midY_L1 = rootBottom + 25 // 第一层到第二层的中间横线高度

  // 根节点垂直下到横线
  addLine(rootCx, rootBottom, rootCx, midY_L1, 'conn_root_down')

  // 横线：从最左子节点到最右子节点
  const l2LeftCx = level2[0].x + level2[0].w / 2
  const l2RightCx = level2[level2.length - 1].x + level2[level2.length - 1].w / 2
  addLine(l2LeftCx, midY_L1, l2RightCx, midY_L1, 'conn_root_hline')

  // 每个第二层节点从横线垂直下到自己顶部
  level2.forEach((box, i) => {
    const childCx = box.x + box.w / 2
    const childTop = box.y
    addLine(childCx, midY_L1, childCx, childTop, `conn_r_${i}_down`)
  })

  // 5. 画第二层到第三层的连线（同样树状）
  let lineIdx = 0
  level3Groups.forEach((group, gi) => {
    const parentBox = level2[group.parent]
    const parentCx = parentBox.x + parentBox.w / 2
    const parentBottom = parentBox.y + parentBox.h
    const midY_L2 = parentBottom + 25 // 中间横线高度

    const childCxList = group.items.map(c => c.x + c.w / 2)
    const leftCx = Math.min(...childCxList)
    const rightCx = Math.max(...childCxList)

    // 父节点垂直下到横线
    addLine(parentCx, parentBottom, parentCx, midY_L2, `conn2_${gi}_pdown`)

    // 横线（从最左子节点到最右子节点）
    if (leftCx !== rightCx) {
      addLine(leftCx, midY_L2, rightCx, midY_L2, `conn2_${gi}_hline`)
    }

    // 每个子节点从横线垂直下到自己顶部
    group.items.forEach((child, ii) => {
      const childCx = child.x + child.w / 2
      const childTop = child.y
      addLine(childCx, midY_L2, childCx, childTop, `conn2_${gi}_${ii}_down`)
    })
  })

  // 组合完整 SVG
  const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
${svgParts.join('\n')}
</svg>`

  // ==============================
  // 发送到 SVGEdit
  // ==============================

  console.log('\n▶ 发送架构图到 SVGEdit...')
  console.log(`  SVG 大小: ${fullSvg.length} 字符`)

  const result = await client.setSvgString(fullSvg)
  console.log(`  setSvgString 结果: ${JSON.stringify(result)}`)

  await sleep(500)

  // 验证
  const elems = await client.getAllElements()
  console.log(`  画布上共 ${elems.length} 个元素`)

  console.log('\n════════════════════════════════════════')
  console.log('  ✅ 架构图已绘制！请查看浏览器画布')
  console.log('  应显示"实时协作文档系统"三层架构图')
  console.log('════════════════════════════════════════')

  client.close()
  process.exit(0)
}

main().catch(err => {
  console.error('错误:', err)
  process.exit(1)
})

/**
 * @file test-draw-cat-icon.js
 * @description 通过远程桥在 SVGEdit 中绘制猫咪插头图标 (CodeBuddy Logo 风格)
 *
 * 运行:
 *   1. node server.js
 *   2. 在浏览器中打开 SVGEdit
 *   3. node test-draw-cat-icon.js
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
  // 构建猫咪插头图标 SVG
  // ==============================
  // 原图分析:
  // - 500x500 视窗，圆心 (250,250)，半径 220
  // - 渐变: 左上紫 (#7B5EA7) → 中间蓝紫 (#5545E0) → 右下青绿 (#00D4AA)
  // - 白色猫形: 占据圆的上半部和右侧大面积，有两个尖锐耳朵，中间V形凹陷
  // - 深色面具: 大圆润气泡形，覆盖圆的下半部和中间，从左中部延伸到右下
  // - 两个白色竖条: 面具中间偏上位置

  const size = 500
  const cx = size / 2
  const cy = size / 2
  const r = 220 // 主圆半径

  const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <!-- 主背景渐变: 左上紫 → 右下青绿 -->
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#8B6CB5"/>
      <stop offset="35%" stop-color="#6548D8"/>
      <stop offset="65%" stop-color="#4A3FE0"/>
      <stop offset="100%" stop-color="#20C4B5"/>
    </linearGradient>

    <!-- 面具部分渐变: 深紫蓝 → 右下青绿 -->
    <linearGradient id="maskGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5535C0"/>
      <stop offset="50%" stop-color="#4A45D8"/>
      <stop offset="100%" stop-color="#15C5C0"/>
    </linearGradient>

    <!-- 裁剪到圆形 -->
    <clipPath id="circleClip">
      <circle cx="${cx}" cy="${cy}" r="${r}"/>
    </clipPath>
  </defs>

  <!-- 主圆形背景 -->
  <circle id="bg_circle" cx="${cx}" cy="${cy}" r="${r}" fill="url(#bgGrad)"/>

  <!-- 所有内容裁剪到圆形内 -->
  <g clip-path="url(#circleClip)">

    <!--
      白色猫形轮廓区域 — 左倾视角
      原图分析:
      - 整体左倾约15度
      - 左耳较矮较小(透视近小远大反转 — 这里左耳较远所以小)
      - 右耳较高较大
      - V形凹陷浅且宽，位于偏左位置
      - 白色区域右侧面积大，左侧面积小
      - 底部延伸到圆的下边界之外(被clip裁剪)
    -->
    <path id="cat_white" d="
      M 65 300
      C 60 260, 75 210, 110 165
      L 155 85
      C 162 70, 170 68, 178 82
      L 200 140
      C 210 165, 218 175, 230 172
      C 245 168, 255 158, 265 135
      L 310 55
      C 320 32, 335 30, 345 52
      L 400 165
      C 425 220, 465 280, 470 340
      C 475 400, 470 460, 440 510
      L 80 510
      C 55 460, 48 390, 55 330
      Z
    " fill="white" opacity="0.95"/>

    <!--
      深色猫脸面具区域 — 左倾椭圆气泡
      原图分析:
      - 整体偏右下，有左倾旋转
      - 上边缘: 从左侧偏高处开始，S形曲线到右侧偏低处
      - 左边不碰到圆的左边缘(留出一条白色缝隙)
      - 右侧覆盖到圆的右边缘
      - 底部远超圆的底部(被clip裁掉)
      - 非常圆润饱满的大气泡形
    -->
    <path id="cat_face" d="
      M 80 280
      C 85 240, 120 210, 175 200
      C 240 188, 310 200, 370 230
      C 430 260, 475 310, 485 370
      C 495 430, 480 490, 450 530
      L 75 530
      C 55 480, 50 420, 55 360
      C 58 320, 65 295, 80 280
      Z
    " fill="url(#maskGrad)" opacity="0.93"/>

    <!-- 左眼/插脚 — 偏右位置，微左倾 -->
    <rect id="left_eye" x="240" y="310" width="28" height="72" rx="14" ry="14"
      fill="white" opacity="0.95"
      transform="rotate(-5, 254, 346)"/>

    <!-- 右眼/插脚 — 更偏右，微左倾 -->
    <rect id="right_eye" x="315" y="300" width="28" height="72" rx="14" ry="14"
      fill="white" opacity="0.95"
      transform="rotate(-5, 329, 336)"/>

  </g>
</svg>`

  // ==============================
  // 发送到 SVGEdit
  // ==============================

  console.log('\n▶ 发送猫咪插头图标到 SVGEdit...')
  console.log(`  SVG 大小: ${fullSvg.length} 字符`)

  // 开始批量操作会话 — 使整个脚本操作可一次性撤销
  await client.beginBatch()
  console.log('  ✅ 批量操作会话已开始')

  const result = await client.setSvgString(fullSvg)
  console.log(`  setSvgString 结果: ${JSON.stringify(result)}`)

  await sleep(500)

  // 验证
  const elems = await client.getAllElements()
  console.log(`  画布上共 ${elems.length} 个元素`)
  for (const el of elems) {
    console.log(`    - ${el.tagName}#${el.id}`)
  }

  // 获取最终 SVG
  const svgStr = await client.getSvgString()
  console.log(`\n  最终 SVG 长度: ${svgStr.length} 字符`)

  // 结束批量操作会话 — 注册为一个可撤销命令
  await client.endBatch('Remote: Draw Cat Icon')
  console.log('  ✅ 批量操作会话已结束，可通过 Ctrl+Z 一次性撤销')

  console.log('\n════════════════════════════════════════')
  console.log('  ✅ 猫咪插头图标已绘制！请查看浏览器画布')
  console.log('════════════════════════════════════════')

  client.close()
  process.exit(0)
}

main().catch(err => {
  console.error('错误:', err)
  process.exit(1)
})

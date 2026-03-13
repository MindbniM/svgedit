/**
 * @file draw-codebuddy-icon.js
 * @description 使用 SVGEdit Remote API 精细绘制 CodeBuddy 图标
 *
 * 图标特征：
 *   - 圆形底板，紫色到青色渐变
 *   - 白色猫耳朵
 *   - 白色面罩区域（猫脸下半部分 / 插头形态）
 *   - 两个白色圆角矩形"眼睛"（插头孔）
 *
 * 运行: node draw-codebuddy-icon.js
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

async function main () {
  log('')
  log('\x1b[1m╔═════════════════════════════════════════════════════════════╗\x1b[0m')
  log('\x1b[1m║   绘制 CodeBuddy 图标                                      ║\x1b[0m')
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
  //  方案：使用 importSvgString 导入精细的 SVG
  // ================================================================

  logStep('清空画布，设置分辨率')
  await client.clear()
  await sleep(300)
  await client.setResolution(512, 512)
  await sleep(200)

  logStep('设置背景色（棋盘格透明感 → 深灰色）')
  await client.setBackground('#2a2a2a')
  await sleep(200)

  // CodeBuddy 图标的精细 SVG
  // 整个图标在 512x512 画布中居中，圆形直径约 460
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="460" viewBox="0 0 460 460">
  <defs>
    <!-- 主背景渐变：从左上紫色到右下青色 -->
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6C3CE0"/>
      <stop offset="35%" stop-color="#5B4FE8"/>
      <stop offset="65%" stop-color="#4A6AEF"/>
      <stop offset="100%" stop-color="#14CCC8"/>
    </linearGradient>
    <!-- 面罩区域的渐变：紫色到青色，偏右下 -->
    <linearGradient id="maskGrad" x1="0.1" y1="0.2" x2="0.9" y2="1">
      <stop offset="0%" stop-color="#5B3FE4"/>
      <stop offset="50%" stop-color="#4565EC"/>
      <stop offset="100%" stop-color="#18B8C8"/>
    </linearGradient>
    <!-- 圆形裁剪蒙版 -->
    <clipPath id="circleClip">
      <circle cx="230" cy="230" r="224"/>
    </clipPath>
  </defs>

  <!-- 圆形背景（带渐变） -->
  <circle cx="230" cy="230" r="224" fill="url(#bgGrad)"/>

  <!-- 所有内容都裁剪在圆内 -->
  <g clip-path="url(#circleClip)">

    <!-- ===== 白色区域（猫耳+面罩整体形状） ===== -->

    <!-- 左耳 - 三角形尖耳朵 -->
    <path d="
      M 72,185
      C 72,185  85,52  118,28
      C 140,14  162,18  175,38
      C 195,68  188,128  182,168
      C 178,192  155,210  130,215
      C 105,220  78,208  72,185
      Z
    " fill="white" opacity="0.95"/>

    <!-- 右耳 - 三角形尖耳朵 -->
    <path d="
      M 388,185
      C 388,185  375,52  342,28
      C 320,14  298,18  285,38
      C 265,68  272,128  278,168
      C 282,192  305,210  330,215
      C 355,220  382,208  388,185
      Z
    " fill="white" opacity="0.95"/>

    <!-- 中间连接带 - 连接两个耳朵的白色弧形区域 -->
    <path d="
      M 130,210
      C 140,170  175,135  200,125
      C 220,118  240,118  260,125
      C 285,135  320,170  330,210
      C 320,200  295,190  270,188
      C 250,186  210,186  190,188
      C 165,190  140,200  130,210
      Z
    " fill="white" opacity="0.95"/>

    <!-- ===== 面罩（猫脸下半部 / 插头形态） ===== -->
    <!-- 这是一个大的白色区域，覆盖下半部分 -->
    <path d="
      M 38,260
      C 35,240  50,200  80,185
      C 110,170  148,175  170,182
      C 200,192  210,210  215,235
      C 220,255  218,290  210,320
      C 200,358  180,390  168,420
      C 160,440  150,460  150,480
      L 310,480
      C 310,460  300,440  292,420
      C 280,390  260,358  250,320
      C 242,290  240,255  245,235
      C 250,210  260,192  290,182
      C 312,175  350,170  380,185
      C 410,200  425,240  422,260
      C 428,310  430,350  420,400
      C 415,430  395,460  395,480
      L 65,480
      C 65,460  45,430  40,400
      C 30,350  32,310  38,260
      Z
    " fill="url(#maskGrad)"/>

    <!-- ===== 白色面罩区域 - 覆盖在渐变上形成面部 ===== -->
    <path d="
      M 55,275
      C 52,250  65,218  90,200
      C 118,182  155,180  180,192
      C 200,200  212,218  215,240
      C 220,268  215,302  200,340
      C 185,378  170,405  160,435
      C 155,450  152,465  152,480
      L 308,480
      C 308,465  305,450  300,435
      C 290,405  275,378  260,340
      C 245,302  240,268  245,240
      C 248,218  260,200  280,192
      C 305,180  342,182  370,200
      C 395,218  408,250  405,275
      C 410,320  412,365  402,410
      C 395,445  380,470  378,480
      L 82,480
      C 80,470  65,445  58,410
      C 48,365  50,320  55,275
      Z
    " fill="white" opacity="0.92"/>

    <!-- ===== 中央面部渐变覆盖（形成猫脸） ===== -->
    <path d="
      M 92,280
      C 90,255  105,228  135,215
      C 152,208  175,208  192,218
      C 205,226  212,242  212,260
      C 215,298  195,348  178,388
      C 168,415  158,440  155,465
      L 305,465
      C 302,440  292,415  282,388
      C 265,348  245,298  248,260
      C 248,242  255,226  268,218
      C 285,208  308,208  325,215
      C 355,228  370,255  368,280
      C 372,325  365,375  352,418
      C 342,450  330,472  328,480
      L 132,480
      C 130,472  118,450  108,418
      C 95,375  88,325  92,280
      Z
    " fill="url(#maskGrad)" opacity="0.95"/>

  </g>
</svg>`

  // 用更简洁精确的方案：直接用 setSvgString 设置完整 SVG
  logStep('导入精细 CodeBuddy 图标 SVG')

  // 使用完整的 SVG 方案，更精确地控制渐变和路径
  const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#6B35E8"/>
      <stop offset="0.4" stop-color="#5847EE"/>
      <stop offset="0.7" stop-color="#3F6BF0"/>
      <stop offset="1" stop-color="#0DD4C8"/>
    </linearGradient>
    <linearGradient id="faceGrad" x1="100" y1="200" x2="420" y2="480" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5838E5"/>
      <stop offset="0.55" stop-color="#3B6AED"/>
      <stop offset="1" stop-color="#12C8C4"/>
    </linearGradient>
    <clipPath id="mainClip">
      <circle cx="256" cy="256" r="230"/>
    </clipPath>
  </defs>
  <!-- 深色背景 -->
  <rect width="512" height="512" fill="#2D2D3D" rx="0"/>
  <!-- 主圆形背景 -->
  <circle cx="256" cy="256" r="230" fill="url(#bgGrad)"/>
  <g clip-path="url(#mainClip)">
    <!-- 左猫耳 -->
    <path d="M 100,200 Q 95,80 140,40 Q 165,20 185,45 Q 210,85 200,180 Z" fill="white" opacity="0.93"/>
    <!-- 右猫耳 -->
    <path d="M 412,200 Q 417,80 372,40 Q 347,20 327,45 Q 302,85 312,180 Z" fill="white" opacity="0.93"/>
    <!-- 耳朵之间的白色弧形连接 -->
    <path d="M 160,185 Q 180,140 215,125 Q 256,110 297,125 Q 332,140 352,185 Q 310,168 256,165 Q 202,168 160,185 Z" fill="white" opacity="0.93"/>

    <!-- 大白色面罩（猫脸+插头） -->
    <path d="
      M 50,290
      Q 42,240 72,200
      Q 105,165 160,168
      Q 200,170 222,198
      Q 240,220 238,260
      Q 236,310 210,370
      Q 192,410 182,445
      Q 175,470 175,520
      L 337,520
      Q 337,470 330,445
      Q 320,410 302,370
      Q 276,310 274,260
      Q 272,220 290,198
      Q 312,170 352,168
      Q 407,165 440,200
      Q 470,240 462,290
      Q 468,350 455,420
      Q 445,470 440,520
      L 72,520
      Q 67,470 44,420
      Q 32,350 50,290
      Z
    " fill="white" opacity="0.95"/>

    <!-- 内部面部渐变 — 猫脸 -->
    <path d="
      M 80,300
      Q 75,258 100,225
      Q 128,195 172,195
      Q 205,196 225,218
      Q 242,238 240,268
      Q 240,318 218,375
      Q 200,420 190,458
      Q 185,480 183,520
      L 329,520
      Q 327,480 322,458
      Q 312,420 294,375
      Q 272,318 272,268
      Q 270,238 287,218
      Q 307,196 340,195
      Q 384,195 412,225
      Q 437,258 432,300
      Q 438,358 425,420
      Q 415,465 412,520
      L 100,520
      Q 97,465 87,420
      Q 74,358 80,300
      Z
    " fill="url(#faceGrad)"/>

    <!-- 左眼（插头孔）— 白色圆角矩形 -->
    <rect x="188" y="320" width="32" height="65" rx="16" ry="16" fill="white"
          transform="rotate(-12, 204, 352)"/>

    <!-- 右眼（插头孔）— 白色圆角矩形 -->
    <rect x="292" y="315" width="32" height="65" rx="16" ry="16" fill="white"
          transform="rotate(8, 308, 348)"/>
  </g>
</svg>`

  await client.setSvgString(fullSvg)
  await sleep(500)
  logOk('图标 SVG 已加载')

  log('')
  log('\x1b[35m  ┌───────────────────────────────────────────────────────────┐\x1b[0m')
  log('\x1b[35m  │  🔍 请在浏览器中查看效果：                                │\x1b[0m')
  log('\x1b[35m  │    • 圆形紫-青渐变背景                                    │\x1b[0m')
  log('\x1b[35m  │    • 白色猫耳朵（左右两个尖耳）                           │\x1b[0m')
  log('\x1b[35m  │    • 白色面罩（猫脸/插头形态）                            │\x1b[0m')
  log('\x1b[35m  │    • 两个白色圆角矩形眼睛（插头孔）                       │\x1b[0m')
  log('\x1b[35m  └───────────────────────────────────────────────────────────┘\x1b[0m')

  let answer = await waitForEnter('  \x1b[1m按回车尝试优化版本，或输入 q 退出 ▸ \x1b[0m')
  if (answer === 'q') { client.close(); return }

  // ================================================================
  //  优化版：更精确地还原图标细节
  // ================================================================
  logStep('加载优化版 — 更精确的路径和渐变')

  const refinedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <!-- 主圆形渐变：左上深紫 → 右下亮青 -->
    <linearGradient id="g1" x1="80" y1="40" x2="460" y2="480" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7230E0"/>
      <stop offset="0.3" stop-color="#6040EA"/>
      <stop offset="0.6" stop-color="#4860F0"/>
      <stop offset="1" stop-color="#08DBC5"/>
    </linearGradient>
    <!-- 面部渐变 -->
    <linearGradient id="g2" x1="120" y1="180" x2="430" y2="500" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#6030E2"/>
      <stop offset="0.4" stop-color="#4C55EC"/>
      <stop offset="0.75" stop-color="#2A90E8"/>
      <stop offset="1" stop-color="#0CC8C0"/>
    </linearGradient>
    <clipPath id="c1">
      <circle cx="256" cy="256" r="228"/>
    </clipPath>
  </defs>

  <!-- 棋盘格暗背景（模拟透明） -->
  <rect width="512" height="512" fill="#303040"/>

  <!-- 主圆底 -->
  <circle cx="256" cy="256" r="228" fill="url(#g1)"/>

  <g clip-path="url(#c1)">
    <!-- ====== 白色大形状：耳朵 + 连接带 + 面罩 ====== -->

    <!-- 左耳 — 向上的尖三角，略向外倾斜 -->
    <path d="
      M 88,205
      Q 82,105 118,52
      Q 135,28 158,32
      Q 180,36 192,65
      Q 212,110 205,185
      Q 200,210 175,218
      Q 140,225 100,215
      Z
    " fill="white"/>

    <!-- 右耳 — 对称 -->
    <path d="
      M 424,205
      Q 430,105 394,52
      Q 377,28 354,32
      Q 332,36 320,65
      Q 300,110 307,185
      Q 312,210 337,218
      Q 372,225 412,215
      Z
    " fill="white"/>

    <!-- 连接带 — 两耳之间的白色拱形 -->
    <path d="
      M 155,215
      Q 170,165 205,140
      Q 230,125 256,120
      Q 282,125 307,140
      Q 342,165 357,215
      Q 320,195 256,190
      Q 192,195 155,215
      Z
    " fill="white"/>

    <!-- 白色面罩主体 — 大U形 -->
    <path d="
      M 48,295
      Q 38,248 68,208
      Q 100,172 148,172
      Q 185,174 210,195
      Q 232,215 235,248
      Q 240,295 220,355
      Q 200,410 188,450
      Q 180,480 178,530
      L 334,530
      Q 332,480 324,450
      Q 312,410 292,355
      Q 272,295 277,248
      Q 280,215 302,195
      Q 327,174 364,172
      Q 412,172 444,208
      Q 474,248 464,295
      Q 472,360 458,425
      Q 448,475 445,530
      L 67,530
      Q 64,475 54,425
      Q 40,360 48,295
      Z
    " fill="white"/>

    <!-- 面部渐变覆盖 — 猫脸形状 -->
    <path d="
      M 78,310
      Q 70,265 96,232
      Q 125,200 168,198
      Q 200,198 222,218
      Q 240,236 240,265
      Q 242,315 222,375
      Q 205,422 195,460
      Q 188,490 186,530
      L 326,530
      Q 324,490 317,460
      Q 307,422 290,375
      Q 270,315 272,265
      Q 272,236 290,218
      Q 312,198 344,198
      Q 387,200 416,232
      Q 442,265 434,310
      Q 440,370 428,430
      Q 418,478 415,530
      L 97,530
      Q 94,478 84,430
      Q 72,370 78,310
      Z
    " fill="url(#g2)"/>

    <!-- ====== 两个"眼睛" — 白色胶囊形（插头孔） ====== -->

    <!-- 左眼 — 微微向左倾斜 -->
    <rect x="192" y="318" width="30" height="62" rx="15" ry="15" fill="white"
          transform="rotate(-15, 207, 349)"/>

    <!-- 右眼 — 微微向右倾斜 -->
    <rect x="290" y="313" width="30" height="62" rx="15" ry="15" fill="white"
          transform="rotate(10, 305, 344)"/>
  </g>
</svg>`

  await client.setSvgString(refinedSvg)
  await sleep(500)
  logOk('优化版图标已加载')

  log('')
  log('\x1b[32m  ┌───────────────────────────────────────────────────────────┐\x1b[0m')
  log('\x1b[32m  │  🎉 CodeBuddy 图标绘制完成！                             │\x1b[0m')
  log('\x1b[32m  │                                                           │\x1b[0m')
  log('\x1b[32m  │  图标组成部分：                                           │\x1b[0m')
  log('\x1b[32m  │    1. 圆形渐变底板（紫→青）                               │\x1b[0m')
  log('\x1b[32m  │    2. 白色猫耳朵（左右对称）                              │\x1b[0m')
  log('\x1b[32m  │    3. 耳朵间白色连接弧                                    │\x1b[0m')
  log('\x1b[32m  │    4. 白色面罩（U 形，猫脸/插头形态）                     │\x1b[0m')
  log('\x1b[32m  │    5. 面部渐变覆盖（紫→青）                               │\x1b[0m')
  log('\x1b[32m  │    6. 两个白色胶囊形眼睛/插头孔                           │\x1b[0m')
  log('\x1b[32m  └───────────────────────────────────────────────────────────┘\x1b[0m')
  log('')

  await waitForEnter('  按回车结束 ▸ ')

  client.close()
  log('\n  \x1b[90m连接已关闭\x1b[0m\n')
}

main().catch(err => {
  console.error('脚本意外错误:', err)
  process.exit(1)
})

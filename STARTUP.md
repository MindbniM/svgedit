# SVGEdit + Remote Bridge 启动指南

## 项目概览

本项目基于 [SVGEdit](https://github.com/SVG-Edit/svgedit) v7.4.1 扩展，增加了 **Remote Bridge（远程桥）** 功能，允许通过 WebSocket 远程控制 SVGEdit 编辑器，实现程序化绘制和修改 SVG 图形。

### 整体架构

```
┌──────────────────┐     WebSocket      ┌──────────────────┐     WebSocket      ┌──────────────────┐
│  远程客户端脚本   │  ←────────────→   │   中继服务端      │  ←────────────→   │  SVGEdit 浏览器   │
│  (Node.js)       │    ws://9527       │   (server.js)     │    ws://9527       │  (ext-remote-     │
│                  │                    │                   │                    │   bridge 扩展)    │
└──────────────────┘                    └──────────────────┘                    └──────────────────┘
     client.js                              server.js                        ext-remote-bridge.js
```

---

## 1. 环境要求

| 依赖   | 版本要求  | 说明                     |
| ------ | --------- | ------------------------ |
| Node.js | >= 20     | 推荐 v24+               |
| npm    | >= 9      | Node.js 自带             |
| 浏览器  | 现代浏览器 | Chrome / Edge / Firefox  |

---

## 2. 安装依赖

### 2.1 SVGEdit 主项目

```bash
cd /data/home/mindinlu/png_to_svg/svgedit
npm install
```

### 2.2 Remote Bridge

```bash
cd /data/home/mindinlu/png_to_svg/svgedit/remote-bridge
npm install
```

---

## 3. 启动项目

项目启动需要 **3 个步骤**，建议分别在 3 个终端窗口中运行：

### 步骤 1：启动 WebSocket 中继服务

```bash
cd /data/home/mindinlu/png_to_svg/svgedit/remote-bridge
node server.js
```

输出：
```
[remote-bridge server] Starting on ws://localhost:9527
[remote-bridge server] Listening on ws://localhost:9527
[remote-bridge server] Waiting for editor and client connections...
```

> 💡 可通过环境变量 `BRIDGE_PORT` 自定义端口：`BRIDGE_PORT=9528 node server.js`

### 步骤 2：启动 SVGEdit 编辑器

```bash
cd /data/home/mindinlu/png_to_svg/svgedit
npm run start
```

输出：
```
svgedit is available at http://localhost:8000/src/editor/index.html
```

在浏览器中打开 **http://localhost:8000/src/editor/index.html**

> 编辑器加载后，`ext-remote-bridge` 扩展会自动连接到 `ws://localhost:9527`。
> 在浏览器控制台中看到 `[remote-bridge] Connected to ws://localhost:9527` 即表示连接成功。

### 步骤 3：运行远程客户端脚本

```bash
cd /data/home/mindinlu/png_to_svg/svgedit/remote-bridge

# 运行演示脚本（添加图形元素）
node demo-client.js

# 运行猫咪图标绘制脚本
node test-draw-cat-icon.js

# 运行架构图绘制脚本
node test-draw-arch.js

# 运行全部命令测试（基础 API）
node test-all-commands.js

# 运行新增 API 测试（分组/克隆/对齐/样式/文字/图层/导出等）
node test-new-apis.js

# 运行视觉验证测试
node test-visual.js
```

---

## 4. 快速启动命令（一键复制）

```bash
# 终端 1：启动中继服务
cd /data/home/mindinlu/png_to_svg/svgedit/remote-bridge && node server.js

# 终端 2：启动编辑器
cd /data/home/mindinlu/png_to_svg/svgedit && npm run start

# 终端 3：运行脚本（等待编辑器在浏览器中打开后执行）
cd /data/home/mindinlu/png_to_svg/svgedit/remote-bridge && node test-draw-cat-icon.js
```

---

## 5. 客户端 SDK 使用

### 5.1 基本用法

```js
import { SvgRemoteClient } from './client.js'

const client = new SvgRemoteClient('ws://localhost:9527', {
  timeout: 15000,       // 请求超时（毫秒）
  autoReconnect: true   // 断线自动重连
})

await client.connect()
console.log('编辑器在线:', client.isEditorOnline())

// ... 执行操作 ...

client.close()
```

### 5.2 读取类 API

| 方法                      | 返回值                                       | 说明                 |
| ------------------------- | -------------------------------------------- | -------------------- |
| `getSvgString()`          | `Promise<string>`                            | 获取完整 SVG XML     |
| `getSvgJson()`            | `Promise<object>`                            | 获取 SVG 的 JSON 结构 |
| `getSelectedElements()`   | `Promise<Array<{id, tagName, attrs}>>`       | 获取当前选中元素     |
| `getElementById(id)`      | `Promise<object>`                            | 获取指定元素详情     |
| `getAllElements()`         | `Promise<Array>`                             | 获取所有可见元素摘要 |
| `getResolution()`         | `Promise<{w, h}>`                            | 获取画布分辨率       |
| `getCurrentLayer()`       | `Promise<{name, index}>`                     | 获取当前图层信息     |
| `getLayers()`             | `Promise<Array<{name, visible}>>`            | 获取所有图层         |

### 5.3 修改类 API

| 方法                                | 说明                         |
| ----------------------------------- | ---------------------------- |
| `setSvgString(svgXml)`              | 整体替换 SVG 内容            |
| `addElement(tagName, attrs, opts?)` | 添加单个元素                 |
| `addElements(elements)`             | 批量添加元素                 |
| `updateElement(id, attrs)`          | 修改元素属性                 |
| `deleteElements(ids)`               | 删除元素                     |
| `moveElement(id, {x?, y?, cx?, cy?})` | 移动元素                   |
| `selectElements(ids)`               | 选中元素                     |
| `clearSelection()`                  | 清除选择                     |
| `clear()`                           | 清空画布                     |
| `setResolution(width, height)`      | 设置画布分辨率               |
| `zoom(level)`                       | 设置缩放级别 (1 = 100%)     |
| `undo()`                            | 撤销                         |
| `redo()`                            | 重做                         |

### 5.4 分组操作

| 方法                                | 说明                         |
| ----------------------------------- | ---------------------------- |
| `groupSelectedElements(ids?)`       | 将元素合并为一个 `<g>` 分组  |
| `ungroupSelectedElement(id?)`       | 取消分组                     |

### 5.5 克隆/复制/剪切/粘贴

| 方法                                      | 说明                                  |
| ----------------------------------------- | ------------------------------------- |
| `cloneSelectedElements({ids?, dx?, dy?})` | 克隆元素（复制并偏移，默认偏移 20px） |
| `copySelectedElements(ids?)`              | 复制到剪贴板                          |
| `cutSelectedElements(ids?)`               | 剪切                                  |
| `pasteElements(type?)`                    | 粘贴（'in_place' 或 'point'）         |

### 5.6 Z 轴层序

| 方法                                | 说明                         |
| ----------------------------------- | ---------------------------- |
| `moveToTopSelectedElement(id?)`     | 移到最前面                   |
| `moveToBottomSelectedElement(id?)`  | 移到最后面                   |
| `moveUpDownSelected(direction, id?)` | 上移或下移一层 ('Up'/'Down') |

### 5.7 变换操作

| 方法                                        | 说明                              |
| ------------------------------------------- | --------------------------------- |
| `setRotationAngle(angle, id?)`              | 设置旋转角度                      |
| `getRotationAngle(id?)`                     | 获取旋转角度                      |
| `flipSelectedElements({horizontal?, vertical?, ids?})` | 翻转元素            |
| `convertToPath(id?)`                        | 转换为路径                        |

### 5.8 对齐操作

| 方法                                               | 说明                                          |
| -------------------------------------------------- | --------------------------------------------- |
| `alignSelectedElements(type, relativeTo?, ids?)`   | 对齐: type='l'/'c'/'r'/'t'/'m'/'b'，relativeTo='selected'/'largest'/'smallest'/'page' |

### 5.9 样式操作

| 方法                                | 说明                                |
| ----------------------------------- | ----------------------------------- |
| `setColor(type, val)`               | 设置填充/描边颜色 (type: 'fill'/'stroke') |
| `setStrokeWidth(val)`               | 设置描边宽度                        |
| `setStrokeAttr(attr, val)`          | 设置描边属性 (dasharray/linejoin/linecap) |
| `setOpacity(val)`                   | 设置不透明度 (0-1)                  |
| `getOpacity()`                      | 获取不透明度                        |
| `setPaintOpacity(type, val)`        | 设置填充/描边透明度                 |
| `getPaintOpacity(type)`             | 获取填充/描边透明度                 |
| `setBlur(val, complete?)`           | 设置高斯模糊                        |
| `getBlur(id?)`                      | 获取模糊值                          |
| `setGradient(type)`                 | 应用渐变                            |
| `setPaint(type, paint)`             | 设置绘画类型（颜色/渐变）            |

### 5.10 文字操作

| 方法                              | 说明                              |
| --------------------------------- | --------------------------------- |
| `setTextContent(text, id?)`       | 设置文本内容                      |
| `setFontFamily(family)`           | 设置字体族                        |
| `setFontSize(size)`               | 设置字号                          |
| `setBold(bold)`                   | 设置粗体                          |
| `setItalic(italic)`               | 设置斜体                          |
| `setTextAnchor(anchor)`           | 设置文本锚点 ('start'/'middle'/'end') |
| `setLetterSpacing(val)`           | 设置字间距                        |
| `setWordSpacing(val)`             | 设置词间距                        |
| `setFontColor(color)`             | 设置文字颜色                      |
| `getFontColor()`                  | 获取文字颜色                      |
| `addTextDecoration(value)`        | 添加文本装饰 (underline 等)       |
| `removeTextDecoration(value)`     | 移除文本装饰                      |
| `getBold()`                       | 获取是否粗体                      |
| `getItalic()`                     | 获取是否斜体                      |
| `getFontFamily()`                 | 获取当前字体族                    |
| `getFontSize()`                   | 获取当前字号                      |
| `getText()`                       | 获取当前文本内容                  |

### 5.11 图层管理

| 方法                                  | 说明                         |
| ------------------------------------- | ---------------------------- |
| `createLayer(name)`                   | 创建新图层                   |
| `deleteCurrentLayer()`               | 删除当前图层                 |
| `renameCurrentLayer(newName)`        | 重命名当前图层               |
| `cloneLayer(name)`                   | 克隆当前图层                 |
| `setCurrentLayer(name)`             | 切换到指定图层               |
| `setCurrentLayerPosition(newPos)`    | 设置图层位置                 |
| `setLayerVisibility(name, visible)` | 设置图层可见性               |
| `moveSelectedToLayer(name)`         | 将选中元素移到指定图层       |
| `mergeLayer()`                       | 合并当前图层与下方图层       |
| `mergeAllLayers()`                   | 合并所有图层                 |

### 5.12 超链接操作

| 方法                        | 说明                         |
| --------------------------- | ---------------------------- |
| `makeHyperlink(url, id?)`  | 为元素添加超链接             |
| `removeHyperlink(id?)`     | 移除超链接                   |
| `setLinkURL(url, id?)`     | 设置链接 URL                 |

### 5.13 图片操作

| 方法                        | 说明                         |
| --------------------------- | ---------------------------- |
| `setImageURL(url, id?)`    | 设置图片 URL                 |
| `embedImage(url)`          | 将外链图片嵌入为 data URL    |

### 5.14 路径/圆角操作

| 方法                        | 说明                         |
| --------------------------- | ---------------------------- |
| `setRectRadius(val, id?)`  | 设置矩形圆角半径             |
| `setSegType(type)`          | 设置路径线段类型（直线/曲线） |

### 5.15 导入/导出

| 方法                             | 说明                             |
| -------------------------------- | -------------------------------- |
| `importSvgString(svgXml)`       | 导入 SVG 字符串作为子图          |
| `rasterExport(type?, quality?)` | 导出位图 (PNG/JPEG/BMP/WEBP)    |
| `exportPDF(outputType?)`        | 导出 PDF                        |

### 5.16 其他操作

| 方法                             | 说明                                |
| -------------------------------- | ----------------------------------- |
| `selectAllInCurrentLayer()`     | 选中当前图层所有元素                |
| `setMode(mode)`                 | 设置编辑模式 (select/rect/circle/...) |
| `getMode()`                     | 获取当前编辑模式                    |
| `setDocumentTitle(title)`       | 设置文档标题                        |
| `setGroupTitle(title)`          | 设置组标题                          |
| `setBackground(color, url?)`   | 设置编辑器背景                      |

### 5.17 批量操作（一次性撤销）

使用 `beginBatch()` / `endBatch()` 将多个操作打包为一个整体，执行后可通过 **一次 Ctrl+Z** 撤销所有操作：

```js
// 开始批量操作
await client.beginBatch()

// 执行多个操作...
await client.setSvgString('<svg>...</svg>')
await client.addElement('rect', { x: 10, y: 10, width: 100, height: 50 })
await client.updateElement('svg_1', { fill: 'red' })

// 结束批量操作 — 整个操作注册为一个可撤销命令
await client.endBatch('描述文本')

// 浏览器中按 Ctrl+Z 可一次性撤销以上所有操作
```

### 5.18 事件监听

```js
// SVG 内容变更
client.on('changed', (data) => {
  console.log('内容变更:', data.elements) // 变更元素的 ID 列表
})

// 选中元素变更
client.on('selected', (data) => {
  console.log('选中变更:', data.elements) // 选中元素的详细信息
})

// 编辑器连接/断开
client.on('editor_connected', () => console.log('编辑器已连接'))
client.on('editor_disconnected', () => console.log('编辑器已断开'))
```

---

## 6. 项目文件结构

```
svgedit/
├── package.json                          # 主项目配置
├── vite.config.mjs                       # Vite 开发服务器配置
├── src/editor/
│   ├── index.html                        # 编辑器入口页面
│   ├── Editor.js                         # 编辑器主类
│   └── extensions/
│       └── ext-remote-bridge/
│           └── ext-remote-bridge.js      # 远程桥浏览器端扩展
├── packages/svgcanvas/                   # SVG 画布引擎核心
│   ├── svgcanvas.js                      # SvgCanvas 主类
│   └── core/
│       ├── json.js                       # JSON → SVG DOM 创建
│       ├── svg-exec.js                   # setSvgString / getSvgString
│       ├── history.js                    # 撤销/重做命令栈
│       ├── draw.js                       # 图层管理
│       └── ...
└── remote-bridge/                        # 远程桥服务端与客户端
    ├── package.json                      # 独立依赖（ws 库）
    ├── server.js                         # WebSocket 中继服务端
    ├── client.js                         # 客户端 SDK
    ├── demo-client.js                    # 演示脚本
    ├── test-draw-cat-icon.js             # 猫咪图标绘制测试
    ├── test-draw-arch.js                 # 架构图绘制测试
    ├── test-all-commands.js              # 基础 API 命令测试
    ├── test-new-apis.js                  # 新增 API 测试（分组/样式/文字/图层等）
    └── test-visual.js                    # 视觉验证测试
```

---

## 7. 常见问题

### Q: 浏览器打开编辑器后看不到 `[remote-bridge] Connected` 日志？

确保中继服务 `server.js` 已启动，且端口 9527 未被占用：

```bash
lsof -i :9527
```

### Q: 客户端脚本报 `Editor is not connected`？

确保浏览器已打开 SVGEdit 编辑器页面，且控制台中显示 `[remote-bridge] Connected`。

### Q: 如何修改 WebSocket 端口？

- 中继服务端：`BRIDGE_PORT=9528 node server.js`
- 编辑器扩展：修改 `ext-remote-bridge.js` 中的 `DEFAULT_WS_URL`
- 客户端脚本：`new SvgRemoteClient('ws://localhost:9528')`

### Q: 如何修改编辑器开发服务器端口？

```bash
cd /data/home/mindinlu/png_to_svg/svgedit
npx vite dev --host --port 3000
```

或修改 `vite.config.mjs` 中的 `server.port`。

### Q: 撤销（Ctrl+Z）不生效？

确保脚本使用了 `beginBatch()` / `endBatch()` 包裹操作。详见 [5.4 批量操作](#54-批量操作一次性撤销)。

---

## 8. npm scripts 参考

在 `svgedit/` 根目录：

| 命令              | 说明                              |
| ----------------- | --------------------------------- |
| `npm run start`   | 启动 Vite 开发服务器 (端口 8000)  |
| `npm run build`   | 构建生产版本到 `dist/editor/`     |
| `npm run lint`    | 代码检查 (standard)               |
| `npm run test`    | 运行单元测试 + E2E 测试           |

在 `svgedit/remote-bridge/` 目录：

| 命令              | 说明                   |
| ----------------- | ---------------------- |
| `npm start`       | 启动 WebSocket 中继服务 |
| `npm run demo`    | 运行演示客户端脚本      |
| `npm test`        | 运行全命令测试          |

---

## 9. 生产部署方案（systemd + nginx）

本节介绍基于 **systemd** 的生产部署方式，适合服务器长期稳定运行。所有服务支持开机自启、崩溃自动重启、日志集成 journald。

### 9.1 架构总览

```
                         ┌────────────────────────────────────────┐
                         │              nginx (:80)                │
                         │                                        │
  浏览器 ─── HTTP ───────▶ /svgedit/mcp/*  ──→ 127.0.0.1:2333    │
                         │                    (diagram-server)    │
                         │                                        │
  浏览器 ─── HTTP ───────▶ /svgedit/*       ──→ 127.0.0.1:2233    │
                         │                    (SVGEdit 前端)       │
                         └────────────────────────────────────────┘
```

| 路径模式 | 转发目标 | 服务 |
|---------|---------|------|
| `/svgedit/mcp/ws` | `127.0.0.1:2333` | diagram-server WebSocket |
| `/svgedit/mcp/api/*` | `127.0.0.1:2333` | diagram-server HTTP API |
| `/svgedit/*` | `127.0.0.1:2233` | SVGEdit 前端 (Vite) |

### 9.2 systemd 服务文件

#### diagram-server（端口 2333）

文件路径：`/etc/systemd/system/diagram-server.service`

```ini
[Unit]
Description=SVGEdit Diagram Server (HTTP API + WebSocket)
After=network.target

[Service]
Type=simple
User=mindinlu
Group=users
WorkingDirectory=/data/home/mindinlu/png_to_svg/svgedit/diagram-server
ExecStart=/data/home/mindinlu/.nvm/versions/node/v24.12.0/bin/node server.js
Restart=always
RestartSec=5

Environment=DIAGRAM_PORT=2333
Environment=EDITOR_BASE_URL=http://21.6.205.60/svgedit/src/editor/index.html
Environment=NODE_ENV=production

StandardOutput=journal
StandardError=journal
SyslogIdentifier=diagram-server

[Install]
WantedBy=multi-user.target
```

#### svgedit-frontend（端口 2233）

文件路径：`/etc/systemd/system/svgedit-frontend.service`

```ini
[Unit]
Description=SVGEdit Frontend (Vite Dev Server)
After=network.target

[Service]
Type=simple
User=mindinlu
Group=users
WorkingDirectory=/data/home/mindinlu/png_to_svg/svgedit
ExecStart=/data/home/mindinlu/.nvm/versions/node/v24.12.0/bin/npx vite --port 2233 --host 0.0.0.0
Restart=always
RestartSec=5

Environment=NODE_ENV=production
Environment=PATH=/data/home/mindinlu/.nvm/versions/node/v24.12.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

StandardOutput=journal
StandardError=journal
SyslogIdentifier=svgedit-frontend

[Install]
WantedBy=multi-user.target
```

### 9.3 nginx 配置

#### upstream 定义

文件路径：`/etc/nginx/conf.d/svgedit.conf`

```nginx
upstream diagram_backend {
    server 127.0.0.1:2333;
}

upstream svgedit_frontend {
    server 127.0.0.1:2233;
}
```

#### 路由规则（在 nginx.conf 的 server block 中）

```nginx
# --- diagram-server WebSocket ---
location /svgedit/mcp/ws {
    proxy_pass http://diagram_backend/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
}

# --- diagram-server HTTP API ---
location /svgedit/mcp/api/ {
    proxy_pass http://diagram_backend/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 50m;

    # CORS
    add_header Access-Control-Allow-Origin * always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
}

# --- diagram-server 状态检查 ---
location = /svgedit/mcp {
    default_type application/json;
    return 200 '{"service":"SVGEdit Diagram Server","status":"running"}';
}

# --- SVGEdit 前端编辑器 ---
location /svgedit/ {
    proxy_pass http://svgedit_frontend/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
}
```

### 9.4 首次部署

```bash
# 1. 安装依赖
cd /data/home/mindinlu/png_to_svg/svgedit && npm install
cd /data/home/mindinlu/png_to_svg/svgedit/diagram-server && npm install

# 2. 将 systemd 服务文件写入（参考 9.2 节内容）
sudo vim /etc/systemd/system/diagram-server.service
sudo vim /etc/systemd/system/svgedit-frontend.service

# 3. 重新加载 systemd 配置并启用服务（开机自启）
sudo systemctl daemon-reload
sudo systemctl enable diagram-server.service svgedit-frontend.service

# 4. 启动服务
sudo systemctl start diagram-server.service
sudo systemctl start svgedit-frontend.service

# 5. 配置 nginx（参考 9.3 节内容）并重新加载
sudo nginx -t && sudo systemctl reload nginx

# 6. 验证
sudo systemctl status diagram-server
sudo systemctl status svgedit-frontend
curl -s http://127.0.0.1:2333/api/diagrams    # 测试 diagram-server
curl -s http://127.0.0.1/svgedit/mcp           # 测试 nginx 转发
```

### 9.5 常用管理命令

```bash
# ── 服务状态 ──
sudo systemctl status diagram-server        # 查看 diagram-server 状态
sudo systemctl status svgedit-frontend      # 查看 SVGEdit 前端状态

# ── 启动 / 停止 / 重启 ──
sudo systemctl start   diagram-server       # 启动
sudo systemctl stop    diagram-server       # 停止
sudo systemctl restart diagram-server       # 重启
sudo systemctl restart svgedit-frontend     # 重启前端

# ── 查看日志 ──
sudo journalctl -u diagram-server -f        # 实时查看 diagram-server 日志
sudo journalctl -u svgedit-frontend -f      # 实时查看前端日志
sudo journalctl -u diagram-server --since "1 hour ago"  # 最近 1 小时日志

# ── nginx ──
sudo nginx -t                               # 测试配置语法
sudo systemctl reload nginx                 # 重新加载配置
sudo tail -f /var/log/nginx/error.log       # 查看 nginx 错误日志

# ── 端口检查 ──
ss -tlnp | grep -E '2333|2233'             # 检查端口监听状态
```

### 9.6 故障排查

| 问题 | 排查方法 |
|------|---------|
| 服务启动失败 | `sudo journalctl -u diagram-server -n 50 --no-pager` 查看错误日志 |
| 端口被占用 | `lsof -ti :2333` 找到占用进程并 kill |
| nginx 502 Bad Gateway | 检查后端服务是否运行：`sudo systemctl status diagram-server` |
| nginx 配置错误 | `sudo nginx -t` 检查语法 |
| Node.js 路径错误 | 确认 `which node` 输出与 service 文件中的路径一致 |
| 服务反复重启 | `sudo journalctl -u diagram-server --since "10 min ago"` 检查崩溃原因 |

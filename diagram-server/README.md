# SVGEdit Diagram Server + MCP 集成方案

## 整体架构

```
用户使用 AI (通过 MCP)                       用户手动编辑 (通过浏览器)
         │                                           │
         ▼                                           ▼
┌──────────────────┐                    ┌──────────────────────────┐
│   MCP Server     │                    │  SVGEdit 浏览器          │
│   (mcp-server.js)│                    │  URL: /editor?id=d_xxx   │
└────────┬─────────┘                    └────────────┬─────────────┘
         │ HTTP API + WebSocket                      │ HTTP API + WebSocket
         ▼                                           ▼
┌────────────────────────────────────────────────────────────────┐
│                     diagram-server (server.js)                  │
│                                                                 │
│  • HTTP API   (端口 9528): CRUD 管理 SVG 图表                   │
│  • WebSocket  (端口 9528/ws): 中继 MCP ↔ SVGEdit 编辑器        │
│  • 文件存储   (./diagrams/): SVG 文件持久化                     │
└────────────────────────────────────────────────────────────────┘
```

## 核心工作流

### 流程 1：AI 创建图表
```
用户 → AI: "帮我画一个系统架构图"
AI  → MCP: create_diagram(name="系统架构图")
MCP → 返回: { diagram_id: "d_abc123", editorUrl: "http://.../editor?id=d_abc123" }
AI  → MCP: update_diagram(diagram_id="d_abc123", svg_content="<svg>...</svg>")
AI  → 用户: "图表已创建，你可以在浏览器打开 http://xxx/editor?id=d_abc123 查看和编辑"
```

### 流程 2：用户手动微调
```
用户在浏览器打开: http://localhost:8000/src/editor/index.html?id=d_abc123
  → SVGEdit 自动从 diagram-server 加载该 diagram 的 SVG
  → 用户拖拽、改颜色、调位置...
  → 修改自动保存回 diagram-server（防抖 3 秒）
```

### 流程 3：AI 继续修改用户微调过的图
```
用户 → AI: "把数据库模块改成蓝色"
AI  → MCP: get_diagram(diagram_id="d_abc123")   // 获取最新 SVG（含用户修改）
AI  → MCP: update_diagram(diagram_id="d_abc123", svg_content="<svg>...修改后...</svg>")
```

### 流程 4：导出
```
用户 → AI: "导出这个图的 SVG"
AI  → MCP: export_diagram_svg(diagram_id="d_abc123")
AI  → 返回: SVG 内容
```

---

## 快速启动

### 1. 安装依赖

```bash
# diagram-server 依赖
cd /data/home/mindinlu/png_to_svg/svgedit/diagram-server
npm install

# SVGEdit 主项目依赖（如果还没装）
cd /data/home/mindinlu/png_to_svg/svgedit
npm install
```

### 2. 启动服务（2 个终端）

```bash
# 终端 1：启动 diagram-server（HTTP API + WebSocket 中继）
cd /data/home/mindinlu/png_to_svg/svgedit/diagram-server
node server.js

# 终端 2：启动 SVGEdit 编辑器（Vite 开发服务器）
cd /data/home/mindinlu/png_to_svg/svgedit
npm run start
```

### 3. 配置 MCP

将以下配置添加到你的 AI 客户端（CodeBuddy / Cursor 等）的 MCP 配置中：

```json
{
  "mcpServers": {
    "svgedit-diagram": {
      "command": "node",
      "args": ["/data/home/mindinlu/png_to_svg/svgedit/diagram-server/mcp-server.js"],
      "env": {
        "DIAGRAM_SERVER_URL": "http://localhost:9528",
        "DIAGRAM_WS_URL": "ws://localhost:9528/ws"
      }
    }
  }
}
```

---

## MCP 工具列表

### 第一层：Diagram 管理（不需要编辑器在线）

| 工具 | 说明 |
|------|------|
| `create_diagram` | 创建新图表，返回 `diagram_id` + 编辑器 URL |
| `list_diagrams` | 列出所有图表 |
| `get_diagram` | 获取图表详情 + SVG 内容 |
| `update_diagram` | 直接替换图表的 SVG 内容 |
| `delete_diagram` | 删除图表 |
| `export_diagram_svg` | 导出图表 SVG |

### 第二层：编辑器实时操作（需要 SVGEdit 在线）

| 工具 | 说明 |
|------|------|
| `editor_add_element` | 添加元素到编辑器画布 |
| `editor_update_element` | 修改元素属性 |
| `editor_delete_elements` | 删除元素 |
| `editor_get_all_elements` | 获取所有元素摘要 |
| `editor_set_svg` | 替换编辑器 SVG（实时显示） |
| `editor_get_svg` | 获取编辑器当前 SVG |
| `editor_save` | 将编辑器内容保存到后端 |

---

## 端口说明

| 服务 | 端口 | 说明 |
|------|------|------|
| diagram-server HTTP | 9528 | API 接口 |
| diagram-server WebSocket | 9528/ws | 编辑器中继 |
| SVGEdit (Vite) | 8000 | 编辑器前端 |

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DIAGRAM_PORT` | 9528 | diagram-server 端口 |
| `DIAGRAMS_DIR` | ./diagrams | SVG 文件存储目录 |
| `EDITOR_HOST` | http://localhost:8000 | SVGEdit 编辑器地址 |
| `DIAGRAM_SERVER_URL` | http://localhost:9528 | MCP Server 访问的后端地址 |
| `DIAGRAM_WS_URL` | ws://localhost:9528/ws | MCP Server 的 WebSocket 地址 |

---

## 与原 remote-bridge 的关系

原 `remote-bridge/server.js`（端口 9527）继续可用，不受影响。
新的 `diagram-server`（端口 9528）是一个增强版，增加了：
- HTTP API 管理 diagram 的 CRUD + 持久化
- WebSocket 中继支持 `diagramId` 路由多个 editor
- 自动保存机制

如果你不需要 diagram 管理功能，仍然可以使用原来的 remote-bridge 方案。

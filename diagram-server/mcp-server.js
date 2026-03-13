/**
 * @file mcp-server.js
 * @description MCP Server for SVGEdit Diagram Service
 *
 * 通过 MCP 协议暴露 SVG 图表操作工具给 AI 客户端。
 * 底层通过 HTTP API 与 diagram-server 通信，管理 SVG 文件。
 * 通过 WebSocket 与 SVGEdit 浏览器编辑器实时通信（可选）。
 *
 * 启动方式：
 *   node mcp-server.js
 *
 * 环境变量：
 *   DIAGRAM_SERVER_URL  diagram-server HTTP 地址 (默认: http://localhost:2333)
 *   DIAGRAM_WS_URL      diagram-server WebSocket 地址 (默认: ws://localhost:2333/ws)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'

import WebSocket from 'ws'

// ========================
// 配置
// ========================

const DIAGRAM_SERVER_URL = process.env.DIAGRAM_SERVER_URL || 'http://localhost:2333'
const DIAGRAM_WS_URL = process.env.DIAGRAM_WS_URL || 'ws://localhost:2333/ws'

// ========================
// HTTP 客户端辅助
// ========================

async function apiRequest (method, path, body) {
  const url = `${DIAGRAM_SERVER_URL}${path}`
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  }
  if (body) {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(url, options)
  const text = await response.text()

  try {
    return JSON.parse(text)
  } catch {
    return { raw: text, status: response.status }
  }
}

// ========================
// WebSocket 客户端（连接到 diagram-server 的中继，用于操作 SVGEdit 编辑器）
// ========================

class DiagramWsClient {
  constructor (url) {
    this.url = url
    this.ws = null
    this._reqId = 0
    this._pending = new Map()
    this._connected = false
  }

  async connect () {
    if (this._connected) return

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url)

      this.ws.on('open', () => {
        this.ws.send(JSON.stringify({ role: 'client' }))
      })

      this.ws.on('message', (rawData) => {
        let msg
        try {
          msg = JSON.parse(rawData.toString())
        } catch {
          return
        }

        if (msg.type === 'registered' && msg.role === 'client') {
          this._connected = true
          resolve()
          return
        }

        if (msg.requestId !== undefined) {
          const handler = this._pending.get(String(msg.requestId))
          if (handler) {
            handler.resolve(msg.result !== undefined ? msg.result : msg)
            clearTimeout(handler.timer)
            this._pending.delete(String(msg.requestId))
          }
        }
      })

      this.ws.on('close', () => {
        this._connected = false
        for (const [, handler] of this._pending) {
          handler.resolve({ error: 'Connection closed' })
          clearTimeout(handler.timer)
        }
        this._pending.clear()
      })

      this.ws.on('error', (err) => {
        if (!this._connected) reject(err)
      })

      setTimeout(() => {
        if (!this._connected) {
          reject(new Error('WebSocket connection timeout'))
          if (this.ws) this.ws.close()
        }
      }, 10000)
    })
  }

  /**
   * 发送 RPC 请求到指定 diagram 的 editor
   */
  async request (diagramId, action, payload = {}) {
    if (!this._connected) {
      try {
        await this.connect()
      } catch {
        return { error: 'Cannot connect to diagram-server WebSocket' }
      }
    }

    return new Promise((resolve, reject) => {
      const requestId = String(++this._reqId)
      const timer = setTimeout(() => {
        this._pending.delete(requestId)
        resolve({ error: `Request timeout for action: ${action}` })
      }, 15000)

      this._pending.set(requestId, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ action, payload, requestId, diagramId }))
    })
  }

  get isConnected () {
    return this._connected
  }

  close () {
    if (this.ws) this.ws.close()
  }
}

// ========================
// MCP 工具定义
// ========================

const TOOLS = [
  // ===== 第一层：Diagram 管理 =====
  {
    name: 'create_diagram',
    description: '创建一个新的 SVG 图表。返回唯一标识符 diagram_id 和编辑器 URL。后续所有操作都通过这个 diagram_id 来标识目标图表。用户可以通过编辑器 URL 在浏览器中手动编辑该图表。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '图表名称（可选）' },
        width: { type: 'number', description: '画布宽度，默认 800', default: 800 },
        height: { type: 'number', description: '画布高度，默认 600', default: 600 }
      }
    }
  },
  {
    name: 'list_diagrams',
    description: '列出所有已创建的图表。返回每个图表的 id、名称、创建时间和编辑器 URL。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_diagram',
    description: '获取指定图表的详细信息，包括当前 SVG 内容。用于 AI 了解画布上目前有什么。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },
  {
    name: 'update_diagram',
    description: '直接替换指定图表的完整 SVG 内容（上传 SVG 到后端存储）。\n\n⚠️ 注意：更建议使用 editor_* 系列实时编辑工具（如 editor_add_element、editor_update_element 等）来逐步构建图表，而不是让 AI 直接生成完整 SVG 字符串。\n\n原因：\n1. 实时编辑工具可以在浏览器中即时预览每一步变化，用户体验更好\n2. 逐步构建便于用户随时调整和修改\n3. 编辑器会自动处理 ID 分配、图层管理、撤销/重做等\n4. AI 直接生成的 SVG 可能存在格式兼容性问题\n\n本工具仅适用于：已有现成的 SVG 文件需要导入，或需要从其他工具迁移 SVG 内容的场景。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        svg_content: { type: 'string', description: '完整的 SVG XML 字符串' },
        name: { type: 'string', description: '可选的新名称' }
      },
      required: ['diagram_id', 'svg_content']
    }
  },
  {
    name: 'delete_diagram',
    description: '删除指定的图表。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },
  {
    name: 'get_editor_usage_guide',
    description: '获取在线编辑功能的使用说明。解释所有 editor_* 系列工具的前提条件。',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // ===== 第二层：通过编辑器实时操作（需要 SVGEdit 浏览器在线）=====
  // ----- 元素 CRUD -----
  {
    name: 'editor_add_element',
    description: '向图表添加一个 SVG 元素。需要编辑器在线。\n\n⚠️ 重要：不要使用此工具添加 text 文本元素！通过 children 传递的文字内容会丢失（已知 BUG）。\n添加文本的正确方式：\n1. 先用此工具创建空的 text 元素（不传 children），再用 editor_set_text_content 设置文字内容\n2. 或者使用 editor_set_svg 直接注入包含文本的完整 SVG\n\n支持的元素类型: rect(矩形), circle(圆形), ellipse(椭圆), line(线段), path(路径), text(文本), image(图片), g(组)\n\n常用属性示例:\n- rect: {x, y, width, height, rx, ry, fill, stroke, stroke-width}\n- circle: {cx, cy, r, fill, stroke}\n- ellipse: {cx, cy, rx, ry, fill, stroke}\n- line: {x1, y1, x2, y2, stroke, stroke-width}\n- text: {x, y, fill, font-size, font-family, text-anchor}（文字内容请用 editor_set_text_content 单独设置）\n- path: {d, fill, stroke, stroke-width}\n- image: {x, y, width, height, href}',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element: { type: 'string', description: 'SVG 元素标签名', enum: ['rect', 'circle', 'ellipse', 'line', 'path', 'text', 'image', 'g'] },
        attrs: { type: 'object', description: '元素属性键值对' },
        children: { type: 'array', description: '子元素数组。text 元素使用 [{text: "文本内容"}]' }
      },
      required: ['diagram_id', 'element', 'attrs']
    }
  },
  {
    name: 'editor_add_elements',
    description: '批量向图表添加多个 SVG 元素（一次调用添加多个元素，比多次调用 editor_add_element 更高效）。需要编辑器在线。\n\n⚠️ 重要：不要使用此工具添加 text 文本元素！通过 children 传递的文字内容会丢失（已知 BUG）。\n添加文本的正确方式：先用此工具创建空的 text 元素（不传 children），再用 editor_set_text_content 逐个设置文字内容；或使用 editor_set_svg 直接注入包含文本的完整 SVG。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        elements: {
          type: 'array',
          description: '元素定义数组，每个元素包含 element(标签名)、attrs(属性)、children(子元素，可选)',
          items: {
            type: 'object',
            properties: {
              element: { type: 'string', description: 'SVG 元素标签名' },
              attrs: { type: 'object', description: '元素属性' },
              children: { type: 'array', description: '子元素' }
            },
            required: ['element', 'attrs']
          }
        }
      },
      required: ['diagram_id', 'elements']
    }
  },
  {
    name: 'editor_update_element',
    description: '修改图表中指定元素的属性（位置、大小、颜色等）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '要修改的元素 ID' },
        attrs: { type: 'object', description: '要修改的属性键值对，如 {fill: "#ff0000", width: 200}' }
      },
      required: ['diagram_id', 'element_id', 'attrs']
    }
  },
  {
    name: 'editor_delete_elements',
    description: '删除图表中的指定元素。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_ids: { type: 'array', items: { type: 'string' }, description: '要删除的元素 ID 列表' }
      },
      required: ['diagram_id', 'element_ids']
    }
  },
  {
    name: 'editor_move_element',
    description: '移动元素到指定坐标位置。支持 rect/image 的 x/y 和 circle/ellipse 的 cx/cy。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '要移动的元素 ID' },
        x: { type: 'number', description: 'rect/text/image 元素的 x 坐标' },
        y: { type: 'number', description: 'rect/text/image 元素的 y 坐标' },
        cx: { type: 'number', description: 'circle/ellipse 元素的 cx 坐标' },
        cy: { type: 'number', description: 'circle/ellipse 元素的 cy 坐标' }
      },
      required: ['diagram_id', 'element_id']
    }
  },

  // ----- 查询操作 -----
  {
    name: 'editor_get_all_elements',
    description: '获取图表中所有可见元素的摘要（ID、标签名、属性）。用于了解画布上有什么元素。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },
  {
    name: 'editor_get_element',
    description: '获取指定元素的详细信息（包括完整属性和子元素）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID' }
      },
      required: ['diagram_id', 'element_id']
    }
  },
  {
    name: 'editor_get_selected',
    description: '获取当前编辑器中被选中的元素列表。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },

  // ----- 选择操作 -----
  {
    name: 'editor_select_elements',
    description: '选中指定的元素。后续的样式、变换等操作会作用于选中的元素。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_ids: { type: 'array', items: { type: 'string' }, description: '要选中的元素 ID 列表' }
      },
      required: ['diagram_id', 'element_ids']
    }
  },
  {
    name: 'editor_select_all',
    description: '选中当前图层中的所有元素。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },
  {
    name: 'editor_clear_selection',
    description: '取消所有选中。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },

  // ----- SVG 整体操作 -----
  {
    name: 'editor_set_svg',
    description: '整体替换图表的 SVG 内容（实时显示在编辑器中，支持撤销）。需要编辑器在线。\n\n⚠️ 更建议使用 editor_add_element/editor_add_elements 逐步构建图表。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        svg_content: { type: 'string', description: '完整的 SVG XML 字符串' }
      },
      required: ['diagram_id', 'svg_content']
    }
  },
  {
    name: 'editor_get_svg',
    description: '获取当前画布的完整 SVG 字符串（包含用户手动编辑的最新状态）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },
  {
    name: 'editor_import_svg',
    description: '将 SVG 片段导入到当前画布中（追加，不替换现有内容）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        svg_content: { type: 'string', description: 'SVG XML 字符串片段' }
      },
      required: ['diagram_id', 'svg_content']
    }
  },
  {
    name: 'editor_clear',
    description: '清空画布上的所有内容。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },

  // ----- 撤销/重做 -----
  {
    name: 'editor_undo',
    description: '撤销上一步操作。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },
  {
    name: 'editor_redo',
    description: '重做上一步被撤销的操作。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },

  // ----- 批量操作会话 -----
  {
    name: 'editor_begin_batch',
    description: '开始批量操作会话。在此之后的所有修改操作将被合并为一个可撤销的整体。配合 editor_end_batch 使用。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },
  {
    name: 'editor_end_batch',
    description: '结束批量操作会话，将会话期间的所有修改合并为一个可撤销命令。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        description: { type: 'string', description: '本次批量操作的描述（显示在撤销历史中）' }
      },
      required: ['diagram_id']
    }
  },

  // ----- 分组操作 -----
  {
    name: 'editor_group_elements',
    description: '将指定元素编组为一个 <g> 组。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_ids: { type: 'array', items: { type: 'string' }, description: '要编组的元素 ID 列表' }
      },
      required: ['diagram_id', 'element_ids']
    }
  },
  {
    name: 'editor_ungroup_element',
    description: '解散指定的组（<g> 元素），其子元素变为独立元素。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '要解散的组元素 ID' }
      },
      required: ['diagram_id', 'element_id']
    }
  },

  // ----- 克隆/复制/粘贴 -----
  {
    name: 'editor_clone_elements',
    description: '克隆（原地复制）指定元素，新元素会偏移一定距离。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_ids: { type: 'array', items: { type: 'string' }, description: '要克隆的元素 ID 列表' },
        dx: { type: 'number', description: '水平偏移量（默认 20）' },
        dy: { type: 'number', description: '垂直偏移量（默认 20）' }
      },
      required: ['diagram_id', 'element_ids']
    }
  },
  {
    name: 'editor_copy_elements',
    description: '复制指定元素到剪贴板（不修改画布，配合 editor_paste_elements 使用）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_ids: { type: 'array', items: { type: 'string' }, description: '要复制的元素 ID 列表' }
      },
      required: ['diagram_id', 'element_ids']
    }
  },
  {
    name: 'editor_cut_elements',
    description: '剪切指定元素到剪贴板（从画布移除，配合 editor_paste_elements 使用）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_ids: { type: 'array', items: { type: 'string' }, description: '要剪切的元素 ID 列表' }
      },
      required: ['diagram_id', 'element_ids']
    }
  },
  {
    name: 'editor_paste_elements',
    description: '粘贴剪贴板中的元素。需要先调用 editor_copy_elements 或 editor_cut_elements。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        paste_type: { type: 'string', description: '粘贴模式：in_place(原位粘贴) 或 point(指定位置)', default: 'in_place' }
      },
      required: ['diagram_id']
    }
  },

  // ----- Z 轴层序操作 -----
  {
    name: 'editor_move_to_top',
    description: '将指定元素移到最顶层（Z 轴最前）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID' }
      },
      required: ['diagram_id', 'element_id']
    }
  },
  {
    name: 'editor_move_to_bottom',
    description: '将指定元素移到最底层（Z 轴最后）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID' }
      },
      required: ['diagram_id', 'element_id']
    }
  },
  {
    name: 'editor_move_up_down',
    description: '将指定元素在 Z 轴上移一层或下移一层。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID' },
        direction: { type: 'string', description: '方向: Up(上移一层) 或 Down(下移一层)', enum: ['Up', 'Down'] }
      },
      required: ['diagram_id', 'element_id', 'direction']
    }
  },

  // ----- 变换操作 -----
  {
    name: 'editor_set_rotation',
    description: '设置元素的旋转角度（单位：度）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID' },
        angle: { type: 'number', description: '旋转角度（0-360 度）' }
      },
      required: ['diagram_id', 'element_id', 'angle']
    }
  },
  {
    name: 'editor_get_rotation',
    description: '获取元素当前的旋转角度。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID' }
      },
      required: ['diagram_id', 'element_id']
    }
  },
  {
    name: 'editor_flip_elements',
    description: '翻转指定元素（水平翻转或垂直翻转）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_ids: { type: 'array', items: { type: 'string' }, description: '要翻转的元素 ID 列表' },
        horizontal: { type: 'boolean', description: '是否水平翻转' },
        vertical: { type: 'boolean', description: '是否垂直翻转' }
      },
      required: ['diagram_id', 'element_ids']
    }
  },

  // ----- 对齐操作 -----
  {
    name: 'editor_align_elements',
    description: '对齐指定的多个元素。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_ids: { type: 'array', items: { type: 'string' }, description: '要对齐的元素 ID 列表' },
        align_type: { type: 'string', description: '对齐方式: l(左对齐), c(水平居中), r(右对齐), t(顶部对齐), m(垂直居中), b(底部对齐)', enum: ['l', 'c', 'r', 't', 'm', 'b'] },
        relative_to: { type: 'string', description: '对齐参照: selected(相对选中元素), largest(相对最大元素), smallest(相对最小元素), page(相对画布)', default: 'selected' }
      },
      required: ['diagram_id', 'element_ids', 'align_type']
    }
  },

  // ----- 样式操作 -----
  {
    name: 'editor_set_color',
    description: '设置选中元素的填充色或描边色。需要先选中元素或提供元素 ID。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID（可选，如不提供则作用于当前选中元素）' },
        color_type: { type: 'string', description: '颜色类型: fill(填充色) 或 stroke(描边色)', enum: ['fill', 'stroke'] },
        color: { type: 'string', description: '颜色值: 如 "#ff0000"、"rgb(255,0,0)"、"none"' }
      },
      required: ['diagram_id', 'color_type', 'color']
    }
  },
  {
    name: 'editor_set_stroke_width',
    description: '设置选中元素的描边宽度。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID（可选）' },
        width: { type: 'number', description: '描边宽度' }
      },
      required: ['diagram_id', 'width']
    }
  },
  {
    name: 'editor_set_stroke_attr',
    description: '设置描边样式属性（虚线、线头样式等）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID（可选）' },
        attr: { type: 'string', description: '属性名: stroke-dasharray, stroke-linejoin, stroke-linecap 等' },
        value: { type: 'string', description: '属性值。如 stroke-dasharray: "5,5"(虚线), "none"(实线)' }
      },
      required: ['diagram_id', 'attr', 'value']
    }
  },
  {
    name: 'editor_set_opacity',
    description: '设置选中元素的整体不透明度（0-1）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID（可选）' },
        opacity: { type: 'number', description: '不透明度 0（完全透明）到 1（完全不透明）' }
      },
      required: ['diagram_id', 'opacity']
    }
  },
  {
    name: 'editor_set_blur',
    description: '设置选中元素的模糊效果。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID（可选）' },
        blur: { type: 'number', description: '模糊值（0 = 无模糊）' }
      },
      required: ['diagram_id', 'blur']
    }
  },

  // ----- 文字操作 -----
  {
    name: 'editor_set_text_content',
    description: '修改文本元素的文字内容。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '文本元素 ID' },
        text: { type: 'string', description: '新的文本内容' }
      },
      required: ['diagram_id', 'element_id', 'text']
    }
  },
  {
    name: 'editor_set_font_family',
    description: '设置文本元素的字体。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '文本元素 ID' },
        family: { type: 'string', description: '字体名称，如 "Arial"、"serif"、"monospace"' }
      },
      required: ['diagram_id', 'element_id', 'family']
    }
  },
  {
    name: 'editor_set_font_size',
    description: '设置文本元素的字号大小。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '文本元素 ID' },
        size: { type: 'number', description: '字号大小' }
      },
      required: ['diagram_id', 'element_id', 'size']
    }
  },
  {
    name: 'editor_set_text_style',
    description: '设置文本元素的样式（粗体、斜体、对齐方式、颜色等，可同时设置多个）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '文本元素 ID' },
        bold: { type: 'boolean', description: '是否粗体' },
        italic: { type: 'boolean', description: '是否斜体' },
        anchor: { type: 'string', description: '文本对齐: start(左), middle(中), end(右)', enum: ['start', 'middle', 'end'] },
        color: { type: 'string', description: '文字颜色' },
        decoration: { type: 'string', description: '文字装饰: underline(下划线), line-through(删除线), overline(上划线)' }
      },
      required: ['diagram_id', 'element_id']
    }
  },

  // ----- 图层管理 -----
  {
    name: 'editor_get_layers',
    description: '获取所有图层的名称和可见性。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },
  {
    name: 'editor_create_layer',
    description: '创建新图层。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        name: { type: 'string', description: '图层名称' }
      },
      required: ['diagram_id', 'name']
    }
  },
  {
    name: 'editor_set_current_layer',
    description: '切换当前活跃图层（后续添加的元素将位于此图层）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        name: { type: 'string', description: '要切换到的图层名称' }
      },
      required: ['diagram_id', 'name']
    }
  },
  {
    name: 'editor_rename_layer',
    description: '重命名当前图层。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        new_name: { type: 'string', description: '新的图层名称' }
      },
      required: ['diagram_id', 'new_name']
    }
  },
  {
    name: 'editor_delete_layer',
    description: '删除当前图层。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },
  {
    name: 'editor_set_layer_visibility',
    description: '设置指定图层的可见性。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        name: { type: 'string', description: '图层名称' },
        visible: { type: 'boolean', description: '是否可见' }
      },
      required: ['diagram_id', 'name', 'visible']
    }
  },
  {
    name: 'editor_move_to_layer',
    description: '将选中的元素移动到指定图层。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_ids: { type: 'array', items: { type: 'string' }, description: '要移动的元素 ID 列表' },
        layer_name: { type: 'string', description: '目标图层名称' }
      },
      required: ['diagram_id', 'layer_name']
    }
  },

  // ----- 画布操作 -----
  {
    name: 'editor_set_resolution',
    description: '设置画布尺寸（宽高）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        width: { type: 'number', description: '画布宽度' },
        height: { type: 'number', description: '画布高度' }
      },
      required: ['diagram_id', 'width', 'height']
    }
  },
  {
    name: 'editor_get_resolution',
    description: '获取当前画布尺寸。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },
  {
    name: 'editor_set_background',
    description: '设置画布背景色或背景图片。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        color: { type: 'string', description: '背景颜色，如 "#ffffff"' },
        url: { type: 'string', description: '背景图片 URL（可选）' }
      },
      required: ['diagram_id', 'color']
    }
  },
  {
    name: 'editor_set_zoom',
    description: '设置编辑器缩放级别。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        level: { type: 'number', description: '缩放级别，1 = 100%，2 = 200%，0.5 = 50%' }
      },
      required: ['diagram_id', 'level']
    }
  },

  // ----- 超链接操作 -----
  {
    name: 'editor_make_hyperlink',
    description: '为指定元素添加超链接。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID' },
        url: { type: 'string', description: '链接 URL' }
      },
      required: ['diagram_id', 'element_id', 'url']
    }
  },
  {
    name: 'editor_remove_hyperlink',
    description: '移除指定元素上的超链接。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID' }
      },
      required: ['diagram_id', 'element_id']
    }
  },

  // ----- 形状操作 -----
  {
    name: 'editor_set_rect_radius',
    description: '设置矩形元素的圆角半径。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '矩形元素 ID' },
        radius: { type: 'number', description: '圆角半径' }
      },
      required: ['diagram_id', 'element_id', 'radius']
    }
  },
  {
    name: 'editor_convert_to_path',
    description: '将指定元素转换为路径（path）元素。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '元素 ID' }
      },
      required: ['diagram_id', 'element_id']
    }
  },

  // ----- 图片操作 -----
  {
    name: 'editor_set_image_url',
    description: '设置图片元素的 URL（更换图片源）。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        element_id: { type: 'string', description: '图片元素 ID' },
        url: { type: 'string', description: '图片 URL' }
      },
      required: ['diagram_id', 'element_id', 'url']
    }
  },

  // ----- 导出操作 -----
  {
    name: 'editor_export_raster',
    description: '将画布导出为位图（PNG/JPEG/WEBP），返回 Base64 Data URL。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' },
        format: { type: 'string', description: '导出格式: PNG, JPEG, BMP, WEBP', enum: ['PNG', 'JPEG', 'BMP', 'WEBP'], default: 'PNG' },
        quality: { type: 'number', description: 'JPEG 质量 0-1（仅 JPEG 格式有效）' }
      },
      required: ['diagram_id']
    }
  },

  // ----- 保存操作 -----
  {
    name: 'editor_save',
    description: '将编辑器中当前画布的内容保存到后端存储。用于持久化编辑结果。需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  },

  // ===== 第三层：导出（不需要编辑器在线）=====
  {
    name: 'export_diagram_svg',
    description: '导出指定图表的 SVG 文件内容。直接从后端存储读取，不需要编辑器在线。',
    inputSchema: {
      type: 'object',
      properties: {
        diagram_id: { type: 'string', description: '图表唯一标识符' }
      },
      required: ['diagram_id']
    }
  }
]

// ========================
// MCP Server 实现
// ========================

async function main () {
  const wsClient = new DiagramWsClient(DIAGRAM_WS_URL)

  const server = new Server(
    {
      name: 'svgedit-diagram-mcp',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  )

  // 列出可用工具
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS }
  })

  // 处理工具调用
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    try {
      switch (name) {
        // ===== Diagram 管理 =====

        case 'create_diagram': {
          const result = await apiRequest('POST', '/api/diagrams', {
            name: args.name,
            width: args.width || 800,
            height: args.height || 600
          })
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                diagram_id: result.id,
                name: result.name,
                editorUrl: result.editorUrl,
                message: `图表已创建。用户可以在浏览器中打开 ${result.editorUrl} 手动编辑。`,
                important: '⚠️ 如果需要使用 editor_* 系列工具进行在线编辑，请先调用 get_editor_usage_guide 工具获取详细使用说明！'
              }, null, 2)
            }]
          }
        }

        case 'list_diagrams': {
          const result = await apiRequest('GET', '/api/diagrams')
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          }
        }

        case 'get_diagram': {
          const result = await apiRequest('GET', `/api/diagrams/${args.diagram_id}`)
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                diagram_id: result.id,
                name: result.name,
                editorUrl: result.editorUrl,
                updatedAt: result.updatedAt,
                svgContent: result.svgContent
              }, null, 2)
            }]
          }
        }

        case 'update_diagram': {
          const result = await apiRequest('PUT', `/api/diagrams/${args.diagram_id}`, {
            svgContent: args.svg_content,
            name: args.name
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                diagram_id: result.id,
                updatedAt: result.updatedAt,
                message: 'SVG 内容已更新'
              }, null, 2)
            }]
          }
        }

        case 'delete_diagram': {
          const result = await apiRequest('DELETE', `/api/diagrams/${args.diagram_id}`)
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          }
        }

        case 'get_editor_usage_guide': {
          const guide = {
            title: 'SVGEdit 在线编辑功能使用说明',
            important: '⚠️ 所有 editor_* 系列工具都需要在浏览器中打开编辑器后才能使用！',
            steps: [
              {
                step: 1,
                action: '创建图表',
                description: '使用 create_diagram 工具创建一个新图表，系统会返回 diagram_id 和 editorUrl'
              },
              {
                step: 2,
                action: '打开编辑器',
                description: '**必须**在浏览器中打开返回的 editorUrl 链接。只有打开编辑器后，WebSocket 连接才会建立，editor_* 工具才能正常工作'
              },
              {
                step: 3,
                action: '使用在线编辑工具',
                description: '现在可以使用所有 editor_* 系列工具进行实时编辑，包括添加元素、修改属性、设置样式等。所有修改会实时反映在浏览器编辑器中'
              },
              {
                step: 4,
                action: '保存结果（可选）',
                description: '使用 editor_save 工具将编辑器中的内容保存到后端存储，以便持久化'
              }
            ],
            tool_categories: {
              no_editor_required: {
                name: '不需要编辑器在线的工具',
                tools: [
                  'create_diagram - 创建图表',
                  'list_diagrams - 列出所有图表',
                  'get_diagram - 获取图表详情',
                  'update_diagram - 直接更新 SVG 内容（推荐使用 editor_* 工具）',
                  'delete_diagram - 删除图表',
                  'export_diagram_svg - 导出 SVG 文件'
                ]
              },
              editor_required: {
                name: '需要编辑器在线的工具（editor_* 系列）',
                description: '这些工具通过 WebSocket 与浏览器编辑器实时通信，必须先在浏览器中打开 editorUrl',
                categories: [
                  {
                    name: '元素操作',
                    tools: ['editor_add_element', 'editor_add_elements', 'editor_update_element', 'editor_delete_elements', 'editor_move_element']
                  },
                  {
                    name: '查询操作',
                    tools: ['editor_get_all_elements', 'editor_get_element', 'editor_get_selected']
                  },
                  {
                    name: '选择操作',
                    tools: ['editor_select_elements', 'editor_select_all', 'editor_clear_selection']
                  },
                  {
                    name: 'SVG 操作',
                    tools: ['editor_set_svg', 'editor_get_svg', 'editor_import_svg', 'editor_clear']
                  },
                  {
                    name: '撤销/重做',
                    tools: ['editor_undo', 'editor_redo']
                  },
                  {
                    name: '分组操作',
                    tools: ['editor_group_elements', 'editor_ungroup_element']
                  },
                  {
                    name: '复制/粘贴',
                    tools: ['editor_clone_elements', 'editor_copy_elements', 'editor_cut_elements', 'editor_paste_elements']
                  },
                  {
                    name: '变换操作',
                    tools: ['editor_set_rotation', 'editor_get_rotation', 'editor_flip_elements']
                  },
                  {
                    name: '对齐操作',
                    tools: ['editor_align_elements']
                  },
                  {
                    name: '样式操作',
                    tools: ['editor_set_color', 'editor_set_stroke_width', 'editor_set_stroke_attr', 'editor_set_opacity', 'editor_set_blur']
                  },
                  {
                    name: '文字操作',
                    tools: ['editor_set_text_content', 'editor_set_font_family', 'editor_set_font_size', 'editor_set_text_style']
                  },
                  {
                    name: '图层管理',
                    tools: ['editor_get_layers', 'editor_create_layer', 'editor_set_current_layer', 'editor_rename_layer', 'editor_delete_layer', 'editor_set_layer_visibility', 'editor_move_to_layer']
                  },
                  {
                    name: '画布操作',
                    tools: ['editor_set_resolution', 'editor_get_resolution', 'editor_set_background', 'editor_set_zoom']
                  },
                  {
                    name: '其他操作',
                    tools: ['editor_make_hyperlink', 'editor_remove_hyperlink', 'editor_set_rect_radius', 'editor_convert_to_path', 'editor_set_image_url', 'editor_export_raster', 'editor_save']
                  }
                ]
              }
            },
            example_workflow: {
              title: '典型工作流程示例',
              code: [
                '1. 调用 create_diagram({name: "我的图表", width: 800, height: 600})',
                '   返回: {diagram_id: "d_xxx", editorUrl: "http://..."}',
                '',
                '2. ⚠️ 在浏览器中打开 editorUrl（这一步是必须的！）',
                '',
                '3. 现在可以调用 editor_* 工具：',
                '   - editor_add_element({diagram_id: "d_xxx", element: "rect", attrs: {x: 10, y: 10, width: 100, height: 50, fill: "blue"}})',
                '   - editor_add_element({diagram_id: "d_xxx", element: "text", attrs: {x: 30, y: 35, fill: "white"}, children: [{text: "Hello"}]})',
                '',
                '4. 保存结果（可选）：',
                '   - editor_save({diagram_id: "d_xxx"})'
              ]
            },
            troubleshooting: {
              title: '常见问题',
              issues: [
                {
                  problem: 'editor_* 工具返回错误或超时',
                  solution: '确保已经在浏览器中打开了编辑器 URL。WebSocket 连接需要编辑器在线才能建立'
                },
                {
                  problem: '不知道如何打开编辑器',
                  solution: 'create_diagram 返回的 editorUrl 就是编辑器地址，直接在浏览器中访问这个链接即可'
                },
                {
                  problem: '想快速上传 SVG 而不是逐步构建',
                  solution: '可以使用 update_diagram 工具直接上传完整的 SVG 内容，不需要编辑器在线'
                }
              ]
            }
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(guide, null, 2)
            }]
          }
        }

        // ===== 编辑器实时操作 =====

        // ----- 元素 CRUD -----

        case 'editor_add_element': {
          const result = await wsClient.request(args.diagram_id, 'addElement', {
            element: args.element,
            attrs: args.attrs,
            children: args.children
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                element_id: result.id,
                message: `已添加 ${args.element} 元素`
              }, null, 2)
            }]
          }
        }

        case 'editor_add_elements': {
          const result = await wsClient.request(args.diagram_id, 'addElements', {
            elements: args.elements
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                element_ids: result.ids,
                message: `已批量添加 ${result.ids?.length || 0} 个元素`
              }, null, 2)
            }]
          }
        }

        case 'editor_update_element': {
          const result = await wsClient.request(args.diagram_id, 'updateElement', {
            id: args.element_id,
            attrs: args.attrs
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '元素属性已更新' }, null, 2)
            }]
          }
        }

        case 'editor_delete_elements': {
          const result = await wsClient.request(args.diagram_id, 'deleteElements', {
            ids: args.element_ids
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, deleted: result.deleted }, null, 2)
            }]
          }
        }

        case 'editor_move_element': {
          const payload = { id: args.element_id }
          if (args.x !== undefined) payload.x = args.x
          if (args.y !== undefined) payload.y = args.y
          if (args.cx !== undefined) payload.cx = args.cx
          if (args.cy !== undefined) payload.cy = args.cy
          const result = await wsClient.request(args.diagram_id, 'moveElement', payload)
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '元素已移动' }, null, 2)
            }]
          }
        }

        // ----- 查询操作 -----

        case 'editor_get_all_elements': {
          const result = await wsClient.request(args.diagram_id, 'getAllElements')
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          }
        }

        case 'editor_get_element': {
          const result = await wsClient.request(args.diagram_id, 'getElementById', {
            id: args.element_id
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          }
        }

        case 'editor_get_selected': {
          const result = await wsClient.request(args.diagram_id, 'getSelectedElements')
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          }
        }

        // ----- 选择操作 -----

        case 'editor_select_elements': {
          const result = await wsClient.request(args.diagram_id, 'selectElements', {
            ids: args.element_ids
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, selected: result.selected }, null, 2)
            }]
          }
        }

        case 'editor_select_all': {
          const result = await wsClient.request(args.diagram_id, 'selectAllInCurrentLayer')
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, ids: result.ids }, null, 2)
            }]
          }
        }

        case 'editor_clear_selection': {
          const result = await wsClient.request(args.diagram_id, 'clearSelection')
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '已取消所有选中' }, null, 2)
            }]
          }
        }

        // ----- SVG 整体操作 -----

        case 'editor_set_svg': {
          const result = await wsClient.request(args.diagram_id, 'setSvgString', {
            svgXml: args.svg_content
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '编辑器 SVG 内容已替换' }, null, 2)
            }]
          }
        }

        case 'editor_get_svg': {
          const result = await wsClient.request(args.diagram_id, 'getSvgString')
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }]
          }
        }

        case 'editor_import_svg': {
          const result = await wsClient.request(args.diagram_id, 'importSvgString', {
            svgXml: args.svg_content
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: 'SVG 内容已导入' }, null, 2)
            }]
          }
        }

        case 'editor_clear': {
          const result = await wsClient.request(args.diagram_id, 'clear')
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '画布已清空' }, null, 2)
            }]
          }
        }

        // ----- 撤销/重做 -----

        case 'editor_undo': {
          const result = await wsClient.request(args.diagram_id, 'undo')
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '已撤销' }, null, 2)
            }]
          }
        }

        case 'editor_redo': {
          const result = await wsClient.request(args.diagram_id, 'redo')
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '已重做' }, null, 2)
            }]
          }
        }

        // ----- 批量操作会话 -----

        case 'editor_begin_batch': {
          const result = await wsClient.request(args.diagram_id, 'beginBatch')
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '批量操作会话已开始' }, null, 2)
            }]
          }
        }

        case 'editor_end_batch': {
          const result = await wsClient.request(args.diagram_id, 'endBatch', {
            text: args.description
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '批量操作会话已结束，已注册为一个可撤销命令' }, null, 2)
            }]
          }
        }

        // ----- 分组操作 -----

        case 'editor_group_elements': {
          const result = await wsClient.request(args.diagram_id, 'groupSelectedElements', {
            ids: args.element_ids
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, group_id: result.id, message: '元素已编组' }, null, 2)
            }]
          }
        }

        case 'editor_ungroup_element': {
          const result = await wsClient.request(args.diagram_id, 'ungroupSelectedElement', {
            id: args.element_id
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '组已解散' }, null, 2)
            }]
          }
        }

        // ----- 克隆/复制/粘贴 -----

        case 'editor_clone_elements': {
          const result = await wsClient.request(args.diagram_id, 'cloneSelectedElements', {
            ids: args.element_ids,
            dx: args.dx,
            dy: args.dy
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, cloned_ids: result.ids, message: '元素已克隆' }, null, 2)
            }]
          }
        }

        case 'editor_copy_elements': {
          const result = await wsClient.request(args.diagram_id, 'copySelectedElements', {
            ids: args.element_ids
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '元素已复制到剪贴板' }, null, 2)
            }]
          }
        }

        case 'editor_cut_elements': {
          const result = await wsClient.request(args.diagram_id, 'cutSelectedElements', {
            ids: args.element_ids
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '元素已剪切到剪贴板' }, null, 2)
            }]
          }
        }

        case 'editor_paste_elements': {
          const result = await wsClient.request(args.diagram_id, 'pasteElements', {
            type: args.paste_type || 'in_place'
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, pasted_ids: result.ids, message: '元素已粘贴' }, null, 2)
            }]
          }
        }

        // ----- Z 轴层序操作 -----

        case 'editor_move_to_top': {
          const result = await wsClient.request(args.diagram_id, 'moveToTopSelectedElement', {
            id: args.element_id
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '元素已移到最顶层' }, null, 2)
            }]
          }
        }

        case 'editor_move_to_bottom': {
          const result = await wsClient.request(args.diagram_id, 'moveToBottomSelectedElement', {
            id: args.element_id
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '元素已移到最底层' }, null, 2)
            }]
          }
        }

        case 'editor_move_up_down': {
          const result = await wsClient.request(args.diagram_id, 'moveUpDownSelected', {
            id: args.element_id,
            direction: args.direction
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `元素已${args.direction === 'Up' ? '上' : '下'}移一层` }, null, 2)
            }]
          }
        }

        // ----- 变换操作 -----

        case 'editor_set_rotation': {
          const result = await wsClient.request(args.diagram_id, 'setRotationAngle', {
            id: args.element_id,
            angle: args.angle
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `旋转角度已设置为 ${args.angle}°` }, null, 2)
            }]
          }
        }

        case 'editor_get_rotation': {
          const result = await wsClient.request(args.diagram_id, 'getRotationAngle', {
            id: args.element_id
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          }
        }

        case 'editor_flip_elements': {
          const result = await wsClient.request(args.diagram_id, 'flipSelectedElements', {
            ids: args.element_ids,
            horizontal: args.horizontal,
            vertical: args.vertical
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '元素已翻转' }, null, 2)
            }]
          }
        }

        // ----- 对齐操作 -----

        case 'editor_align_elements': {
          // 先选中元素
          await wsClient.request(args.diagram_id, 'selectElements', { ids: args.element_ids })
          const result = await wsClient.request(args.diagram_id, 'alignSelectedElements', {
            ids: args.element_ids,
            type: args.align_type,
            relativeTo: args.relative_to || 'selected'
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          const alignNames = { l: '左对齐', c: '水平居中', r: '右对齐', t: '顶部对齐', m: '垂直居中', b: '底部对齐' }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `已${alignNames[args.align_type] || '对齐'}` }, null, 2)
            }]
          }
        }

        // ----- 样式操作 -----

        case 'editor_set_color': {
          // 如果提供了 element_id，先选中
          if (args.element_id) {
            await wsClient.request(args.diagram_id, 'selectElements', { ids: [args.element_id] })
          }
          const result = await wsClient.request(args.diagram_id, 'setColor', {
            type: args.color_type,
            val: args.color
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `${args.color_type === 'fill' ? '填充色' : '描边色'}已设置为 ${args.color}` }, null, 2)
            }]
          }
        }

        case 'editor_set_stroke_width': {
          if (args.element_id) {
            await wsClient.request(args.diagram_id, 'selectElements', { ids: [args.element_id] })
          }
          const result = await wsClient.request(args.diagram_id, 'setStrokeWidth', {
            val: args.width
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `描边宽度已设置为 ${args.width}` }, null, 2)
            }]
          }
        }

        case 'editor_set_stroke_attr': {
          if (args.element_id) {
            await wsClient.request(args.diagram_id, 'selectElements', { ids: [args.element_id] })
          }
          const result = await wsClient.request(args.diagram_id, 'setStrokeAttr', {
            attr: args.attr,
            val: args.value
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `描边属性 ${args.attr} 已设置` }, null, 2)
            }]
          }
        }

        case 'editor_set_opacity': {
          if (args.element_id) {
            await wsClient.request(args.diagram_id, 'selectElements', { ids: [args.element_id] })
          }
          const result = await wsClient.request(args.diagram_id, 'setOpacity', {
            val: args.opacity
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `不透明度已设置为 ${args.opacity}` }, null, 2)
            }]
          }
        }

        case 'editor_set_blur': {
          if (args.element_id) {
            await wsClient.request(args.diagram_id, 'selectElements', { ids: [args.element_id] })
          }
          const result = await wsClient.request(args.diagram_id, 'setBlur', {
            val: args.blur,
            complete: true
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `模糊效果已设置为 ${args.blur}` }, null, 2)
            }]
          }
        }

        // ----- 文字操作 -----

        case 'editor_set_text_content': {
          const result = await wsClient.request(args.diagram_id, 'setTextContent', {
            id: args.element_id,
            text: args.text
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '文本内容已更新' }, null, 2)
            }]
          }
        }

        case 'editor_set_font_family': {
          const result = await wsClient.request(args.diagram_id, 'setFontFamily', {
            id: args.element_id,
            family: args.family
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `字体已设置为 ${args.family}` }, null, 2)
            }]
          }
        }

        case 'editor_set_font_size': {
          const result = await wsClient.request(args.diagram_id, 'setFontSize', {
            id: args.element_id,
            size: args.size
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `字号已设置为 ${args.size}` }, null, 2)
            }]
          }
        }

        case 'editor_set_text_style': {
          const results = []
          // 先选中文本元素
          if (args.element_id) {
            await wsClient.request(args.diagram_id, 'selectElements', { ids: [args.element_id] })
          }
          if (args.bold !== undefined) {
            await wsClient.request(args.diagram_id, 'setBold', { id: args.element_id, bold: args.bold })
            results.push(`粗体: ${args.bold}`)
          }
          if (args.italic !== undefined) {
            await wsClient.request(args.diagram_id, 'setItalic', { id: args.element_id, italic: args.italic })
            results.push(`斜体: ${args.italic}`)
          }
          if (args.anchor) {
            await wsClient.request(args.diagram_id, 'setTextAnchor', { id: args.element_id, anchor: args.anchor })
            results.push(`对齐: ${args.anchor}`)
          }
          if (args.color) {
            await wsClient.request(args.diagram_id, 'setFontColor', { id: args.element_id, color: args.color })
            results.push(`颜色: ${args.color}`)
          }
          if (args.decoration) {
            await wsClient.request(args.diagram_id, 'addTextDecoration', { id: args.element_id, value: args.decoration })
            results.push(`装饰: ${args.decoration}`)
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `文本样式已更新: ${results.join(', ')}` }, null, 2)
            }]
          }
        }

        // ----- 图层管理 -----

        case 'editor_get_layers': {
          const result = await wsClient.request(args.diagram_id, 'getLayers')
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          }
        }

        case 'editor_create_layer': {
          const result = await wsClient.request(args.diagram_id, 'createLayer', {
            name: args.name
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `图层 "${args.name}" 已创建` }, null, 2)
            }]
          }
        }

        case 'editor_set_current_layer': {
          const result = await wsClient.request(args.diagram_id, 'setCurrentLayer', {
            name: args.name
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `已切换到图层 "${args.name}"` }, null, 2)
            }]
          }
        }

        case 'editor_rename_layer': {
          const result = await wsClient.request(args.diagram_id, 'renameCurrentLayer', {
            newName: args.new_name
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `图层已重命名为 "${args.new_name}"` }, null, 2)
            }]
          }
        }

        case 'editor_delete_layer': {
          const result = await wsClient.request(args.diagram_id, 'deleteCurrentLayer')
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '当前图层已删除' }, null, 2)
            }]
          }
        }

        case 'editor_set_layer_visibility': {
          const result = await wsClient.request(args.diagram_id, 'setLayerVisibility', {
            name: args.name,
            visible: args.visible
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `图层 "${args.name}" ${args.visible ? '已显示' : '已隐藏'}` }, null, 2)
            }]
          }
        }

        case 'editor_move_to_layer': {
          // 先选中要移动的元素
          if (args.element_ids) {
            await wsClient.request(args.diagram_id, 'selectElements', { ids: args.element_ids })
          }
          const result = await wsClient.request(args.diagram_id, 'moveSelectedToLayer', {
            name: args.layer_name
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `元素已移动到图层 "${args.layer_name}"` }, null, 2)
            }]
          }
        }

        // ----- 画布操作 -----

        case 'editor_set_resolution': {
          const result = await wsClient.request(args.diagram_id, 'setResolution', {
            width: args.width,
            height: args.height
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `画布尺寸已设置为 ${args.width}x${args.height}` }, null, 2)
            }]
          }
        }

        case 'editor_get_resolution': {
          const result = await wsClient.request(args.diagram_id, 'getResolution')
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          }
        }

        case 'editor_set_background': {
          const result = await wsClient.request(args.diagram_id, 'setBackground', {
            color: args.color,
            url: args.url
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `画布背景已设置为 ${args.color}` }, null, 2)
            }]
          }
        }

        case 'editor_set_zoom': {
          const result = await wsClient.request(args.diagram_id, 'zoom', {
            level: args.level
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `缩放级别已设置为 ${args.level * 100}%` }, null, 2)
            }]
          }
        }

        // ----- 超链接操作 -----

        case 'editor_make_hyperlink': {
          const result = await wsClient.request(args.diagram_id, 'makeHyperlink', {
            id: args.element_id,
            url: args.url
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '超链接已添加' }, null, 2)
            }]
          }
        }

        case 'editor_remove_hyperlink': {
          const result = await wsClient.request(args.diagram_id, 'removeHyperlink', {
            id: args.element_id
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '超链接已移除' }, null, 2)
            }]
          }
        }

        // ----- 形状操作 -----

        case 'editor_set_rect_radius': {
          const result = await wsClient.request(args.diagram_id, 'setRectRadius', {
            id: args.element_id,
            val: args.radius
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: `圆角半径已设置为 ${args.radius}` }, null, 2)
            }]
          }
        }

        case 'editor_convert_to_path': {
          const result = await wsClient.request(args.diagram_id, 'convertToPath', {
            id: args.element_id
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '元素已转换为路径' }, null, 2)
            }]
          }
        }

        // ----- 图片操作 -----

        case 'editor_set_image_url': {
          const result = await wsClient.request(args.diagram_id, 'setImageURL', {
            id: args.element_id,
            url: args.url
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: '图片 URL 已更新' }, null, 2)
            }]
          }
        }

        // ----- 导出操作 -----

        case 'editor_export_raster': {
          const result = await wsClient.request(args.diagram_id, 'rasterExport', {
            type: args.format || 'PNG',
            quality: args.quality
          })
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                format: args.format || 'PNG',
                dataUrl: result.dataUrl,
                message: `已导出为 ${args.format || 'PNG'} 格式`
              }, null, 2)
            }]
          }
        }

        // ----- 保存操作 -----

        case 'editor_save': {
          // 先从编辑器获取当前 SVG
          const svgResult = await wsClient.request(args.diagram_id, 'getSvgString')
          if (svgResult.error || typeof svgResult !== 'string') {
            return {
              content: [{
                type: 'text',
                text: `错误: 无法从编辑器获取 SVG 内容。${svgResult.error || '编辑器可能未打开。'}`
              }],
              isError: true
            }
          }
          // 保存到后端存储
          const saveResult = await apiRequest('PUT', `/api/diagrams/${args.diagram_id}`, {
            svgContent: svgResult
          })
          if (saveResult.error) {
            return { content: [{ type: 'text', text: `保存失败: ${saveResult.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                diagram_id: args.diagram_id,
                updatedAt: saveResult.updatedAt,
                message: '编辑器内容已保存到后端'
              }, null, 2)
            }]
          }
        }

        // ===== 导出 =====

        case 'export_diagram_svg': {
          const result = await apiRequest('GET', `/api/diagrams/${args.diagram_id}`)
          if (result.error) {
            return { content: [{ type: 'text', text: `错误: ${result.error}` }], isError: true }
          }
          return {
            content: [{
              type: 'text',
              text: result.svgContent
            }]
          }
        }

        default:
          return {
            content: [{ type: 'text', text: `未知工具: ${name}` }],
            isError: true
          }
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `工具执行错误: ${err.message}` }],
        isError: true
      }
    }
  })

  // 启动 MCP Server (stdio)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[MCP] SVGEdit Diagram MCP Server started (stdio)')
}

main().catch(err => {
  console.error('[MCP] Fatal error:', err)
  process.exit(1)
})

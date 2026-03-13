/**
 * @file server.js
 * @description 统一后端服务：HTTP API + WebSocket 中继 + SVG 文件存储
 *
 * 架构：
 *   ┌──────────┐   MCP     ┌──────────────────────┐   WebSocket   ┌────────────┐
 *   │ AI Client │ ──────→  │  diagram-server       │ ←──────────→ │  SVGEdit   │
 *   │ (MCP)     │  HTTP    │  • HTTP API (CRUD)     │              │  (浏览器)   │
 *   └──────────┘          │  • WebSocket 中继       │              └────────────┘
 *                          │  • 文件存储             │
 *                          └──────────────────────┘
 *
 * HTTP API：
 *   POST   /api/diagrams              创建新 diagram
 *   GET    /api/diagrams              列出所有 diagrams
 *   GET    /api/diagrams/:id          获取 diagram 详情 + SVG 内容
 *   PUT    /api/diagrams/:id          更新 diagram SVG 内容
 *   DELETE /api/diagrams/:id          删除 diagram
 *   GET    /api/diagrams/:id/svg      获取纯 SVG 内容（直接可用）
 *
 * WebSocket (ws://host:port/ws)：
 *   与原 remote-bridge server.js 兼容的中继协议
 *   新增：editor 角色注册时可携带 diagramId，支持多 diagram 编辑
 */

import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ========================
// 配置
// ========================

const PORT = parseInt(process.env.DIAGRAM_PORT || '2333', 10)
const DIAGRAMS_DIR = process.env.DIAGRAMS_DIR || path.join(__dirname, 'diagrams')
const META_FILE = path.join(DIAGRAMS_DIR, '_meta.json')

// ========================
// Diagram 存储管理器
// ========================

class DiagramStore {
  constructor (baseDir, metaFile) {
    this.baseDir = baseDir
    this.metaFile = metaFile
    /** @type {Map<string, {id: string, name: string, createdAt: string, updatedAt: string}>} */
    this.meta = new Map()
  }

  async init () {
    await fs.mkdir(this.baseDir, { recursive: true })
    try {
      const raw = await fs.readFile(this.metaFile, 'utf-8')
      const arr = JSON.parse(raw)
      for (const item of arr) {
        this.meta.set(item.id, item)
      }
    } catch {
      // 文件不存在或 JSON 无效，从头开始
    }
    console.log(`[DiagramStore] Loaded ${this.meta.size} diagrams from ${this.baseDir}`)
  }

  async _saveMeta () {
    const arr = Array.from(this.meta.values())
    await fs.writeFile(this.metaFile, JSON.stringify(arr, null, 2), 'utf-8')
  }

  _svgPath (id) {
    return path.join(this.baseDir, `${id}.svg`)
  }

  /**
   * 创建新 diagram
   * @param {object} options
   * @param {string} [options.name] 名称
   * @param {number} [options.width=800] 宽度
   * @param {number} [options.height=600] 高度
   * @param {string} [options.svgContent] 初始 SVG 内容（可选）
   * @returns {Promise<object>} diagram meta + svg content
   */
  async create ({ name, width = 800, height = 600, svgContent } = {}) {
    const id = `d_${uuidv4().replace(/-/g, '').substring(0, 12)}`
    const now = new Date().toISOString()

    const svg = svgContent || this._createEmptySvg(width, height)
    const entry = {
      id,
      name: name || `Untitled_${id}`,
      width,
      height,
      createdAt: now,
      updatedAt: now
    }

    await fs.writeFile(this._svgPath(id), svg, 'utf-8')
    this.meta.set(id, entry)
    await this._saveMeta()

    return { ...entry, svgContent: svg }
  }

  /**
   * 获取 diagram 详情
   */
  async get (id) {
    const entry = this.meta.get(id)
    if (!entry) return null

    try {
      const svgContent = await fs.readFile(this._svgPath(id), 'utf-8')
      return { ...entry, svgContent }
    } catch {
      return null
    }
  }

  /**
   * 获取纯 SVG 内容
   */
  async getSvg (id) {
    if (!this.meta.has(id)) return null
    try {
      return await fs.readFile(this._svgPath(id), 'utf-8')
    } catch {
      return null
    }
  }

  /**
   * 更新 diagram SVG 内容
   */
  async update (id, svgContent, name) {
    const entry = this.meta.get(id)
    if (!entry) return null

    entry.updatedAt = new Date().toISOString()
    if (name) entry.name = name

    await fs.writeFile(this._svgPath(id), svgContent, 'utf-8')
    await this._saveMeta()

    return { ...entry }
  }

  /**
   * 删除 diagram
   */
  async delete (id) {
    if (!this.meta.has(id)) return false
    this.meta.delete(id)
    try {
      await fs.unlink(this._svgPath(id))
    } catch {
      // 文件已不存在
    }
    await this._saveMeta()
    return true
  }

  /**
   * 列出所有 diagrams
   */
  list () {
    return Array.from(this.meta.values()).sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    )
  }

  _createEmptySvg (width, height) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <!-- Created by SVGEdit Diagram Server -->
</svg>`
  }
}

// ========================
// HTTP 请求路由
// ========================

/**
 * 解析 JSON body
 */
function parseBody (req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk.toString() })
    req.on('end', () => {
      if (!body) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch (e) {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 发送 JSON 响应
 */
function sendJson (res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  res.end(JSON.stringify(data))
}

/**
 * 发送纯 SVG 响应
 */
function sendSvg (res, svgContent) {
  res.writeHead(200, {
    'Content-Type': 'image/svg+xml',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(svgContent)
}

/**
 * 创建 HTTP 路由处理器
 */
function createRouter (store, editorBaseUrl) {
  return async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    const pathname = url.pathname

    // CORS 预检
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      })
      res.end()
      return
    }

    try {
      // POST /api/diagrams - 创建新 diagram
      if (req.method === 'POST' && pathname === '/api/diagrams') {
        const body = await parseBody(req)
        const diagram = await store.create({
          name: body.name,
          width: body.width,
          height: body.height,
          svgContent: body.svgContent
        })

        // 构建编辑器 URL
        const editorUrl = `${editorBaseUrl}?id=${diagram.id}`

        sendJson(res, 201, {
          ...diagram,
          editorUrl
        })
        return
      }

      // GET /api/diagrams - 列出所有
      if (req.method === 'GET' && pathname === '/api/diagrams') {
        const list = store.list().map(item => ({
          ...item,
          editorUrl: `${editorBaseUrl}?id=${item.id}`
        }))
        sendJson(res, 200, { diagrams: list })
        return
      }

      // GET /api/diagrams/:id - 获取详情
      const detailMatch = pathname.match(/^\/api\/diagrams\/([^/]+)$/)
      if (req.method === 'GET' && detailMatch) {
        const id = detailMatch[1]
        const diagram = await store.get(id)
        if (!diagram) {
          sendJson(res, 404, { error: `Diagram not found: ${id}` })
          return
        }
        sendJson(res, 200, {
          ...diagram,
          editorUrl: `${editorBaseUrl}?id=${id}`
        })
        return
      }

      // PUT /api/diagrams/:id - 更新 SVG
      const updateMatch = pathname.match(/^\/api\/diagrams\/([^/]+)$/)
      if (req.method === 'PUT' && updateMatch) {
        const id = updateMatch[1]
        const body = await parseBody(req)
        if (!body.svgContent) {
          sendJson(res, 400, { error: 'svgContent is required' })
          return
        }
        const result = await store.update(id, body.svgContent, body.name)
        if (!result) {
          sendJson(res, 404, { error: `Diagram not found: ${id}` })
          return
        }
        sendJson(res, 200, result)
        return
      }

      // DELETE /api/diagrams/:id - 删除
      const deleteMatch = pathname.match(/^\/api\/diagrams\/([^/]+)$/)
      if (req.method === 'DELETE' && deleteMatch) {
        const id = deleteMatch[1]
        const ok = await store.delete(id)
        if (!ok) {
          sendJson(res, 404, { error: `Diagram not found: ${id}` })
          return
        }
        sendJson(res, 200, { success: true, id })
        return
      }

      // GET /api/diagrams/:id/svg - 获取纯 SVG
      const svgMatch = pathname.match(/^\/api\/diagrams\/([^/]+)\/svg$/)
      if (req.method === 'GET' && svgMatch) {
        const id = svgMatch[1]
        const svg = await store.getSvg(id)
        if (!svg) {
          sendJson(res, 404, { error: `Diagram not found: ${id}` })
          return
        }
        sendSvg(res, svg)
        return
      }

      // 404
      sendJson(res, 404, { error: 'Not found' })
    } catch (err) {
      console.error('[HTTP] Error:', err)
      sendJson(res, 500, { error: err.message })
    }
  }
}

// ========================
// WebSocket 中继（兼容原 remote-bridge 协议）
// ========================

/**
 * 扩展版 WebSocket 中继
 * 新增 diagramId 支持：editor 注册时携带 diagramId，
 * 客户端发消息时携带 diagramId 即可路由到对应 editor
 */
function setupWebSocketRelay (httpServer, store) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  /**
   * 按 diagramId 管理 editor 连接
   * key: diagramId (或 '__default__' 表示不指定 diagram 的 editor)
   * value: WebSocket
   */
  const editorsByDiagram = new Map()

  /** @type {Set<import('ws').WebSocket>} */
  const clientSockets = new Set()

  /** @type {Map<string, import('ws').WebSocket>} 按 requestId 追踪发送者 */
  const pendingRequests = new Map()

  wss.on('connection', (ws) => {
    let role = null
    let assignedDiagramId = null

    ws.on('message', async (rawData) => {
      let msg
      try {
        msg = JSON.parse(rawData.toString())
      } catch {
        ws.send(JSON.stringify({ error: 'Invalid JSON' }))
        return
      }

      // 首条消息注册角色
      if (!role) {
        if (msg.role === 'editor') {
          role = 'editor'
          assignedDiagramId = msg.diagramId || '__default__'

          // 替换已有的同 diagramId editor
          const existing = editorsByDiagram.get(assignedDiagramId)
          if (existing && existing.readyState === 1) {
            console.log(`[ws] Replacing editor for diagram: ${assignedDiagramId}`)
            existing.close()
          }
          editorsByDiagram.set(assignedDiagramId, ws)
          console.log(`[ws] Editor connected for diagram: ${assignedDiagramId}`)

          ws.send(JSON.stringify({ type: 'registered', role: 'editor', diagramId: assignedDiagramId }))
          broadcastToClients({ event: 'editor_connected', diagramId: assignedDiagramId })
          return
        } else if (msg.role === 'client') {
          role = 'client'
          clientSockets.add(ws)
          console.log(`[ws] Client connected (total: ${clientSockets.size})`)

          // 告知哪些 diagram 有 editor 在线
          const onlineDiagrams = Array.from(editorsByDiagram.entries())
            .filter(([, s]) => s.readyState === 1)
            .map(([did]) => did)

          ws.send(JSON.stringify({
            type: 'registered',
            role: 'client',
            onlineDiagrams
          }))
          return
        } else {
          role = 'client'
          clientSockets.add(ws)
        }
      }

      // 路由消息
      if (role === 'client') {
        const diagramId = msg.diagramId || '__default__'
        const editor = editorsByDiagram.get(diagramId)

        if (!editor || editor.readyState !== 1) {
          ws.send(JSON.stringify({
            requestId: msg.requestId,
            error: `Editor not connected for diagram: ${diagramId}`
          }))
          return
        }

        if (msg.requestId) {
          pendingRequests.set(String(msg.requestId), ws)
        }
        editor.send(JSON.stringify(msg))
      } else if (role === 'editor') {
        if (msg.requestId) {
          const targetClient = pendingRequests.get(String(msg.requestId))
          if (targetClient && targetClient.readyState === 1) {
            targetClient.send(JSON.stringify(msg))
          }
          pendingRequests.delete(String(msg.requestId))
        } else if (msg.event) {
          broadcastToClients({ ...msg, diagramId: assignedDiagramId })
        }

        // 如果 editor 发送了 svg_saved 事件，持久化到文件
        if (msg.event === 'svg_saved' && msg.data?.svgContent && assignedDiagramId !== '__default__') {
          try {
            await store.update(assignedDiagramId, msg.data.svgContent)
            console.log(`[ws] Auto-saved diagram: ${assignedDiagramId}`)
          } catch (err) {
            console.error(`[ws] Auto-save error for ${assignedDiagramId}:`, err)
          }
        }
      }
    })

    ws.on('close', () => {
      if (role === 'editor') {
        console.log(`[ws] Editor disconnected: ${assignedDiagramId}`)
        if (editorsByDiagram.get(assignedDiagramId) === ws) {
          editorsByDiagram.delete(assignedDiagramId)
        }
        broadcastToClients({ event: 'editor_disconnected', diagramId: assignedDiagramId })
      } else if (role === 'client') {
        clientSockets.delete(ws)
        console.log(`[ws] Client disconnected (remaining: ${clientSockets.size})`)
        for (const [reqId, client] of pendingRequests.entries()) {
          if (client === ws) pendingRequests.delete(reqId)
        }
      }
    })

    ws.on('error', (err) => {
      console.error(`[ws] WebSocket error (role=${role}):`, err.message)
    })
  })

  function broadcastToClients (msg) {
    const data = JSON.stringify(msg)
    for (const client of clientSockets) {
      if (client.readyState === 1) {
        client.send(data)
      }
    }
  }

  return wss
}

// ========================
// 启动
// ========================

async function main () {
  const store = new DiagramStore(DIAGRAMS_DIR, META_FILE)
  await store.init()

  // SVGEdit 编辑器的 base URL（用户在浏览器打开）
  // EDITOR_BASE_URL 直接指定完整的编辑器入口 URL，优先级最高
  // EDITOR_HOST 指定编辑器的 host（向后兼容）
  const editorBaseUrl = process.env.EDITOR_BASE_URL
    || (process.env.EDITOR_HOST
      ? `${process.env.EDITOR_HOST}/src/editor/index.html`
      : `http://localhost:8000/src/editor/index.html`)

  const httpServer = createServer(createRouter(store, editorBaseUrl))
  setupWebSocketRelay(httpServer, store)

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`  SVGEdit Diagram Server`)
    console.log(`${'='.repeat(60)}`)
    console.log(`  HTTP API:    http://localhost:${PORT}/api/diagrams`)
    console.log(`  WebSocket:   ws://localhost:${PORT}/ws`)
    console.log(`  Editor:      ${editorBaseUrl}`)
    console.log(`  Diagrams:    ${DIAGRAMS_DIR}`)
    console.log(`${'='.repeat(60)}\n`)
  })
}

main().catch(err => {
  console.error('Failed to start diagram-server:', err)
  process.exit(1)
})

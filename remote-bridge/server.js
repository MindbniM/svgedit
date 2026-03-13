/**
 * @file server.js
 * @description WebSocket 中继服务端
 *
 * 架构：
 *   [远程客户端(s)] ←→ [中继 Server] ←→ [SVGEdit 浏览器端]
 *
 * 工作方式：
 * - SVGEdit 浏览器扩展连接到 ws://localhost:9527 （作为 "editor"）
 * - 远程客户端连接到 ws://localhost:9527 （作为 "client"）
 * - 客户端发送的命令 → 转发给 editor
 * - editor 的响应 → 转发回对应客户端
 * - editor 的事件推送 → 广播给所有客户端
 *
 * 连接通过首条消息中的 { role: "editor" | "client" } 来注册角色。
 */

import { WebSocketServer } from 'ws'

const PORT = parseInt(process.env.BRIDGE_PORT || '9527', 10)

const wss = new WebSocketServer({ port: PORT })

/** @type {import('ws').WebSocket | null} */
let editorSocket = null

/** @type {Set<import('ws').WebSocket>} */
const clientSockets = new Set()

/** @type {Map<string, import('ws').WebSocket>} 按 requestId 追踪发送者 */
const pendingRequests = new Map()

console.log(`[remote-bridge server] Starting on ws://localhost:${PORT}`)

wss.on('connection', (ws) => {
  let role = null

  ws.on('message', (rawData) => {
    let msg
    try {
      msg = JSON.parse(rawData.toString())
    } catch (e) {
      ws.send(JSON.stringify({ error: 'Invalid JSON' }))
      return
    }

    // 首条消息注册角色
    if (!role) {
      if (msg.role === 'editor') {
        role = 'editor'
        if (editorSocket && editorSocket.readyState === 1) {
          // 已有 editor 连接，替换
          console.log('[server] Replacing existing editor connection')
          editorSocket.close()
        }
        editorSocket = ws
        console.log('[server] Editor connected')
        ws.send(JSON.stringify({ type: 'registered', role: 'editor' }))
        // 通知所有客户端 editor 已上线
        broadcastToClients({ event: 'editor_connected' })
        return
      } else if (msg.role === 'client') {
        role = 'client'
        clientSockets.add(ws)
        console.log(`[server] Client connected (total: ${clientSockets.size})`)
        ws.send(JSON.stringify({
          type: 'registered',
          role: 'client',
          editorOnline: !!(editorSocket && editorSocket.readyState === 1)
        }))
        return
      } else {
        // 如果没有指定 role，默认当作 client
        role = 'client'
        clientSockets.add(ws)
        console.log(`[server] Client connected (auto, total: ${clientSockets.size})`)
      }
    }

    // 路由消息
    if (role === 'client') {
      // 客户端 → editor：转发命令
      if (!editorSocket || editorSocket.readyState !== 1) {
        ws.send(JSON.stringify({
          requestId: msg.requestId,
          error: 'Editor is not connected'
        }))
        return
      }
      // 记录请求来源
      if (msg.requestId) {
        pendingRequests.set(String(msg.requestId), ws)
      }
      editorSocket.send(JSON.stringify(msg))
    } else if (role === 'editor') {
      // editor → 客户端：响应或事件
      if (msg.requestId) {
        // 定向响应
        const targetClient = pendingRequests.get(String(msg.requestId))
        if (targetClient && targetClient.readyState === 1) {
          targetClient.send(JSON.stringify(msg))
        }
        pendingRequests.delete(String(msg.requestId))
      } else if (msg.event) {
        // 事件广播给所有客户端
        broadcastToClients(msg)
      }
    }
  })

  ws.on('close', () => {
    if (role === 'editor') {
      console.log('[server] Editor disconnected')
      editorSocket = null
      broadcastToClients({ event: 'editor_disconnected' })
    } else if (role === 'client') {
      clientSockets.delete(ws)
      console.log(`[server] Client disconnected (remaining: ${clientSockets.size})`)
      // 清理该客户端的 pending requests
      for (const [reqId, client] of pendingRequests.entries()) {
        if (client === ws) {
          pendingRequests.delete(reqId)
        }
      }
    }
  })

  ws.on('error', (err) => {
    console.error(`[server] WebSocket error (role=${role}):`, err.message)
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

wss.on('listening', () => {
  console.log(`[remote-bridge server] Listening on ws://localhost:${PORT}`)
  console.log('[remote-bridge server] Waiting for editor and client connections...')
})

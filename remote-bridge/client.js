/**
 * @file client.js
 * @description SVGEdit 远程客户端 SDK
 *
 * 使用示例：
 * ```js
 * import { SvgRemoteClient } from './client.js'
 *
 * const client = new SvgRemoteClient('ws://localhost:9527')
 * await client.connect()
 *
 * // 获取当前 SVG
 * const svg = await client.getSvgString()
 *
 * // 添加一个矩形
 * await client.addElement('rect', { x: 10, y: 10, width: 100, height: 50, fill: '#4A90D9' })
 *
 * // 修改元素属性
 * await client.updateElement('svg_1', { fill: 'red', stroke: '#000' })
 *
 * // 整体替换 SVG
 * await client.setSvgString('<svg ...>...</svg>')
 *
 * client.close()
 * ```
 */

import WebSocket from 'ws'

export class SvgRemoteClient {
  /**
   * @param {string} [url] WebSocket 服务端地址 (默认: ws://localhost:{BRIDGE_PORT})
   * @param {object} [options]
   * @param {number} [options.timeout=10000] 请求超时毫秒
   * @param {boolean} [options.autoReconnect=true] 是否自动重连
   */
  constructor (url, options = {}) {
    // 默认端口从环境变量读取，开发环境默认 9527
    const defaultPort = process.env.BRIDGE_PORT || '9527'
    const defaultUrl = `ws://localhost:${defaultPort}`
    this.url = url || defaultUrl
    this.timeout = options.timeout || 10000
    this.autoReconnect = options.autoReconnect !== false
    this.ws = null
    this._reqId = 0
    this._pending = new Map()
    this._eventHandlers = new Map()
    this._connected = false
    this._editorOnline = false
    this._reconnectTimer = null
  }

  // ========================
  // 连接管理
  // ========================

  /**
   * 连接到中继服务端
   * @returns {Promise<void>}
   */
  connect () {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url)

      const onOpenOnce = () => {
        // 注册为 client 角色
        this.ws.send(JSON.stringify({ role: 'client' }))
      }

      this.ws.on('open', onOpenOnce)

      this.ws.on('message', (rawData) => {
        let msg
        try {
          msg = JSON.parse(rawData.toString())
        } catch (e) {
          return
        }

        // 注册确认
        if (msg.type === 'registered' && msg.role === 'client') {
          this._connected = true
          this._editorOnline = !!msg.editorOnline
          resolve()
          return
        }

        // RPC 响应
        if (msg.requestId !== undefined) {
          const handler = this._pending.get(String(msg.requestId))
          if (handler) {
            handler.resolve(msg.result !== undefined ? msg.result : msg)
            clearTimeout(handler.timer)
            this._pending.delete(String(msg.requestId))
          }
          return
        }

        // 事件推送
        if (msg.event) {
          if (msg.event === 'editor_connected') {
            this._editorOnline = true
          } else if (msg.event === 'editor_disconnected') {
            this._editorOnline = false
          }
          this._emit(msg.event, msg.data || msg)
        }
      })

      this.ws.on('close', () => {
        this._connected = false
        this._editorOnline = false
        this._emit('disconnected')

        // 拒绝所有 pending 请求
        for (const [, handler] of this._pending) {
          handler.resolve({ error: 'Connection closed' })
          clearTimeout(handler.timer)
        }
        this._pending.clear()

        if (this.autoReconnect && !this._closing) {
          this._scheduleReconnect()
        }
      })

      this.ws.on('error', (err) => {
        if (!this._connected) {
          reject(err)
        }
        this._emit('error', err)
      })

      // 超时
      setTimeout(() => {
        if (!this._connected) {
          reject(new Error('Connection timeout'))
          if (this.ws) this.ws.close()
        }
      }, this.timeout)
    })
  }

  /** @private */
  _scheduleReconnect () {
    if (this._reconnectTimer) return
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null
      try {
        await this.connect()
        console.log('[SvgRemoteClient] Reconnected')
      } catch {
        // 静默失败，下次重试
      }
    }, 3000)
  }

  /**
   * 关闭连接
   */
  close () {
    this._closing = true
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
    }
  }

  /**
   * 编辑器是否在线
   * @returns {boolean}
   */
  isEditorOnline () {
    return this._editorOnline
  }

  // ========================
  // 事件系统
  // ========================

  /**
   * 监听事件
   * @param {string} event 事件名 ('changed' | 'selected' | 'editor_connected' | 'editor_disconnected' | 'disconnected' | 'error')
   * @param {Function} handler
   */
  on (event, handler) {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, [])
    }
    this._eventHandlers.get(event).push(handler)
  }

  /**
   * 移除事件监听
   * @param {string} event
   * @param {Function} handler
   */
  off (event, handler) {
    const handlers = this._eventHandlers.get(event)
    if (handlers) {
      const idx = handlers.indexOf(handler)
      if (idx >= 0) handlers.splice(idx, 1)
    }
  }

  /** @private */
  _emit (event, data) {
    const handlers = this._eventHandlers.get(event) || []
    for (const h of handlers) {
      try {
        h(data)
      } catch (err) {
        console.error(`[SvgRemoteClient] Event handler error for "${event}":`, err)
      }
    }
  }

  // ========================
  // RPC 基础
  // ========================

  /**
   * 发送 RPC 请求并等待响应
   * @param {string} action 操作名
   * @param {object} [payload={}] 参数
   * @returns {Promise<any>} 响应结果
   */
  request (action, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this._connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('Not connected'))
      }

      const requestId = String(++this._reqId)
      const timer = setTimeout(() => {
        this._pending.delete(requestId)
        reject(new Error(`Request timeout for action: ${action}`))
      }, this.timeout)

      this._pending.set(requestId, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ action, payload, requestId }))
    })
  }

  // ========================
  // 读取类 API
  // ========================

  /**
   * 获取当前编辑器中的完整 SVG XML 字符串
   * @returns {Promise<string>}
   */
  async getSvgString () {
    return this.request('getSvgString')
  }

  /**
   * 获取当前 SVG 的 JSON 结构描述
   * @returns {Promise<object>}
   */
  async getSvgJson () {
    return this.request('getSvgJson')
  }

  /**
   * 获取当前选中的元素信息
   * @returns {Promise<Array<{id: string, tagName: string, attrs: object}>>}
   */
  async getSelectedElements () {
    return this.request('getSelectedElements')
  }

  /**
   * 获取指定 ID 元素的详细 JSON 描述
   * @param {string} id 元素 ID
   * @returns {Promise<object>}
   */
  async getElementById (id) {
    return this.request('getElementById', { id })
  }

  /**
   * 获取所有可见元素的摘要
   * @returns {Promise<Array>}
   */
  async getAllElements () {
    return this.request('getAllElements')
  }

  /**
   * 获取画布分辨率
   * @returns {Promise<{w: number, h: number}>}
   */
  async getResolution () {
    return this.request('getResolution')
  }

  /**
   * 获取当前图层信息
   * @returns {Promise<{name: string, index: number}>}
   */
  async getCurrentLayer () {
    return this.request('getCurrentLayer')
  }

  /**
   * 获取所有图层
   * @returns {Promise<Array<{name: string, visible: boolean}>>}
   */
  async getLayers () {
    return this.request('getLayers')
  }

  // ========================
  // 修改类 API
  // ========================

  /**
   * 用 SVG XML 字符串整体替换当前编辑内容
   * @param {string} svgXml 完整的 SVG XML
   * @returns {Promise<{success: boolean}>}
   */
  async setSvgString (svgXml) {
    return this.request('setSvgString', { svgXml })
  }

  /**
   * 添加单个 SVG 元素
   * @param {string} element SVG 标签名 ('rect', 'circle', 'path', 'text', 'line', 'ellipse', 'image', 'g')
   * @param {object} attrs 属性键值对
   * @param {object} [options]
   * @param {boolean} [options.curStyles=false] 是否应用当前画笔样式
   * @param {Array} [options.children] 子元素（文本节点或嵌套 JSON）
   * @returns {Promise<{success: boolean, id: string}>}
   */
  async addElement (element, attrs, options = {}) {
    return this.request('addElement', {
      element,
      attrs,
      curStyles: options.curStyles || false,
      children: options.children
    })
  }

  /**
   * 批量添加 SVG 元素
   * @param {Array<{element: string, attrs: object, curStyles?: boolean, children?: Array}>} elements
   * @returns {Promise<{success: boolean, ids: string[]}>}
   */
  async addElements (elements) {
    return this.request('addElements', { elements })
  }

  /**
   * 修改指定元素的属性
   * @param {string} id 元素 ID
   * @param {object} attrs 要修改的属性键值对
   * @returns {Promise<{success: boolean}>}
   */
  async updateElement (id, attrs) {
    return this.request('updateElement', { id, attrs })
  }

  /**
   * 删除指定 ID 的元素
   * @param {string|string[]} ids 一个或多个元素 ID
   * @returns {Promise<{success: boolean, deleted: number}>}
   */
  async deleteElements (ids) {
    const idArray = Array.isArray(ids) ? ids : [ids]
    return this.request('deleteElements', { ids: idArray })
  }

  /**
   * 移动元素到指定位置
   * @param {string} id 元素 ID
   * @param {object} position 位置 { x?, y?, cx?, cy? }
   * @returns {Promise<{success: boolean}>}
   */
  async moveElement (id, position) {
    return this.request('moveElement', { id, ...position })
  }

  /**
   * 选中指定元素
   * @param {string|string[]} ids
   * @returns {Promise<{success: boolean, selected: number}>}
   */
  async selectElements (ids) {
    const idArray = Array.isArray(ids) ? ids : [ids]
    return this.request('selectElements', { ids: idArray })
  }

  /**
   * 清除选择
   * @returns {Promise<{success: boolean}>}
   */
  async clearSelection () {
    return this.request('clearSelection')
  }

  /**
   * 开始批量操作会话
   * 调用后，后续的所有修改操作将被视为一个整体。
   * 调用 endBatch() 后，整个批量操作可以通过一次撤销(Ctrl+Z)回退。
   * @returns {Promise<{success: boolean}>}
   */
  async beginBatch () {
    return this.request('beginBatch')
  }

  /**
   * 结束批量操作会话
   * 将 beginBatch() 以来的所有操作注册为一个可撤销命令。
   * @param {string} [text] - 可选的撤销命令描述文本
   * @returns {Promise<{success: boolean}>}
   */
  async endBatch (text) {
    return this.request('endBatch', { text })
  }

  /**
   * 撤销
   * @returns {Promise<{success: boolean}>}
   */
  async undo () {
    return this.request('undo')
  }

  /**
   * 重做
   * @returns {Promise<{success: boolean}>}
   */
  async redo () {
    return this.request('redo')
  }

  /**
   * 清空画布
   * @returns {Promise<{success: boolean}>}
   */
  async clear () {
    return this.request('clear')
  }

  /**
   * 设置画布分辨率
   * @param {number} width
   * @param {number} height
   * @returns {Promise<{success: boolean}>}
   */
  async setResolution (width, height) {
    return this.request('setResolution', { width, height })
  }

  /**
   * 设置缩放级别
   * @param {number} level 缩放倍数 (1 = 100%)
   * @returns {Promise<{success: boolean}>}
   */
  async zoom (level) {
    return this.request('zoom', { level })
  }

  // ========================
  // 分组操作
  // ========================

  /**
   * 将选中的元素合并为一个分组 (g 元素)
   * @param {string[]} [ids] 要分组的元素 ID 列表，不传则对当前选中元素操作
   * @returns {Promise<{success: boolean, id: string}>} 新建分组的 ID
   */
  async groupSelectedElements (ids) {
    return this.request('groupSelectedElements', ids ? { ids } : {})
  }

  /**
   * 取消分组，将分组内元素释放出来
   * @param {string} [id] 分组元素的 ID，不传则对当前选中的分组操作
   * @returns {Promise<{success: boolean}>}
   */
  async ungroupSelectedElement (id) {
    return this.request('ungroupSelectedElement', id ? { id } : {})
  }

  // ========================
  // 克隆/复制/剪切/粘贴
  // ========================

  /**
   * 克隆选中的元素（就地复制并偏移）
   * @param {object} [options]
   * @param {string[]} [options.ids] 要克隆的元素 ID 列表
   * @param {number} [options.dx=20] X 偏移量
   * @param {number} [options.dy=20] Y 偏移量
   * @returns {Promise<{success: boolean, ids: string[]}>} 新克隆元素的 ID
   */
  async cloneSelectedElements (options = {}) {
    return this.request('cloneSelectedElements', {
      ids: options.ids,
      dx: options.dx,
      dy: options.dy
    })
  }

  /**
   * 复制选中的元素到剪贴板
   * @param {string[]} [ids] 要复制的元素 ID 列表
   * @returns {Promise<{success: boolean}>}
   */
  async copySelectedElements (ids) {
    return this.request('copySelectedElements', ids ? { ids } : {})
  }

  /**
   * 剪切选中的元素
   * @param {string[]} [ids] 要剪切的元素 ID 列表
   * @returns {Promise<{success: boolean}>}
   */
  async cutSelectedElements (ids) {
    return this.request('cutSelectedElements', ids ? { ids } : {})
  }

  /**
   * 粘贴剪贴板中的元素
   * @param {string} [type='in_place'] 粘贴类型: 'in_place' | 'point'
   * @returns {Promise<{success: boolean, ids: string[]}>}
   */
  async pasteElements (type) {
    return this.request('pasteElements', { type: type || 'in_place' })
  }

  // ========================
  // Z 轴层序操作
  // ========================

  /**
   * 将元素移到最前面（DOM 底部）
   * @param {string} [id] 元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async moveToTopSelectedElement (id) {
    return this.request('moveToTopSelectedElement', id ? { id } : {})
  }

  /**
   * 将元素移到最后面（DOM 顶部）
   * @param {string} [id] 元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async moveToBottomSelectedElement (id) {
    return this.request('moveToBottomSelectedElement', id ? { id } : {})
  }

  /**
   * 上移或下移一层
   * @param {string} direction 'Up' 或 'Down'
   * @param {string} [id] 元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async moveUpDownSelected (direction, id) {
    const payload = { direction }
    if (id) payload.id = id
    return this.request('moveUpDownSelected', payload)
  }

  // ========================
  // 变换操作
  // ========================

  /**
   * 设置元素旋转角度
   * @param {number} angle 角度值
   * @param {string} [id] 元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async setRotationAngle (angle, id) {
    const payload = { angle }
    if (id) payload.id = id
    return this.request('setRotationAngle', payload)
  }

  /**
   * 获取元素旋转角度
   * @param {string} [id] 元素 ID
   * @returns {Promise<{angle: number}>}
   */
  async getRotationAngle (id) {
    return this.request('getRotationAngle', id ? { id } : {})
  }

  /**
   * 翻转选中的元素
   * @param {object} options
   * @param {boolean} [options.horizontal=false] 水平翻转
   * @param {boolean} [options.vertical=false] 垂直翻转
   * @param {string[]} [options.ids] 要翻转的元素 ID 列表
   * @returns {Promise<{success: boolean}>}
   */
  async flipSelectedElements (options = {}) {
    return this.request('flipSelectedElements', {
      horizontal: options.horizontal || false,
      vertical: options.vertical || false,
      ids: options.ids
    })
  }

  /**
   * 将选中的元素转换为路径 (path)
   * @param {string} [id] 元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async convertToPath (id) {
    return this.request('convertToPath', id ? { id } : {})
  }

  // ========================
  // 对齐操作
  // ========================

  /**
   * 对齐选中的元素
   * @param {string} type 对齐方式: 'l'|'c'|'r'|'t'|'m'|'b' (left/center/right/top/middle/bottom)
   * @param {string} [relativeTo='selected'] 相对于: 'selected'|'largest'|'smallest'|'page'
   * @param {string[]} [ids] 要对齐的元素 ID 列表
   * @returns {Promise<{success: boolean}>}
   */
  async alignSelectedElements (type, relativeTo, ids) {
    const payload = { type, relativeTo: relativeTo || 'selected' }
    if (ids) payload.ids = ids
    return this.request('alignSelectedElements', payload)
  }

  // ========================
  // 样式操作
  // ========================

  /**
   * 设置填充或描边颜色
   * @param {string} type 'fill' 或 'stroke'
   * @param {string} val 颜色值，如 '#ff0000'、'none'、'rgb(255,0,0)' 等
   * @returns {Promise<{success: boolean}>}
   */
  async setColor (type, val) {
    return this.request('setColor', { type, val })
  }

  /**
   * 设置描边宽度
   * @param {number} val 宽度值
   * @returns {Promise<{success: boolean}>}
   */
  async setStrokeWidth (val) {
    return this.request('setStrokeWidth', { val })
  }

  /**
   * 设置描边属性
   * @param {string} attr 属性名: 'stroke-dasharray'|'stroke-linejoin'|'stroke-linecap'
   * @param {string} val 属性值
   * @returns {Promise<{success: boolean}>}
   */
  async setStrokeAttr (attr, val) {
    return this.request('setStrokeAttr', { attr, val })
  }

  /**
   * 设置元素不透明度
   * @param {number} val 0-1 之间的值
   * @returns {Promise<{success: boolean}>}
   */
  async setOpacity (val) {
    return this.request('setOpacity', { val })
  }

  /**
   * 获取当前不透明度
   * @returns {Promise<{opacity: number}>}
   */
  async getOpacity () {
    return this.request('getOpacity')
  }

  /**
   * 设置填充或描边的透明度
   * @param {string} type 'fill' 或 'stroke'
   * @param {number} val 0-1 之间的值
   * @returns {Promise<{success: boolean}>}
   */
  async setPaintOpacity (type, val) {
    return this.request('setPaintOpacity', { type, val })
  }

  /**
   * 获取填充或描边的透明度
   * @param {string} type 'fill' 或 'stroke'
   * @returns {Promise<{opacity: number}>}
   */
  async getPaintOpacity (type) {
    return this.request('getPaintOpacity', { type })
  }

  /**
   * 设置模糊值
   * @param {number} val 模糊的标准偏差值
   * @param {boolean} [complete=false] 是否完成模糊设置
   * @returns {Promise<{success: boolean}>}
   */
  async setBlur (val, complete) {
    return this.request('setBlur', { val, complete: complete || false })
  }

  /**
   * 获取模糊值
   * @param {string} [id] 元素 ID
   * @returns {Promise<{blur: number}>}
   */
  async getBlur (id) {
    return this.request('getBlur', id ? { id } : {})
  }

  /**
   * 应用渐变到选中元素
   * @param {string} type 'fill' 或 'stroke'
   * @returns {Promise<{success: boolean}>}
   */
  async setGradient (type) {
    return this.request('setGradient', { type })
  }

  /**
   * 设置绘画类型（颜色/渐变）
   * @param {string} type 'fill' 或 'stroke'
   * @param {object} paint 绘画对象
   * @returns {Promise<{success: boolean}>}
   */
  async setPaint (type, paint) {
    return this.request('setPaint', { type, paint })
  }

  // ========================
  // 文字操作
  // ========================

  /**
   * 设置文本内容
   * @param {string} text 新的文本内容
   * @param {string} [id] 文本元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async setTextContent (text, id) {
    const payload = { text }
    if (id) payload.id = id
    return this.request('setTextContent', payload)
  }

  /**
   * 设置字体族
   * @param {string} family 字体名称，如 'Arial'、'serif' 等
   * @param {string} [id] 文本元素 ID（可选，传入时自动选中该元素）
   * @returns {Promise<{success: boolean}>}
   */
  async setFontFamily (family, id) {
    const payload = { family }
    if (id) payload.id = id
    return this.request('setFontFamily', payload)
  }

  /**
   * 设置字号
   * @param {number} size 字号大小
   * @param {string} [id] 文本元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async setFontSize (size, id) {
    const payload = { size }
    if (id) payload.id = id
    return this.request('setFontSize', payload)
  }

  /**
   * 设置粗体
   * @param {boolean} bold 是否粗体
   * @param {string} [id] 文本元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async setBold (bold, id) {
    const payload = { bold }
    if (id) payload.id = id
    return this.request('setBold', payload)
  }

  /**
   * 设置斜体
   * @param {boolean} italic 是否斜体
   * @param {string} [id] 文本元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async setItalic (italic, id) {
    const payload = { italic }
    if (id) payload.id = id
    return this.request('setItalic', payload)
  }

  /**
   * 设置文本锚点（对齐方式）
   * @param {string} anchor 'start' | 'middle' | 'end'
   * @param {string} [id] 文本元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async setTextAnchor (anchor, id) {
    const payload = { anchor }
    if (id) payload.id = id
    return this.request('setTextAnchor', payload)
  }

  /**
   * 设置字间距
   * @param {number|string} val 间距值
   * @param {string} [id] 文本元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async setLetterSpacing (val, id) {
    const payload = { val }
    if (id) payload.id = id
    return this.request('setLetterSpacing', payload)
  }

  /**
   * 设置词间距
   * @param {number|string} val 间距值
   * @param {string} [id] 文本元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async setWordSpacing (val, id) {
    const payload = { val }
    if (id) payload.id = id
    return this.request('setWordSpacing', payload)
  }

  /**
   * 设置文字颜色
   * @param {string} color 颜色值
   * @param {string} [id] 文本元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async setFontColor (color, id) {
    const payload = { color }
    if (id) payload.id = id
    return this.request('setFontColor', payload)
  }

  /**
   * 获取文字颜色
   * @returns {Promise<{color: string}>}
   */
  async getFontColor () {
    return this.request('getFontColor')
  }

  /**
   * 添加文本装饰（下划线、删除线等）
   * @param {string} value 装饰值，如 'underline'、'line-through'、'overline'
   * @param {string} [id] 文本元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async addTextDecoration (value, id) {
    const payload = { value }
    if (id) payload.id = id
    return this.request('addTextDecoration', payload)
  }

  /**
   * 移除文本装饰
   * @param {string} value 装饰值
   * @param {string} [id] 文本元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async removeTextDecoration (value, id) {
    const payload = { value }
    if (id) payload.id = id
    return this.request('removeTextDecoration', payload)
  }

  /**
   * 获取当前是否粗体
   * @returns {Promise<{bold: boolean}>}
   */
  async getBold () {
    return this.request('getBold')
  }

  /**
   * 获取当前是否斜体
   * @returns {Promise<{italic: boolean}>}
   */
  async getItalic () {
    return this.request('getItalic')
  }

  /**
   * 获取当前字体族
   * @returns {Promise<{family: string}>}
   */
  async getFontFamily () {
    return this.request('getFontFamily')
  }

  /**
   * 获取当前字号
   * @returns {Promise<{size: number}>}
   */
  async getFontSize () {
    return this.request('getFontSize')
  }

  /**
   * 获取当前文本内容
   * @returns {Promise<{text: string}>}
   */
  async getText () {
    return this.request('getText')
  }

  // ========================
  // 图层管理
  // ========================

  /**
   * 创建新图层
   * @param {string} name 图层名称
   * @returns {Promise<{success: boolean}>}
   */
  async createLayer (name) {
    return this.request('createLayer', { name })
  }

  /**
   * 删除当前图层
   * @returns {Promise<{success: boolean}>}
   */
  async deleteCurrentLayer () {
    return this.request('deleteCurrentLayer')
  }

  /**
   * 重命名当前图层
   * @param {string} newName 新名称
   * @returns {Promise<{success: boolean}>}
   */
  async renameCurrentLayer (newName) {
    return this.request('renameCurrentLayer', { newName })
  }

  /**
   * 克隆当前图层
   * @param {string} name 新图层名称
   * @returns {Promise<{success: boolean}>}
   */
  async cloneLayer (name) {
    return this.request('cloneLayer', { name })
  }

  /**
   * 切换到指定图层
   * @param {string} name 图层名称
   * @returns {Promise<{success: boolean}>}
   */
  async setCurrentLayer (name) {
    return this.request('setCurrentLayer', { name })
  }

  /**
   * 设置当前图层在图层列表中的位置
   * @param {number} newPos 新位置索引
   * @returns {Promise<{success: boolean}>}
   */
  async setCurrentLayerPosition (newPos) {
    return this.request('setCurrentLayerPosition', { newPos })
  }

  /**
   * 设置图层可见性
   * @param {string} name 图层名称
   * @param {boolean} visible 是否可见
   * @returns {Promise<{success: boolean}>}
   */
  async setLayerVisibility (name, visible) {
    return this.request('setLayerVisibility', { name, visible })
  }

  /**
   * 将选中元素移到指定图层
   * @param {string} name 目标图层名称
   * @returns {Promise<{success: boolean}>}
   */
  async moveSelectedToLayer (name) {
    return this.request('moveSelectedToLayer', { name })
  }

  /**
   * 将当前图层与下方图层合并
   * @returns {Promise<{success: boolean}>}
   */
  async mergeLayer () {
    return this.request('mergeLayer')
  }

  /**
   * 合并所有图层
   * @returns {Promise<{success: boolean}>}
   */
  async mergeAllLayers () {
    return this.request('mergeAllLayers')
  }

  // ========================
  // 超链接操作
  // ========================

  /**
   * 为选中元素添加超链接
   * @param {string} url 链接地址
   * @param {string} [id] 元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async makeHyperlink (url, id) {
    const payload = { url }
    if (id) payload.id = id
    return this.request('makeHyperlink', payload)
  }

  /**
   * 移除超链接
   * @param {string} [id] 元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async removeHyperlink (id) {
    return this.request('removeHyperlink', id ? { id } : {})
  }

  /**
   * 设置链接 URL
   * @param {string} url 链接地址
   * @param {string} [id] 元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async setLinkURL (url, id) {
    const payload = { url }
    if (id) payload.id = id
    return this.request('setLinkURL', payload)
  }

  // ========================
  // 图片操作
  // ========================

  /**
   * 设置图片 URL
   * @param {string} url 图片地址
   * @param {string} [id] image 元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async setImageURL (url, id) {
    const payload = { url }
    if (id) payload.id = id
    return this.request('setImageURL', payload)
  }

  /**
   * 将外链图片嵌入为 data URL
   * @param {string} url 图片地址
   * @returns {Promise<{success: boolean, dataUrl: string}>}
   */
  async embedImage (url) {
    return this.request('embedImage', { url })
  }

  // ========================
  // 路径/圆角操作
  // ========================

  /**
   * 设置矩形圆角半径
   * @param {number} val 圆角值 (rx/ry)
   * @param {string} [id] 矩形元素 ID
   * @returns {Promise<{success: boolean}>}
   */
  async setRectRadius (val, id) {
    const payload = { val }
    if (id) payload.id = id
    return this.request('setRectRadius', payload)
  }

  /**
   * 设置路径线段类型（直线/曲线）
   * @param {number} type 线段类型值
   * @returns {Promise<{success: boolean}>}
   */
  async setSegType (type) {
    return this.request('setSegType', { type })
  }

  // ========================
  // 导入/导出
  // ========================

  /**
   * 导入 SVG 字符串（作为子图导入当前画布）
   * @param {string} svgXml SVG XML 字符串
   * @returns {Promise<{success: boolean}>}
   */
  async importSvgString (svgXml) {
    return this.request('importSvgString', { svgXml })
  }

  /**
   * 导出为位图（PNG/JPEG/BMP/WEBP）
   * @param {string} [type='PNG'] 格式类型: 'PNG' | 'JPEG' | 'BMP' | 'WEBP'
   * @param {number} [quality] 质量 (0-1，JPEG 适用)
   * @returns {Promise<{success: boolean, dataUrl: string}>}
   */
  async rasterExport (type, quality) {
    return this.request('rasterExport', { type: type || 'PNG', quality })
  }

  /**
   * 导出为 PDF
   * @param {string} [outputType] 输出类型
   * @returns {Promise<{success: boolean, data: any}>}
   */
  async exportPDF (outputType) {
    return this.request('exportPDF', { outputType })
  }

  // ========================
  // 其他操作
  // ========================

  /**
   * 选中当前图层的所有元素
   * @returns {Promise<{success: boolean, ids: string[]}>}
   */
  async selectAllInCurrentLayer () {
    return this.request('selectAllInCurrentLayer')
  }

  /**
   * 设置编辑模式
   * @param {string} mode 模式名称，如 'select', 'rect', 'circle', 'ellipse', 'line', 'path', 'text', 'image', 'fhpath' 等
   * @returns {Promise<{success: boolean}>}
   */
  async setMode (mode) {
    return this.request('setMode', { mode })
  }

  /**
   * 获取当前编辑模式
   * @returns {Promise<{mode: string}>}
   */
  async getMode () {
    return this.request('getMode')
  }

  /**
   * 设置文档标题
   * @param {string} title 标题
   * @returns {Promise<{success: boolean}>}
   */
  async setDocumentTitle (title) {
    return this.request('setDocumentTitle', { title })
  }

  /**
   * 设置组标题
   * @param {string} title 标题
   * @returns {Promise<{success: boolean}>}
   */
  async setGroupTitle (title) {
    return this.request('setGroupTitle', { title })
  }

  /**
   * 设置编辑器背景
   * @param {string} color 背景色
   * @param {string} [url] 背景图片 URL
   * @returns {Promise<{success: boolean}>}
   */
  async setBackground (color, url) {
    const payload = { color }
    if (url) payload.url = url
    return this.request('setBackground', payload)
  }
}

export default SvgRemoteClient

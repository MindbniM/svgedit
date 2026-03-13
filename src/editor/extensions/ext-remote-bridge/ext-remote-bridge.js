/**
 * @file ext-remote-bridge.js
 * @description SVGEdit 远程通信桥扩展
 * 通过 WebSocket 允许远程端读取和修改当前正在编辑的 SVG 图像。
 *
 * 新增功能：
 * - 支持 URL 参数 ?id=xxx 加载指定 diagram
 * - 连接到 diagram-server 统一后端 (WebSocket 中继 + HTTP API)
 * - 编辑后自动/手动保存到后端
 *
 * @license MIT
 */

const name = 'remote-bridge'

/**
 * diagram-server 地址推断
 *
 * 部署模式（路径前缀方案）：
 *   - SVGEdit 前端: http://HOST/svgedit/src/editor/index.html
 *   - diagram-server API: http://HOST/svgedit/mcp/api/diagrams
 *   - diagram-server WS:  ws://HOST/svgedit/mcp/ws
 *
 * 本地开发模式：
 *   - SVGEdit 前端: http://localhost:2233/src/editor/index.html
 *   - diagram-server: http://localhost:2333 (直连)
 *
 * 自动推断规则：
 *   如果当前页面 URL 路径以 /svgedit/ 开头 → 使用同 origin 的路径前缀模式
 *   否则 → 使用 localhost:9528 直连模式
 */
const DIAGRAM_SERVER_INTERNAL_PORT = 2333

/**
 * 根据当前浏览器 URL 自动推断 diagram-server 地址
 */
function inferServerUrls () {
  try {
    const hostname = window.location.hostname
    const port = window.location.port
    const protocol = window.location.protocol
    const pathname = window.location.pathname

    // 路径前缀模式：URL 路径以 /svgedit/ 开头（通过 nginx 反向代理）
    if (pathname.startsWith('/svgedit/')) {
      const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
      const hostWithPort = port ? `${hostname}:${port}` : hostname
      return {
        wsUrl: `${wsProtocol}//${hostWithPort}/svgedit/mcp/ws`,
        apiUrl: `${protocol}//${hostWithPort}/svgedit/mcp`
      }
    }

    // 非 localhost 但不是路径前缀模式（兼容旧的独立端口模式）
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
      const hostWithPort = port ? `${hostname}:${port}` : hostname
      return {
        wsUrl: `${wsProtocol}//${hostWithPort}/svgedit/mcp/ws`,
        apiUrl: `${protocol}//${hostWithPort}/svgedit/mcp`
      }
    }
  } catch {
    // fallback
  }

  // 默认本地开发地址（直连 diagram-server）
  return {
    wsUrl: `ws://localhost:${DIAGRAM_SERVER_INTERNAL_PORT}/ws`,
    apiUrl: `http://localhost:${DIAGRAM_SERVER_INTERNAL_PORT}`
  }
}

/**
 * 从 URL 搜索参数中获取 diagram ID
 */
function getDiagramIdFromUrl () {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('id') || null
  } catch {
    return null
  }
}

/**
 * 从 URL 搜索参数中获取配置（URL 参数优先级最高）
 */
function getConfigFromUrl () {
  try {
    const params = new URLSearchParams(window.location.search)
    return {
      wsUrl: params.get('wsUrl') || null,
      apiUrl: params.get('apiUrl') || null
    }
  } catch {
    return {}
  }
}

export default {
  name,
  /**
   * @param {object} _initArgs
   * @param {object} [extConfig] - 通过 userExtensions config 传入的配置
   */
  async init (_initArgs, extConfig) {
    const svgEditor = this
    const { svgCanvas } = svgEditor

    // 配置优先级：URL 参数 > extConfig > 自动推断
    const urlConfig = getConfigFromUrl()
    const inferred = inferServerUrls()
    const wsUrl = urlConfig.wsUrl || extConfig?.wsUrl || inferred.wsUrl
    const apiUrl = urlConfig.apiUrl || extConfig?.apiUrl || inferred.apiUrl
    const diagramId = getDiagramIdFromUrl()

    console.log(`[remote-bridge] Config: wsUrl=${wsUrl}, apiUrl=${apiUrl}, diagramId=${diagramId}`)

    let ws = null
    let reconnectTimer = null
    let isConnected = false
    let saveTimer = null
    const AUTO_SAVE_DELAY = 3000 // 自动保存延迟（毫秒）

    // ========================
    // WebSocket 连接管理
    // ========================

    function connect () {
      if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        return
      }

      try {
        ws = new WebSocket(wsUrl)
      } catch (err) {
        console.warn(`[remote-bridge] WebSocket connection failed: ${err.message}`)
        scheduleReconnect()
        return
      }

      ws.onopen = () => {
        isConnected = true
        console.log(`[remote-bridge] Connected to ${wsUrl}`)
        // 注册为 editor 角色，携带 diagramId
        const registerMsg = { role: 'editor' }
        if (diagramId) {
          registerMsg.diagramId = diagramId
        }
        ws.send(JSON.stringify(registerMsg))
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }

        // 如果有 diagramId，从 API 加载 SVG 内容
        if (diagramId) {
          loadDiagramFromApi(diagramId)
        } else {
          // 没有 diagramId 时，清空画布显示空白画板
          // 避免加载 localStorage 中的旧内容
          svgCanvas.clear()
          console.log('[remote-bridge] No diagram ID provided, starting with blank canvas')
        }
      }

      ws.onclose = () => {
        isConnected = false
        console.log('[remote-bridge] Disconnected')
        scheduleReconnect()
      }

      ws.onerror = (err) => {
        console.warn('[remote-bridge] WebSocket error:', err)
      }

      ws.onmessage = (event) => {
        handleMessage(event.data)
      }
    }

    function scheduleReconnect () {
      if (reconnectTimer) return
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        console.log('[remote-bridge] Attempting to reconnect...')
        connect()
      }, 3000)
    }

    function send (data) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data))
      }
    }

    // ========================
    // Diagram API 加载与保存
    // ========================

    /**
     * 从 diagram-server HTTP API 加载指定 diagram 的 SVG 内容
     */
    async function loadDiagramFromApi (id) {
      try {
        console.log(`[remote-bridge] Loading diagram: ${id}`)
        const response = await fetch(`${apiUrl}/api/diagrams/${id}`)
        if (!response.ok) {
          console.error(`[remote-bridge] Failed to load diagram ${id}: ${response.status}`)
          return
        }
        const data = await response.json()
        if (data.svgContent) {
          svgCanvas.setSvgString(data.svgContent, true)
          svgEditor.updateCanvas()
          try { svgEditor.zoomImage && svgEditor.zoomImage() } catch (_) {}
          syncEditorUI()
          console.log(`[remote-bridge] Diagram loaded: ${data.name || id}`)

          // 更新页面标题
          document.title = `SVG-edit: ${data.name || id}`
        }
      } catch (err) {
        console.error(`[remote-bridge] Error loading diagram ${id}:`, err)
      }
    }

    /**
     * 将当前 SVG 保存回 diagram-server
     */
    async function saveDiagramToApi () {
      if (!diagramId) return
      try {
        const svgContent = svgCanvas.getSvgString()
        const response = await fetch(`${apiUrl}/api/diagrams/${diagramId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ svgContent })
        })
        if (response.ok) {
          console.log(`[remote-bridge] Diagram saved: ${diagramId}`)
          // 同时通过 WebSocket 通知其他客户端
          send({ event: 'svg_saved', data: { svgContent, diagramId } })
        } else {
          console.error(`[remote-bridge] Failed to save diagram: ${response.status}`)
        }
      } catch (err) {
        console.error(`[remote-bridge] Error saving diagram:`, err)
      }
    }

    /**
     * 延迟自动保存（防抖）
     */
    function scheduleAutoSave () {
      if (!diagramId) return
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveDiagramToApi()
      }, AUTO_SAVE_DELAY)
    }

    // ========================
    // 命令处理器
    // ========================

    /**
     * 安全地获取元素的 JSON 描述
     */
    function elemToJson (el) {
      if (!el) return null
      const attrs = {}
      for (const attr of Array.from(el.attributes)) {
        attrs[attr.name] = attr.value
      }
      return {
        id: el.id,
        tagName: el.tagName,
        attrs
      }
    }

    /**
     * 获取所有可见元素的摘要
     */
    function getAllElementsSummary () {
      const visibleElems = svgCanvas.getVisibleElements()
      return visibleElems.map(el => elemToJson(el)).filter(Boolean)
    }

    /**
     * 同步编辑器 UI 状态（更新 undo/redo 按钮、上下文面板等）
     * 在任何修改类操作后调用
     */
    function syncEditorUI () {
      try {
        if (svgEditor.topPanel && typeof svgEditor.topPanel.updateContextPanel === 'function') {
          svgEditor.topPanel.updateContextPanel()
        }
        if (svgEditor.layersPanel && typeof svgEditor.layersPanel.populateLayers === 'function') {
          svgEditor.layersPanel.populateLayers()
        }
      } catch (e) {
        console.warn('[remote-bridge] syncEditorUI error:', e)
      }
    }

    /**
     * 完整恢复编辑器状态：设置 SVG 内容 + 更新画布 + 刷新 UI
     * @param {string} svgStr - 要恢复到的 SVG 字符串
     */
    function restoreEditorState (svgStr) {
      svgCanvas.setSvgString(svgStr, true)
      svgEditor.updateCanvas()
      try { svgEditor.zoomImage && svgEditor.zoomImage() } catch (_) { /* ignore */ }
      // 重新识别图层
      try {
        const { identifyLayers } = svgCanvas.getCurrentDrawing().constructor
        if (typeof identifyLayers === 'function') {
          identifyLayers()
        }
      } catch (_) { /* ignore */ }
      syncEditorUI()
    }

    /**
     * 标记当前是否有脚本正在执行批量操作
     */
    let batchSessionActive = false
    let batchOldSvg = null

    /**
     * 确保文本元素被选中（文字操作前调用）
     * 如果 payload 提供了 id，先选中该元素；
     * 否则检查当前选中元素是否包含文本元素，如果没有则跳过。
     */
    function ensureTextSelected (payload) {
      if (payload && payload.id) {
        const elem = svgCanvas.getElement(payload.id)
        if (elem) {
          svgCanvas.selectOnly([elem], true)
        }
      }
      // 即使没有提供 id，也要确保当前选中的元素包含 text
      // 如果当前没有选中文本元素，文字操作方法内部会过滤并跳过
    }

    /**
     * 处理远程命令
     */
    async function handleCommand (action, payload) {
      switch (action) {
        // ===== 读取类操作 =====

        case 'getSvgString': {
          return svgCanvas.getSvgString()
        }

        case 'getSvgJson': {
          const content = svgCanvas.getSvgContent()
          return svgCanvas.getJsonFromSvgElements(content)
        }

        case 'getSelectedElements': {
          const selected = svgCanvas.getSelectedElements().filter(Boolean)
          return selected.map(el => elemToJson(el))
        }

        case 'getElementById': {
          const elem = svgCanvas.getElement(payload.id)
          if (!elem) return { error: `Element not found: ${payload.id}` }
          return svgCanvas.getJsonFromSvgElements(elem)
        }

        case 'getAllElements': {
          return getAllElementsSummary()
        }

        case 'getResolution': {
          return svgCanvas.getResolution()
        }

        case 'getCurrentLayer': {
          const drawing = svgCanvas.getCurrentDrawing()
          return {
            name: drawing.getCurrentLayerName(),
            index: drawing.indexCurrentLayer()
          }
        }

        case 'getLayers': {
          const drawing = svgCanvas.getCurrentDrawing()
          const count = drawing.getNumLayers()
          const layers = []
          for (let i = 0; i < count; i++) {
            layers.push({
              name: drawing.getLayerName(i),
              visible: drawing.getLayerVisibility(drawing.getLayerName(i))
            })
          }
          return layers
        }

        // ===== 批量操作会话 =====

        case 'beginBatch': {
          // 脚本开始批量操作前调用，保存当前 SVG 快照
          batchOldSvg = svgCanvas.getSvgString()
          batchSessionActive = true
          console.log('[remote-bridge] Batch session started, snapshot saved')
          return { success: true }
        }

        case 'endBatch': {
          // 脚本结束批量操作后调用，将整个批量操作作为一个可撤销命令
          if (!batchSessionActive || batchOldSvg === null) {
            return { error: 'No active batch session' }
          }
          const oldSvg = batchOldSvg
          const newSvg = svgCanvas.getSvgString()
          batchSessionActive = false
          batchOldSvg = null

          // 创建自定义 undo 命令，继承正确的接口
          const customCmd = {
            text: payload?.text || 'Remote: Batch Operation',
            type () { return 'remote-bridge-batch' },
            elements () { return [svgCanvas.getSvgContent()] },
            getText () { return this.text },
            isEmpty () { return false },
            // apply/unapply 遵循 UndoManager 的调用约定:
            // UndoManager.undo() 调用 cmd.unapply(handler)
            // UndoManager.redo() 调用 cmd.apply(handler)
            apply (handler) {
              if (handler) {
                try { handler.handleHistoryEvent('before_apply', customCmd) } catch (_) {}
              }
              restoreEditorState(newSvg)
              if (handler) {
                try { handler.handleHistoryEvent('after_apply', customCmd) } catch (_) {}
              }
            },
            unapply (handler) {
              if (handler) {
                try { handler.handleHistoryEvent('before_unapply', customCmd) } catch (_) {}
              }
              restoreEditorState(oldSvg)
              if (handler) {
                try { handler.handleHistoryEvent('after_unapply', customCmd) } catch (_) {}
              }
            }
          }
          svgCanvas.undoMgr.addCommandToHistory(customCmd)
          syncEditorUI()
          console.log('[remote-bridge] Batch session ended, undo command registered')
          return { success: true }
        }

        // ===== 修改类操作 =====

        case 'setSvgString': {
          // 如果在批量操作中，不单独记录 undo，由 endBatch 统一处理
          if (batchSessionActive) {
            const result = svgCanvas.setSvgString(payload.svgXml, true) // preventUndo
            if (result !== false) {
              svgEditor.updateCanvas()
              try { svgEditor.zoomImage && svgEditor.zoomImage() } catch (_) {}
              syncEditorUI()
            }
            return { success: result !== false }
          }

          // 非批量模式：保存快照，创建单次可撤销命令
          const oldSvgStr = svgCanvas.getSvgString()
          const result = svgCanvas.setSvgString(payload.svgXml, true) // preventUndo
          if (result !== false) {
            svgEditor.updateCanvas()
            try { svgEditor.zoomImage && svgEditor.zoomImage() } catch (_) {}

            const newSvgStr = svgCanvas.getSvgString()
            const customCmd = {
              text: 'Remote: Change Source',
              type () { return 'remote-bridge-batch' },
              elements () { return [svgCanvas.getSvgContent()] },
              getText () { return this.text },
              isEmpty () { return false },
              apply (handler) {
                if (handler) {
                  try { handler.handleHistoryEvent('before_apply', customCmd) } catch (_) {}
                }
                restoreEditorState(newSvgStr)
                if (handler) {
                  try { handler.handleHistoryEvent('after_apply', customCmd) } catch (_) {}
                }
              },
              unapply (handler) {
                if (handler) {
                  try { handler.handleHistoryEvent('before_unapply', customCmd) } catch (_) {}
                }
                restoreEditorState(oldSvgStr)
                if (handler) {
                  try { handler.handleHistoryEvent('after_unapply', customCmd) } catch (_) {}
                }
              }
            }
            svgCanvas.undoMgr.addCommandToHistory(customCmd)
            syncEditorUI()
          }
          return { success: result !== false }
        }

        case 'addElement': {
          // 添加单个元素
          const jsonDef = {
            element: payload.element,
            curStyles: payload.curStyles || false,
            attr: {
              ...payload.attrs,
              id: payload.attrs?.id || svgCanvas.getNextId()
            }
          }
          if (payload.children) {
            jsonDef.children = payload.children
          }
          const newElem = svgCanvas.addSVGElementsFromJson(jsonDef)
          if (newElem) {
            svgCanvas.selectOnly([newElem], true)
            svgCanvas.call('changed', [newElem])
            syncEditorUI()
          }
          return { success: !!newElem, id: newElem?.id }
        }

        case 'addElements': {
          // 批量添加元素
          const ids = []
          const addedElems = []
          const elements = payload.elements || []
          for (const def of elements) {
            const jsonDef = {
              element: def.element,
              curStyles: def.curStyles || false,
              attr: {
                ...def.attrs,
                id: def.attrs?.id || svgCanvas.getNextId()
              }
            }
            if (def.children) {
              jsonDef.children = def.children
            }
            const newElem = svgCanvas.addSVGElementsFromJson(jsonDef)
            if (newElem) {
              ids.push(newElem.id)
              addedElems.push(newElem)
            }
          }
          if (addedElems.length > 0) {
            svgCanvas.selectOnly(addedElems, true)
            svgCanvas.call('changed', addedElems)
            syncEditorUI()
          }
          return { success: true, ids }
        }

        case 'updateElement': {
          // 修改指定元素的属性
          const target = svgCanvas.getElement(payload.id)
          if (!target) return { error: `Element not found: ${payload.id}` }

          svgCanvas.selectOnly([target], true)
          const attrs = payload.attrs || {}
          for (const [attr, value] of Object.entries(attrs)) {
            svgCanvas.changeSelectedAttribute(attr, value)
          }
          svgCanvas.call('changed', [target])
          syncEditorUI()
          return { success: true }
        }

        case 'deleteElements': {
          // 删除指定 ID 的元素
          const ids = payload.ids || []
          const elems = ids
            .map(id => svgCanvas.getElement(id))
            .filter(Boolean)
          if (elems.length === 0) return { error: 'No matching elements found' }

          svgCanvas.selectOnly(elems)
          svgCanvas.deleteSelectedElements()
          syncEditorUI()
          return { success: true, deleted: elems.length }
        }

        case 'moveElement': {
          // 移动元素到指定位置
          const moveTarget = svgCanvas.getElement(payload.id)
          if (!moveTarget) return { error: `Element not found: ${payload.id}` }

          svgCanvas.selectOnly([moveTarget], true)
          if (payload.x !== undefined) {
            svgCanvas.changeSelectedAttribute('x', payload.x)
          }
          if (payload.y !== undefined) {
            svgCanvas.changeSelectedAttribute('y', payload.y)
          }
          if (payload.cx !== undefined) {
            svgCanvas.changeSelectedAttribute('cx', payload.cx)
          }
          if (payload.cy !== undefined) {
            svgCanvas.changeSelectedAttribute('cy', payload.cy)
          }
          svgCanvas.call('changed', [moveTarget])
          syncEditorUI()
          return { success: true }
        }

        case 'selectElements': {
          // 选中指定元素
          const selectIds = payload.ids || []
          const selectElems = selectIds
            .map(id => svgCanvas.getElement(id))
            .filter(Boolean)
          svgCanvas.selectOnly(selectElems, true)
          return { success: true, selected: selectElems.length }
        }

        case 'clearSelection': {
          svgCanvas.clearSelection()
          return { success: true }
        }

        case 'undo': {
          svgCanvas.undoMgr.undo()
          svgEditor.updateCanvas()
          try { svgEditor.zoomImage && svgEditor.zoomImage() } catch (_) {}
          syncEditorUI()
          return { success: true }
        }

        case 'redo': {
          svgCanvas.undoMgr.redo()
          svgEditor.updateCanvas()
          try { svgEditor.zoomImage && svgEditor.zoomImage() } catch (_) {}
          syncEditorUI()
          return { success: true }
        }

        case 'clear': {
          svgCanvas.clear()
          svgEditor.updateCanvas()
          syncEditorUI()
          return { success: true }
        }

        case 'setResolution': {
          svgCanvas.setResolution(payload.width, payload.height)
          svgEditor.updateCanvas()
          syncEditorUI()
          return { success: true }
        }

        case 'zoom': {
          svgCanvas.setZoom(payload.level)
          return { success: true }
        }

        // ===== 分组操作 =====

        case 'groupSelectedElements': {
          // 先选中指定元素（如果提供了 ids）
          if (payload.ids) {
            const elems = payload.ids.map(id => svgCanvas.getElement(id)).filter(Boolean)
            if (elems.length === 0) return { error: 'No matching elements found' }
            svgCanvas.selectOnly(elems, true)
          }
          // 记录分组前的元素 IDs，用于之后定位新建的 g 元素
          const preGroupIds = new Set(
            svgCanvas.getSelectedElements().filter(Boolean).map(el => el.id)
          )
          svgCanvas.groupSelectedElements()
          syncEditorUI()
          // groupSelectedElements 内部调用 selectOnly([g], true)
          // 但 g 可能已不在 selectedElements 中（取决于实现），所以我们用备用方案
          let groupElemId = null
          const postSelected = svgCanvas.getSelectedElements().filter(Boolean)
          if (postSelected.length > 0 && postSelected[0].tagName === 'g') {
            groupElemId = postSelected[0].id
          } else {
            // 备用方案：在当前图层中查找包含原先元素的 g
            const currentLayer = svgCanvas.getCurrentDrawing().getCurrentLayer()
            if (currentLayer) {
              const gs = currentLayer.querySelectorAll('g')
              for (const g of gs) {
                if (g.id && !g.id.startsWith('selectorGroup') && !g.id.startsWith('selector')) {
                  const childIds = Array.from(g.children).map(c => c.id)
                  if (preGroupIds.size > 0 && childIds.some(cid => preGroupIds.has(cid))) {
                    groupElemId = g.id
                    break
                  }
                }
              }
            }
          }
          return { success: true, id: groupElemId }
        }

        case 'ungroupSelectedElement': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            if (!elem) return { error: `Element not found: ${payload.id}` }
            svgCanvas.selectOnly([elem], true)
          }
          svgCanvas.ungroupSelectedElement()
          syncEditorUI()
          return { success: true }
        }

        // ===== 克隆/复制/剪切/粘贴 =====

        case 'cloneSelectedElements': {
          if (payload.ids) {
            const elems = payload.ids.map(id => svgCanvas.getElement(id)).filter(Boolean)
            if (elems.length === 0) return { error: 'No matching elements found' }
            svgCanvas.selectOnly(elems, true)
          }
          // 记录克隆前已有元素 IDs
          const preCloneElems = new Set(
            svgCanvas.getVisibleElements().map(el => el.id).filter(Boolean)
          )
          svgCanvas.cloneSelectedElements(payload.dx || 20, payload.dy || 20)
          syncEditorUI()
          // 克隆后：先尝试从 selectedElements 获取
          let clonedIds = svgCanvas.getSelectedElements().filter(Boolean).map(el => el.id)
          // 如果 selectedElements 为空，从 visibleElements 差集中获取
          if (clonedIds.length === 0) {
            const postElems = svgCanvas.getVisibleElements().map(el => el.id).filter(Boolean)
            clonedIds = postElems.filter(id => !preCloneElems.has(id))
          }
          return { success: true, ids: clonedIds }
        }

        case 'copySelectedElements': {
          if (payload.ids) {
            const elems = payload.ids.map(id => svgCanvas.getElement(id)).filter(Boolean)
            if (elems.length === 0) return { error: 'No matching elements found' }
            svgCanvas.selectOnly(elems, true)
          }
          svgCanvas.copySelectedElements()
          return { success: true }
        }

        case 'cutSelectedElements': {
          if (payload.ids) {
            const elems = payload.ids.map(id => svgCanvas.getElement(id)).filter(Boolean)
            if (elems.length === 0) return { error: 'No matching elements found' }
            svgCanvas.selectOnly(elems, true)
          }
          svgCanvas.cutSelectedElements()
          syncEditorUI()
          return { success: true }
        }

        case 'pasteElements': {
          // 记录粘贴前所有可见元素的 ID
          const prePasteElems = new Set(
            svgCanvas.getVisibleElements().map(el => el.id).filter(Boolean)
          )
          svgCanvas.pasteElements(payload.type || 'in_place')
          syncEditorUI()
          // 先尝试从 selectedElements 获取粘贴结果
          let pastedIds = svgCanvas.getSelectedElements().filter(Boolean).map(el => el.id).filter(Boolean)
          // 如果 selectedElements 为空，从 visibleElements 差集中获取
          if (pastedIds.length === 0) {
            const postElems = svgCanvas.getVisibleElements().map(el => el.id).filter(Boolean)
            pastedIds = postElems.filter(id => !prePasteElems.has(id))
          }
          return { success: true, ids: pastedIds }
        }

        // ===== Z 轴层序操作 =====

        case 'moveToTopSelectedElement': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            if (!elem) return { error: `Element not found: ${payload.id}` }
            svgCanvas.selectOnly([elem], true)
          }
          svgCanvas.moveToTopSelectedElement()
          syncEditorUI()
          return { success: true }
        }

        case 'moveToBottomSelectedElement': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            if (!elem) return { error: `Element not found: ${payload.id}` }
            svgCanvas.selectOnly([elem], true)
          }
          svgCanvas.moveToBottomSelectedElement()
          syncEditorUI()
          return { success: true }
        }

        case 'moveUpDownSelected': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            if (!elem) return { error: `Element not found: ${payload.id}` }
            svgCanvas.selectOnly([elem], true)
          }
          // direction: 'Up' or 'Down'
          svgCanvas.moveUpDownSelected(payload.direction || 'Up')
          syncEditorUI()
          return { success: true }
        }

        // ===== 变换操作 =====

        case 'setRotationAngle': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            if (!elem) return { error: `Element not found: ${payload.id}` }
            svgCanvas.selectOnly([elem], true)
          }
          svgCanvas.setRotationAngle(payload.angle, payload.preventUndo || false)
          syncEditorUI()
          return { success: true }
        }

        case 'getRotationAngle': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            if (!elem) return { error: `Element not found: ${payload.id}` }
            return { angle: svgCanvas.getRotationAngle(elem) }
          }
          const sel = svgCanvas.getSelectedElements().filter(Boolean)
          if (sel.length === 0) return { error: 'No element selected' }
          return { angle: svgCanvas.getRotationAngle(sel[0]) }
        }

        case 'flipSelectedElements': {
          if (payload.ids) {
            const elems = payload.ids.map(id => svgCanvas.getElement(id)).filter(Boolean)
            if (elems.length === 0) return { error: 'No matching elements found' }
            svgCanvas.selectOnly(elems, true)
          }
          // horizontal: flipSelectedElements(-1, 1)
          // vertical: flipSelectedElements(1, -1)
          const sx = payload.horizontal ? -1 : 1
          const sy = payload.vertical ? -1 : 1
          svgCanvas.flipSelectedElements(sx, sy)
          syncEditorUI()
          return { success: true }
        }

        case 'convertToPath': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            if (!elem) return { error: `Element not found: ${payload.id}` }
            svgCanvas.selectOnly([elem], true)
          }
          svgCanvas.convertToPath()
          syncEditorUI()
          return { success: true }
        }

        // ===== 对齐操作 =====

        case 'alignSelectedElements': {
          if (payload.ids) {
            const elems = payload.ids.map(id => svgCanvas.getElement(id)).filter(Boolean)
            if (elems.length === 0) return { error: 'No matching elements found' }
            svgCanvas.selectOnly(elems, true)
          }
          // type: 'l' | 'c' | 'r' | 't' | 'm' | 'b' (left/center/right/top/middle/bottom)
          // relativeTo: 'selected' | 'largest' | 'smallest' | 'page'
          svgCanvas.alignSelectedElements(payload.type, payload.relativeTo || 'selected')
          syncEditorUI()
          return { success: true }
        }

        // ===== 样式操作 =====

        case 'setColor': {
          // type: 'fill' | 'stroke'
          // val: color string like '#ff0000', 'none', etc.
          svgCanvas.setColor(payload.type, payload.val, payload.preventUndo || false)
          syncEditorUI()
          return { success: true }
        }

        case 'setStrokeWidth': {
          svgCanvas.setStrokeWidth(payload.val)
          syncEditorUI()
          return { success: true }
        }

        case 'setStrokeAttr': {
          // attr: 'stroke-dasharray' | 'stroke-linejoin' | 'stroke-linecap' | ...
          svgCanvas.setStrokeAttr(payload.attr, payload.val)
          syncEditorUI()
          return { success: true }
        }

        case 'setOpacity': {
          svgCanvas.setOpacity(payload.val)
          syncEditorUI()
          return { success: true }
        }

        case 'getOpacity': {
          return { opacity: svgCanvas.getOpacity() }
        }

        case 'setPaintOpacity': {
          // type: 'fill' | 'stroke'
          svgCanvas.setPaintOpacity(payload.type, payload.val, payload.preventUndo || false)
          syncEditorUI()
          return { success: true }
        }

        case 'getPaintOpacity': {
          return { opacity: svgCanvas.getPaintOpacity(payload.type) }
        }

        case 'setBlur': {
          svgCanvas.setBlur(payload.val, payload.complete || false)
          syncEditorUI()
          return { success: true }
        }

        case 'getBlur': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            return { blur: svgCanvas.getBlur(elem) }
          }
          const sel = svgCanvas.getSelectedElements().filter(Boolean)
          return { blur: svgCanvas.getBlur(sel[0]) }
        }

        case 'setGradient': {
          // type: 'fill' or 'stroke'
          svgCanvas.setGradient(payload.type)
          syncEditorUI()
          return { success: true }
        }

        case 'setPaint': {
          // type: 'fill' or 'stroke'
          // paint: paint object
          svgCanvas.setPaint(payload.type, payload.paint)
          syncEditorUI()
          return { success: true }
        }

        // ===== 文字操作 =====

        case 'setTextContent': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            if (!elem) return { error: `Element not found: ${payload.id}` }
            svgCanvas.selectOnly([elem], true)
          }
          // 直接修改文本内容属性，不调用 textActions.init/setCursor 以避免在非编辑模式下报错
          svgCanvas.changeSelectedAttribute('#text', payload.text)
          syncEditorUI()
          return { success: true }
        }

        case 'setFontFamily': {
          ensureTextSelected(payload)
          svgCanvas.setFontFamily(payload.family)
          syncEditorUI()
          return { success: true }
        }

        case 'setFontSize': {
          ensureTextSelected(payload)
          svgCanvas.setFontSize(payload.size)
          syncEditorUI()
          return { success: true }
        }

        case 'setBold': {
          ensureTextSelected(payload)
          svgCanvas.setBold(payload.bold)
          syncEditorUI()
          return { success: true }
        }

        case 'setItalic': {
          ensureTextSelected(payload)
          svgCanvas.setItalic(payload.italic)
          syncEditorUI()
          return { success: true }
        }

        case 'setTextAnchor': {
          ensureTextSelected(payload)
          // anchor: 'start' | 'middle' | 'end'
          svgCanvas.setTextAnchor(payload.anchor)
          syncEditorUI()
          return { success: true }
        }

        case 'setLetterSpacing': {
          ensureTextSelected(payload)
          svgCanvas.setLetterSpacing(payload.val)
          syncEditorUI()
          return { success: true }
        }

        case 'setWordSpacing': {
          ensureTextSelected(payload)
          svgCanvas.setWordSpacing(payload.val)
          syncEditorUI()
          return { success: true }
        }

        case 'setFontColor': {
          ensureTextSelected(payload)
          svgCanvas.setFontColor(payload.color)
          syncEditorUI()
          return { success: true }
        }

        case 'getFontColor': {
          return { color: svgCanvas.getFontColor() }
        }

        case 'addTextDecoration': {
          ensureTextSelected(payload)
          svgCanvas.addTextDecoration(payload.value)
          syncEditorUI()
          return { success: true }
        }

        case 'removeTextDecoration': {
          ensureTextSelected(payload)
          svgCanvas.removeTextDecoration(payload.value)
          syncEditorUI()
          return { success: true }
        }

        case 'getBold': {
          return { bold: svgCanvas.getBold() }
        }

        case 'getItalic': {
          return { italic: svgCanvas.getItalic() }
        }

        case 'getFontFamily': {
          return { family: svgCanvas.getFontFamily() }
        }

        case 'getFontSize': {
          return { size: svgCanvas.getFontSize() }
        }

        case 'getText': {
          return { text: svgCanvas.getText() }
        }

        // ===== 图层管理 =====

        case 'createLayer': {
          svgCanvas.createLayer(payload.name)
          syncEditorUI()
          return { success: true }
        }

        case 'deleteCurrentLayer': {
          const result = svgCanvas.deleteCurrentLayer()
          syncEditorUI()
          return { success: !!result }
        }

        case 'renameCurrentLayer': {
          const result = svgCanvas.renameCurrentLayer(payload.newName)
          syncEditorUI()
          return { success: !!result }
        }

        case 'cloneLayer': {
          svgCanvas.cloneLayer(payload.name)
          syncEditorUI()
          return { success: true }
        }

        case 'setCurrentLayer': {
          const result = svgCanvas.setCurrentLayer(payload.name)
          syncEditorUI()
          return { success: !!result }
        }

        case 'setCurrentLayerPosition': {
          const result = svgCanvas.setCurrentLayerPosition(payload.newPos)
          syncEditorUI()
          return { success: !!result }
        }

        case 'setLayerVisibility': {
          svgCanvas.setLayerVisibility(payload.name, payload.visible)
          syncEditorUI()
          return { success: true }
        }

        case 'moveSelectedToLayer': {
          const result = svgCanvas.moveSelectedToLayer(payload.name)
          syncEditorUI()
          return { success: !!result }
        }

        case 'mergeLayer': {
          svgCanvas.mergeLayer()
          syncEditorUI()
          return { success: true }
        }

        case 'mergeAllLayers': {
          svgCanvas.mergeAllLayers()
          syncEditorUI()
          return { success: true }
        }

        // ===== 超链接操作 =====

        case 'makeHyperlink': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            if (!elem) return { error: `Element not found: ${payload.id}` }
            svgCanvas.selectOnly([elem], true)
          }
          svgCanvas.makeHyperlink(payload.url)
          syncEditorUI()
          return { success: true }
        }

        case 'removeHyperlink': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            if (!elem) return { error: `Element not found: ${payload.id}` }
            svgCanvas.selectOnly([elem], true)
          }
          svgCanvas.removeHyperlink()
          syncEditorUI()
          return { success: true }
        }

        case 'setLinkURL': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            if (!elem) return { error: `Element not found: ${payload.id}` }
            svgCanvas.selectOnly([elem], true)
          }
          svgCanvas.setLinkURL(payload.url)
          syncEditorUI()
          return { success: true }
        }

        // ===== 图片操作 =====

        case 'setImageURL': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            if (!elem) return { error: `Element not found: ${payload.id}` }
            svgCanvas.selectOnly([elem], true)
          }
          svgCanvas.setImageURL(payload.url)
          syncEditorUI()
          return { success: true }
        }

        case 'embedImage': {
          const result = await svgCanvas.embedImage(payload.url)
          return { success: true, dataUrl: result }
        }

        // ===== 路径/圆角操作 =====

        case 'setRectRadius': {
          if (payload.id) {
            const elem = svgCanvas.getElement(payload.id)
            if (!elem) return { error: `Element not found: ${payload.id}` }
            svgCanvas.selectOnly([elem], true)
          }
          svgCanvas.setRectRadius(payload.val)
          syncEditorUI()
          return { success: true }
        }

        case 'setSegType': {
          svgCanvas.setSegType(payload.type)
          syncEditorUI()
          return { success: true }
        }

        // ===== 导入/导出操作 =====

        case 'importSvgString': {
          svgCanvas.importSvgString(payload.svgXml)
          svgEditor.updateCanvas()
          syncEditorUI()
          return { success: true }
        }

        case 'rasterExport': {
          // type: 'PNG' | 'JPEG' | 'BMP' | 'WEBP'
          // quality: 0-1 for JPEG
          // 使用 avoidEvent 避免触发 exportHandler（否则会弹出新窗口被浏览器拦截）
          const exportResult = await svgCanvas.rasterExport(
            payload.type || 'PNG',
            payload.quality,
            payload.exportWindowName,
            { avoidEvent: true }
          )
          return { success: true, dataUrl: exportResult?.datauri }
        }

        case 'exportPDF': {
          const pdfResult = await svgCanvas.exportPDF(
            payload.exportWindowName,
            payload.outputType
          )
          return { success: true, data: pdfResult }
        }

        // ===== 其他操作 =====

        case 'selectAllInCurrentLayer': {
          svgCanvas.selectAllInCurrentLayer()
          syncEditorUI()
          const allSelected = svgCanvas.getSelectedElements().filter(Boolean)
          return { success: true, ids: allSelected.map(el => el.id) }
        }

        case 'setMode': {
          svgCanvas.setMode(payload.mode)
          return { success: true }
        }

        case 'getMode': {
          return { mode: svgCanvas.getMode() }
        }

        case 'setDocumentTitle': {
          svgCanvas.setDocumentTitle(payload.title)
          syncEditorUI()
          return { success: true }
        }

        case 'setGroupTitle': {
          svgCanvas.setGroupTitle(payload.title)
          syncEditorUI()
          return { success: true }
        }

        case 'setBackground': {
          svgCanvas.setBackground(payload.color, payload.url)
          syncEditorUI()
          return { success: true }
        }

        default:
          return { error: `Unknown action: ${action}` }
      }
    }

    /**
     * 处理收到的 WebSocket 消息
     */
    async function handleMessage (rawData) {
      let msg
      try {
        msg = JSON.parse(rawData)
      } catch (e) {
        console.warn('[remote-bridge] Invalid JSON message:', rawData)
        return
      }

      const { action, payload, requestId } = msg

      // 忽略非命令消息（如注册确认 { type: 'registered', role: 'editor' }）
      if (!action) {
        return
      }

      try {
        const result = await handleCommand(action, payload || {})
        send({ requestId, result })
      } catch (err) {
        console.error(`[remote-bridge] Error handling action "${action}":`, err)
        send({ requestId, error: err.message })
      }
    }

    // ========================
    // 事件推送（本地变更 → 远程）
    // ========================

    svgCanvas.bind('changed', (_win, elems) => {
      if (!isConnected) return
      send({
        event: 'changed',
        data: {
          elements: elems?.filter(Boolean).map(e => e.id).filter(Boolean)
        }
      })
      // 触发自动保存
      scheduleAutoSave()
    })

    svgCanvas.bind('selected', (_win, elems) => {
      if (!isConnected) return
      send({
        event: 'selected',
        data: {
          elements: elems?.filter(Boolean).map(el => elemToJson(el)).filter(Boolean)
        }
      })
    })

    // ========================
    // 启动连接
    // ========================

    connect()

    // 将桥的控制接口暴露到全局，方便调试
    window.__svgRemoteBridge = {
      connect,
      disconnect: () => {
        if (ws) ws.close()
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
      },
      isConnected: () => isConnected,
      diagramId,
      save: saveDiagramToApi,
      load: () => diagramId && loadDiagramFromApi(diagramId),
      send
    }

    return {
      name,
      callback () {
        console.log('[remote-bridge] Extension loaded')
      }
    }
  }
}

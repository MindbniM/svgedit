#!/bin/bash
# ============================================================
# SVGEdit + Diagram Server 一键部署/重启脚本
#
# 用法:
#   ./deploy.sh              # 启动所有服务
#   ./deploy.sh stop         # 停止所有服务
#   ./deploy.sh restart      # 重启所有服务
#   ./deploy.sh status       # 查看服务状态
#
# 部署架构（路径前缀模式，仅使用 80 端口）:
#   http://HOST/svgedit/                     → SVGEdit 编辑器前端 (Vite :2233)
#   http://HOST/svgedit/mcp/api/diagrams     → diagram-server API (:2333)
#   ws://HOST/svgedit/mcp/ws                 → diagram-server WebSocket (:2333)
# ============================================================

set -e

# ---- 配置 ----
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_PORT=2333
EDITOR_PORT=2233

# 外部访问的 Host（用于生成 editorUrl）
EXTERNAL_HOST="${EXTERNAL_HOST:-your-domain.com}"

# 编辑器入口的完整外部 URL
EDITOR_BASE_URL="http://${EXTERNAL_HOST}/svgedit/src/editor/index.html"

LOG_DIR="/tmp"
DIAGRAM_SERVER_LOG="${LOG_DIR}/diagram-server.log"
SVGEDIT_LOG="${LOG_DIR}/svgedit-dev.log"
PID_DIR="${SCRIPT_DIR}/.pids"

# ---- 加载 Node.js ----
load_node() {
    if [ -f "$HOME/.nvm/nvm.sh" ]; then
        source "$HOME/.nvm/nvm.sh"
    fi
    if ! command -v node &>/dev/null; then
        echo "❌ Node.js 未找到，请确认 nvm 或 node 已安装"
        exit 1
    fi
    echo "📦 Node.js: $(node --version)"
}

# ---- 启动 diagram-server ----
start_diagram_server() {
    echo "🚀 启动 diagram-server (内部端口 ${SERVER_PORT})..."
    mkdir -p "$PID_DIR"

    cd "$SCRIPT_DIR"
    EDITOR_BASE_URL="$EDITOR_BASE_URL" nohup node server.js > "$DIAGRAM_SERVER_LOG" 2>&1 &
    echo $! > "$PID_DIR/diagram-server.pid"
    sleep 1

    if kill -0 $(cat "$PID_DIR/diagram-server.pid") 2>/dev/null; then
        echo "✅ diagram-server 已启动 (PID: $(cat $PID_DIR/diagram-server.pid))"
    else
        echo "❌ diagram-server 启动失败，查看日志: $DIAGRAM_SERVER_LOG"
        cat "$DIAGRAM_SERVER_LOG"
        exit 1
    fi
}

# ---- 启动 SVGEdit ----
start_svgedit() {
    echo "🚀 启动 SVGEdit 编辑器 (内部端口 ${EDITOR_PORT})..."
    mkdir -p "$PID_DIR"

    cd "$PROJECT_DIR"
    nohup npx vite --port "$EDITOR_PORT" --host 0.0.0.0 > "$SVGEDIT_LOG" 2>&1 &
    echo $! > "$PID_DIR/svgedit.pid"
    sleep 3

    if kill -0 $(cat "$PID_DIR/svgedit.pid") 2>/dev/null; then
        echo "✅ SVGEdit 已启动 (PID: $(cat $PID_DIR/svgedit.pid))"
    else
        echo "❌ SVGEdit 启动失败，查看日志: $SVGEDIT_LOG"
        cat "$SVGEDIT_LOG"
        exit 1
    fi
}

# ---- 停止服务 ----
stop_services() {
    echo "🛑 停止服务..."

    # 通过 PID 文件停止
    for pidfile in "$PID_DIR"/*.pid; do
        if [ -f "$pidfile" ]; then
            pid=$(cat "$pidfile")
            name=$(basename "$pidfile" .pid)
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null
                echo "   已停止 $name (PID: $pid)"
            fi
            rm -f "$pidfile"
        fi
    done

    # 兜底：按端口杀
    lsof -ti :"$SERVER_PORT" | xargs kill -9 2>/dev/null || true
    lsof -ti :"$EDITOR_PORT" | xargs kill -9 2>/dev/null || true

    echo "✅ 所有服务已停止"
}

# ---- 查看状态 ----
show_status() {
    echo ""
    echo "============================================================"
    echo "  SVGEdit + Diagram Server 服务状态"
    echo "============================================================"

    # diagram-server
    if lsof -i :"$SERVER_PORT" &>/dev/null; then
        echo "  ✅ diagram-server   : 运行中 (内部 :${SERVER_PORT})"
    else
        echo "  ❌ diagram-server   : 未运行"
    fi

    # SVGEdit
    if lsof -i :"$EDITOR_PORT" &>/dev/null; then
        echo "  ✅ SVGEdit 编辑器    : 运行中 (内部 :${EDITOR_PORT})"
    else
        echo "  ❌ SVGEdit 编辑器    : 未运行"
    fi

    # nginx
    if sudo nginx -t 2>/dev/null; then
        echo "  ✅ nginx            : 配置正常"
    else
        echo "  ⚠️  nginx            : 配置异常"
    fi

    echo ""
    echo "  📡 外部访问地址（仅需 80 端口）:"
    echo "     编辑器:  http://${EXTERNAL_HOST}/svgedit/src/editor/index.html"
    echo "     API:    http://${EXTERNAL_HOST}/svgedit/mcp/api/diagrams"
    echo "     WS:     ws://${EXTERNAL_HOST}/svgedit/mcp/ws"
    echo "     MCP 状态: http://${EXTERNAL_HOST}/svgedit/mcp"
    echo ""
    echo "  📋 MCP 配置:"
    echo "     DIAGRAM_SERVER_URL=http://${EXTERNAL_HOST}/svgedit/mcp"
    echo "     DIAGRAM_WS_URL=ws://${EXTERNAL_HOST}/svgedit/mcp/ws"
    echo ""
    echo "  📝 日志:"
    echo "     diagram-server: ${DIAGRAM_SERVER_LOG}"
    echo "     SVGEdit:        ${SVGEDIT_LOG}"
    echo "============================================================"
}

# ---- 主逻辑 ----
case "${1:-start}" in
    start)
        load_node
        stop_services 2>/dev/null || true
        start_diagram_server
        start_svgedit
        show_status
        ;;
    stop)
        stop_services
        ;;
    restart)
        load_node
        stop_services
        sleep 1
        start_diagram_server
        start_svgedit
        show_status
        ;;
    status)
        show_status
        ;;
    *)
        echo "用法: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac

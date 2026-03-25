# SVGEdit 快速参考

## 🎯 核心端口配置

| 服务 | 环境变量 | 默认端口 | 说明 |
|------|---------|---------|------|
| Remote Bridge | `BRIDGE_PORT` | 9527 | WebSocket 中继 |
| Diagram Server | `DIAGRAM_PORT` | 2333 | HTTP API + WebSocket |
| SVGEdit 前端 | `VITE_PORT` | 8000 | Vite 开发服务器 |

## ⚙️ 环境变量速查

```bash
# Remote Bridge
BRIDGE_PORT=9527

# Diagram Server
DIAGRAM_PORT=2333
DIAGRAMS_DIR=./diagrams
EDITOR_BASE_URL=http://localhost:8000/src/editor/index.html

# Frontend
VITE_PORT=8000
VITE_HOST=localhost

# Environment
NODE_ENV=development
```

## 🚀 启动命令

### 开发环境（3 个终端）

```bash
# Terminal 1: Remote Bridge
cd remote-bridge && node server.js

# Terminal 2: Diagram Server
cd diagram-server && node server.js

# Terminal 3: Frontend
npm run start
```

### 使用 .env 文件

```bash
cp .env.example .env
dotenv -- node remote-bridge/server.js
dotenv -- node diagram-server/server.js
dotenv -- npm run start
```

## 🔗 访问地址

| 服务 | 地址 |
|------|------|
| 编辑器 | http://localhost:8000/src/editor/index.html |
| Diagram API | http://localhost:2333/api/diagrams |
| Remote Bridge | ws://localhost:9527 |

## 📝 MCP 配置

```json
{
  "mcpServers": {
    "svgedit-diagram": {
      "type": "streamableHttp",
      "url": "http://localhost:2333/api",
      "timeout": 60
    }
  }
}
```

## 🔧 常用命令

```bash
# 检查端口
lsof -i :2333
lsof -i :8000
lsof -i :9527

# 查看日志 (systemd)
sudo journalctl -u diagram-server -f
sudo journalctl -u svgedit-frontend -f

# 重启服务 (systemd)
sudo systemctl restart diagram-server
sudo systemctl restart svgedit-frontend

# 测试连接
curl http://localhost:2333/api/diagrams
wscat -c ws://localhost:9527
```

## 📁 重要文件

```
svgedit/
├── .env.example              # 环境变量模板
├── .gitignore                # Git 忽略规则
├── CONFIGURATION.md          # 配置指南
├── STARTUP.md                # 启动指南
├── MCP-QUICK-START.md        # MCP 快速上手
├── PROJECT_CLEANUP_SUMMARY.md # 整理总结
├── remote-bridge/
│   ├── server.js             # WebSocket 中继
│   └── client.js             # 客户端 SDK
└── diagram-server/
    ├── server.js             # HTTP + WebSocket 服务
    ├── mcp-config.json       # MCP 配置（本地）
    └── mcp-config-external.json # MCP 配置（外部）
```

## 🐛 故障排查

### 端口冲突
```bash
# 查找占用进程
lsof -i :2333
# 修改 .env 中的端口
DIAGRAM_PORT=2334
```

### 服务无法启动
```bash
# 检查 Node.js 版本
node --version  # 需要 >= 20

# 检查依赖
npm install

# 查看详细日志
NODE_ENV=development node diagram-server/server.js
```

### WebSocket 连接失败
```bash
# 检查中继服务是否运行
ps aux | grep server.js

# 检查防火墙
sudo firewall-cmd --list-ports

# 测试连接
wscat -c ws://localhost:9527
```

## 📚 文档导航

- **新手入门**: 阅读 [STARTUP.md](./STARTUP.md)
- **环境配置**: 阅读 [CONFIGURATION.md](./CONFIGURATION.md)
- **MCP 集成**: 阅读 [MCP-QUICK-START.md](./MCP-QUICK-START.md)
- **整理说明**: 阅读 [PROJECT_CLEANUP_SUMMARY.md](./PROJECT_CLEANUP_SUMMARY.md)

## 🎯 常见场景

### 本地开发
```bash
# 使用默认端口
npm run start
```

### 生产部署
```bash
# 1. 配置 .env
cp .env.example .env.production
vim .env.production

# 2. 使用 systemd 或 Docker
# 参考 CONFIGURATION.md
```

### 团队协作
```bash
# 1. 不提交 .env 文件
git add .gitignore

# 2. 共享 .env.example
git add .env.example

# 3. 团队成员各自配置
cp .env.example .env
```

---

**快速帮助**: 
- 问题排查: `CONFIGURATION.md` → 故障排查章节
- API 文档: `remote-bridge/client.js` → JSDoc 注释
- 完整文档: [STARTUP.md](./STARTUP.md)

# SVGEdit 配置指南

本文档说明如何配置 SVGEdit 项目的环境变量和部署参数。

---

## 📁 配置文件

### 1. 环境变量文件

创建 `.env` 文件（从 `.env.example` 复制）：

```bash
cp .env.example .env
```

### 2. 配置项说明

#### Remote Bridge 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BRIDGE_PORT` | 9527 | WebSocket 中继服务端口 |

**使用场景：**
- 开发环境：使用默认端口 9527
- 生产环境：如果端口冲突，可修改为其他端口

**示例：**
```bash
# 开发环境
BRIDGE_PORT=9527

# 生产环境（端口冲突时）
BRIDGE_PORT=9528
```

---

#### Diagram Server 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DIAGRAM_PORT` | 2333 | Diagram Server HTTP/WebSocket 端口 |
| `DIAGRAMS_DIR` | ./diagrams | Diagram 文件存储目录 |
| `EDITOR_BASE_URL` | http://localhost:8000/src/editor/index.html | SVGEdit 编辑器 URL |

**使用场景：**
- 开发环境：使用 localhost
- 生产环境：使用实际域名

**示例：**
```bash
# 开发环境
DIAGRAM_PORT=2333
DIAGRAMS_DIR=./diagrams
EDITOR_BASE_URL=http://localhost:8000/src/editor/index.html

# 生产环境
DIAGRAM_PORT=2333
DIAGRAMS_DIR=/var/data/svgedit/diagrams
EDITOR_BASE_URL=http://your-domain.com/svgedit/src/editor/index.html
```

---

#### SVGEdit 前端配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_PORT` | 8000 | Vite 开发服务器端口 |
| `VITE_HOST` | localhost | Vite 开发服务器主机 |

**示例：**
```bash
# 开发环境
VITE_PORT=8000
VITE_HOST=localhost

# 生产环境（允许外部访问）
VITE_PORT=2233
VITE_HOST=0.0.0.0
```

---

#### 通用配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODE_ENV` | development | Node.js 运行环境 |
| `NODE_BIN` | /usr/bin/node | Node.js 二进制文件路径 |

**示例：**
```bash
# 开发环境
NODE_ENV=development

# 生产环境
NODE_ENV=production
NODE_BIN=/usr/bin/node
```

---

## 🚀 启动命令

### 开发环境

```bash
# 1. 启动中继服务
cd remote-bridge
BRIDGE_PORT=9527 node server.js

# 2. 启动 Diagram Server
cd diagram-server
DIAGRAM_PORT=2333 EDITOR_BASE_URL=http://localhost:8000/src/editor/index.html node server.js

# 3. 启动 SVGEdit 前端
npm run start
```

### 使用 .env 文件

```bash
# 1. 创建 .env 文件
cp .env.example .env

# 2. 编辑配置
vim .env

# 3. 使用 dotenv 加载（需要安装 dotenv-cli）
npm install -g dotenv-cli

# 4. 启动服务
dotenv -- node remote-bridge/server.js
dotenv -- node diagram-server/server.js
```

---

## 🔧 MCP 配置

### 本地开发环境

编辑 CodeBuddy MCP 配置文件：

```json
{
  "mcpServers": {
    "svgedit-diagram": {
      "type": "streamableHttp",
      "url": "http://localhost:2333/api",
      "timeout": 60,
      "disabled": false
    }
  }
}
```

### 生产环境

```json
{
  "mcpServers": {
    "svgedit-diagram": {
      "type": "streamableHttp",
      "url": "http://your-domain.com/svgedit/mcp-remote/mcp",
      "timeout": 60,
      "disabled": false
    }
  }
}
```

---

## 🐳 Docker 配置

### docker-compose.yml 示例

```yaml
version: '3.8'

services:
  diagram-server:
    build: ./diagram-server
    ports:
      - "${DIAGRAM_PORT:-2333}:2333"
    environment:
      - DIAGRAM_PORT=2333
      - DIAGRAMS_DIR=/data/diagrams
      - EDITOR_BASE_URL=${EDITOR_BASE_URL}
      - NODE_ENV=production
    volumes:
      - ./diagrams:/data/diagrams

  svgedit-frontend:
    build: .
    ports:
      - "${VITE_PORT:-8000}:8000"
    environment:
      - NODE_ENV=production
    command: npx vite --port 8000 --host 0.0.0.0

  remote-bridge:
    build: ./remote-bridge
    ports:
      - "${BRIDGE_PORT:-9527}:9527"
    environment:
      - BRIDGE_PORT=9527
```

### 启动 Docker 服务

```bash
# 使用 .env 文件
docker-compose up -d

# 查看日志
docker-compose logs -f diagram-server
```

---

## 📝 Nginx 反向代理配置

### 上游服务定义

```nginx
# /etc/nginx/conf.d/svgedit-upstream.conf
upstream diagram_backend {
    server 127.0.0.1:2333;
}

upstream svgedit_frontend {
    server 127.0.0.1:8000;
}

upstream remote_bridge {
    server 127.0.0.1:9527;
}
```

### 路由配置

```nginx
# Diagram Server API
location /svgedit/mcp/api/ {
    proxy_pass http://diagram_backend/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

# Diagram Server WebSocket
location /svgedit/mcp/ws {
    proxy_pass http://diagram_backend/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

# SVGEdit 前端
location /svgedit/ {
    proxy_pass http://svgedit_frontend/;
    proxy_http_version 1.1;
}

# Remote Bridge (可选，如需外部访问)
location /svgedit/bridge/ {
    proxy_pass http://remote_bridge/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

---

## 🔒 安全配置

### 1. 限制访问来源

```nginx
# 仅允许内网访问
location /svgedit/mcp/ {
    allow 192.168.0.0/16;
    allow 10.0.0.0/8;
    deny all;
    
    proxy_pass http://diagram_backend/;
}
```

### 2. 添加认证

```nginx
# 使用 Basic Auth
location /svgedit/mcp/ {
    auth_basic "SVGEdit API";
    auth_basic_user_file /etc/nginx/.htpasswd;
    
    proxy_pass http://diagram_backend/;
}
```

### 3. HTTPS 配置

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # ... location 配置 ...
}
```

---

## 📊 监控与日志

### 日志配置

```bash
# systemd 服务日志
sudo journalctl -u diagram-server -f
sudo journalctl -u svgedit-frontend -f

# 应用日志目录
mkdir -p /var/log/svgedit
```

### 健康检查

```bash
# Diagram Server
curl http://localhost:2333/api/diagrams

# SVGEdit 前端
curl http://localhost:8000/

# Remote Bridge (WebSocket)
wscat -c ws://localhost:9527
```

---

## 🛠️ 故障排查

### 1. 端口冲突

```bash
# 检查端口占用
lsof -i :2333
lsof -i :8000
lsof -i :9527

# 修改 .env 中的端口配置
DIAGRAM_PORT=2334
VITE_PORT=8001
BRIDGE_PORT=9528
```

### 2. 环境变量未生效

```bash
# 检查环境变量
env | grep DIAGRAM
env | grep VITE
env | grep BRIDGE

# 重启服务
sudo systemctl restart diagram-server
sudo systemctl restart svgedit-frontend
```

### 3. Node.js 路径问题

```bash
# 查找 Node.js 路径
which node

# 更新 systemd 服务文件
sudo vim /etc/systemd/system/diagram-server.service
# 修改 ExecStart=/path/to/node server.js

# 重新加载配置
sudo systemctl daemon-reload
sudo systemctl restart diagram-server
```

---

## 📚 参考文档

- [STARTUP.md](./STARTUP.md) - 启动指南
- [MCP-QUICK-START.md](./MCP-QUICK-START.md) - MCP 快速上手
- [.env.example](./.env.example) - 环境变量模板

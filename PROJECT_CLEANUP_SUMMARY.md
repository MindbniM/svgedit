# SVGEdit 项目整理总结

## 📋 整理内容

本次整理主要完成了以下工作：

### 1. 环境变量配置化 ✅

#### 创建的文件
- `.env.example` - 环境变量模板
- `.gitignore` - Git 忽略规则（包含 .env 文件）
- `CONFIGURATION.md` - 配置指南文档

#### 配置项说明

| 配置项 | 文件位置 | 环境变量 | 默认值 |
|--------|---------|---------|--------|
| WebSocket 中继端口 | `remote-bridge/server.js` | `BRIDGE_PORT` | 9527 |
| Diagram Server 端口 | `diagram-server/server.js` | `DIAGRAM_PORT` | 2333 |
| Diagram 存储目录 | `diagram-server/server.js` | `DIAGRAMS_DIR` | ./diagrams |
| 编辑器 URL | `diagram-server/server.js` | `EDITOR_BASE_URL` | http://localhost:8000/... |
| Vite 端口 | `vite.config.mjs` | `VITE_PORT` | 8000 |
| Vite 主机 | `vite.config.mjs` | `VITE_HOST` | localhost |

---

### 2. 文档脱敏 ✅

#### 修改的文件

| 文件 | 修改内容 |
|------|---------|
| `MCP-QUICK-START.md` | 将域名 `your-domain.com` 替换为 `your-domain.com` |
| `STARTUP.md` | 将绝对路径 `/data/home/mindinlu/...` 替换为 `/path/to/...` |
| `diagram-server/mcp-config.json` | 使用 `localhost` 替代具体域名 |
| `diagram-server/mcp-config-external.json` | 使用 `your-domain.com` 作为占位符 |
| `diagram-server/deploy.sh` | 将默认域名改为 `your-domain.com` |
| `vite.config.mjs` | 使用环境变量 `process.env.VITE_HOST` |

#### 脱敏原则

- **域名**: 所有 `*.devcloud.woa.com` 替换为 `your-domain.com`
- **路径**: 所有 `/data/home/mindinlu/` 替换为 `/path/to/`
- **用户**: 所有 `mindinlu` 用户名替换为 `your-username`
- **组**: 所有 `users` 组替换为 `your-group`

---

### 3. 代码优化 ✅

#### remote-bridge/client.js

**修改前：**
```javascript
constructor (url = 'ws://localhost:9527', options = {}) {
  this.url = url
  // ...
}
```

**修改后：**
```javascript
constructor (url, options = {}) {
  // 默认端口从环境变量读取，开发环境默认 9527
  const defaultPort = process.env.BRIDGE_PORT || '9527'
  const defaultUrl = `ws://localhost:${defaultPort}`
  this.url = url || defaultUrl
  // ...
}
```

**优势：**
- 支持通过环境变量配置端口
- 保持向后兼容（默认值不变）
- 开发和生产环境灵活切换

---

## 📁 文件结构

```
svgedit/
├── .env.example              ✨ 新增：环境变量模板
├── .gitignore                ✨ 新增：Git 忽略规则
├── CONFIGURATION.md          ✨ 新增：配置指南
├── STARTUP.md                ✅ 已脱敏
├── MCP-QUICK-START.md        ✅ 已脱敏
├── vite.config.mjs           ✅ 使用环境变量
├── remote-bridge/
│   ├── server.js             ✅ 已使用 BRIDGE_PORT
│   └── client.js             ✅ 支持环境变量
└── diagram-server/
    ├── server.js             ✅ 已使用环境变量
    ├── deploy.sh             ✅ 已脱敏
    ├── mcp-config.json       ✅ 已脱敏
    └── mcp-config-external.json  ✅ 已脱敏
```

---

## 🚀 使用方式

### 方式 1：直接使用环境变量

```bash
# 启动中继服务
BRIDGE_PORT=9527 node remote-bridge/server.js

# 启动 Diagram Server
DIAGRAM_PORT=2333 \
EDITOR_BASE_URL=http://localhost:8000/src/editor/index.html \
node diagram-server/server.js

# 启动前端
npm run start
```

### 方式 2：使用 .env 文件

```bash
# 1. 创建 .env 文件
cp .env.example .env

# 2. 编辑配置
vim .env

# 3. 安装 dotenv-cli
npm install -g dotenv-cli

# 4. 启动服务
dotenv -- node remote-bridge/server.js
dotenv -- node diagram-server/server.js
dotenv -- npm run start
```

### 方式 3：systemd 服务（生产环境）

参考 `STARTUP.md` 中的 systemd 配置章节。

---

## 🔐 安全建议

### 1. 保护 .env 文件

```bash
# .env 文件包含敏感配置，不应提交到 Git
# 已添加到 .gitignore

# 设置合适的文件权限
chmod 600 .env
```

### 2. 不同环境使用不同配置

```bash
# 开发环境
.env.development

# 测试环境
.env.test

# 生产环境
.env.production
```

### 3. 敏感信息管理

- 生产环境的域名、端口通过环境变量或配置管理工具注入
- 不要在代码中硬编码域名、IP、密码等敏感信息
- 使用 systemd `Environment` 配置或 Docker secrets

---

## 📝 迁移指南

如果你是从旧版本升级，请按以下步骤操作：

### 步骤 1：创建 .env 文件

```bash
cd svgedit
cp .env.example .env
```

### 步骤 2：配置环境变量

编辑 `.env` 文件，填入你的实际配置：

```bash
# Remote Bridge
BRIDGE_PORT=9527

# Diagram Server
DIAGRAM_PORT=2333
DIAGRAMS_DIR=./diagrams
EDITOR_BASE_URL=http://your-domain.com/svgedit/src/editor/index.html

# Frontend
VITE_PORT=8000
VITE_HOST=your-domain.com

# Environment
NODE_ENV=production
```

### 步骤 3：更新 systemd 服务（如使用）

编辑 systemd 服务文件，添加环境变量：

```ini
[Service]
EnvironmentFile=/path/to/svgedit/.env
# 或
Environment=DIAGRAM_PORT=2333
Environment=EDITOR_BASE_URL=http://your-domain.com/svgedit/src/editor/index.html
```

### 步骤 4：更新 MCP 配置

编辑 CodeBuddy MCP 配置，使用你的实际域名：

```json
{
  "mcpServers": {
    "svgedit-diagram": {
      "url": "http://your-domain.com/svgedit/mcp-remote/mcp"
    }
  }
}
```

### 步骤 5：重启服务

```bash
# systemd
sudo systemctl daemon-reload
sudo systemctl restart diagram-server svgedit-frontend

# 或手动重启
pkill -f "node.*server.js"
./restart.sh
```

---

## ✅ 验证清单

完成配置后，请验证以下项目：

- [ ] `.env` 文件已创建并配置正确
- [ ] `.env` 已添加到 `.gitignore`
- [ ] 文档中不包含敏感信息（域名、路径、用户名）
- [ ] 服务可以正常启动（检查日志无错误）
- [ ] MCP 工具可以正常调用
- [ ] 编辑器可以正常访问
- [ ] WebSocket 连接正常

---

## 🔗 相关文档

- [CONFIGURATION.md](./CONFIGURATION.md) - 详细配置指南
- [STARTUP.md](./STARTUP.md) - 启动指南
- [MCP-QUICK-START.md](./MCP-QUICK-START.md) - MCP 快速上手
- [.env.example](./.env.example) - 环境变量模板

---

## 📞 支持

如遇到问题，请检查：

1. **环境变量是否正确加载**
   ```bash
   env | grep DIAGRAM
   env | grep BRIDGE
   env | grep VITE
   ```

2. **端口是否被占用**
   ```bash
   lsof -i :2333
   lsof -i :8000
   lsof -i :9527
   ```

3. **日志输出**
   ```bash
   # systemd
   sudo journalctl -u diagram-server -f
   
   # 手动启动
   node diagram-server/server.js
   ```

4. **参考 CONFIGURATION.md 中的故障排查章节**

---

## 🎉 完成

项目配置整理完成！现在你可以：

- ✅ 通过环境变量灵活配置不同环境
- ✅ 安全地分享代码（无敏感信息泄露）
- ✅ 快速部署到不同环境
- ✅ 团队协作更加标准化

开始使用：
```bash
# 复制配置模板
cp .env.example .env

# 编辑你的配置
vim .env

# 启动服务
npm run start
```

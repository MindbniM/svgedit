# SVGEdit MCP 服务器更新日志

## 新增工具：get_editor_usage_guide

### 功能说明
添加了一个新的 MCP 工具 `get_editor_usage_guide`，用于获取在线编辑功能的详细使用说明。

### 工具信息
- **工具名称**: `get_editor_usage_guide`
- **描述**: 获取在线编辑功能的使用说明。解释所有 editor_* 系列工具的前提条件。
- **参数**: 无需参数
- **返回**: 包含完整使用指南的 JSON 对象

### 返回内容包括

1. **重要提示**: 强调所有 editor_* 工具必须在浏览器中打开编辑器后才能使用
2. **使用步骤**: 分步骤说明如何使用在线编辑功能
   - 步骤 1: 创建图表
   - 步骤 2: 打开编辑器（必须）
   - 步骤 3: 使用在线编辑工具
   - 步骤 4: 保存结果（可选）
3. **工具分类**:
   - 不需要编辑器在线的工具列表
   - 需要编辑器在线的工具（editor_* 系列）分类
4. **典型工作流程示例**: 展示完整的使用流程
5. **常见问题**: 提供故障排除指南

### 使用示例

```javascript
// 在 CodeBuddy 中使用 MCP 工具
mcp_call_tool({
  serverName: "svgedit-diagram",
  toolName: "get_editor_usage_guide",
  arguments: "{}"
})
```

### 主要目的

这个工具的主要目的是帮助 AI 助手和用户理解：
1. **关键前提**: 使用 editor_* 工具前必须在浏览器中打开编辑器 URL
2. **工具分类**: 清楚区分哪些工具需要编辑器在线，哪些不需要
3. **正确流程**: 展示标准的使用工作流程
4. **问题解决**: 当遇到错误时如何排查

### 更新文件

- `/data/home/mindinlu/png_to_svg/svgedit/diagram-server/mcp-server.js`
  - 在 `TOOLS` 数组中添加了新工具定义（第 217-224 行）
  - 在 `CallToolRequestSchema` 处理器中添加了 `get_editor_usage_guide` case（第 1129-1221 行）

### 重启服务器

修改后需要重启 MCP 服务器才能生效。CodeBuddy 会在下次调用时自动重启 MCP 服务器。

### 验证方法

1. 在 CodeBuddy 中调用 `mcp_get_tool_description` 查看工具是否存在
2. 调用 `get_editor_usage_guide` 查看返回的完整指南
3. 验证返回的 JSON 结构是否正确

---

更新日期: 2026-03-11

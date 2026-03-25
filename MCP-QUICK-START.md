# SVGEdit MCP 工具快速上手指南

## 📦 什么是 SVGEdit MCP？

SVGEdit MCP 是一个让 AI 能够**创建和编辑 SVG 图表**的工具。通过简单配置，AI 就可以帮你：
- 创建流程图、架构图、UML 图
- 实时编辑图形元素（矩形、圆形、文字等）
- 保存和导出 SVG 文件

---

## ⚡ 快速配置（3 步）

### 第 1 步：打开 MCP 配置文件

在 CodeBuddy 中，打开MCP配置文件：

### 第 2 步：添加配置

在 `mcpServers` 中添加以下内容：

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

**💡 提示**：如果你已经有其他 MCP 服务器配置，只需在 `mcpServers` 对象中添加 `svgedit-diagram` 部分即可。


✅ **完成！现在你可以让 AI 帮你画图了。**

---

## 🎨 基础使用示例

### 示例 1：创建一个简单的流程图

**你对 AI 说**：
```
帮我创建一个简单的登录流程图，包含：
1. 开始
2. 输入用户名密码
3. 验证
4. 成功/失败
5. 结束
```

**AI 会自动**：
1. 调用 `create_diagram` 创建画板
2. 调用 `editor_clear` 清空缓存
3. 使用 `editor_add_elements` 添加矩形和文字
4. 使用 `editor_add_element` 添加箭头连线
5. 返回编辑器 URL 供你预览

### 示例 2：修改现有图表

**你对 AI 说**：
```
把刚才创建的流程图中"验证"这个框改成圆角矩形，颜色改为蓝色
```

**AI 会自动**：
1. 使用 `editor_get_all_elements` 找到"验证"元素
2. 使用 `editor_set_rect_radius` 设置圆角
3. 使用 `editor_set_color` 改变颜色

### 示例 3：保存和导出

**你对 AI 说**：
```
保存这个图表，并把 SVG 内容保存到本地文件
```

**AI 会自动**：
1. 使用 `editor_save` 保存到云端并获取 SVG 内容
2. 使用 `write_to_file` 将 SVG 保存到本地文件

---

## 🔧 常用工具说明

### 📋 图表管理工具

| 工具 | 用途 | 示例 |
|------|------|------|
| `create_diagram` | 创建新画板 | "创建一个 800x600 的画板" |
| `list_diagrams` | 查看所有图表 | "列出我创建的所有图表" |
| `editor_clear` | 清空画板 | "清空当前画板" |

### 🎨 绘图工具

| 工具 | 用途 | 示例 |
|------|------|------|
| `editor_add_element` | 添加单个元素 | "添加一个蓝色矩形" |
| `editor_add_elements` | 批量添加元素 | "添加 5 个矩形和 3 条连线" |
| `editor_update_element` | 修改元素属性 | "把这个矩形改成红色" |
| `editor_delete_elements` | 删除元素 | "删除所有圆形" |

### ✏️ 文本工具

| 工具 | 用途 | 示例 |
|------|------|------|
| `editor_set_text_content` | 设置文字内容 | "把文本改为'开始'" |
| `editor_set_font_size` | 设置字号 | "把字体改大到 24" |
| `editor_set_text_style` | 设置文字样式 | "把文字加粗" |

### 💾 保存工具

| 工具 | 用途 | 示例 |
|------|------|------|
| `editor_save` | 保存并返回 SVG | "保存这个图表" |
| `export_diagram_svg` | 导出 SVG 内容 | "导出 SVG 文件" |

---

## 💡 使用技巧

### ✅ 最佳实践

1. **创建新图表后先清空**
   ```
   AI，帮我创建一个新画板，然后清空它
   ```
   ⚠️ 这样可以避免浏览器缓存导致的旧图残留

2. **批量操作更高效**
   ```
   AI，一次性添加这些元素：3个矩形、2个圆形、4条连线
   ```
   使用 `editor_add_elements` 比多次调用 `editor_add_element` 更快

3. **让 AI 打开编辑器**
   ```
   AI，创建画板后帮我打开编辑器预览
   ```
   AI 会自动调用 `preview_url` 在 IDE 内置浏览器中打开

### ⚠️ 注意事项

1. **文本元素的添加**
   - ❌ 不要用 `editor_add_element` 直接添加带文字的 text 元素
   - ✅ 正确方式：先用 `editor_add_element` 创建空 text，再用 `editor_set_text_content` 设置内容

2. **元素 ID**
   - 创建元素后，AI 会获得元素 ID
   - 后续修改、删除都需要用这个 ID

3. **编辑器在线要求**
   - 大部分 `editor_*` 工具需要编辑器在线（打开 URL）
   - 如果遇到"编辑器未打开"错误，让 AI 先打开编辑器

---

## 🎯 完整示例：创建系统架构图

**你可以这样说**：

```
帮我画一个简单的三层架构图：
- 顶层：用户界面（蓝色）
- 中层：业务逻辑（绿色）
- 底层：数据库（橙色）
用箭头连接它们，并标注每层的名称
```

**AI 会执行的步骤**：
1. ✅ 创建 800x600 画板
2. ✅ 清空画板（避免缓存）
3. ✅ 添加 3 个圆角矩形（不同颜色）
4. ✅ 为每个矩形添加文字标注
5. ✅ 添加箭头连线
6. ✅ 保存图表并返回 SVG
7. ✅ 打开编辑器供你预览

---

## 🔗 相关链接

- **编辑器地址**: http://your-domain.com/svgedit/src/editor/index.html
- **服务器地址**: http://your-domain.com/svgedit/mcp-remote/mcp
- **本地开发**: http://localhost:8000/src/editor/index.html (VITE_PORT=8000)
- **项目文档**: `svgedit/STARTUP.md`

---

## 🆘 常见问题

### Q1: 配置后 AI 找不到 svgedit 工具？
**A**: 重启 CodeBuddy，确保配置文件格式正确（JSON 语法）

### Q2: 创建的画板出现旧图？
**A**: 让 AI 在创建画板后调用 `editor_clear` 清空画板

### Q3: AI 说"编辑器未打开"？
**A**: 让 AI 先打开编辑器 URL，或者你手动在浏览器中打开编辑器 URL

### Q4: 文字显示不出来？
**A**: 确保使用 `editor_set_text_content` 设置文字，而不是在 `editor_add_element` 中直接传递

### Q5: 如何查看所有可用工具？
**A**: 对 AI 说："列出 svgedit 所有可用的工具"

---

## 🎉 开始使用

现在你可以对 AI 说：

- "帮我画一个登录流程图"
- "创建一个系统架构图"
- "画一个 UML 类图"
- "把这个矩形改成圆角，颜色改为红色"

**祝你使用愉快！** 🚀

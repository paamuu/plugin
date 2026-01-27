# AI Webview 实现文档

## 概述

本文档说明如何在VSCode插件中实现一个AI助手的Webview视图。该视图通过侧边栏的AI图标进行访问，提供了一个现代化的对话界面。

## 实现细节

### 1. 文件结构

新增文件：
- `src/providers/aiWebviewProvider.ts` - AI Webview提供者实现

修改文件：
- `package.json` - 添加viewContainer和view配置
- `src/extension.ts` - 注册AI Webview提供者

### 2. Package.json 配置

#### viewsContainers 配置
在 `contributes` 中添加了 `viewsContainers`：
```json
"viewsContainers": {
  "activitybar": [
    {
      "id": "aiAssistantView",
      "title": "AI 助手",
      "icon": "$(symbol-misc)"
    }
  ]
}
```

- `id`: 容器的唯一标识符
- `title`: 在侧边栏中显示的标题
- `icon`: 使用VSCode内置的图标 `$(symbol-misc)`（AI相关图标）

#### views 配置
在 `views` 中添加了 `aiAssistantView`：
```json
"views": {
  "aiAssistantView": [
    {
      "id": "aiAssistant",
      "name": "AI 助手",
      "type": "webview",
      "when": "true"
    }
  ],
  ...
}
```

### 3. AiWebviewProvider 类

#### 主要功能

1. **视图管理**
   - `resolveWebviewView()` - 初始化webview视图
   - `show()` - 展开/显示视图
   - `isResolved()` - 检查视图是否已初始化

2. **消息处理**
   - `alert` - 显示通知消息
   - `sendMessage` - 处理用户的AI对话消息
   - `clearHistory` - 清空对话历史
   - `copyToClipboard` - 复制消息到剪贴板
   - `insertText` - 在编辑器中插入文本

3. **AI响应生成**
   - `generateAiResponse()` - 生成AI回复（目前为示例实现）

#### 实现关键点

```typescript
// 1. 实现 WebviewViewProvider 接口
export class AiWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiAssistant';
    private _view: vscode.WebviewView | undefined;

    // 2. 实现 resolveWebviewView 方法
    public resolveWebviewView(
        webviewView: WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        // 监听消息...
    }
}
```

### 4. Webview UI 设计

#### 特点

- **现代化界面** - 使用渐变色标题和流畅的动画
- **自适应主题** - 使用VSCode的CSS变量，自动适应编辑器主题
- **完整功能**
  - 消息输入框（支持Enter发送）
  - 清空历史按钮
  - 复制和插入功能
  - 输入中的动画指示器
  - 消息动画效果

#### CSS 特点

- 使用VSCode主题变量（`--vscode-*`）
- 自定义滚动条样式
- 响应式布局
- 动画效果（消息滑入、输入中的点击动画）

#### 交互功能

1. **发送消息**
   - 点击发送按钮或按Enter键
   - 显示用户消息和AI响应

2. **消息操作**
   - 复制（📋）- 复制到剪贴板
   - 插入（➕）- 插入到当前编辑器

3. **历史管理**
   - 清空按钮清除所有对话

### 5. Extension.ts 中的注册

```typescript
// 创建提供者实例
const aiWebviewProvider = new AiWebviewProvider(context.extensionUri);

// 注册提供者
context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AiWebviewProvider.viewType, aiWebviewProvider, {
        webviewOptions: {
            retainContextWhenHidden: true,
        }
    })
);
```

## 集成AI API

### 当前实现

现在使用 `generateAiResponse()` 方法提供示例响应。

### 集成真实AI API

要集成真实的AI API（如OpenAI, Claude等），修改 `handleSendMessage()` 方法：

```typescript
private async handleSendMessage(webview: vscode.Webview, message: any): Promise<void> {
    try {
        const userMessage = message.text;
        
        // 调用真实AI API
        const aiResponse = await this.callAiApi(userMessage);
        
        webview.postMessage({
            type: 'aiResponse',
            response: aiResponse,
            timestamp: Date.now()
        });
    } catch (error) {
        // 错误处理...
    }
}

private async callAiApi(userMessage: string): Promise<string> {
    // 使用axios或fetch调用API
    // const response = await axios.post('https://api.openai.com/...', {...});
    // return response.data.choices[0].message.content;
}
```

## 图标说明

- `$(symbol-misc)` - VSCode内置的通用符号图标，适合表示AI助手
- 其他可用的AI相关图标：
  - `$(hubot)` - 机器人图标
  - `$(lightbulb)` - 灯泡图标（用于建议）
  - `$(sparkle)` - 闪耀图标（用于特性）

## 构建和测试

1. **构建项目**
   ```bash
   npm run build
   ```

2. **运行调试**
   - 在VSCode中按 `F5` 打开Extension Development Host
   - 在左侧活动栏中找到AI助手图标
   - 点击展开AI助手视图

3. **测试功能**
   - 输入消息并发送
   - 测试复制和插入功能
   - 测试清空历史功能

## 注意事项

1. **retainContextWhenHidden** - 设置为 `true` 以保持webview的HTML上下文，即使视图被隐藏
2. **enableScripts** - 确保webview可以执行脚本
3. **CSP策略** - 在生产环境中应该配置Content Security Policy

## 后续改进

1. 集成真实的AI API
2. 添加历史记录持久化
3. 支持不同的AI模型选择
4. 添加上下文感知功能（当前文件内容等）
5. 支持代码块语法高亮
6. 添加流式响应支持
7. 实现消息搜索功能

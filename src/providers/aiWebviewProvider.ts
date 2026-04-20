import * as vscode from 'vscode';
import { WebviewView } from 'vscode';

interface ChatMessage {
    role: 'user' | 'ai';
    content: string;
    timestamp: number;
}

export class AiWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiAssistant';
    // 使用静态变量跟踪当前会话中是否已初始化（插件重新加载时会重置）
    private static _sessionInitialized = false;
    private _view: vscode.WebviewView | undefined;
    private _chatHistory: ChatMessage[] = [];
    private _messageDisposable: vscode.Disposable | undefined;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context?: vscode.ExtensionContext
    ) {
        // 从存储中恢复对话历史
        this._loadChatHistory();
    }

    /**
     * 从ExtensionContext存储中加载对话历史
     */
    private _loadChatHistory(): void {
        if (!this._context) return;
        
        const savedHistory = this._context.globalState.get<ChatMessage[]>('aiAssistant.chatHistory');
        if (savedHistory && Array.isArray(savedHistory)) {
            this._chatHistory = savedHistory;
            console.log('已恢复对话历史，共', this._chatHistory.length, '条消息');
        }
    }

    /**
     * 保存对话历史到ExtensionContext存储
     */
    private async _saveChatHistory(): Promise<void> {
        if (!this._context) return;
        
        try {
            // 只保存最近100条消息以节省存储空间
            const historyToSave = this._chatHistory.slice(-100);
            await this._context.globalState.update('aiAssistant.chatHistory', historyToSave);
        } catch (error) {
            console.error('保存对话历史失败:', error);
        }
    }

    /**
     * 获取对话历史
     */
    public getChatHistory(): ChatMessage[] {
        return this._chatHistory;
    }

    /**
     * 添加消息到历史记录
     */
    private _addToHistory(role: 'user' | 'ai', content: string): void {
        this._chatHistory.push({
            role,
            content,
            timestamp: Date.now()
        });
        this._saveChatHistory();
    }

    /**
     * 显示并展开 webview view
     * @param preserveFocus 是否保持焦点在当前编辑器
     */
    public show(preserveFocus?: boolean): void {
        if (this._view) {
            this._view.show(preserveFocus);
        } else {
            console.log('AI Assistant webview 视图尚未解析，无法展开');
        }
    }

    /**
     * 检查视图是否已解析
     */
    public isResolved(): boolean {
        return this._view !== undefined;
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        if (this._messageDisposable) {
            this._messageDisposable.dispose();
            this._messageDisposable = undefined;
        }
        this._view = undefined;
        // this._isInitialized = false;
    }

    public async resolveWebviewView(
        webviewView: WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        // 检查webview是否已经初始化过
        // 方法：检查HTML内容是否包含我们的特殊标识符
        // 如果包含，说明webview已经初始化过（retainContextWhenHidden保留了内容）
        const existingHtml = webviewView.webview.html;
        const hasInitializedContent = existingHtml && existingHtml.includes('__AI_ASSISTANT_INITIALIZED__');
        
        // 如果检测到已初始化的内容，说明是拖拽操作，跳过重新初始化
        if (hasInitializedContent) {
            console.log('AI Assistant webview 已存在且已初始化，跳过重新初始化（拖拽操作）');
            
            // 清理之前的消息监听器（如果存在）
            if (this._messageDisposable) {
                this._messageDisposable.dispose();
                this._messageDisposable = undefined;
            }
            
            // 更新视图引用
            this._view = webviewView;
            
            // 重新绑定消息监听器（因为webviewView实例可能是新的）
            this._messageDisposable = webviewView.webview.onDidReceiveMessage(
                async (message) => {
                    await this._handleWebviewMessage(webviewView.webview, message);
                },
                undefined,
                []
            );
            
            console.log('已重新绑定消息监听器，保持webview状态');
            return;
        }

        // 首次初始化或插件重新加载（HTML中没有标识符）
        console.log('AI Assistant webview 首次初始化或插件重新加载');

        // 清理之前的消息监听器（如果存在）
        if (this._messageDisposable) {
            this._messageDisposable.dispose();
            this._messageDisposable = undefined;
        }

        // 保存 webview view 引用
        this._view = webviewView;

        // 设置webview的一些配置选项
        webviewView.webview.options = {
            enableScripts: true,
        };

        // 设置HTML内容，并注入当前的对话历史
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview, this._chatHistory);

        // 标记为已初始化（持久化到ExtensionContext）
        await this._markAsInitialized();

        // 监听来自webview的消息
        this._messageDisposable = webviewView.webview.onDidReceiveMessage(
            async (message) => {
                await this._handleWebviewMessage(webviewView.webview, message);
            },
            undefined,
            []
        );
    }

    /**
     * 处理来自webview的消息（提取为独立方法以便复用）
     */
    private async _handleWebviewMessage(webview: vscode.Webview, message: any): Promise<void> {
        switch (message.command) {
            case 'webviewReady':
                // webview已准备好
                return;
            case 'alert':
                vscode.window.showInformationMessage(message.text);
                return;
            case 'sendMessage':
                // 处理AI对话消息
                this._addToHistory('user', message.text);
                await this.handleSendMessage(webview, message);
                return;
            case 'clearHistory':
                // 清空对话历史
                this._chatHistory = [];
                this._saveChatHistory();
                this.handleClearHistory(webview);
                return;
            case 'copyToClipboard':
                // 复制到剪贴板
                await vscode.env.clipboard.writeText(message.text);
                vscode.window.showInformationMessage('已复制到剪贴板');
                return;
            case 'insertText':
                // 在编辑器中插入文本
                await this.handleInsertText(message.text);
                return;
        }
    }

    /**
     * 处理发送消息
     */
    private async handleSendMessage(webview: vscode.Webview, message: any): Promise<void> {
        try {
            const userMessage = message.text;
            
            // 模拟AI响应（实际应用中应该调用真实的AI API）
            const aiResponse = this.generateAiResponse(userMessage);
            
            // 添加AI响应到历史记录
            this._addToHistory('ai', aiResponse);
            
            // 将AI响应发送回webview
            webview.postMessage({
                type: 'aiResponse',
                response: aiResponse,
                timestamp: Date.now()
            });
            
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            vscode.window.showErrorMessage(`处理消息失败: ${err.message}`);
            webview.postMessage({
                type: 'error',
                error: err.message,
                timestamp: Date.now()
            });
        }
    }

    /**
     * 处理清空对话历史
     */
    private handleClearHistory(webview: vscode.Webview): void {
        webview.postMessage({
            type: 'historyCleared',
            timestamp: Date.now()
        });
        vscode.window.showInformationMessage('对话历史已清空');
    }

    /**
     * 处理在编辑器中插入文本
     */
    private async handleInsertText(text: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('没有打开的编辑器');
            return;
        }

        await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, text);
        });
    }

    /**
     * 生成AI响应（模拟）
     */
    private generateAiResponse(userMessage: string): string {
        // 这里是简单的示例响应
        // 在实际应用中，应该调用真实的AI API（如OpenAI, Claude等）
        const responses: { [key: string]: string } = {
            'hello': '你好！我是AI助手，很高兴为你服务。有什么我可以帮助你的吗？',
            'help': '我可以帮助你编写代码、解答问题、生成文本等。请告诉我你需要什么帮助。',
            'code': '我可以帮你生成代码片段。请告诉我具体需求。',
            'default': `我收到了你的消息："${userMessage}"。这是一个演示响应。在实际应用中，这里会调用真实的AI API来生成更有意义的回复。`
        };

        const lowerMessage = userMessage.toLowerCase();
        for (const [key, value] of Object.entries(responses)) {
            if (lowerMessage.includes(key)) {
                return value;
            }
        }

        return responses.default;
    }

    private _getHtmlForWebview(webview: vscode.Webview, chatHistory: ChatMessage[] = []) {
        // 将对话历史转换为JSON字符串，注入到HTML中
        const historyJson = JSON.stringify(chatHistory);
        
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI 助手</title>
    <!-- 注入初始状态 -->
    <script>
        window.__INITIAL_CHAT_HISTORY__ = ${historyJson};
    </script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        .container {
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 16px;
            color: white;
            text-align: center;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }

        .header h2 {
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .header-icon {
            font-size: 24px;
        }

        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .message {
            display: flex;
            gap: 8px;
            animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .message.user {
            justify-content: flex-end;
        }

        .message-content {
            max-width: 85%;
            padding: 10px 12px;
            border-radius: 8px;
            word-wrap: break-word;
            line-height: 1.4;
        }

        .message.user .message-content {
            background-color: #667eea;
            color: white;
        }

        .message.ai .message-content {
            background-color: var(--vscode-editor-lineHighlightBackgroundColor);
            border: 1px solid var(--vscode-panel-border);
        }

        .message-icon {
            display: flex;
            align-items: flex-end;
            font-size: 16px;
            height: 100%;
        }

        .message-actions {
            display: flex;
            gap: 4px;
            margin-top: 4px;
            opacity: 0;
            transition: opacity 0.2s;
        }

        .message.ai:hover .message-actions {
            opacity: 1;
        }

        .action-button {
            background: none;
            border: none;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            font-size: 12px;
            padding: 2px 6px;
            border-radius: 3px;
            transition: background-color 0.2s;
        }

        .action-button:hover {
            background-color: var(--vscode-editor-hoverHighlightBackground);
        }

        .input-area {
            background-color: var(--vscode-input-background);
            border-top: 1px solid var(--vscode-panel-border);
            padding: 12px;
            display: flex;
            gap: 8px;
            align-items: flex-end;
        }

        .input-wrapper {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .input-box {
            display: flex;
            gap: 8px;
            align-items: flex-end;
        }

        input[type="text"] {
            flex: 1;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px 12px;
            border-radius: 4px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }

        input[type="text"]:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 0 0 2px var(--vscode-focusBorder) transparent;
        }

        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            transition: background-color 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
        }

        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        button:active {
            background-color: var(--vscode-button-background);
        }

        .secondary-button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .secondary-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .controls {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        }

        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--vscode-disabledForeground);
            text-align: center;
            gap: 12px;
        }

        .empty-icon {
            font-size: 48px;
            opacity: 0.5;
        }

        .typing-indicator {
            display: flex;
            gap: 4px;
            padding: 10px 12px;
        }

        .typing-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: var(--vscode-foreground);
            opacity: 0.6;
            animation: typing 1.4s infinite;
        }

        .typing-dot:nth-child(2) {
            animation-delay: 0.2s;
        }

        .typing-dot:nth-child(3) {
            animation-delay: 0.4s;
        }

        @keyframes typing {
            0%, 60%, 100% {
                transform: translateY(0);
                opacity: 0.6;
            }
            30% {
                transform: translateY(-8px);
                opacity: 1;
            }
        }

        /* 滚动条样式 */
        .messages-container::-webkit-scrollbar {
            width: 8px;
        }

        .messages-container::-webkit-scrollbar-track {
            background: transparent;
        }

        .messages-container::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 4px;
        }

        .messages-container::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>
                <span class="header-icon">🤖</span>
                <span>AI 助手</span>
            </h2>
        </div>

        <div class="messages-container" id="messagesContainer">
            <div class="empty-state">
                <div class="empty-icon">🤖</div>
                <div>
                    <p style="font-weight: 500; margin-bottom: 4px;">欢迎使用 AI 助手</p>
                    <p style="font-size: 12px; opacity: 0.7;">在下方输入框中输入你的问题或需求</p>
                </div>
            </div>
        </div>

        <div class="input-area">
            <div class="input-wrapper">
                <div class="input-box">
                    <input 
                        type="text" 
                        id="messageInput" 
                        placeholder="输入你的问题或需求..." 
                        aria-label="消息输入框"
                    >
                    <button id="sendBtn" title="发送消息 (Enter)">
                        <span>📤</span>
                    </button>
                </div>
                <div class="controls">
                    <button class="secondary-button" id="clearBtn" title="清空对话历史">
                        <span>🗑️</span>
                        <span>清空</span>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <script>
        console.log('webview loaded-----------------');
        const vscode = acquireVsCodeApi();
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const clearBtn = document.getElementById('clearBtn');
        const messagesContainer = document.getElementById('messagesContainer');

        // 从注入的初始状态恢复对话历史
        const initialHistory = window.__INITIAL_CHAT_HISTORY__ || [];
        let isFirstMessage = initialHistory.length === 0;

        // 初始化时恢复对话历史
        function initializeHistory() {
            if (initialHistory && initialHistory.length > 0) {
                console.log('从初始状态恢复对话历史，共', initialHistory.length, '条消息');
                messagesContainer.innerHTML = ''; // 清空空状态
                
                initialHistory.forEach(msg => {
                    displayMessage(msg.content, msg.role);
                });
                
                scrollToBottom();
            }
        }

        // 页面加载完成后通知插件
        function notifyWebviewReady() {
            console.log('发送 webviewReady 信号到插件');
            vscode.postMessage({
                command: 'webviewReady'
            });
        }

        // 发送消息
        function sendMessage() {
            const text = messageInput.value.trim();
            if (!text) return;

            // 清空输入框
            messageInput.value = '';
            messageInput.focus();

            // 移除空状态
            if (isFirstMessage) {
                messagesContainer.innerHTML = '';
                isFirstMessage = false;
            }

            // 显示用户消息
            displayMessage(text, 'user');

            // 显示输入中的AI指示器
            showTypingIndicator();

            // 发送消息到插件
            vscode.postMessage({
                command: 'sendMessage',
                text: text
            });
        }

        // 显示消息
        function displayMessage(text, role) {
            const messageEl = document.createElement('div');
            messageEl.className = \`message \${role}\`;

            const icon = role === 'user' ? '👤' : '🤖';
            
            const contentEl = document.createElement('div');
            contentEl.className = 'message-content';
            contentEl.textContent = text;

            const iconEl = document.createElement('div');
            iconEl.className = 'message-icon';
            iconEl.textContent = icon;

            messageEl.appendChild(iconEl);
            messageEl.appendChild(contentEl);

            if (role === 'ai') {
                const actionsEl = document.createElement('div');
                actionsEl.className = 'message-actions';
                actionsEl.innerHTML = \`
                    <button class="action-button" onclick="copyMessage(this)">📋 复制</button>
                    <button class="action-button" onclick="insertMessage(this)">➕ 插入</button>
                \`;
                messageEl.appendChild(actionsEl);
            }

            messagesContainer.appendChild(messageEl);
            scrollToBottom();
        }

        // 显示输入中的指示器
        function showTypingIndicator() {
            const messageEl = document.createElement('div');
            messageEl.className = 'message ai';
            messageEl.id = 'typing-indicator';

            const iconEl = document.createElement('div');
            iconEl.className = 'message-icon';
            iconEl.textContent = '🤖';

            const contentEl = document.createElement('div');
            contentEl.className = 'message-content';
            contentEl.innerHTML = \`
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            \`;

            messageEl.appendChild(iconEl);
            messageEl.appendChild(contentEl);
            messagesContainer.appendChild(messageEl);
            scrollToBottom();
        }

        // 移除输入中的指示器
        function removeTypingIndicator() {
            const indicator = document.getElementById('typing-indicator');
            if (indicator) {
                indicator.remove();
            }
        }

        // 复制消息
        function copyMessage(button) {
            const messageContent = button.parentElement.previousElementSibling.textContent;
            vscode.postMessage({
                command: 'copyToClipboard',
                text: messageContent
            });
        }

        // 插入消息到编辑器
        function insertMessage(button) {
            const messageContent = button.parentElement.previousElementSibling.textContent;
            vscode.postMessage({
                command: 'insertText',
                text: messageContent
            });
        }

        // 清空对话
        function clearHistory() {
            if (confirm('确定要清空所有对话吗？')) {
                messagesContainer.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-icon">🤖</div>
                        <div>
                            <p style="font-weight: 500; margin-bottom: 4px;">欢迎使用 AI 助手</p>
                            <p style="font-size: 12px; opacity: 0.7;">在下方输入框中输入你的问题或需求</p>
                        </div>
                    </div>
                \`;
                isFirstMessage = true;
                messageInput.focus();
                vscode.postMessage({
                    command: 'clearHistory'
                });
            }
        }

        // 滚动到底部
        function scrollToBottom() {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        // 监听来自插件的消息
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'aiResponse':
                    removeTypingIndicator();
                    displayMessage(message.response, 'ai');
                    break;
                case 'error':
                    removeTypingIndicator();
                    displayMessage(\`错误: \${message.error}\`, 'ai');
                    break;
                case 'historyCleared':
                    isFirstMessage = true;
                    break;
            }
        });

        // 事件监听
        sendBtn.addEventListener('click', sendMessage);
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        clearBtn.addEventListener('click', clearHistory);

        // 页面初始化：恢复历史 -> 通知插件 -> 聚焦输入框
        function initializeWebview() {
            console.log('初始化Webview');
            
            // 1. 恢复对话历史
            initializeHistory();
            
            // 2. 通知插件webview已准备好
            notifyWebviewReady();
            
            // 3. 聚焦输入框
            messageInput.focus();
        }

        // 页面加载完成时初始化
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            // 页面已经加载，直接初始化
            initializeWebview();
        } else {
            // 等待页面加载完成后初始化
            window.addEventListener('load', () => {
                initializeWebview();
            });
        }
    </script>
</body>
</html>`;
    }
}

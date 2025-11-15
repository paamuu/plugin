import * as vscode from 'vscode';
import { WebviewView } from 'vscode';
import { StreamProcessor, StreamProcessorOptions } from './streamProcessor';
import { StreamProcessorOptimized, StreamProcessorOptimizedOptions } from './streamProcessorOptimized';
import * as path from 'path';
import * as os from 'os';

export class CaseWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'testCase';
    private streamProcessor: StreamProcessor | null = null;
    private streamProcessorOptimized: StreamProcessorOptimized | null = null;
    private useOptimizedVersion: boolean = true; // 默认使用优化版本（无需修改webview）

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {

        // 设置HTML内容
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 处理来自webview的消息
        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showInformationMessage(message.text);
                        return;
                    case 'startStream':
                        // 启动流式处理
                        await this.handleStartStream(webviewView.webview, message);
                        return;
                    case 'stopStream':
                        // 停止流式处理（快速响应）
                        this.handleStopStream();
                        return;
                    case 'messageAck':
                        // Webview确认收到消息（用于背压控制，仅原版本需要）
                        if (this.streamProcessor && message.count) {
                            this.streamProcessor.handleMessageAck(message.count);
                        }
                        return;
                }
            },
            undefined,
            []
        );
    }

    /**
     * 处理启动流式处理
     */
    private async handleStartStream(webview: vscode.Webview, message: any): Promise<void> {
        try {
            const { url, config, historyFilePath, useOptimized } = message;

            // 如果已有流在处理，先停止
            if (this.streamProcessor) {
                this.streamProcessor.stop();
            }
            if (this.streamProcessorOptimized) {
                this.streamProcessorOptimized.stop();
            }

            // 创建历史记录文件路径（如果未提供）
            const filePath = historyFilePath || path.join(
                os.tmpdir(),
                'vscode-plugin-history',
                `stream-${Date.now()}.jsonl`
            );

            // 根据配置选择使用哪个版本
            const useOptimizedVersion = useOptimized !== false; // 默认使用优化版本

            if (useOptimizedVersion) {
                // 使用优化版本（无需修改webview）
                const options: StreamProcessorOptimizedOptions = {
                    webview: webview,
                    messageType: 'streamData',
                    historyFilePath: filePath,
                    initialBatchSize: message.initialBatchSize || 20,
                    minBatchSize: message.minBatchSize || 5,
                    maxBatchSize: message.maxBatchSize || 100,
                    initialMessageInterval: message.initialMessageInterval || 100,
                    minMessageInterval: message.minMessageInterval || 50,
                    maxMessageInterval: message.maxMessageInterval || 500,
                    maxQueueLength: message.maxQueueLength || 2000,
                    ensureDataIntegrity: message.ensureDataIntegrity !== false, // 默认启用数据完整性保证
                    enableAdaptive: message.enableAdaptive !== false,
                    onData: (data) => {
                        // 可以在这里添加额外的数据处理逻辑
                    },
                    onError: (error) => {
                        vscode.window.showErrorMessage(`流式处理错误: ${error.message}`);
                        webview.postMessage({
                            type: 'streamError',
                            error: error.message,
                            timestamp: Date.now()
                        });
                    },
                    onComplete: () => {
                        webview.postMessage({
                            type: 'streamComplete',
                            timestamp: Date.now()
                        });
                        this.streamProcessorOptimized = null;
                    }
                };

                this.streamProcessorOptimized = new StreamProcessorOptimized(options);
                await this.streamProcessorOptimized.processStream(url, config);
            } else {
                // 使用原版本（需要webview支持消息确认）
                const options: StreamProcessorOptions = {
                    webview: webview,
                    messageType: 'streamData',
                    historyFilePath: filePath,
                    batchSize: message.batchSize || 10,
                    messageInterval: message.messageInterval || 50,
                    enableBackpressure: message.enableBackpressure !== false,
                    onData: (data) => {
                        // 可以在这里添加额外的数据处理逻辑
                    },
                    onError: (error) => {
                        vscode.window.showErrorMessage(`流式处理错误: ${error.message}`);
                        webview.postMessage({
                            type: 'streamError',
                            error: error.message,
                            timestamp: Date.now()
                        });
                    },
                    onComplete: () => {
                        webview.postMessage({
                            type: 'streamComplete',
                            timestamp: Date.now()
                        });
                        this.streamProcessor = null;
                    }
                };

                this.streamProcessor = new StreamProcessor(options);
                await this.streamProcessor.processStream(url, config);
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            vscode.window.showErrorMessage(`启动流式处理失败: ${err.message}`);
            webview.postMessage({
                type: 'streamError',
                error: err.message,
                timestamp: Date.now()
            });
        }
    }

    /**
     * 处理停止流式处理（快速响应）
     */
    private handleStopStream(): void {
        if (this.streamProcessor) {
            // 立即停止，不等待
            this.streamProcessor.stop();
            this.streamProcessor = null;
        }
        if (this.streamProcessorOptimized) {
            // 立即停止，不等待
            this.streamProcessorOptimized.stop();
            this.streamProcessorOptimized = null;
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Case Webview</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
        }
        
        .container {
            max-width: 100%;
            margin: 0 auto;
        }
        
        h1 {
            color: var(--vscode-textLink-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
        
        .card {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 15px;
            margin-bottom: 15px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            margin: 5px;
            transition: background-color 0.2s;
        }
        
        .button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .input {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px;
            border-radius: 4px;
            width: 100%;
            box-sizing: border-box;
            margin: 5px 0;
        }
        
        .input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        
        .status {
            padding: 10px;
            border-radius: 4px;
            margin: 10px 0;
        }
        
        .status.success {
            background-color: var(--vscode-testing-iconPassed);
            color: var(--vscode-foreground);
        }
        
        .status.error {
            background-color: var(--vscode-testing-iconFailed);
            color: var(--vscode-foreground);
        }
        
        .list {
            list-style: none;
            padding: 0;
        }
        
        .list-item {
            padding: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .list-item:last-child {
            border-bottom: none;
        }
        
        .badge {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📋 Case 管理面板</h1>
        <input type="text" class="input" id="caseName" placeholder="输入Case名称">
        <div class="card">
            <h3>快速操作</h3>
            <button class="button" onclick="showAlert('Hello from Case Webview!')">
                显示消息
            </button>
            <button class="button" onclick="refreshData()">
                刷新数据
            </button>
            <button class="button" onclick="openSettings()">
                打开设置
            </button>
        </div>
        
        <div class="card">
            <h3>流式处理</h3>
            <div id="streamStatus" class="status">状态: 未开始</div>
            <button class="button" id="startStreamBtn" onclick="startStream('https://api.example.com/stream', { method: 'POST' })">
                开始流式处理
            </button>
            <button class="button" id="stopStreamBtn" onclick="stopStream()">
                停止流式处理
            </button>
        </div>
        
        <div class="card">
            <h3>添加新Case</h3>
            <input type="text" class="input" id="caseName" placeholder="输入Case名称">
            <input type="text" class="input" id="caseDescription" placeholder="输入Case描述">
            <button class="button" onclick="addCase()">添加Case</button>
        </div>
        
        <div class="card">
            <h3>Case列表</h3>
            <ul class="list" id="caseList">
                <li class="list-item">
                    <span>示例Case 1</span>
                    <span class="badge">进行中</span>
                </li>
                <li class="list-item">
                    <span>示例Case 2</span>
                    <span class="badge">已完成</span>
                </li>
                <li class="list-item">
                    <span>示例Case 3</span>
                    <span class="badge">待处理</span>
                </li>
            </ul>
        </div>
        
        <div class="card">
            <h3>统计信息</h3>
            <div class="status success">
                <strong>总计:</strong> 3 个Case<br>
                <strong>已完成:</strong> 1 个<br>
                <strong>进行中:</strong> 1 个<br>
                <strong>待处理:</strong> 1 个
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // 流式处理状态
        let isStreaming = false;
        let receivedMessageCount = 0;
        let pendingAckCount = 0;
        const MAX_PENDING_ACK = 50; // 最大待确认消息数（背压控制）
        
        // 监听来自插件侧的消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'streamData':
                    // 处理批处理数据
                    if (Array.isArray(message.data)) {
                        message.data.forEach(data => {
                            handleStreamData(data);
                        });
                        receivedMessageCount += message.data.length;
                        pendingAckCount += message.data.length;
                        
                        // 如果待确认消息过多，延迟确认（背压控制）
                        if (pendingAckCount > MAX_PENDING_ACK) {
                            // 延迟发送确认，给webview时间处理消息
                            setTimeout(() => {
                                sendMessageAck(message.data.length);
                                pendingAckCount = Math.max(0, pendingAckCount - message.data.length);
                            }, 100);
                        } else {
                            // 立即发送确认
                            sendMessageAck(message.data.length);
                            pendingAckCount = Math.max(0, pendingAckCount - message.data.length);
                        }
                    }
                    break;
                case 'streamComplete':
                    isStreaming = false;
                    updateStreamStatus('已完成');
                    console.log('流式传输完成，共接收 ' + receivedMessageCount + ' 条消息');
                    break;
                case 'streamStopped':
                    isStreaming = false;
                    updateStreamStatus('已停止');
                    console.log('流式传输已停止');
                    break;
                case 'streamError':
                    isStreaming = false;
                    updateStreamStatus('错误: ' + message.error);
                    console.error('流式传输错误:', message.error);
                    break;
            }
        });
        
        // 处理流式数据
        function handleStreamData(data) {
            // 在这里处理接收到的数据
            // 例如：更新UI、显示内容等
            console.log('收到数据:', data);
        }
        
        // 发送消息确认（用于背压控制）
        function sendMessageAck(count) {
            vscode.postMessage({
                command: 'messageAck',
                count: count
            });
        }
        
        // 更新流状态显示
        function updateStreamStatus(status) {
            const statusElement = document.getElementById('streamStatus');
            if (statusElement) {
                statusElement.textContent = '状态: ' + status;
            }
        }
        
        // 启动流式处理
        function startStream(url, config) {
            if (isStreaming) {
                showAlert('流式处理已在进行中');
                return;
            }
            
            isStreaming = true;
            receivedMessageCount = 0;
            pendingAckCount = 0;
            updateStreamStatus('进行中...');
            
            vscode.postMessage({
                command: 'startStream',
                url: url,
                config: config || {},
                batchSize: 10, // 批处理大小
                messageInterval: 50, // 消息间隔（毫秒）
                enableBackpressure: true // 启用背压控制
            });
        }
        
        // 停止流式处理（快速响应）
        function stopStream() {
            if (!isStreaming) {
                return;
            }
            
            // 立即发送停止命令，不等待
            vscode.postMessage({
                command: 'stopStream'
            });
            
            // 立即更新UI状态，不等待插件响应
            isStreaming = false;
            updateStreamStatus('正在停止...');
        }
        
        function showAlert(message) {
            vscode.postMessage({
                command: 'alert',
                text: message
            });
        }
        
        function refreshData() {
            showAlert('数据已刷新！');
            // 这里可以添加刷新逻辑
        }
        
        function openSettings() {
            showAlert('打开设置功能');
            // 这里可以添加打开设置的逻辑
        }
        
        function addCase() {
            const name = document.getElementById('caseName').value;
            const description = document.getElementById('caseDescription').value;
            
            if (name.trim() === '') {
                showAlert('请输入Case名称');
                return;
            }
            
            // 添加到列表
            const caseList = document.getElementById('caseList');
            const newItem = document.createElement('li');
            newItem.className = 'list-item';
            newItem.innerHTML = \`
                <span>\${name}</span>
                <span class="badge">待处理</span>
            \`;
            caseList.appendChild(newItem);
            
            // 清空输入框
            document.getElementById('caseName').value = '';
            document.getElementById('caseDescription').value = '';
            
            showAlert(\`已添加Case: \${name}\`);
        }
        
        // 页面加载完成后的初始化
        document.addEventListener('DOMContentLoaded', function() {
            console.log('Case Webview 已加载 - 使用 retainContextWhenHidden');
        });
        
        // 导出函数供外部调用
        window.startStream = startStream;
        window.stopStream = stopStream;
    </script>
</body>
</html>`;
    }
}

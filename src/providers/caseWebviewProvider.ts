import * as vscode from 'vscode';
import { WebviewView } from 'vscode';

export class CaseWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'testCase';

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
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showInformationMessage(message.text);
                        return;
                }
            },
            undefined,
            []
        );
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
    </script>
</body>
</html>`;
    }
}

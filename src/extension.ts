import * as vscode from 'vscode';
import { AngularSchematicsProvider } from './providers/angularSchematicsProvider';
import { SchematicsQuickPick } from './ui/schematicsQuickPick';
import * as path from 'path';
import { CaseWebviewProvider } from './providers/caseWebviewProvider';
import { searchWithBuiltinRg } from './providers/vscode-built-in-ripgrep';
import { batchSearchTextWithTimeout } from './providers/batch-search';
import { findFilesByName, findAndDisplayFiles } from './providers/fileFinder';
import { ViewExpander } from './utils/viewExpander';

export function activate(context: vscode.ExtensionContext) {
    console.log('Angular Schematics 扩展已激活');
    
    // 注册Case Webview提供者
    const caseWebviewProvider = new CaseWebviewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(CaseWebviewProvider.viewType, caseWebviewProvider,{
            webviewOptions:{
                // 保持webview折叠不删除html元素
                retainContextWhenHidden:true,
            }
        })
    );

    // 注册一个命令来展开 Case webview（用于测试和手动触发）
    const expandCaseViewCommand = vscode.commands.registerCommand('case.expandView', async () => {
        if (caseWebviewProvider.isResolved()) {
            caseWebviewProvider.show(true);
            vscode.window.showInformationMessage('Case 视图已展开');
        } else {
            vscode.window.showWarningMessage('Case 视图尚未初始化，请先点击一次 Case 视图');
        }
        
    });
    context.subscriptions.push(expandCaseViewCommand);

    // 在插件启动时自动展开 Case webview
    // 
    // ⚠️ 重要限制说明：
    // 1. VS Code 的按需加载机制：WebviewView 只有在首次需要显示时才会调用 resolveWebviewView
    // 2. 如果用户从未点击过 Case 视图，resolveWebviewView 不会被调用，视图无法展开
    // 3. VS Code API 没有提供强制展开 Explorer 中 webview view 的方法
    // 
    // ✅ 当前实现的效果：
    // - 如果视图已解析（用户之前点击过）：可以自动展开
    // - 如果视图未解析（用户从未点击过）：无法自动展开，但会在用户首次点击时自动展开
    // 
    // 📖 详细说明请参考：docs/webview-view-auto-expand-limitations.md
    setTimeout(() => {
        ViewExpander.expandWebviewView(caseWebviewProvider, 25, 200).then(success => {
            if (success) {
                console.log('Case webview 已成功自动展开（视图已解析）');
            } else {
                console.log('Case webview 尚未解析。一旦用户首次点击 Case 视图，它将自动展开（已在 resolveWebviewView 中实现）');
            }
        });
    }, 1200);

    // 创建状态栏项
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(code) Angular Schematics";
    statusBarItem.tooltip = "点击生成 Angular 原理图";
    statusBarItem.command = 'angular-schematics.generate';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // 检查当前工作区是否为 Angular 项目
    checkAngularProject(statusBarItem);

    // 注册命令
    const disposable = vscode.commands.registerCommand('angular-schematics.generate', async (uri?: vscode.Uri) => {
        try {
            // 如果没有提供uri，尝试获取当前工作区
            let workspaceFolder: vscode.WorkspaceFolder | undefined;
            
            if (uri) {
                workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
            } else {
                // 获取当前工作区的第一个文件夹
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    workspaceFolder = workspaceFolders[0];
                }
            }

            if (!workspaceFolder) {
                vscode.window.showErrorMessage('请在Angular项目工作区中执行此命令');
                return;
            }

            const angularJsonPath = vscode.Uri.joinPath(workspaceFolder.uri, 'angular.json');
            try {
                await vscode.workspace.fs.stat(angularJsonPath);
            } catch {
                vscode.window.showErrorMessage('当前项目不是Angular项目，未找到angular.json文件');
                return;
            }

            // 创建schematics提供者
            const schematicsProvider = new AngularSchematicsProvider(workspaceFolder.uri.fsPath);
            
            // 显示schematics选择器
            const quickPick = new SchematicsQuickPick(schematicsProvider);
            await quickPick.show();
            
        } catch (error) {
            vscode.window.showErrorMessage(`执行命令时出错: ${error}`);
        }
    });


     const search =  vscode.commands.registerCommand('extension.searchWithBuiltinRg', async () => {
        searchWithBuiltinRg("viewport");
       const result =  await batchSearchTextWithTimeout(["function test1","abdsd","这是一段测试代码"]);
       console.log(result);
      });
    context.subscriptions.push(disposable);
    context.subscriptions.push(search);

    // 监听工作区变化
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
        checkAngularProject(statusBarItem);
    });
    // 注册命令：显示基于 Webview 的“模态”面板（WebviewPanel）
    const showCaseModal = vscode.commands.registerCommand('case.showModal', async () => {
        const panel = vscode.window.createWebviewPanel(
            'caseModal',
            'Case 对话框',
            { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = getCaseModalHtml(panel.webview, context.extensionUri);

        panel.webview.onDidReceiveMessage((msg) => {
            if (msg?.command === 'close') {
                panel.dispose();
            }
            if (msg?.command === 'confirm') {
                vscode.window.showInformationMessage(`确认: ${msg.payload ?? ''}`);
                panel.dispose();
            }
        });
    });
    context.subscriptions.push(showCaseModal);

    // 原生多步向导（非webview，原生模态交互）
    const showWizard = vscode.commands.registerCommand('case.showWizard', async () => {
        const title = await vscode.window.showInputBox({
            title: 'Case 向导 - 第一步',
            prompt: '请输入标题',
            placeHolder: '标题',
            ignoreFocusOut: true
        });
        if (title === undefined) { return; }

        const desc = await vscode.window.showInputBox({
            title: 'Case 向导 - 第二步',
            prompt: '请输入描述',
            placeHolder: '描述',
            ignoreFocusOut: true,
            value: ''
        });
        if (desc === undefined) { return; }

        const pick = await vscode.window.showQuickPick([
            { label: '确定', description: '提交' },
            { label: '取消', description: '放弃' }
        ], { title: 'Case 向导 - 确认', placeHolder: '请选择', ignoreFocusOut: true });
        if (!pick || pick.label === '取消') { return; }

        vscode.window.showInformationMessage(`已提交: ${title} / ${desc}`);
    });
    context.subscriptions.push(showWizard);

    // 注册文件查找命令
    const findFilesCommand = vscode.commands.registerCommand('extension.findFiles', async () => {
        // 让用户输入要查找的文件名（多个文件名用逗号分隔）
        const input = await vscode.window.showInputBox({
            title: '查找文件',
            prompt: '请输入要查找的文件名（多个文件名用逗号分隔），例如: package.json,tsconfig.json,angular.json',
            placeHolder: 'package.json, tsconfig.json',
            ignoreFocusOut: true
        });

        if (!input) {
            return;
        }

        // 解析输入的文件名
        const fileNames = input
            .split(',')
            .map(name => name.trim())
            .filter(name => name.length > 0);

        if (fileNames.length === 0) {
            vscode.window.showErrorMessage('请输入至少一个文件名');
            return;
        }

        // 显示查找进度
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: '正在查找文件...',
                cancellable: false
            },
            async () => {
                // 查找文件并在输出通道显示结果
                await findAndDisplayFiles(fileNames);
                
                // 同时获取文件列表并显示信息
                const files = await findFilesByName(fileNames);
                if (files.length > 0) {
                    vscode.window.showInformationMessage(
                        `找到 ${files.length} 个文件，详情请查看输出面板`
                    );
                } else {
                    vscode.window.showWarningMessage('未找到任何匹配的文件');
                }
            }
        );
    });
    context.subscriptions.push(findFilesCommand);
}

/**
 * 检查当前工作区是否为 Angular 项目
 */
async function checkAngularProject(statusBarItem?: vscode.StatusBarItem) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        if (statusBarItem) {
            statusBarItem.hide();
        }
        return;
    }

    const workspaceFolder = workspaceFolders[0];
    const angularJsonPath = vscode.Uri.joinPath(workspaceFolder.uri, 'angular.json');
    
    try {
        await vscode.workspace.fs.stat(angularJsonPath);
        console.log('检测到 Angular 项目:', workspaceFolder.name);
        if (statusBarItem) {
            statusBarItem.text = `$(code) Angular Schematics - ${workspaceFolder.name}`;
            statusBarItem.show();
        }
        // 只在首次检测到 Angular 项目时显示提示
        const key = `angularProjectDetected_${workspaceFolder.name}`;
        if (!vscode.workspace.getConfiguration().get(key)) {
            vscode.window.showInformationMessage(`Angular Schematics 插件已激活 - 项目: ${workspaceFolder.name}`);
            vscode.workspace.getConfiguration().update(key, true, vscode.ConfigurationTarget.Workspace);
        }
    } catch {
        console.log('当前项目不是 Angular 项目');
        if (statusBarItem) {
            statusBarItem.hide();
        }
    }
}

export function deactivate() {
    console.log('Angular Schematics 扩展已停用');
}

function getCaseModalHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Case 对话框</title>
  <style>
    body { margin:0; padding:16px; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    .dialog { max-width: 640px; margin: 0 auto; border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 16px; background: var(--vscode-editor-background); }
    h2 { margin-top: 0; }
    .row { margin: 12px 0; }
    input, textarea { width: 100%; box-sizing: border-box; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  </style>
  </head>
  <body>
    <div class="dialog">
      <h2>Case 对话框</h2>
      <div class="row">
        <input id="title" placeholder="标题" />
      </div>
      <div class="row">
        <textarea id="desc" rows="5" placeholder="描述"></textarea>
      </div>
      <div class="actions">
        <button class="secondary" id="cancel">取消</button>
        <button id="ok">确定</button>
      </div>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ command: 'close' }));
      document.getElementById('ok').addEventListener('click', () => {
        const title = document.getElementById('title').value;
        const desc = document.getElementById('desc').value;
        vscode.postMessage({ command: 'confirm', payload: { title, desc } });
      });
    </script>
  </body>
</html>`;
}


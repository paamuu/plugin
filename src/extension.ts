import * as vscode from 'vscode';
import { AngularSchematicsProvider } from './providers/angularSchematicsProvider';
import { SchematicsQuickPick } from './ui/schematicsQuickPick';
import { CaseWebviewProvider } from './providers/caseWebviewProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Angular Schematics 扩展已激活');

    // 注册Case Webview提供者
    const caseWebviewProvider = new CaseWebviewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(CaseWebviewProvider.viewType, caseWebviewProvider)
    );

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

    context.subscriptions.push(disposable);

    // 监听工作区变化
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
        checkAngularProject(statusBarItem);
    });
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

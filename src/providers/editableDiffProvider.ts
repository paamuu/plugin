import * as vscode from 'vscode';
import * as axios from 'axios';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * 可编辑的 Diff 提供者
 * 功能：
 * 1. 使用 vscode.diff 对比本地文件和从接口获取的数据
 * 2. 右侧接口数据可以编辑
 * 3. 编辑后的右侧内容可以保存
 */
export class EditableDiffProvider {
    private static readonly TEMP_DIR = path.join(os.tmpdir(), 'vscode-editable-diff');
    private static tempFileMap = new Map<string, vscode.Uri>(); // API URL -> 临时文件 URI
    private static currentDiffRightUri: vscode.Uri | undefined; // 当前打开的 diff 右侧文件 URI

    /**
     * 注册文档内容提供者
     */
    public static register(context: vscode.ExtensionContext): void {
        // 确保临时目录存在
        if (!fs.existsSync(EditableDiffProvider.TEMP_DIR)) {
            fs.mkdirSync(EditableDiffProvider.TEMP_DIR, { recursive: true });
        }

        // 注册命令：打开可编辑的 diff 视图
        const openDiffCommand = vscode.commands.registerCommand(
            'extension.openEditableDiff',
            async (uri?: vscode.Uri) => {
                await EditableDiffProvider.openEditableDiff(uri);
            }
        );
        context.subscriptions.push(openDiffCommand);

        // 注册命令：保存右侧编辑的内容
        const saveRightCommand = vscode.commands.registerCommand(
            'extension.saveEditableDiffRight',
            async () => {
                await EditableDiffProvider.saveRightContent();
            }
        );
        context.subscriptions.push(saveRightCommand);

        // 监听文档关闭事件，清理临时文件和引用
        const onDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument(async (document) => {
            // 检查是否是临时文件
            if (document.uri.fsPath.startsWith(EditableDiffProvider.TEMP_DIR)) {
                // 如果是当前打开的 diff 右侧文件，清理引用
                if (EditableDiffProvider.currentDiffRightUri && 
                    document.uri.fsPath === EditableDiffProvider.currentDiffRightUri.fsPath) {
                    EditableDiffProvider.currentDiffRightUri = undefined;
                }

                // 延迟删除，给用户一些时间
                setTimeout(async () => {
                    try {
                        // 检查文件是否还在使用中
                        const isOpen = vscode.workspace.textDocuments.some(
                            doc => doc.uri.fsPath === document.uri.fsPath
                        );
                        if (!isOpen) {
                            await vscode.workspace.fs.delete(document.uri, { recursive: false });
                        }
                    } catch (error) {
                        // 忽略删除错误（文件可能已被删除）
                    }
                }, 5000);
            }
        });
        context.subscriptions.push(onDidCloseTextDocument);
    }

    /**
     * 打开可编辑的 diff 视图
     * @param localFileUri 本地文件 URI（可选，如果不提供则让用户选择）
     */
    public static async openEditableDiff(localFileUri?: vscode.Uri): Promise<void> {
        try {
            // 0. 如果已有打开的 diff，先关闭它
            if (EditableDiffProvider.currentDiffRightUri) {
                await EditableDiffProvider.closeCurrentDiff();
            }

            // 1. 获取本地文件
            let leftUri: vscode.Uri;
            if (localFileUri) {
                leftUri = localFileUri;
            } else {
                // 如果没有提供 URI，让用户选择文件
                const fileUri = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    openLabel: '选择要对比的文件'
                });
                if (!fileUri || fileUri.length === 0) {
                    return;
                }
                leftUri = fileUri[0];
            }

            // 2. 显示进度
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: '正在从接口获取数据...',
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ increment: 0 });

                    // 3. 从接口获取数据
                    let apiData: string = 'testadsfasdfasfd';

                    // 4. 创建临时文件存储接口数据（确保可编辑）
                    const tempFileName = `diff-right-${Date.now()}-${Math.random().toString(36).substring(7)}.txt`;
                    const tempFilePath = path.join(EditableDiffProvider.TEMP_DIR, tempFileName);
                    const rightUri = vscode.Uri.file(tempFilePath);

                    // 5. 将接口数据写入临时文件
                    const encoder = new TextEncoder();
                    await vscode.workspace.fs.writeFile(rightUri, encoder.encode(apiData));

                    // 6. 存储映射关系
                    EditableDiffProvider.tempFileMap.set('testkey', rightUri);

                    // 7. 保存当前 diff 的右侧文件 URI
                    EditableDiffProvider.currentDiffRightUri = rightUri;

                    // 8. 打开 diff 视图
                    const fileName = vscode.workspace.asRelativePath(leftUri);
                    const title = `${fileName} ↔ 接口数据`;
                    await vscode.commands.executeCommand(
                        'vscode.diff',
                        leftUri,
                        rightUri,
                        title
                    );

                    vscode.window.showInformationMessage('Diff 视图已打开，右侧内容可以编辑');
                }
            );
        } catch (error: any) {
            vscode.window.showErrorMessage(`打开 Diff 视图失败: ${error.message}`);
        }
    }

    /**
     * 关闭当前打开的 diff 视图
     */
    private static async closeCurrentDiff(): Promise<void> {
        if (!EditableDiffProvider.currentDiffRightUri) {
            return;
        }

        try {
            const rightUri = EditableDiffProvider.currentDiffRightUri;
            const rightUriString = rightUri.toString();
            const rightUriPath = path.normalize(rightUri.fsPath);

            // 方法1: 查找所有标签页，找到包含该文档的标签页并关闭
            const allTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
            for (const tab of allTabs) {
                let shouldClose = false;

                if (tab.input instanceof vscode.TabInputTextDiff) {
                    // 检查是否是包含我们临时文件的 diff 视图
                    const diffInput = tab.input as vscode.TabInputTextDiff;
                    const modifiedPath = path.normalize(diffInput.modified.fsPath);
                    if (diffInput.modified.toString() === rightUriString || 
                        modifiedPath === rightUriPath) {
                        shouldClose = true;
                    }
                } else if (tab.input instanceof vscode.TabInputText) {
                    // 检查是否是临时文件本身
                    const textInput = tab.input as vscode.TabInputText;
                    const textPath = path.normalize(textInput.uri.fsPath);
                    if (textInput.uri.toString() === rightUriString || 
                        textPath === rightUriPath) {
                        shouldClose = true;
                    }
                }

                if (shouldClose) {
                    // 切换到该标签页所在的组，然后关闭
                    const group = vscode.window.tabGroups.all.find(g => g.tabs.includes(tab));
                    if (group) {
                        // 切换到该组
                        const groupIndex = vscode.window.tabGroups.all.indexOf(group);
                        await vscode.commands.executeCommand('workbench.action.focusTabGroup', groupIndex + 1);
                        // 切换到该标签页
                        const tabIndex = group.tabs.indexOf(tab);
                        await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', tabIndex + 1);
                        // 关闭当前活动的编辑器
                        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                        break;
                    }
                }
            }

            // 方法2: 如果方法1没有成功，尝试通过关闭文档来关闭编辑器
            const doc = vscode.workspace.textDocuments.find(
                d => path.normalize(d.uri.fsPath) === rightUriPath
            );
            if (doc) {
                // 尝试关闭包含该文档的所有编辑器
                const editors = vscode.window.visibleTextEditors.filter(
                    e => path.normalize(e.document.uri.fsPath) === rightUriPath
                );
                for (const editor of editors) {
                    await vscode.window.showTextDocument(editor.document, { preview: false });
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                }
            }

            // 清理引用
            EditableDiffProvider.currentDiffRightUri = undefined;
        } catch (error) {
            // 忽略关闭错误，继续打开新的 diff
            console.warn('关闭之前的 diff 视图时出错:', error);
            EditableDiffProvider.currentDiffRightUri = undefined;
        }
    }


    /**
     * 保存右侧编辑的内容
     */
    public static async saveRightContent(): Promise<void> {
        try {
            // 查找所有打开的临时文件（diff 右侧文件）
            const tempDocuments = vscode.workspace.textDocuments.filter(doc => {
                const docPath = doc.uri.fsPath;
                const tempDir = EditableDiffProvider.TEMP_DIR;
                // 使用规范化路径进行比较，确保跨平台兼容
                return path.normalize(docPath).startsWith(path.normalize(tempDir));
            });

            if (tempDocuments.length === 0) {
                vscode.window.showWarningMessage('没有找到可编辑的 diff 右侧文档');
                return;
            }

            let targetDocument: vscode.TextDocument;

            if (tempDocuments.length === 1) {
                // 只有一个临时文件，直接使用
                targetDocument = tempDocuments[0];
            } else {
                // 多个临时文件，让用户选择
                const items = tempDocuments.map(doc => ({
                    label: `临时文件: ${path.basename(doc.uri.fsPath)}`,
                    description: doc.uri.fsPath,
                    document: doc
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: '选择要保存的文档'
                });

                if (!selected) {
                    return;
                }

                targetDocument = selected.document;
            }

            // 获取编辑后的内容
            const editedContent = targetDocument.getText();

            // 让用户选择保存位置
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('edited-content.txt'),
                filters: {
                    'Text files': ['txt'],
                    'All files': ['*']
                },
                saveLabel: '保存'
            });

            if (!saveUri) {
                return;
            }

            // 保存文件
            const encoder = new TextEncoder();
            const data = encoder.encode(editedContent);
            await vscode.workspace.fs.writeFile(saveUri, data);

            vscode.window.showInformationMessage(`内容已保存到: ${vscode.workspace.asRelativePath(saveUri)}`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`保存失败: ${error.message}`);
        }
    }
}


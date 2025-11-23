import * as vscode from 'vscode';

/**
 * 视图展开工具类
 * 用于通过编码方式展开 Explorer 中的视图项
 */
export class ViewExpander {
    /**
     * 展开 Explorer 中的指定视图
     * @param viewId 视图 ID（在 package.json 中定义的 views.explorer[].id）
     * @param maxAttempts 最大尝试次数
     * @param interval 每次尝试的间隔（毫秒）
     * @returns 是否成功展开
     */
    static async expandExplorerView(
        viewId: string,
        maxAttempts: number = 20,
        interval: number = 200
    ): Promise<boolean> {
        try {
            // 步骤1: 确保 Explorer 视图可见
            await vscode.commands.executeCommand('workbench.view.explorer');
            await new Promise(resolve => setTimeout(resolve, 300));

            // 步骤2: 聚焦侧边栏
            await vscode.commands.executeCommand('workbench.action.focusSideBar');
            await new Promise(resolve => setTimeout(resolve, 200));

            // 步骤3: 尝试通过命令展开视图
            // 注意：对于 webview view，可能需要视图已解析才能展开
            let success = false;
            for (let i = 0; i < maxAttempts; i++) {
                try {
                    // 尝试执行视图相关的命令
                    // 对于某些视图类型，可能有特定的命令
                    await vscode.commands.executeCommand(`workbench.view.extension.${viewId}`);
                    success = true;
                    break;
                } catch (e) {
                    // 命令不存在，继续尝试其他方法
                }

                // 每隔几次尝试，重新聚焦侧边栏
                if (i % 5 === 0 && i > 0) {
                    await vscode.commands.executeCommand('workbench.action.focusSideBar');
                }

                await new Promise(resolve => setTimeout(resolve, interval));
            }

            return success;
        } catch (error) {
            console.error(`展开视图 ${viewId} 时出错:`, error);
            return false;
        }
    }

    /**
     * 展开 WebviewView（需要提供 WebviewViewProvider 实例）
     * @param provider WebviewViewProvider 实例（需要实现 isResolved 和 show 方法）
     * @param maxAttempts 最大尝试次数
     * @param interval 每次尝试的间隔（毫秒）
     * @returns 是否成功展开
     */
    static async expandWebviewView(
        provider: { isResolved(): boolean; show(preserveFocus?: boolean): void },
        maxAttempts: number = 25,
        interval: number = 200
    ): Promise<boolean> {
        try {
            // 确保 Explorer 视图可见
            await vscode.commands.executeCommand('workbench.view.explorer');
            await new Promise(resolve => setTimeout(resolve, 500));

            // 聚焦侧边栏
            await vscode.commands.executeCommand('workbench.action.focusSideBar');
            await new Promise(resolve => setTimeout(resolve, 300));

            // 等待视图解析并展开
            for (let i = 0; i < maxAttempts; i++) {
                if (provider.isResolved()) {
                    provider.show(true);
                    console.log(`Webview 视图已展开（第 ${i + 1} 次尝试）`);
                    return true;
                }

                // 每隔几次尝试，重新聚焦侧边栏
                if (i % 5 === 0 && i > 0) {
                    await vscode.commands.executeCommand('workbench.action.focusSideBar');
                }

                await new Promise(resolve => setTimeout(resolve, interval));
            }

            console.log('Webview 视图尚未解析，将在首次点击时自动展开');
            return false;
        } catch (error) {
            console.error('展开 Webview 视图时出错:', error);
            return false;
        }
    }

    /**
     * 展开 TreeView（如果视图已注册）
     * @param viewId 视图 ID
     * @param item 要展开的树项（可选）
     * @returns 是否成功
     */
    static async expandTreeView(
        viewId: string,
        item?: vscode.TreeItem
    ): Promise<boolean> {
        try {
            // 确保视图容器可见
            await vscode.commands.executeCommand(`workbench.view.extension.${viewId}`);
            await new Promise(resolve => setTimeout(resolve, 300));

            // 如果提供了树项，尝试展开它
            if (item) {
                // 这里需要获取 TreeView 实例，但通常需要在扩展中保存引用
                // 所以这个方法可能需要扩展来提供 TreeView 实例
            }

            return true;
        } catch (error) {
            console.error(`展开 TreeView ${viewId} 时出错:`, error);
            return false;
        }
    }
}


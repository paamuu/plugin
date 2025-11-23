import * as vscode from 'vscode';
import * as path from 'path';

/**
 * 使用 vscode.workspace.findFiles() 查找指定文件名称的文件
 * 支持多个文件名称的查找
 * 
 * @param fileNames 要查找的文件名称数组，例如: ['package.json', 'tsconfig.json', 'angular.json']
 * @param excludePattern 排除模式，默认为排除 node_modules 和 .git 目录
 * @returns 返回找到的文件 URI 数组
 */
export async function findFilesByName(
    fileNames: string[],
    excludePattern?: string
): Promise<vscode.Uri[]> {
    if (!fileNames || fileNames.length === 0) {
        return [];
    }

    // 默认排除 node_modules 和 .git 目录
    const defaultExclude = '**/{node_modules,.git}/**';
    const exclude = excludePattern || defaultExclude;

    // 存储所有找到的文件
    const foundFiles: vscode.Uri[] = [];

    // 为每个文件名创建查找任务
    const searchPromises = fileNames.map(async (fileName) => {
        try {
            // 使用 glob 模式查找文件，支持精确文件名匹配
            // 使用 **/{fileName} 模式可以查找任何目录下的该文件
            const pattern = `**/${fileName}`;
            const files = await vscode.workspace.findFiles(
                pattern,
                exclude,
                undefined // 不限制结果数量
            );
            return files;
        } catch (error) {
            console.error(`查找文件 ${fileName} 时出错:`, error);
            return [];
        }
    });

    // 等待所有查找任务完成
    const results = await Promise.all(searchPromises);

    // 合并所有结果并去重（基于文件路径）
    const uniqueFiles = new Map<string, vscode.Uri>();
    results.forEach(files => {
        files.forEach(file => {
            const key = file.fsPath;
            if (!uniqueFiles.has(key)) {
                uniqueFiles.set(key, file);
                foundFiles.push(file);
            }
        });
    });

    return foundFiles;
}

/**
 * 查找文件并返回详细信息（包括路径、大小等）
 * 
 * @param fileNames 要查找的文件名称数组
 * @param excludePattern 排除模式
 * @returns 返回文件详细信息数组
 */
export async function findFilesWithDetails(
    fileNames: string[],
    excludePattern?: string
): Promise<Array<{ uri: vscode.Uri; path: string; name: string; size?: number }>> {
    const files = await findFilesByName(fileNames, excludePattern);
    
    const details = await Promise.all(
        files.map(async (uri) => {
            try {
                const stat = await vscode.workspace.fs.stat(uri);
                return {
                    uri,
                    path: uri.fsPath,
                    name: path.basename(uri.fsPath),
                    size: stat.size
                };
            } catch (error) {
                return {
                    uri,
                    path: uri.fsPath,
                    name: path.basename(uri.fsPath),
                    size: undefined
                };
            }
        })
    );

    return details;
}

/**
 * 在输出通道中显示查找结果
 * 
 * @param fileNames 要查找的文件名称数组
 * @param outputChannel 输出通道（可选）
 */
export async function findAndDisplayFiles(
    fileNames: string[],
    outputChannel?: vscode.OutputChannel
): Promise<void> {
    const channel = outputChannel || vscode.window.createOutputChannel('文件查找');
    
    channel.clear();
    channel.appendLine(`开始查找文件: ${fileNames.join(', ')}`);
    channel.appendLine('');

    const files = await findFilesByName(fileNames);

    if (files.length === 0) {
        channel.appendLine('未找到任何匹配的文件');
        channel.show();
        return;
    }

    channel.appendLine(`找到 ${files.length} 个文件:`);
    channel.appendLine('');

    files.forEach((file, index) => {
        channel.appendLine(`${index + 1}. ${file.fsPath}`);
    });

    channel.show();
}


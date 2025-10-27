/**
 * VS Code 搜索扩展 - 简化实用版本
 * 
 * 这是一个可以直接使用的简化版本，展示了核心功能
 */

import * as vscode from 'vscode';
import { rgPath } from '@vscode/ripgrep';
import { spawn } from 'child_process';
import * as path from 'path';

/**
 * 简化的搜索服务
 */
class SimpleSearchService {
  /**
   * 执行搜索
   */
  async searchInWorkspace(query: string): Promise<SearchResult[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error('没有打开的工作区');
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    
    // 构建 ripgrep 命令
    const args = [
      '--line-number',
      '--column',
      '--json',  // 使用 JSON 格式输出
      query,
      rootPath
    ];

    return new Promise((resolve, reject) => {
      const rg = spawn(rgPath, args, { cwd: rootPath });
      const results: SearchResult[] = [];
      
      let buffer = '';

      rg.stdout.on('data', (data) => {
        buffer += data.toString();
        
        // 解析 JSON 行
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const result = JSON.parse(line);
              if (result.type === 'match') {
                results.push({
                  file: vscode.Uri.file(result.data.path.text),
                  line: result.data.line_number - 1,
                  column: result.data.submatches[0].start,
                  matchText: result.data.lines.text.trim(),
                  preview: this.getPreview(result.data.lines.text, result.data.submatches[0])
                });
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      });

      rg.on('close', (code) => {
        if (code === 0 || results.length > 0) {
          resolve(results);
        } else {
          reject(new Error(`搜索失败，退出码: ${code}`));
        }
      });

      rg.on('error', reject);
    });
  }

  /**
   * 获取匹配内容的预览
   */
  private getPreview(lineText: string, match: any): string {
    const start = Math.max(0, match.start - 20);
    const end = Math.min(lineText.length, match.end + 20);
    return lineText.substring(start, end).trim();
  }
}

interface SearchResult {
  file: vscode.Uri;
  line: number;
  column: number;
  matchText: string;
  preview: string;
}

/**
 * 激活扩展
 */
export function activate(context: vscode.ExtensionContext) {
  const searchService = new SimpleSearchService();

  // 注册搜索命令
  const searchCommand = vscode.commands.registerCommand('extension.simpleSearch', async () => {
    // 输入搜索词
    const query = await vscode.window.showInputBox({
      prompt: '输入搜索词',
      placeHolder: '支持正则表达式'
    });

    if (!query) {
      return;
    }

    // 显示进度
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: '正在搜索...',
      cancellable: true
    }, async (progress, token) => {
      try {
        const results = await searchService.searchInWorkspace(query);
        
        if (results.length === 0) {
          vscode.window.showInformationMessage(`未找到匹配项: "${query}"`);
          return;
        }

        // 在输出面板显示结果
        const outputChannel = vscode.window.createOutputChannel('搜索结果');
        outputChannel.clear();
        outputChannel.appendLine(`找到 ${results.length} 个匹配项:\n`);

        const fileMap = new Map<string, SearchResult[]>();
        for (const result of results) {
          const key = result.file.fsPath;
          if (!fileMap.has(key)) {
            fileMap.set(key, []);
          }
          fileMap.get(key)!.push(result);
        }

        for (const [file, matches] of fileMap.entries()) {
          outputChannel.appendLine(`${file}:`);
          for (const match of matches) {
            outputChannel.appendLine(`  ${match.line + 1}: ${match.matchText}`);
          }
          outputChannel.appendLine('');
        }

        outputChannel.show();

        // 创建快速选择列表
        const items = Array.from(fileMap.entries()).map(([file, matches]) => ({
          label: path.basename(file),
          description: `${matches.length} 个匹配项`,
          detail: file
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: '选择一个文件查看结果'
        });

        if (selected) {
          const matches = fileMap.get(selected.detail!);
          if (matches && matches.length > 0) {
            // 打开文件并跳转到第一个匹配项
            const document = await vscode.workspace.openTextDocument(matches[0].file);
            const editor = await vscode.window.showTextDocument(document);
            
            const position = new vscode.Position(matches[0].line, matches[0].column);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
          }
        }
      } catch (error) {
        vscode.window.showErrorMessage(`搜索失败: ${error}`);
      }
    });
  });

  context.subscriptions.push(searchCommand);

  console.log('简化的搜索扩展已激活');
}

/**
 * 停用扩展
 */
export function deactivate() {
  console.log('简化的搜索扩展已停用');
}

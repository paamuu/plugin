/**
 * 批量搜索使用示例
 * 
 * 该示例展示了如何使用单进程批量搜索多个文本。
 * 所有搜索在单个 ripgrep 进程中完成，返回结果与输入一一对应。
 */

import * as vscode from 'vscode';
import { batchSearchText, batchSearchTextWithTimeout } from '../src/providers/batch-search';

/**
 * 示例：批量搜索多个文本
 */
export async function batchSearchExample() {
  try {
    // 搜索多个关键词
    const queries = ['import', 'export', 'class', 'function', 'interface'];
    const results = await batchSearchText(queries);

    console.log('批量搜索结果:');
    results.forEach((result, index) => {
      console.log(`\n查询: "${queries[index]}"`);
      if (result) {
        console.log(`  找到文件: ${result.uri.fsPath}`);
        console.log(`  行号: ${result.line + 1}, 列号: ${result.column + 1}`);
        console.log(`  预览: ${result.preview}`);
      } else {
        console.log('  未找到匹配');
      }
    });
  } catch (error) {
    console.error('批量搜索失败:', error);
  }
}

/**
 * 示例：批量搜索带超时控制
 */
export async function batchSearchWithTimeoutExample() {
  try {
    const queries = ['Component', 'Directive', 'Module'];
    const results = await batchSearchTextWithTimeout(queries, 5000);

    console.log('带超时的批量搜索结果:');
    results.forEach((result, index) => {
      console.log(`\n查询: "${queries[index]}"`);
      if (result) {
        console.log(`  找到文件: ${result.uri.fsPath}`);
        console.log(`  行号: ${result.line + 1}, 列号: ${result.column + 1}`);
        console.log(`  预览: ${result.preview}`);
      } else {
        console.log('  未找到或超时');
      }
    });
  } catch (error) {
    console.error('批量搜索失败:', error);
  }
}

/**
 * 示例：在 VS Code 扩展中使用批量搜索
 */
export async function activateBatchSearch(context: vscode.ExtensionContext) {
  // 注册命令
  const disposable = vscode.commands.registerCommand(
    'extension.batchSearch',
    async () => {
      // 从用户输入获取搜索关键词
      const input = await vscode.window.showInputBox({
        prompt: '请输入要搜索的关键词（用逗号分隔）',
        placeHolder: '例如: import,export,class'
      });

      if (!input) {
        return;
      }

      // 解析输入
      const queries = input.split(',').map(q => q.trim()).filter(q => q.length > 0);
      
      if (queries.length === 0) {
        vscode.window.showWarningMessage('请输入至少一个搜索关键词');
        return;
      }

      // 执行批量搜索
      try {
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '批量搜索中...',
            cancellable: false
          },
          async () => {
            const results = await batchSearchText(queries);

            // 显示结果
            const items = results.map((result, index) => {
              if (result) {
                return `${index + 1}. "${queries[index]}" → ${result.uri.fsPath} (${result.line + 1}:${result.column + 1})`;
              } else {
                return `${index + 1}. "${queries[index]}" → 未找到`;
              }
            });

            vscode.window.showInformationMessage(
              `搜索完成\n${items.join('\n')}`,
              '查看结果'
            );
          }
        );
      } catch (error) {
        vscode.window.showErrorMessage(`搜索失败: ${error}`);
      }
    }
  );

  context.subscriptions.push(disposable);
}


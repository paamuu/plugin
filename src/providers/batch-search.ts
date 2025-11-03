/**
 * 批量文本搜索
 *
 * 该文件实现了一次搜索多个文本的功能，返回与入参一一对应的搜索结果。
 * 如果某个文本未找到，对应位置返回 null。
 * 如果某个文本有多个匹配结果，只返回第一个（最匹配的）结果。
 */

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface SearchResultItem {
  uri: vscode.Uri;
  line: number;
  column: number;
  preview: string;
}

/**
 * 解析 VS Code 安装目录内置的 ripgrep 路径。
 */
function resolveBuiltinRgPath(): string {
  const exeName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const appRoot = vscode.env.appRoot;

  const candidates = [
    path.join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', exeName),
    path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', exeName),
    path.join(appRoot, 'node_modules', 'vscode-ripgrep', 'bin', exeName),
    path.join(appRoot, 'node_modules.asar.unpacked', 'vscode-ripgrep', 'bin', exeName)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('无法定位 VS Code 自带的 ripgrep 可执行文件');
}


/**
 * 批量搜索多个文本（单进程实现）
 *
 * 使用 ripgrep 的 OR 模式在单个进程中搜索多个模式
 *
 * @param queries 要搜索的文本数组
 * @returns 与 queries 一一对应的搜索结果数组，未找到的位置为 null
 *
 * @example
 * ```typescript
 * const results = await batchSearchText(['import', 'export', 'class']);
 * // results 可能是: [result1, null, result3]
 * ```
 */
export async function batchSearchText(queries: string[]): Promise<(SearchResultItem | null)[]> {
  if (!queries || queries.length === 0) {
    return [];
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('请先打开一个工作区');
  }

  const rgPath = resolveBuiltinRgPath();
  const cwd = workspaceFolders[0].uri.fsPath;
  
  // 转义特殊字符并构建 OR 模式的正则表达式
  const escapedQueries = queries.map((q) => {
    // 转义正则表达式特殊字符
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped;
  });
  const orPattern = escapedQueries.join('|');
  
  // ripgrep 参数
  const args = ['--json', '--line-number', '--column', orPattern, cwd];

  return new Promise((resolve, reject) => {
    // 为每个查询维护第一个匹配结果
    const firstMatches: (SearchResultItem | null)[] = queries.map(() => null);
    
    const rg = spawn(rgPath, args, { cwd });
    let buffer = '';

    rg.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'match') {
            const matchData = parsed.data;
            const lineText = matchData.lines.text;
            
            // 查找这个匹配属于哪个查询
            for (let i = 0; i < queries.length; i++) {
              // 如果这个查询还没有结果
              if (firstMatches[i] === null) {
                // 检查这行是否包含这个查询
                const query = queries[i];
                const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(escapedQuery);
                if (regex.test(lineText)) {
                  // 找到匹配位置
                  const matchIndex = lineText.search(regex);
                  firstMatches[i] = {
                    uri: vscode.Uri.file(matchData.path.text),
                    line: matchData.line_number - 1,
                    column: matchIndex,
                    preview: lineText.trim()
                  };
                  break; // 为第一个未匹配的查询找到结果
                }
              }
            }
            
            // 检查是否所有查询都有结果了
            if (firstMatches.every(result => result !== null)) {
              rg.kill();
              resolve(firstMatches);
              return;
            }
          }
        } catch (error) {
          console.warn('解析 ripgrep 输出失败:', error);
        }
      }
    });

    rg.stderr.on('data', (chunk) => {
      console.error('ripgrep 错误输出:', chunk.toString());
    });

    rg.on('close', (code) => {
      // ripgrep 退出码 0 或 1 都是正常的（1 表示没找到匹配）
      if (code === 0 || code === 1) {
        resolve(firstMatches);
      } else {
        reject(new Error(`ripgrep 退出码: ${code}`));
      }
    });

    rg.on('error', reject);
  });
}

/**
 * 批量搜索多个文本（带超时控制）
 *
 * @param queries 要搜索的文本数组
 * @param timeoutMs 整个搜索的超时时间（毫秒），默认 10 秒
 * @returns 与 queries 一一对应的搜索结果数组，未找到或超时的位置为 null
 */
export async function batchSearchTextWithTimeout(
  queries: string[],
  timeoutMs: number = 10000
): Promise<(SearchResultItem | null)[]> {
  if (!queries || queries.length === 0) {
    return [];
  }

  try {
    const result = await Promise.race([
      batchSearchText(queries),
      new Promise<(SearchResultItem | null)[]>((resolve) => 
        setTimeout(() => {
          console.warn('批量搜索超时');
          resolve(queries.map(() => null));
        }, timeoutMs)
      )
    ]);
    return result;
  } catch (error) {
    console.error('批量搜索失败:', error);
    throw error;
  }
}


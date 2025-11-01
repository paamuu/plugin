/**
 * VS Code 自带 ripgrep 调用示例
 *
 * 该文件展示如何在扩展中复用 VS Code 内建的 ripgrep 可执行文件，
 * 无需额外安装 `@vscode/ripgrep` 依赖，即可在工作区执行文本搜索。
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
 * 利用外部 ripgrep 进程完成搜索。
 */
async function searchWithBuiltinRg(query: string): Promise<SearchResultItem[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('请先打开一个工作区');
  }

  const rgPath = resolveBuiltinRgPath();
  const cwd = workspaceFolders[0].uri.fsPath;
  const args = ['--json', '--line-number', '--column', query, cwd];

  return new Promise((resolve, reject) => {
    const results: SearchResultItem[] = [];
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
            const match = parsed.data.submatches[0];
            results.push({
              uri: vscode.Uri.file(parsed.data.path.text),
              line: parsed.data.line_number - 1,
              column: match.start,
              preview: parsed.data.lines.text.trim()
            });
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
      if (code === 0) {
        resolve(results);
        return;
      }
      if (code === 1 && results.length === 0) {
        resolve([]);
        return;
      }
      if (results.length > 0) {
        resolve(results);
        return;
      }
      reject(new Error(`ripgrep 退出码: ${code}`));
    });

    rg.on('error', reject);
  });
}



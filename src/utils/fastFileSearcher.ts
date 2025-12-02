import * as vscode from 'vscode';
import * as fs from 'fs/promises';

/**
 * 在大量本地文件中按内容进行快速查找（不依赖 ripgrep/ipc）。
 *
 * 主要优化点：
 * - 使用 Node.js 原生 fs 直接读本地文件，避免 vscode.workspace.fs 的额外 IPC 开销；
 * - 通过受控的最大并发（maxConcurrency）批量读取，充分利用 IO，而不把事件循环“打爆”；
 * - 可指定最大结果数量，命中足够后提前停止。
 */
export class FastFileSearcher {
  private readonly textDecoder = new TextDecoder('utf-8');

  constructor(
    private readonly workspace: typeof vscode.workspace = vscode.workspace,
  ) {}

  /**
   * 在工作区中按内容查找文件。
   *
   * @param query 要查找的内容，可以是字符串或正则。
   * @param options 其它可选项。
   */
  async search(
    query: string | RegExp,
    options?: {
      include?: string; // e.g. '**/*.ts'
      exclude?: string; // e.g. '**/node_modules/**'
      maxResults?: number;
      maxConcurrency?: number;
    },
  ): Promise<string[]> {
    const {
      include = '**/*',
      exclude = '**/node_modules/**',
      maxResults = Infinity,
      maxConcurrency = 64,
    } = options ?? {};

    const uris = await this.workspace.findFiles(include, exclude);
    if (!uris.length) {
      return [];
    }

    const matcher =
      typeof query === 'string'
        ? (text: string) => text.includes(query)
        : (text: string) => query.test(text);

    const results: string[] = [];
    let index = 0;
    let stopped = false;

    const worker = async () => {
      while (!stopped) {
        const currentIndex = index++;
        if (currentIndex >= uris.length) {
          return;
        }
        const uri = uris[currentIndex];

        try {
          // 使用 Node fs 直接读本地文件，通常比 vscode.workspace.fs 更快
          const buffer = await fs.readFile(uri.fsPath);
          const text = this.textDecoder.decode(buffer);

          if (matcher(text)) {
            results.push(uri.fsPath);
            if (results.length >= maxResults) {
              stopped = true;
              return;
            }
          }
        } catch (err) {
          // 忽略单个文件读取失败，继续其它文件
          console.warn('[FastFileSearcher] 读取失败: ', uri.fsPath, err);
        }
      }
    };

    const concurrency = Math.min(maxConcurrency, uris.length);
    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    return results;
  }
}

/**
 * 使用示例（在 extension.ts 中）：
 *
 * const searcher = new FastFileSearcher(vscode.workspace);
 * const files = await searcher.search('要查找的字符串', {
 *   include: '**/*.ts',
 *   exclude: '**/node_modules/**',
 *   maxResults: 100,
 *   maxConcurrency: 64,
 * });
 * // files 即为命中的文件绝对路径数组
 */



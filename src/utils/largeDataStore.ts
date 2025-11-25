import * as vscode from 'vscode';

/**
 * 大数据量存储场景下，不要直接依赖 `context.globalState`。
 * 该类通过 `globalStorageUri` 下的文件异步读写，实现低延迟的持久化。
 */
export class LargeDataStore<T extends Record<string, unknown> = Record<string, unknown>> {
  private readonly fileUri: vscode.Uri;
  private readonly flushDelay: number;
  private cache: T = {} as T;
  private flushTimer?: NodeJS.Timeout;
  private initialized: Promise<void>;
  private isDisposed = false;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly context: vscode.ExtensionContext,
    options?: { fileName?: string; flushDelay?: number },
  ) {
    this.fileUri = vscode.Uri.joinPath(
      context.globalStorageUri,
      options?.fileName ?? 'large-data.json',
    );
    this.flushDelay = options?.flushDelay ?? 150;
    this.initialized = this.initialize();
  }

  /**
   * 读取某个 key（确保初始化完成）。
   */
  async get<K extends keyof T>(key: K): Promise<T[K]> {
    await this.initialized;
    return this.cache[key];
  }

  /**
   * 设置并延迟写入文件。
   */
  async set<K extends keyof T>(key: K, value: T[K]): Promise<void> {
    await this.initialized;
    this.cache[key] = value;
    this.scheduleFlush();
  }

  /**
   * 删除数据。
   */
  async delete<K extends keyof T>(key: K): Promise<void> {
    await this.initialized;
    delete this.cache[key];
    this.scheduleFlush();
  }

  /**
   * 获取完整数据快照（只读）。
   */
  async getAll(): Promise<Readonly<T>> {
    await this.initialized;
    return Object.freeze({ ...this.cache });
  }

  /**
   * 释放资源并确保写入完成，可在 extension deactivate 时调用。
   */
  async dispose(): Promise<void> {
    this.isDisposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.pendingWrite;
    await this.flush();
  }

  private async initialize(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    try {
      const bytes = await vscode.workspace.fs.readFile(this.fileUri);
      const json = Buffer.from(bytes).toString('utf8');
      this.cache = json ? (JSON.parse(json) as T) : ({} as T);
    } catch (err) {
      if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
        this.cache = {} as T;
        return;
      }
      console.warn('[LargeDataStore] 初始化失败', err);
      this.cache = {} as T;
    }
  }

  private scheduleFlush(): void {
    if (this.isDisposed || this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.pendingWrite = this.flush();
    }, this.flushDelay);
  }

  private async flush(): Promise<void> {
    if (this.isDisposed) {
      return;
    }
    await vscode.workspace.fs.writeFile(
      this.fileUri,
      Buffer.from(JSON.stringify(this.cache)),
    );
  }
}

/**
 * 使用示例：
 *
 * const store = new LargeDataStore(context, { fileName: 'search-cache.json' });
 * await store.set('bigKey', hugeObject);
 * const cached = await store.get('bigKey');
 * await store.dispose(); // 在 deactivate 时调用
 */


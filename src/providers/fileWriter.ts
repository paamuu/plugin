/**
 * 高性能异步文件写入模块
 * 解决高频率文件写入导致VSCode崩溃的问题
 * 
 * 核心特性：
 * 1. 异步队列：所有写入操作异步执行，不阻塞主进程
 * 2. 批量写入：累积数据后批量写入，减少I/O操作
 * 3. 流式写入：使用WriteStream提高性能
 * 4. 错误隔离：写入错误不影响主进程
 * 5. 自动重试：写入失败时自动重试
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

/**
 * 文件写入选项
 */
export interface FileWriterOptions {
  /** 文件路径 */
  filePath: string;
  /** 批量写入大小（字节），默认64KB */
  batchSize?: number;
  /** 批量写入时间间隔（毫秒），默认1000ms */
  flushInterval?: number;
  /** 是否立即刷新到磁盘，默认false（性能更好） */
  autoFlush?: boolean;
  /** 最大队列长度，超过此长度将丢弃旧数据，默认10000 */
  maxQueueLength?: number;
  /** 队列满时的策略：'drop'丢弃旧数据，'wait'等待，默认'wait' */
  queueFullStrategy?: 'drop' | 'wait';
  /** 写入失败重试次数，默认3次 */
  maxRetries?: number;
  /** 重试间隔（毫秒），默认100ms */
  retryInterval?: number;
  /** 错误回调 */
  onError?: (error: Error) => void;
}

/**
 * 写入队列项
 */
interface WriteQueueItem {
  data: string;
  timestamp: number;
  retries: number;
}

/**
 * 高性能异步文件写入器
 */
export class FileWriter extends EventEmitter {
  private writeQueue: WriteQueueItem[] = [];
  private writeStream: fs.WriteStream | null = null;
  private isWriting: boolean = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private currentBuffer: string = '';
  private totalBytesWritten: number = 0;
  private totalWrites: number = 0;
  private totalErrors: number = 0;
  private isClosed: boolean = false;

  private readonly filePath: string;
  private readonly batchSize: number;
  private readonly flushInterval: number;
  private readonly autoFlush: boolean;
  private readonly maxQueueLength: number;
  private readonly queueFullStrategy: 'drop' | 'wait';
  private readonly maxRetries: number;
  private readonly retryInterval: number;
  private readonly onError?: (error: Error) => void;

  constructor(options: FileWriterOptions) {
    super();
    
    this.filePath = options.filePath;
    this.batchSize = options.batchSize || 64 * 1024; // 64KB
    this.flushInterval = options.flushInterval || 1000; // 1秒
    this.autoFlush = options.autoFlush || false;
    this.maxQueueLength = options.maxQueueLength || 10000;
    this.queueFullStrategy = options.queueFullStrategy || 'wait';
    this.maxRetries = options.maxRetries || 3;
    this.retryInterval = options.retryInterval || 100;
    this.onError = options.onError;

    // 确保目录存在
    this.ensureDirectory();
    
    // 初始化写入流
    this.initializeStream();
    
    // 启动定时刷新
    this.startFlushTimer();
  }

  /**
   * 确保目录存在
   */
  private async ensureDirectory(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      await fs.promises.mkdir(dir, { recursive: true });
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 初始化写入流
   */
  private initializeStream(): void {
    try {
      // 使用追加模式打开文件流
      this.writeStream = fs.createWriteStream(this.filePath, {
        flags: 'a', // 追加模式
        encoding: 'utf8',
        autoClose: false, // 保持流打开
        highWaterMark: this.batchSize // 设置缓冲区大小
      });

      // 监听错误事件
      this.writeStream.on('error', (error: Error) => {
        this.handleError(error);
        // 尝试重新初始化流
        this.reinitializeStream();
      });

      // 监听drain事件（缓冲区已清空）
      this.writeStream.on('drain', () => {
        this.isWriting = false;
        // 继续处理队列
        this.processQueue();
      });

      // 监听finish事件
      this.writeStream.on('finish', () => {
        this.isWriting = false;
      });

    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 重新初始化流（错误恢复）
   */
  private reinitializeStream(): void {
    // 延迟重新初始化，避免频繁重试
    setTimeout(() => {
      if (!this.isClosed && !this.writeStream) {
        try {
          this.initializeStream();
        } catch (error) {
          this.handleError(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }, this.retryInterval * 2);
  }

  /**
   * 写入数据（异步，不阻塞）
   */
  write(data: string): void {
    if (this.isClosed) {
      return;
    }

    // 检查队列长度
    if (this.writeQueue.length >= this.maxQueueLength) {
      if (this.queueFullStrategy === 'drop') {
        // 丢弃最旧的数据
        const dropped = this.writeQueue.shift();
        if (dropped) {
          console.warn(`文件写入队列已满，丢弃数据: ${dropped.data.substring(0, 100)}...`);
        }
      } else {
        // 等待（但为了避免阻塞，仍然加入队列，只是记录警告）
        console.warn(`文件写入队列已满 (${this.writeQueue.length})，等待处理...`);
      }
    }

    // 添加到队列
    this.writeQueue.push({
      data,
      timestamp: Date.now(),
      retries: 0
    });

    // 异步处理队列（不阻塞当前调用）
    setImmediate(() => {
      this.processQueue();
    });
  }

  /**
   * 处理写入队列
   */
  private processQueue(): void {
    if (this.isWriting || !this.writeStream || this.writeQueue.length === 0 || this.isClosed) {
      return;
    }

    // 批量处理数据
    const batch: string[] = [];
    let batchSize = 0;

    while (this.writeQueue.length > 0 && batchSize < this.batchSize) {
      const item = this.writeQueue.shift();
      if (item) {
        batch.push(item.data);
        batchSize += Buffer.byteLength(item.data, 'utf8');
      }
    }

    if (batch.length === 0) {
      return;
    }

    // 合并批量数据
    const dataToWrite = batch.join('');
    this.currentBuffer += dataToWrite;

    // 如果缓冲区达到批量大小，立即写入
    if (Buffer.byteLength(this.currentBuffer, 'utf8') >= this.batchSize) {
      this.flushBuffer();
    }
  }

  /**
   * 刷新缓冲区到文件
   */
  private flushBuffer(): void {
    if (!this.writeStream || this.currentBuffer.length === 0 || this.isClosed) {
      return;
    }

    const dataToWrite = this.currentBuffer;
    this.currentBuffer = '';
    this.isWriting = true;

    // 使用setImmediate异步写入，避免阻塞
    setImmediate(() => {
      try {
        const canContinue = this.writeStream!.write(dataToWrite, 'utf8');
        
        if (!canContinue) {
          // 缓冲区已满，等待drain事件
          this.writeStream!.once('drain', () => {
            this.isWriting = false;
            this.processQueue();
          });
        } else {
          this.isWriting = false;
          // 继续处理队列
          setImmediate(() => {
            this.processQueue();
          });
        }

        // 更新统计
        this.totalBytesWritten += Buffer.byteLength(dataToWrite, 'utf8');
        this.totalWrites++;

        // 如果需要自动刷新
        if (this.autoFlush && this.writeStream) {
          this.writeStream.uncork();
        }

      } catch (error) {
        this.isWriting = false;
        this.handleError(error instanceof Error ? error : new Error(String(error)));
        // 将数据重新加入队列（重试）
        this.retryWrite(dataToWrite);
      }
    });
  }

  /**
   * 重试写入
   */
  private retryWrite(data: string): void {
    // 查找队列中是否有相同的数据（避免重复）
    const existingItem = this.writeQueue.find(item => item.data === data);
    
    if (existingItem) {
      existingItem.retries++;
      if (existingItem.retries >= this.maxRetries) {
        // 超过最大重试次数，丢弃数据
        const index = this.writeQueue.indexOf(existingItem);
        if (index > -1) {
          this.writeQueue.splice(index, 1);
        }
        console.error(`文件写入失败，已重试${this.maxRetries}次，丢弃数据`);
        this.totalErrors++;
      } else {
        // 延迟重试
        setTimeout(() => {
          this.processQueue();
        }, this.retryInterval);
      }
    } else {
      // 重新加入队列
      this.writeQueue.unshift({
        data,
        timestamp: Date.now(),
        retries: 1
      });
      
      // 延迟重试
      setTimeout(() => {
        this.processQueue();
      }, this.retryInterval);
    }
  }

  /**
   * 启动定时刷新
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.currentBuffer.length > 0) {
        this.flushBuffer();
      }
    }, this.flushInterval);
  }

  /**
   * 强制刷新所有缓冲区
   */
  async flush(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.writeStream) {
        resolve();
        return;
      }

      // 先刷新当前缓冲区
      if (this.currentBuffer.length > 0) {
        this.flushBuffer();
      }

      // 处理剩余队列
      while (this.writeQueue.length > 0) {
        this.processQueue();
      }

      // 等待所有数据写入完成
      const checkComplete = () => {
        if (this.writeQueue.length === 0 && this.currentBuffer.length === 0 && !this.isWriting) {
          // 确保数据刷新到磁盘
          if (this.writeStream) {
            this.writeStream.uncork();
            // 使用fsync确保数据写入磁盘
            const fd = (this.writeStream as any).fd;
            if (fd) {
              fs.fsync(fd, (err) => {
                if (err) {
                  reject(err);
                } else {
                  resolve();
                }
              });
            } else {
              resolve();
            }
          } else {
            resolve();
          }
        } else {
          // 继续等待
          setTimeout(checkComplete, 10);
        }
      };

      checkComplete();
    });
  }

  /**
   * 关闭文件写入器
   */
  async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }

    this.isClosed = true;

    // 停止定时器
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // 刷新所有数据
    await this.flush();

    // 关闭流
    return new Promise<void>((resolve, reject) => {
      if (this.writeStream) {
        this.writeStream.end(() => {
          this.writeStream = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 处理错误
   */
  private handleError(error: Error): void {
    this.totalErrors++;
    this.emit('error', error);
    
    if (this.onError) {
      // 异步调用错误回调，避免阻塞
      setImmediate(() => {
        try {
          this.onError!(error);
        } catch (err) {
          console.error('错误回调执行失败:', err);
        }
      });
    } else {
      console.error('文件写入错误:', error);
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    queueLength: number;
    bufferSize: number;
    totalBytesWritten: number;
    totalWrites: number;
    totalErrors: number;
    isWriting: boolean;
    isClosed: boolean;
  } {
    return {
      queueLength: this.writeQueue.length,
      bufferSize: Buffer.byteLength(this.currentBuffer, 'utf8'),
      totalBytesWritten: this.totalBytesWritten,
      totalWrites: this.totalWrites,
      totalErrors: this.totalErrors,
      isWriting: this.isWriting,
      isClosed: this.isClosed
    };
  }

  /**
   * 清空队列（紧急情况使用）
   */
  clearQueue(): void {
    this.writeQueue = [];
    this.currentBuffer = '';
  }
}


/**
 * 优化的流式数据处理模块
 * 解决高频率/大数据量下的消息延迟和不同步问题
 */

import * as vscode from 'vscode';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SSE 数据解析接口
 */
interface SSEData {
  content?: string;
  [key: string]: any;
}

/**
 * 流式处理选项
 */
export interface StreamProcessorOptions {
  /** 数据处理回调函数 */
  onData?: (data: SSEData) => void;
  /** 错误处理回调函数 */
  onError?: (error: Error) => void;
  /** 完成回调函数 */
  onComplete?: () => void;
  /** 自定义数据解析函数 */
  parseData?: (jsonString: string) => SSEData;
  /** Webview 实例，用于发送消息 */
  webview?: vscode.Webview;
  /** 消息类型，用于标识发送到webview的消息 */
  messageType?: string;
  /** 历史记录文件路径 */
  historyFilePath?: string;
  /** 消息批处理大小（默认10，即每10条数据合并发送一次） */
  batchSize?: number;
  /** 消息发送间隔（毫秒，默认50ms） */
  messageInterval?: number;
  /** 是否启用背压控制 */
  enableBackpressure?: boolean;
}

/**
 * 消息队列项
 */
interface MessageQueueItem {
  data: SSEData;
  timestamp: number;
}

/**
 * 优化的流式处理器
 * 
 * 主要优化点：
 * 1. 消息队列和批处理：减少webview消息数量，提高性能
 * 2. 背压控制：当webview处理不过来时，暂停发送
 * 3. 快速停止响应：使用标志位立即停止处理
 * 4. 异步文件写入：不阻塞消息发送
 * 5. 消息同步机制：确保插件和webview状态一致
 */
export class StreamProcessor {
  private isStopped: boolean = false;
  private messageQueue: MessageQueueItem[] = [];
  private batchBuffer: SSEData[] = [];
  private lastMessageTime: number = 0;
  private fileWriteQueue: string[] = [];
  private isWritingFile: boolean = false;
  private stream: NodeJS.ReadableStream | null = null;
  private messageIntervalId: NodeJS.Timeout | null = null;
  private fileWriteIntervalId: NodeJS.Timeout | null = null;
  private pendingMessageCount: number = 0; // 待处理的消息数量（用于背压控制）
  private acknowledgedMessageCount: number = 0; // 已确认的消息数量
  private readonly batchSize: number;
  private readonly messageInterval: number;
  private readonly enableBackpressure: boolean;
  private readonly webview?: vscode.Webview;
  private readonly messageType?: string;
  private readonly historyFilePath?: string;
  private readonly maxPendingMessages: number = 100; // 最大待处理消息数（背压阈值）

  constructor(private options: StreamProcessorOptions = {}) {
    this.batchSize = options.batchSize || 10;
    this.messageInterval = options.messageInterval || 50;
    this.enableBackpressure = options.enableBackpressure !== false;
    this.webview = options.webview;
    this.messageType = options.messageType || 'streamData';
    this.historyFilePath = options.historyFilePath;
  }

  /**
   * 处理 SSE 流式数据
   */
  async processStream(
    url: string,
    config: AxiosRequestConfig = {}
  ): Promise<void> {
    // 重置状态
    this.isStopped = false;
    this.messageQueue = [];
    this.batchBuffer = [];
    this.pendingMessageCount = 0;
    this.lastMessageTime = Date.now();

    try {
      // 配置 axios 响应类型为 stream
      const response: AxiosResponse<NodeJS.ReadableStream> = await axios({
        ...config,
        url,
        method: config.method || 'GET',
        responseType: 'stream',
        headers: {
          'Accept': 'text/event-stream',
          ...config.headers
        }
      });

      this.stream = response.data;

      // 启动消息发送定时器
      this.startMessageTimer();
      
      // 启动文件写入定时器
      if (this.historyFilePath) {
        this.startFileWriteTimer();
      }

      // 创建文本解码器
      const decoder = new TextDecoder();
      
      // 缓冲区：用于存储不完整的行和 JSON 数据
      let lineBuffer = '';
      let jsonBuffer = '';
      let isParsingJson = false;
      let braceCount = 0;
      let bracketCount = 0;
      let inString = false;
      let escapeNext = false;

      // 处理流式数据
      return new Promise<void>((resolve, reject) => {
        response.data.on('data', (chunk: Buffer) => {
          // 检查是否已停止
          if (this.isStopped) {
            this.cleanup();
            resolve();
            return;
          }

          try {
            // 将 chunk 转换为字符串并添加到行缓冲区
            lineBuffer += decoder.decode(chunk, { stream: true });
            
            // 按行分割
            const lines = lineBuffer.split('\n');
            
            // 保留最后一个可能不完整的行
            lineBuffer = lines.pop() || '';
            
            // 处理每一行
            for (const line of lines) {
              if (this.isStopped) {
                break;
              }

              const trimmedLine = line.trim();
              
              // 跳过空行
              if (!trimmedLine) {
                continue;
              }
              
              // 处理 SSE 格式的数据行
              if (trimmedLine.startsWith('data: ')) {
                const dataContent = trimmedLine.slice(6); // 移除 "data: " 前缀
                
                // 检查是否是结束标记
                if (dataContent.trim() === '[DONE]') {
                  // 处理缓冲区中剩余的数据
                  this.flushBatchBuffer();
                  this.options.onComplete?.();
                  this.cleanup();
                  resolve();
                  return;
                }
                
                // 处理 JSON 数据（可能被分割）
                const result = this.processJsonChunk(
                  dataContent,
                  {
                    jsonBuffer,
                    isParsingJson,
                    braceCount,
                    bracketCount,
                    inString,
                    escapeNext
                  }
                );
                
                // 更新状态
                jsonBuffer = result.buffer;
                isParsingJson = result.state.isParsingJson;
                braceCount = result.state.braceCount;
                bracketCount = result.state.bracketCount;
                inString = result.state.inString;
                escapeNext = result.state.escapeNext;
                
                // 如果有完整的 JSON，处理它
                if (result.completeJson) {
                  this.handleData(result.completeJson);
                }
              }
            }
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.options.onError?.(err);
            this.cleanup();
            reject(err);
          }
        });

        response.data.on('end', () => {
          // 流结束，处理剩余的缓冲区数据
          if (!this.isStopped && lineBuffer.trim()) {
            const trimmedLine = lineBuffer.trim();
            if (trimmedLine.startsWith('data: ')) {
              const dataContent = trimmedLine.slice(6);
              if (dataContent.trim() && dataContent.trim() !== '[DONE]') {
                const result = this.processJsonChunk(
                  dataContent,
                  {
                    jsonBuffer,
                    isParsingJson,
                    braceCount,
                    bracketCount,
                    inString,
                    escapeNext
                  }
                );
                
                if (result.completeJson) {
                  this.handleData(result.completeJson);
                }
              }
            }
          }
          
          // 处理剩余的 JSON 缓冲区（如果有）
          if (!this.isStopped && jsonBuffer.trim()) {
            try {
              const parseData = this.options.parseData || ((jsonString: string) => JSON.parse(jsonString) as SSEData);
              const parsed = parseData(jsonBuffer.trim());
              this.handleData(parsed);
            } catch (error) {
              console.warn('无法解析剩余的 JSON 数据:', error);
            }
          }
          
          // 刷新所有缓冲区
          this.flushBatchBuffer();
          this.flushFileQueue();
          
          this.options.onComplete?.();
          this.cleanup();
          resolve();
        });

        response.data.on('error', (error: Error) => {
          this.options.onError?.(error);
          this.cleanup();
          reject(error);
        });
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.onError?.(err);
      this.cleanup();
      throw err;
    }
  }

  /**
   * 停止流处理（快速响应）
   */
  stop(): void {
    this.isStopped = true;
    
    // 立即停止流
    if (this.stream && 'destroy' in this.stream) {
      try {
        (this.stream as any).destroy();
      } catch (error) {
        // 忽略错误
      }
    }
    
    // 清理定时器
    this.cleanup();
    
    // 发送停止确认消息到webview
    if (this.webview) {
      try {
        this.webview.postMessage({
          type: 'streamStopped',
          timestamp: Date.now()
        });
      } catch (error) {
        console.warn('发送停止消息失败:', error);
      }
    }
  }

  /**
   * 处理webview的消息确认（用于背压控制）
   */
  handleMessageAck(count: number): void {
    this.acknowledgedMessageCount += count;
    this.pendingMessageCount = Math.max(0, this.pendingMessageCount - count);
  }

  /**
   * 处理数据
   */
  private handleData(data: SSEData): void {
    if (this.isStopped) {
      return;
    }

    // 调用回调
    this.options.onData?.(data);

    // 添加到批处理缓冲区
    this.batchBuffer.push(data);

    // 添加到文件写入队列
    if (this.historyFilePath) {
      this.fileWriteQueue.push(JSON.stringify(data) + '\n');
    }

    // 如果批处理缓冲区达到大小，立即发送
    if (this.batchBuffer.length >= this.batchSize) {
      this.flushBatchBuffer();
    }
  }

  /**
   * 刷新批处理缓冲区，发送消息到webview
   */
  private flushBatchBuffer(): void {
    if (this.batchBuffer.length === 0 || !this.webview || this.isStopped) {
      return;
    }

    // 检查背压控制
    if (this.enableBackpressure && this.pendingMessageCount >= this.maxPendingMessages) {
      // 如果待处理消息过多，延迟发送（背压控制）
      setTimeout(() => this.flushBatchBuffer(), this.messageInterval * 2);
      return;
    }

    const batch = [...this.batchBuffer];
    this.batchBuffer = [];
    this.pendingMessageCount += batch.length;

    try {
      // 发送批处理消息
      this.webview.postMessage({
        type: this.messageType,
        data: batch,
        timestamp: Date.now(),
        count: batch.length
      });
    } catch (error) {
      console.warn('发送消息到webview失败:', error);
      this.pendingMessageCount = Math.max(0, this.pendingMessageCount - batch.length);
    }
  }

  /**
   * 启动消息发送定时器
   */
  private startMessageTimer(): void {
    this.messageIntervalId = setInterval(() => {
      if (this.isStopped) {
        return;
      }

      const now = Date.now();
      // 如果距离上次发送超过间隔时间，且缓冲区有数据，则发送
      if (now - this.lastMessageTime >= this.messageInterval && this.batchBuffer.length > 0) {
        this.flushBatchBuffer();
        this.lastMessageTime = now;
      }
    }, this.messageInterval);
  }

  /**
   * 启动文件写入定时器
   */
  private startFileWriteTimer(): void {
    this.fileWriteIntervalId = setInterval(() => {
      if (this.isStopped) {
        return;
      }
      this.flushFileQueue();
    }, 1000); // 每秒写入一次文件
  }

  /**
   * 刷新文件写入队列
   */
  private async flushFileQueue(): Promise<void> {
    if (this.fileWriteQueue.length === 0 || this.isWritingFile || !this.historyFilePath) {
      return;
    }

    this.isWritingFile = true;
    const dataToWrite = this.fileWriteQueue.join('');
    this.fileWriteQueue = [];

    try {
      // 确保目录存在
      const dir = path.dirname(this.historyFilePath);
      await fs.promises.mkdir(dir, { recursive: true });

      // 追加写入文件（异步，不阻塞）
      await fs.promises.appendFile(this.historyFilePath, dataToWrite, 'utf8');
    } catch (error) {
      console.error('写入历史记录文件失败:', error);
      // 将数据重新加入队列，以便重试
      this.fileWriteQueue.unshift(dataToWrite);
    } finally {
      this.isWritingFile = false;
    }
  }

  /**
   * 处理 JSON chunk（可能不完整）
   */
  private processJsonChunk(
    chunk: string,
    currentState: {
      jsonBuffer: string;
      isParsingJson: boolean;
      braceCount: number;
      bracketCount: number;
      inString: boolean;
      escapeNext: boolean;
    }
  ): {
    buffer: string;
    state: {
      isParsingJson: boolean;
      braceCount: number;
      bracketCount: number;
      inString: boolean;
      escapeNext: boolean;
    };
    completeJson: SSEData | null;
  } {
    const parseData = this.options.parseData || ((jsonString: string) => JSON.parse(jsonString) as SSEData);
    
    let buffer = currentState.jsonBuffer + chunk;
    let isParsingJson = currentState.isParsingJson || buffer.trim().startsWith('{') || buffer.trim().startsWith('[');
    let braceCount = currentState.braceCount;
    let bracketCount = currentState.bracketCount;
    let inString = currentState.inString;
    let escapeNext = currentState.escapeNext;

    // 如果还没有开始解析 JSON，检查是否开始
    if (!isParsingJson && (chunk.trim().startsWith('{') || chunk.trim().startsWith('['))) {
      isParsingJson = true;
    }

    // 遍历每个字符，统计括号和检测字符串状态
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
      } else if (char === '[') {
        bracketCount++;
      } else if (char === ']') {
        bracketCount--;
      }
    }

    // 检查 JSON 是否完整
    let completeJson: SSEData | null = null;
    
    if (isParsingJson && braceCount === 0 && bracketCount === 0 && !inString) {
      // JSON 完整，尝试解析
      const trimmedBuffer = buffer.trim();
      if (trimmedBuffer) {
        try {
          completeJson = parseData(trimmedBuffer);
          // 解析成功，重置缓冲区
          buffer = '';
          isParsingJson = false;
          braceCount = 0;
          bracketCount = 0;
          inString = false;
          escapeNext = false;
        } catch (error) {
          // 解析失败，可能是 JSON 还不完整，继续等待
        }
      }
    }

    return {
      buffer,
      state: {
        isParsingJson,
        braceCount,
        bracketCount,
        inString,
        escapeNext
      },
      completeJson
    };
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    if (this.messageIntervalId) {
      clearInterval(this.messageIntervalId);
      this.messageIntervalId = null;
    }
    if (this.fileWriteIntervalId) {
      clearInterval(this.fileWriteIntervalId);
      this.fileWriteIntervalId = null;
    }
    
    // 最后刷新一次
    this.flushBatchBuffer();
    this.flushFileQueue();
  }

  /**
   * 获取当前状态
   */
  getStatus(): {
    isStopped: boolean;
    queueLength: number;
    batchBufferLength: number;
    pendingMessageCount: number;
  } {
    return {
      isStopped: this.isStopped,
      queueLength: this.messageQueue.length,
      batchBufferLength: this.batchBuffer.length,
      pendingMessageCount: this.pendingMessageCount
    };
  }
}


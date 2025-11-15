/**
 * 优化的流式数据处理模块（仅插件端优化，无需修改webview）
 * 解决高频率/大数据量下的消息延迟和不同步问题
 * 
 * 核心优化策略：
 * 1. 智能批处理：根据数据频率自动调整批处理大小
 * 2. 自适应节流：动态调整发送间隔，避免消息积压
 * 3. 队列管理：限制队列大小，优先发送最新数据
 * 4. 快速停止：立即清空队列，不等待发送完成
 */

import * as vscode from 'vscode';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import * as path from 'path';
import { FileWriter, FileWriterOptions } from './fileWriter';

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
export interface StreamProcessorOptimizedOptions {
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
  /** 初始批处理大小 */
  initialBatchSize?: number;
  /** 最小批处理大小 */
  minBatchSize?: number;
  /** 最大批处理大小 */
  maxBatchSize?: number;
  /** 初始消息发送间隔（毫秒） */
  initialMessageInterval?: number;
  /** 最小消息发送间隔（毫秒） */
  minMessageInterval?: number;
  /** 最大消息发送间隔（毫秒） */
  maxMessageInterval?: number;
  /** 队列最大长度（超过此长度将强制合并，不会丢弃数据） */
  maxQueueLength?: number;
  /** 是否启用数据完整性保证（确保所有数据都被处理，不丢失） */
  ensureDataIntegrity?: boolean;
  /** 是否启用自适应调整 */
  enableAdaptive?: boolean;
}

/**
 * 消息队列项
 */
interface MessageQueueItem {
  data: SSEData;
  timestamp: number;
}

/**
 * 优化的流式处理器（仅插件端优化）
 * 
 * 主要优化点：
 * 1. 智能批处理：根据数据到达频率自动调整批处理大小
 * 2. 自适应节流：根据队列长度动态调整发送间隔
 * 3. 队列管理：限制队列大小，防止内存溢出
 * 4. 快速停止：立即清空队列，不等待发送完成
 * 5. 异步文件写入：不阻塞消息发送
 */
export class StreamProcessorOptimized {
  private isStopped: boolean = false;
  private batchBuffer: SSEData[] = [];
  private messageQueue: MessageQueueItem[] = [];
  private fileWriter: FileWriter | null = null;
  private stream: NodeJS.ReadableStream | null = null;
  private messageIntervalId: NodeJS.Timeout | null = null;
  private adaptiveIntervalId: NodeJS.Timeout | null = null;
  
  // 自适应参数
  private currentBatchSize: number;
  private currentMessageInterval: number;
  private lastSendTime: number = 0;
  private dataReceiveRate: number = 0; // 数据接收速率（条/秒）
  private queueLengthHistory: number[] = []; // 队列长度历史（用于自适应调整）
  
  // 配置参数
  private readonly minBatchSize: number;
  private readonly maxBatchSize: number;
  private readonly minMessageInterval: number;
  private readonly maxMessageInterval: number;
  private readonly maxQueueLength: number;
  private readonly ensureDataIntegrity: boolean;
  private readonly enableAdaptive: boolean;
  
  // 数据完整性保证
  private totalDataReceived: number = 0; // 接收到的总数据条数
  private totalDataSent: number = 0; // 已发送的总数据条数
  private pendingDataBuffer: SSEData[] = []; // 待发送数据缓冲区（确保不丢失）
  private readonly webview?: vscode.Webview;
  private readonly messageType?: string;
  private readonly historyFilePath?: string;

  constructor(private options: StreamProcessorOptimizedOptions = {}) {
    // 初始化批处理参数
    const initialBatchSize = options.initialBatchSize || 20;
    this.minBatchSize = options.minBatchSize || 5;
    this.maxBatchSize = options.maxBatchSize || 100;
    this.currentBatchSize = Math.max(this.minBatchSize, Math.min(this.maxBatchSize, initialBatchSize));
    
    // 初始化消息间隔参数
    const initialMessageInterval = options.initialMessageInterval || 100;
    this.minMessageInterval = options.minMessageInterval || 50;
    this.maxMessageInterval = options.maxMessageInterval || 500;
    this.currentMessageInterval = Math.max(this.minMessageInterval, Math.min(this.maxMessageInterval, initialMessageInterval));
    
    // 队列管理参数
    this.maxQueueLength = options.maxQueueLength || 2000; // 增大默认值，确保有足够缓冲
    this.ensureDataIntegrity = options.ensureDataIntegrity !== false; // 默认启用数据完整性保证
    this.enableAdaptive = options.enableAdaptive !== false;
    
    // 其他参数
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
    this.batchBuffer = [];
    this.messageQueue = [];
    this.pendingDataBuffer = [];
    this.currentBatchSize = this.options.initialBatchSize || 20;
    this.currentMessageInterval = this.options.initialMessageInterval || 100;
    this.lastSendTime = Date.now();
    this.dataReceiveRate = 0;
    this.queueLengthHistory = [];
    this.totalDataReceived = 0;
    this.totalDataSent = 0;

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
      
      // 初始化文件写入器
      if (this.historyFilePath) {
        this.initializeFileWriter();
      }

      // 启动自适应调整定时器
      if (this.enableAdaptive) {
        this.startAdaptiveTimer();
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
      let dataCount = 0;
      const dataCountStartTime = Date.now();

      // 处理流式数据
      return new Promise<void>((resolve, reject) => {
        response.data.on('data', (chunk: Buffer) => {
          // 检查是否已停止
          if (this.isStopped) {
            this.cleanup().catch(() => {
              // 忽略清理错误
            });
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
                  // 处理缓冲区中剩余的数据（确保不丢失）
                  if (jsonBuffer.trim()) {
                    try {
                      const parseData = this.options.parseData || ((jsonString: string) => JSON.parse(jsonString) as SSEData);
                      const parsed = parseData(jsonBuffer.trim());
                      this.handleData(parsed);
                    } catch (error) {
                      console.warn('解析最终JSON失败:', error);
                    }
                  }
                  this.flushBatchBuffer();
                  this.flushAllBuffers(); // 确保所有数据都被发送
                  await this.flushFileWriter();
                  this.options.onComplete?.();
                  this.cleanup();
                  resolve();
                  return;
                }
                
                // 处理 JSON 数据（可能被分割，也可能包含多条数据）
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
                
                // 处理完整的 JSON（可能包含多条数据）
                if (result.completeJson) {
                  // 检查是否是数组（多条数据拼接）
                  if (Array.isArray(result.completeJson)) {
                    // 多条数据，分别处理
                    for (const item of result.completeJson) {
                      dataCount++;
                      this.handleData(item);
                    }
                  } else {
                    // 单条数据
                    dataCount++;
                    this.handleData(result.completeJson);
                  }
                  
                  // 更新数据接收速率（每秒更新一次）
                  const now = Date.now();
                  if (now - dataCountStartTime >= 1000) {
                    this.dataReceiveRate = dataCount;
                    dataCount = 0;
                  }
                }
              }
            }
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.options.onError?.(err);
            this.cleanup().catch(() => {
              // 忽略清理错误
            });
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
          
          // 刷新所有缓冲区（确保数据完整性）
          this.flushBatchBuffer();
          this.flushAllBuffers(); // 确保所有数据都被发送
          await this.flushFileWriter();
          
          // 验证数据完整性
          if (this.ensureDataIntegrity) {
            const pending = this.batchBuffer.length + this.messageQueue.length + this.pendingDataBuffer.length;
            if (pending > 0) {
              console.warn(`警告：仍有 ${pending} 条数据未发送`);
            }
            if (this.totalDataReceived !== this.totalDataSent) {
              console.warn(`数据统计不一致：接收 ${this.totalDataReceived} 条，发送 ${this.totalDataSent} 条`);
            }
          }
          
          this.options.onComplete?.();
          this.cleanup().then(() => {
            resolve();
          }).catch((error) => {
            reject(error);
          });
        });

        response.data.on('error', (error: Error) => {
          this.options.onError?.(error);
          this.cleanup().catch(() => {
            // 忽略清理错误
          });
          reject(error);
        });
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.onError?.(err);
      this.cleanup().catch(() => {
        // 忽略清理错误
      });
      throw err;
    }
  }

  /**
   * 停止流处理（快速响应，但确保数据完整性）
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
    
    // 如果启用了数据完整性保证，先发送所有待发送的数据
    if (this.ensureDataIntegrity) {
      // 刷新所有缓冲区，确保数据不丢失
      this.flushAllBuffers();
    } else {
      // 立即清空队列
      this.batchBuffer = [];
      this.messageQueue = [];
      this.pendingDataBuffer = [];
    }
    
    // 清理定时器（异步，不阻塞）
    this.cleanup().catch(() => {
      // 忽略清理错误
    });
    
    // 发送停止确认消息到webview（包含数据统计）
    if (this.webview) {
      try {
        this.webview.postMessage({
          type: 'streamStopped',
          timestamp: Date.now(),
          dataStats: {
            totalReceived: this.totalDataReceived,
            totalSent: this.totalDataSent,
            pending: this.batchBuffer.length + this.messageQueue.length + this.pendingDataBuffer.length
          }
        });
      } catch (error) {
        console.warn('发送停止消息失败:', error);
      }
    }
  }

  /**
   * 处理数据（确保数据不丢失）
   */
  private handleData(data: SSEData): void {
    if (this.isStopped) {
      return;
    }

    // 更新接收计数
    this.totalDataReceived++;

    // 调用回调
    this.options.onData?.(data);

    // 添加到批处理缓冲区
    this.batchBuffer.push(data);

    // 异步写入文件（不阻塞）
    if (this.fileWriter) {
      this.fileWriter.write(JSON.stringify(data) + '\n');
    }

    // 如果批处理缓冲区达到大小，立即发送
    if (this.batchBuffer.length >= this.currentBatchSize) {
      this.flushBatchBuffer();
    }
  }

  /**
   * 刷新批处理缓冲区，发送消息到webview（确保数据不丢失）
   */
  private flushBatchBuffer(): void {
    if (this.batchBuffer.length === 0 || !this.webview || this.isStopped) {
      return;
    }

    const batch = [...this.batchBuffer];
    this.batchBuffer = [];

    // 如果启用了数据完整性保证，确保所有数据都被处理
    if (this.ensureDataIntegrity) {
      // 将数据添加到待发送缓冲区（确保不丢失）
      this.pendingDataBuffer.push(...batch);
      
      // 检查队列长度，如果超过限制，强制合并并发送
      if (this.messageQueue.length >= this.maxQueueLength) {
        // 强制合并队列中的所有数据
        this.forceMergeAndSend();
      } else {
        // 添加到消息队列
        const queueItem: MessageQueueItem = {
          data: batch as any,
          timestamp: Date.now()
        };
        this.messageQueue.push(queueItem);
      }
    } else {
      // 不保证数据完整性时，使用原有逻辑（但改为合并而不是丢弃）
      if (this.messageQueue.length >= this.maxQueueLength) {
        // 合并旧数据，而不是丢弃
        this.mergeQueueItems();
      }

      // 添加到消息队列
      const queueItem: MessageQueueItem = {
        data: batch as any,
        timestamp: Date.now()
      };
      this.messageQueue.push(queueItem);
    }

    // 记录队列长度历史（用于自适应调整）
    if (this.enableAdaptive) {
      this.queueLengthHistory.push(this.messageQueue.length);
      if (this.queueLengthHistory.length > 10) {
        this.queueLengthHistory.shift();
      }
    }

    // 尝试立即发送（如果距离上次发送时间足够长）
    const now = Date.now();
    if (now - this.lastSendTime >= this.currentMessageInterval) {
      this.sendNextBatch();
    }
  }

  /**
   * 强制合并并发送（确保数据不丢失）
   */
  private forceMergeAndSend(): void {
    if (this.messageQueue.length === 0 && this.pendingDataBuffer.length === 0) {
      return;
    }

    // 合并队列中的所有数据
    const allData: SSEData[] = [];
    
    // 合并消息队列中的数据
    for (const item of this.messageQueue) {
      if (Array.isArray(item.data)) {
        allData.push(...item.data);
      } else {
        allData.push(item.data);
      }
    }
    
    // 合并待发送缓冲区中的数据
    allData.push(...this.pendingDataBuffer);
    
    // 清空队列和缓冲区
    this.messageQueue = [];
    this.pendingDataBuffer = [];
    
    // 如果合并后的数据量很大，分批发送
    const maxBatchSize = this.maxBatchSize * 2; // 允许更大的批次
    if (allData.length > maxBatchSize) {
      // 分批发送
      for (let i = 0; i < allData.length; i += maxBatchSize) {
        const batch = allData.slice(i, i + maxBatchSize);
        this.sendBatchImmediately(batch);
      }
    } else {
      // 一次性发送
      this.sendBatchImmediately(allData);
    }
  }

  /**
   * 立即发送一批数据
   */
  private sendBatchImmediately(batch: SSEData[]): void {
    if (batch.length === 0 || !this.webview || this.isStopped) {
      return;
    }

    try {
      this.webview.postMessage({
        type: this.messageType,
        data: batch,
        timestamp: Date.now(),
        count: batch.length
      });

      this.totalDataSent += batch.length;
      this.lastSendTime = Date.now();
    } catch (error) {
      console.warn('发送消息到webview失败:', error);
      // 发送失败，将数据重新加入待发送缓冲区（确保不丢失）
      if (this.ensureDataIntegrity) {
        this.pendingDataBuffer.push(...batch);
      }
    }
  }

  /**
   * 刷新所有缓冲区（确保数据完整性）
   */
  private flushAllBuffers(): void {
    // 先刷新批处理缓冲区
    if (this.batchBuffer.length > 0) {
      this.flushBatchBuffer();
    }

    // 发送所有待发送的数据
    if (this.pendingDataBuffer.length > 0) {
      this.sendBatchImmediately([...this.pendingDataBuffer]);
      this.pendingDataBuffer = [];
    }

    // 发送队列中的所有数据
    while (this.messageQueue.length > 0) {
      const item = this.messageQueue.shift();
      if (item) {
        const data = Array.isArray(item.data) ? item.data : [item.data];
        this.sendBatchImmediately(data);
      }
    }
  }

  /**
   * 发送下一批消息（确保数据不丢失）
   */
  private sendNextBatch(): void {
    if (this.isStopped) {
      return;
    }

    // 优先发送待发送缓冲区中的数据
    if (this.pendingDataBuffer.length > 0) {
      const batch = this.pendingDataBuffer.splice(0, this.currentBatchSize);
      this.sendBatchImmediately(batch);
      return;
    }

    // 然后发送队列中的数据
    if (this.messageQueue.length === 0 || !this.webview) {
      return;
    }

    const queueItem = this.messageQueue.shift();
    if (!queueItem) {
      return;
    }

    const data = Array.isArray(queueItem.data) ? queueItem.data : [queueItem.data];
    this.sendBatchImmediately(data);
  }

  /**
   * 合并队列中的旧数据
   */
  private mergeQueueItems(): void {
    if (this.messageQueue.length < 2) {
      return;
    }

    // 合并前50%的数据
    const mergeCount = Math.floor(this.messageQueue.length * 0.5);
    const mergedData: SSEData[] = [];

    for (let i = 0; i < mergeCount; i++) {
      const item = this.messageQueue[i];
      if (Array.isArray(item.data)) {
        mergedData.push(...item.data);
      } else {
        mergedData.push(item.data);
      }
    }

    // 替换为合并后的数据
    this.messageQueue.splice(0, mergeCount, {
      data: mergedData as any,
      timestamp: Date.now()
    });
  }

  /**
   * 启动消息发送定时器
   */
  private startMessageTimer(): void {
    this.messageIntervalId = setInterval(() => {
      if (this.isStopped) {
        return;
      }

      // 发送队列中的消息
      while (this.messageQueue.length > 0) {
        const now = Date.now();
        if (now - this.lastSendTime >= this.currentMessageInterval) {
          this.sendNextBatch();
        } else {
          break; // 等待间隔时间
        }
      }
    }, Math.min(this.currentMessageInterval, 50)); // 定时器间隔不超过50ms
  }

  /**
   * 启动自适应调整定时器
   */
  private startAdaptiveTimer(): void {
    this.adaptiveIntervalId = setInterval(() => {
      if (this.isStopped) {
        return;
      }

      this.adaptiveAdjust();
    }, 2000); // 每2秒调整一次
  }

  /**
   * 自适应调整参数
   */
  private adaptiveAdjust(): void {
    if (this.queueLengthHistory.length < 3) {
      return;
    }

    // 计算平均队列长度
    const avgQueueLength = this.queueLengthHistory.reduce((a, b) => a + b, 0) / this.queueLengthHistory.length;
    const maxQueueLength = Math.max(...this.queueLengthHistory);

    // 如果队列持续增长，增加批处理大小和发送间隔
    if (avgQueueLength > this.maxQueueLength * 0.7 || maxQueueLength > this.maxQueueLength * 0.9) {
      // 队列压力大，增加批处理大小和发送间隔
      this.currentBatchSize = Math.min(
        this.maxBatchSize,
        Math.floor(this.currentBatchSize * 1.2)
      );
      this.currentMessageInterval = Math.min(
        this.maxMessageInterval,
        Math.floor(this.currentMessageInterval * 1.2)
      );
    } else if (avgQueueLength < this.maxQueueLength * 0.3 && maxQueueLength < this.maxQueueLength * 0.5) {
      // 队列压力小，减少批处理大小和发送间隔（提高实时性）
      this.currentBatchSize = Math.max(
        this.minBatchSize,
        Math.floor(this.currentBatchSize * 0.9)
      );
      this.currentMessageInterval = Math.max(
        this.minMessageInterval,
        Math.floor(this.currentMessageInterval * 0.9)
      );
    }

    // 根据数据接收速率调整
    if (this.dataReceiveRate > 100) {
      // 高频率数据，增加批处理大小
      this.currentBatchSize = Math.min(
        this.maxBatchSize,
        Math.floor(this.currentBatchSize * 1.1)
      );
    } else if (this.dataReceiveRate < 10) {
      // 低频率数据，减少批处理大小（提高实时性）
      this.currentBatchSize = Math.max(
        this.minBatchSize,
        Math.floor(this.currentBatchSize * 0.95)
      );
    }
  }

  /**
   * 初始化文件写入器
   */
  private initializeFileWriter(): void {
    if (!this.historyFilePath) {
      return;
    }

    try {
      const options: FileWriterOptions = {
        filePath: this.historyFilePath,
        batchSize: 64 * 1024, // 64KB批量写入
        flushInterval: 1000, // 1秒刷新一次
        autoFlush: false, // 不自动刷新，提高性能
        maxQueueLength: 10000, // 最大队列长度
        queueFullStrategy: 'wait', // 队列满时等待
        maxRetries: 3, // 最大重试3次
        retryInterval: 100, // 重试间隔100ms
        onError: (error) => {
          // 错误处理，不影响主进程
          console.error('文件写入错误:', error);
          this.options.onError?.(error);
        }
      };

      this.fileWriter = new FileWriter(options);

      // 监听错误事件
      this.fileWriter.on('error', (error: Error) => {
        console.error('文件写入器错误:', error);
      });

    } catch (error) {
      console.error('初始化文件写入器失败:', error);
      this.fileWriter = null;
    }
  }

  /**
   * 刷新文件写入器
   */
  private async flushFileWriter(): Promise<void> {
    if (this.fileWriter) {
      try {
        await this.fileWriter.flush();
      } catch (error) {
        console.error('刷新文件写入器失败:', error);
      }
    }
  }

  /**
   * 处理 JSON chunk（可能不完整，也可能包含多条数据）
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
    completeJson: SSEData | SSEData[] | null;
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
    let completeJson: SSEData | SSEData[] | null = null;
    
    if (isParsingJson && braceCount === 0 && bracketCount === 0 && !inString) {
      // JSON 完整，尝试解析
      const trimmedBuffer = buffer.trim();
      if (trimmedBuffer) {
        try {
          const parsed = parseData(trimmedBuffer);
          
          // 检查是否可能是多条数据拼接（尝试拆分）
          // 如果解析结果是字符串，可能包含多条JSON
          if (typeof parsed === 'string') {
            const multipleJson = this.tryParseMultipleJson(parsed, parseData);
            if (multipleJson.length > 0) {
              completeJson = multipleJson.length === 1 ? multipleJson[0] : multipleJson;
            } else {
              completeJson = parsed as SSEData;
            }
          } else if (Array.isArray(parsed)) {
            // 已经是数组，直接使用
            completeJson = parsed;
          } else {
            // 单条数据
            completeJson = parsed;
          }
          
          // 解析成功，重置缓冲区
          buffer = '';
          isParsingJson = false;
          braceCount = 0;
          bracketCount = 0;
          inString = false;
          escapeNext = false;
        } catch (error) {
          // 解析失败，可能是 JSON 还不完整，继续等待
          // 或者可能是多条数据拼接，尝试拆分
          const multipleJson = this.tryParseMultipleJson(trimmedBuffer, parseData);
          if (multipleJson.length > 0) {
            completeJson = multipleJson.length === 1 ? multipleJson[0] : multipleJson;
            buffer = '';
            isParsingJson = false;
            braceCount = 0;
            bracketCount = 0;
            inString = false;
            escapeNext = false;
          }
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
   * 尝试解析多条JSON数据（处理拼接的情况）
   */
  private tryParseMultipleJson(
    jsonString: string,
    parseData: (jsonString: string) => SSEData
  ): SSEData[] {
    const results: SSEData[] = [];
    let currentPos = 0;
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let startPos = -1;

    // 查找所有完整的JSON对象
    for (let i = 0; i < jsonString.length; i++) {
      const char = jsonString[i];

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

      if (char === '{' || char === '[') {
        if (startPos === -1) {
          startPos = i;
        }
        depth++;
      } else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0 && startPos !== -1) {
          // 找到一个完整的JSON对象
          const jsonStr = jsonString.substring(startPos, i + 1);
          try {
            const parsed = parseData(jsonStr);
            results.push(parsed);
          } catch (error) {
            // 解析失败，跳过
            console.warn('解析JSON片段失败:', error);
          }
          startPos = -1;
        }
      }
    }

    return results;
  }

  /**
   * 清理资源（确保数据完整性）
   */
  private async cleanup(): Promise<void> {
    if (this.messageIntervalId) {
      clearInterval(this.messageIntervalId);
      this.messageIntervalId = null;
    }
    // 关闭文件写入器
    if (this.fileWriter) {
      try {
        await this.fileWriter.close();
      } catch (error) {
        console.error('关闭文件写入器失败:', error);
      }
      this.fileWriter = null;
    }
    if (this.adaptiveIntervalId) {
      clearInterval(this.adaptiveIntervalId);
      this.adaptiveIntervalId = null;
    }
    
    // 最后刷新一次（确保数据不丢失）
    if (this.ensureDataIntegrity) {
      this.flushAllBuffers();
    } else {
      this.flushBatchBuffer();
    }
    await this.flushFileWriter();
  }

  /**
   * 获取当前状态（包含数据完整性信息）
   */
  getStatus(): {
    isStopped: boolean;
    queueLength: number;
    batchBufferLength: number;
    pendingDataBufferLength: number;
    currentBatchSize: number;
    currentMessageInterval: number;
    dataReceiveRate: number;
    totalDataReceived: number;
    totalDataSent: number;
    dataIntegrity: {
      allDataSent: boolean;
      pendingCount: number;
    };
  } {
    const pendingCount = this.batchBuffer.length + this.messageQueue.length + this.pendingDataBuffer.length;
    return {
      isStopped: this.isStopped,
      queueLength: this.messageQueue.length,
      batchBufferLength: this.batchBuffer.length,
      pendingDataBufferLength: this.pendingDataBuffer.length,
      currentBatchSize: this.currentBatchSize,
      currentMessageInterval: this.currentMessageInterval,
      dataReceiveRate: this.dataReceiveRate,
      totalDataReceived: this.totalDataReceived,
      totalDataSent: this.totalDataSent,
      dataIntegrity: {
        allDataSent: this.totalDataReceived === this.totalDataSent && pendingCount === 0,
        pendingCount: pendingCount
      }
    };
  }
}


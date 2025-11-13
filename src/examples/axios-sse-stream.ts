/**
 * 使用 axios 处理 SSE (Server-Sent Events) 流式接口的示例
 * 
 * 该示例展示了如何处理以下场景：
 * 1. SSE 格式数据：data: {"content": "Hello"}
 * 2. 大数据量时，JSON 可能被分割到多个 chunk 中
 * 3. 需要拼接多个 chunk 直到得到完整的 JSON 对象
 * 
 * 依赖安装：
 * npm install axios
 * npm install --save-dev @types/node (如果使用 TypeScript)
 * 
 * 使用说明：
 * 本文件提供了两个版本：
 * 1. processSSEStreamWithAxios: 使用括号计数和字符串状态检测，更精确
 * 2. processSSEStreamWithAxiosSimple: 使用 JSON.parse 异常检测，更简单
 */

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

/**
 * SSE 数据解析接口
 */
interface SSEData {
  content?: string;
  [key: string]: any;
}

/**
 * SSE 流式处理选项
 */
interface SSEStreamOptions {
  /** 数据处理回调函数 */
  onData?: (data: SSEData) => void;
  /** 错误处理回调函数 */
  onError?: (error: Error) => void;
  /** 完成回调函数 */
  onComplete?: () => void;
  /** 自定义数据解析函数 */
  parseData?: (jsonString: string) => SSEData;
}

/**
 * 使用 axios 处理 SSE 流式数据
 * 
 * @param url 请求 URL
 * @param config axios 请求配置
 * @param options SSE 处理选项
 * @returns Promise<void>
 * 
 * @example
 * ```typescript
 * await processSSEStreamWithAxios('https://api.example.com/stream', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json'
 *   },
 *   data: { prompt: 'Hello' }
 * }, {
 *   onData: (data) => {
 *     console.log('收到数据:', data);
 *   },
 *   onError: (error) => {
 *     console.error('错误:', error);
 *   },
 *   onComplete: () => {
 *     console.log('流式传输完成');
 *   }
 * });
 * ```
 */
export async function processSSEStreamWithAxios(
  url: string,
  config: AxiosRequestConfig = {},
  options: SSEStreamOptions = {}
): Promise<void> {
  const {
    onData,
    onError,
    onComplete,
    parseData = (jsonString: string) => JSON.parse(jsonString) as SSEData
  } = options;

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

    // 创建文本解码器
    const decoder = new TextDecoder();
    
    // 缓冲区：用于存储不完整的行和 JSON 数据
    // 这些变量需要在 Promise 外部声明，以便在整个流处理过程中保持状态
    let lineBuffer = '';  // 行缓冲区：存储不完整的行
    let jsonBuffer = '';   // JSON 缓冲区：存储不完整的 JSON
    
    // 标记当前是否正在解析一个 JSON 对象
    let isParsingJson = false;
    
    // 括号计数器：用于检测 JSON 对象的完整性
    let braceCount = 0;
    let bracketCount = 0;
    let inString = false;
    let escapeNext = false;

    // 处理流式数据
    return new Promise<void>((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => {
        try {
          // 将 chunk 转换为字符串并添加到行缓冲区
          lineBuffer += decoder.decode(chunk, { stream: true });
          
          // 按行分割
          const lines = lineBuffer.split('\n');
          
          // 保留最后一个可能不完整的行
          lineBuffer = lines.pop() || '';
          
          // 处理每一行
          for (const line of lines) {
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
                if (jsonBuffer.trim() && isParsingJson) {
                  try {
                    const parsed = parseData(jsonBuffer.trim());
                    onData?.(parsed);
                  } catch (error) {
                    console.warn('解析缓冲区中的 JSON 失败:', error);
                  }
                }
                onComplete?.();
                resolve();
                return;
              }
              
              // 处理 JSON 数据（可能被分割）
              // 使用闭包变量来维护状态
              const result = processJsonChunkWithState(
                dataContent,
                {
                  jsonBuffer,
                  isParsingJson,
                  braceCount,
                  bracketCount,
                  inString,
                  escapeNext
                },
                parseData
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
                try {
                  onData?.(result.completeJson);
                  // 重置状态，准备下一个 JSON
                  jsonBuffer = '';
                  isParsingJson = false;
                  braceCount = 0;
                  bracketCount = 0;
                  inString = false;
                  escapeNext = false;
                } catch (error) {
                  console.warn('处理完整 JSON 时出错:', error);
                }
              }
            }
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          onError?.(err);
          reject(err);
        }
      });

      response.data.on('end', () => {
        // 流结束，处理剩余的缓冲区数据
        if (lineBuffer.trim()) {
          const trimmedLine = lineBuffer.trim();
          if (trimmedLine.startsWith('data: ')) {
            const dataContent = trimmedLine.slice(6);
            if (dataContent.trim() && dataContent.trim() !== '[DONE]') {
              const result = processJsonChunkWithState(
                dataContent,
                {
                  jsonBuffer,
                  isParsingJson,
                  braceCount,
                  bracketCount,
                  inString,
                  escapeNext
                },
                parseData
              );
              
              if (result.completeJson) {
                try {
                  onData?.(result.completeJson);
                } catch (error) {
                  console.warn('处理最终 JSON 时出错:', error);
                }
              }
            }
          }
        }
        
        // 处理剩余的 JSON 缓冲区（如果有）
        if (jsonBuffer.trim()) {
          try {
            const parsed = parseData(jsonBuffer.trim());
            onData?.(parsed);
          } catch (error) {
            console.warn('无法解析剩余的 JSON 数据:', error);
          }
        }
        
        onComplete?.();
        resolve();
      });

      response.data.on('error', (error: Error) => {
        onError?.(error);
        reject(error);
      });
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    onError?.(err);
    throw err;
  }
}

/**
 * JSON 解析状态
 */
interface JsonParseState {
  isParsingJson: boolean;
  braceCount: number;
  bracketCount: number;
  inString: boolean;
  escapeNext: boolean;
}

/**
 * JSON chunk 处理结果
 */
interface ProcessJsonChunkResult {
  buffer: string;
  state: JsonParseState;
  completeJson: SSEData | null;
}

/**
 * 处理 JSON chunk（可能不完整）
 * 使用括号计数和字符串状态来检测 JSON 的完整性
 * 
 * @param chunk 新的 JSON chunk
 * @param currentState 当前解析状态
 * @param parseData JSON 解析函数
 * @returns 处理结果，包含更新后的缓冲区和状态，以及完整的 JSON（如果有）
 */
function processJsonChunkWithState(
  chunk: string,
  currentState: {
    jsonBuffer: string;
    isParsingJson: boolean;
    braceCount: number;
    bracketCount: number;
    inString: boolean;
    escapeNext: boolean;
  },
  parseData: (jsonString: string) => SSEData
): ProcessJsonChunkResult {
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
        // 保持当前状态
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
 * 简化版本的 SSE 流处理函数（使用更简单的 JSON 完整性检测）
 * 
 * 这个方法使用 JSON.parse 的异常来检测 JSON 是否完整
 * 适用于大多数场景，但可能在某些边界情况下不如上面的方法精确
 */
export async function processSSEStreamWithAxiosSimple(
  url: string,
  config: AxiosRequestConfig = {},
  options: SSEStreamOptions = {}
): Promise<void> {
  const {
    onData,
    onError,
    onComplete,
    parseData = (jsonString: string) => JSON.parse(jsonString) as SSEData
  } = options;

  try {
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

    const decoder = new TextDecoder();
    let lineBuffer = '';  // 行缓冲区
    let jsonBuffer = '';  // JSON 缓冲区

    return new Promise<void>((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => {
        try {
          lineBuffer += decoder.decode(chunk, { stream: true });
          
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (!trimmedLine) {
              continue;
            }
            
            if (trimmedLine.startsWith('data: ')) {
              const dataContent = trimmedLine.slice(6);
              
              if (dataContent.trim() === '[DONE]') {
                // 处理剩余的 JSON 缓冲区
                if (jsonBuffer.trim()) {
                  try {
                    const parsed = parseData(jsonBuffer.trim());
                    onData?.(parsed);
                    jsonBuffer = '';
                  } catch (error) {
                    // 忽略解析失败的部分数据
                    console.warn('无法解析剩余的 JSON 数据:', error);
                  }
                }
                onComplete?.();
                resolve();
                return;
              }
              
              // 添加到 JSON 缓冲区
              jsonBuffer += dataContent;
              
              // 尝试解析 JSON
              let parsed: SSEData | null = null;
              try {
                parsed = parseData(jsonBuffer.trim());
                // 解析成功，说明 JSON 完整
                onData?.(parsed);
                jsonBuffer = ''; // 清空缓冲区
              } catch (error) {
                // 解析失败，说明 JSON 还不完整，继续累积数据
                // 不处理错误，等待更多数据
              }
            }
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          onError?.(err);
          reject(err);
        }
      });

      response.data.on('end', () => {
        // 处理剩余的缓冲区
        if (lineBuffer.trim()) {
          const trimmedLine = lineBuffer.trim();
          if (trimmedLine.startsWith('data: ')) {
            const dataContent = trimmedLine.slice(6);
            if (dataContent.trim() && dataContent.trim() !== '[DONE]') {
              jsonBuffer += dataContent;
            }
          }
        }
        
        // 尝试解析最后的 JSON
        if (jsonBuffer.trim()) {
          try {
            const parsed = parseData(jsonBuffer.trim());
            onData?.(parsed);
          } catch (error) {
            console.warn('无法解析最终的 JSON 数据:', error);
          }
        }
        
        onComplete?.();
        resolve();
      });

      response.data.on('error', (error: Error) => {
        onError?.(error);
        reject(error);
      });
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    onError?.(err);
    throw err;
  }
}

/**
 * 使用示例
 */
export async function exampleUsage() {
  // 示例 1: 使用完整版本（更精确的 JSON 检测）
  await processSSEStreamWithAxios(
    'https://api.example.com/stream',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      data: {
        prompt: 'Hello, how are you?'
      }
    },
    {
      onData: (data) => {
        console.log('收到数据:', data);
        if (data.content) {
          process.stdout.write(data.content); // 实时输出内容
        }
      },
      onError: (error) => {
        console.error('发生错误:', error);
      },
      onComplete: () => {
        console.log('\n流式传输完成');
      }
    }
  );

  // 示例 2: 使用简化版本（更简单但可能不够精确）
  await processSSEStreamWithAxiosSimple(
    'https://api.example.com/stream',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer your-token'
      },
      data: {
        prompt: 'Generate a long response'
      }
    },
    {
      onData: (data) => {
        console.log('收到数据:', data);
      },
      onError: (error) => {
        console.error('错误:', error);
      },
      onComplete: () => {
        console.log('完成');
      }
    }
  );
}

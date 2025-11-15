# 流式处理数据完整性保证方案

## 概述

本方案在原有优化基础上，**确保所有数据都不丢失**，并正确处理**多条数据拼接**的情况。

## 核心特性

### 1. 数据完整性保证（默认启用）

- **原理**：使用多层缓冲区确保数据不丢失
- **实现**：
  - `batchBuffer`：批处理缓冲区
  - `messageQueue`：消息队列
  - `pendingDataBuffer`：待发送数据缓冲区（确保不丢失）
- **效果**：即使队列满了也不会丢弃数据，而是强制合并并发送

### 2. 多条数据拼接处理

- **原理**：智能识别和拆分拼接的JSON数据
- **实现**：
  - 检测字符串中是否包含多个完整的JSON对象
  - 使用括号计数和字符串状态检测来拆分
  - 支持 `{...}{...}` 和 `[{...},{...}]` 等多种格式
- **效果**：正确处理流式接口返回的多条拼接数据

### 3. 数据统计和验证

- **原理**：跟踪接收和发送的数据条数，验证完整性
- **实现**：
  - `totalDataReceived`：接收到的总数据条数
  - `totalDataSent`：已发送的总数据条数
  - 完成时自动验证数据是否全部发送
- **效果**：可以监控数据完整性，发现问题时及时告警

### 4. 强制合并机制

- **原理**：当队列满时，强制合并所有数据并发送
- **实现**：
  - 合并消息队列和待发送缓冲区的所有数据
  - 如果数据量很大，分批发送（允许更大的批次）
  - 发送失败时重新加入缓冲区（确保不丢失）
- **效果**：防止内存溢出，同时确保数据不丢失

## 使用方法

### 基本使用（启用数据完整性保证）

```typescript
import { StreamProcessorOptimized } from './providers/streamProcessorOptimized';

const processor = new StreamProcessorOptimized({
  webview: webview,
  messageType: 'streamData',
  historyFilePath: '/path/to/history.jsonl',
  // 数据完整性保证（默认启用）
  ensureDataIntegrity: true,
  // 批处理参数
  initialBatchSize: 20,
  minBatchSize: 5,
  maxBatchSize: 100,
  // 消息间隔参数
  initialMessageInterval: 100,
  minMessageInterval: 50,
  maxMessageInterval: 500,
  // 队列管理参数（增大默认值，确保有足够缓冲）
  maxQueueLength: 2000,
  // 自适应调整
  enableAdaptive: true,
  // 回调函数
  onData: (data) => {
    // 处理数据
  },
  onError: (error) => {
    // 处理错误
  },
  onComplete: () => {
    // 处理完成（此时所有数据都已发送）
  }
});

await processor.processStream(url, config);
```

### 在CaseWebviewProvider中使用

```typescript
vscode.postMessage({
  command: 'startStream',
  url: 'https://api.example.com/stream',
  config: { /* axios配置 */ },
  // 启用数据完整性保证（默认）
  ensureDataIntegrity: true,
  // 其他参数...
});
```

### 监控数据完整性

```typescript
// 获取状态
const status = processor.getStatus();
console.log('数据完整性:', status.dataIntegrity);
// {
//   allDataSent: true,  // 是否所有数据都已发送
//   pendingCount: 0     // 待发送数据条数
// }

console.log('数据统计:', {
  received: status.totalDataReceived,
  sent: status.totalDataSent,
  pending: status.pendingCount
});
```

## 多条数据拼接处理

### 支持的格式

1. **多个JSON对象拼接**
   ```
   data: {"id":1,"name":"A"}{"id":2,"name":"B"}
   ```

2. **JSON数组**
   ```
   data: [{"id":1,"name":"A"},{"id":2,"name":"B"}]
   ```

3. **混合格式**
   ```
   data: {"id":1}{"id":2}[{"id":3}]
   ```

### 处理流程

1. **检测完整性**：使用括号计数检测JSON是否完整
2. **尝试解析**：先尝试整体解析
3. **拆分处理**：如果整体解析失败，尝试拆分多个JSON对象
4. **分别处理**：将拆分后的数据分别加入处理流程

### 示例

```typescript
// 流式接口返回：
// data: {"id":1,"content":"A"}{"id":2,"content":"B"}

// 处理结果：
// handleData({id:1, content:"A"})
// handleData({id:2, content:"B"})
```

## 数据完整性保证机制

### 1. 多层缓冲区

```
接收数据 → batchBuffer → messageQueue/pendingDataBuffer → webview
```

- **batchBuffer**：临时批处理缓冲区
- **messageQueue**：消息队列（正常情况）
- **pendingDataBuffer**：待发送缓冲区（确保不丢失）

### 2. 强制合并策略

当 `messageQueue.length >= maxQueueLength` 时：
1. 合并消息队列中的所有数据
2. 合并待发送缓冲区的数据
3. 如果数据量很大，分批发送
4. 发送失败时重新加入缓冲区

### 3. 停止时的数据保证

停止时（`stop()` 方法）：
1. 如果启用了数据完整性保证，先发送所有待发送的数据
2. 刷新所有缓冲区
3. 发送停止消息时包含数据统计

### 4. 完成时的验证

流结束时：
1. 刷新所有缓冲区
2. 验证数据完整性：
   - 检查是否有待发送数据
   - 检查接收和发送的数据条数是否一致
3. 如果有问题，输出警告日志

## 参数说明

### 数据完整性参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `ensureDataIntegrity` | `true` | 是否启用数据完整性保证 |
| `maxQueueLength` | `2000` | 最大队列长度（增大默认值） |

### 其他参数

与原有方案相同，参见 `stream-processing-optimized-only-plugin.md`

## 性能影响

### 内存使用

- **启用数据完整性保证**：内存使用可能增加（多层缓冲区）
- **不启用**：内存使用与原有方案相同

### 处理速度

- **正常情况**：与原有方案相同
- **队列满时**：需要合并数据，可能稍慢，但确保数据不丢失

## 注意事项

1. **内存使用**：启用数据完整性保证时，内存使用可能增加
2. **停止响应**：启用数据完整性保证时，停止命令会等待所有数据发送完成
3. **多条数据拼接**：自动识别和拆分，无需特殊处理
4. **数据验证**：完成时会自动验证，发现问题会输出警告

## 与原方案对比

| 特性 | 原方案 | 数据完整性保证方案 |
|------|--------|-------------------|
| 数据丢失风险 | 队列满时可能丢弃 | ✅ 不会丢失 |
| 多条数据拼接 | 不支持 | ✅ 自动识别和拆分 |
| 数据统计 | 无 | ✅ 完整的统计和验证 |
| 停止响应 | 立即清空队列 | 等待数据发送完成 |
| 内存使用 | 较低 | 可能增加 |

## 推荐使用场景

### 使用数据完整性保证的场景

- ✅ 数据不能丢失的场景
- ✅ 需要处理多条数据拼接的情况
- ✅ 需要监控数据完整性的场景
- ✅ 对数据准确性要求高的场景

### 不使用数据完整性保证的场景

- ✅ 对性能要求极高，可以容忍少量数据丢失
- ✅ 数据量非常大，内存受限
- ✅ 实时性要求极高，不能等待数据发送完成

## 故障排查

### 数据统计不一致

如果 `totalDataReceived !== totalDataSent`：
1. 检查是否有待发送数据（`pendingCount > 0`）
2. 检查是否有发送失败的情况
3. 检查日志中的警告信息

### 多条数据未正确拆分

如果多条数据没有被正确拆分：
1. 检查数据格式是否符合预期
2. 检查 `parseData` 函数是否正确
3. 查看日志中的解析错误信息

### 内存使用过高

如果内存使用过高：
1. 减小 `maxQueueLength`
2. 增大 `initialBatchSize` 和 `maxBatchSize`
3. 减小 `initialMessageInterval`


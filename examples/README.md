# @vscode/ripgrep 文件搜索示例

本项目演示了如何使用 `@vscode/ripgrep` 库在大规模文件系统中进行高性能文本搜索。

## 功能特性

- 🚀 **高性能搜索**: 基于 ripgrep 的高性能文本搜索
- 📁 **大规模文件支持**: 适用于处理 70,000+ 文件的大型项目
- 🔍 **多种搜索模式**: 支持正则表达式、整词匹配、大小写敏感等
- 📊 **搜索统计**: 提供详细的搜索性能统计信息
- 💾 **结果保存**: 支持将搜索结果保存到 JSON 文件
- 🔄 **批量搜索**: 支持同时搜索多个模式

## 文件结构

```
examples/
├── file-search.ts          # TypeScript 版本的主要搜索类
├── file-search.js          # JavaScript 版本的主要搜索类
├── search-demo.ts          # TypeScript 版本的演示和测试
├── run-search.js           # 可执行的演示脚本
├── basic-usage.js          # 基本使用示例
└── advanced-usage.js       # 高级使用示例
```

## 快速开始

### 1. 安装依赖

```bash
npm install @vscode/ripgrep
```

如果安装失败，可以尝试使用替代包：

```bash
npm install @opensumi/vscode-ripgrep
```

### 2. 运行示例

```bash
# 进入示例目录
cd examples

# 运行完整演示
node run-search.js
```

### 3. 基本使用

```javascript
const { LargeScaleFileSearcher } = require('./file-search.js');

const searcher = new LargeScaleFileSearcher();

// 搜索函数定义
const functions = await searcher.searchText('function', './src', {
  lineNumber: true,
  includePattern: '*.{ts,js}'
});

// 搜索类定义
const classes = await searcher.searchText('class', './src', {
  lineNumber: true,
  includePattern: '*.{ts,js}'
});

// 搜索 TODO 注释
const todos = await searcher.searchText('TODO', '.', {
  lineNumber: true,
  caseSensitive: false
});
```

## 主要功能

### 1. 基本搜索

```javascript
// 简单文本搜索
const results = await searcher.searchText('pattern', './directory');

// 带选项的搜索
const results = await searcher.searchText('pattern', './directory', {
  caseSensitive: true,    // 区分大小写
  wholeWord: true,        // 整词匹配
  lineNumber: true,       // 显示行号
  maxCount: 100,          // 限制结果数量
  includePattern: '*.ts', // 只搜索 TypeScript 文件
  excludePattern: 'test/**' // 排除测试文件
});
```

### 2. 文件类型搜索

```javascript
// 搜索代码文件
const codeResults = await searcher.searchInCodeFiles('export', './src');

// 搜索配置文件
const configResults = await searcher.searchInConfigFiles('version', '.');

// 搜索特定文件类型
const tsResults = await searcher.searchInFileTypes('interface', ['ts', 'tsx'], './src');
```

### 3. 批量搜索

```javascript
const patterns = ['function', 'class', 'interface'];
const batchResults = await searcher.batchSearch(patterns, './src', {
  maxCount: 10
});

batchResults.forEach((results, pattern) => {
  console.log(`模式 "${pattern}" 找到 ${results.length} 个匹配项`);
});
```

### 4. 搜索统计

```javascript
const stats = await searcher.getSearchStats('export', './src');
console.log(`总文件数: ${stats.totalFiles}`);
console.log(`总匹配数: ${stats.totalMatches}`);
console.log(`搜索耗时: ${stats.searchTime}ms`);
```

### 5. 保存搜索结果

```javascript
await searcher.searchAndSave('TODO', '.', './todos.json', {
  lineNumber: true
});
```

## 搜索选项

| 选项 | 类型 | 说明 |
|------|------|------|
| `caseSensitive` | boolean | 是否区分大小写 |
| `wholeWord` | boolean | 是否整词匹配 |
| `regexp` | boolean | 是否使用正则表达式 |
| `lineNumber` | boolean | 是否显示行号 |
| `column` | boolean | 是否显示列号 |
| `context` | number | 显示上下文行数 |
| `includePattern` | string/array | 包含的文件模式 |
| `excludePattern` | string/array | 排除的文件模式 |
| `maxCount` | number | 最大结果数量 |
| `maxDepth` | number | 最大搜索深度 |
| `followSymlinks` | boolean | 是否跟随符号链接 |
| `multiline` | boolean | 是否多行匹配 |

## 性能优化建议

1. **使用适当的排除模式**: 排除 `node_modules`、`.git` 等不需要搜索的目录
2. **限制搜索范围**: 使用 `includePattern` 限制文件类型
3. **设置最大结果数**: 使用 `maxCount` 避免返回过多结果
4. **批量搜索**: 对于多个模式，使用 `batchSearch` 而不是多次单独搜索

## 错误处理

```javascript
try {
  const results = await searcher.searchText('pattern', './directory');
  console.log(`找到 ${results.length} 个匹配项`);
} catch (error) {
  if (error.message.includes('No such file or directory')) {
    console.error('目录不存在');
  } else if (error.message.includes('Permission denied')) {
    console.error('权限不足');
  } else {
    console.error('搜索失败:', error.message);
  }
}
```

## 示例输出

运行 `node run-search.js` 会看到类似以下的输出：

```
🚀 启动 @vscode/ripgrep 文件搜索示例

🎯 开始文件搜索演示...

✅ 创建测试文件: ./test-files/example.ts
✅ 创建测试文件: ./test-files/config.json
✅ 创建测试文件: ./test-files/utils.js

🔍 演示1: 搜索函数定义
🔍 开始搜索: "function" 在目录 "./test-files"
✅ 搜索完成，耗时: 18ms，找到 2 个匹配项
找到 2 个函数定义:
  📄 ./test-files\utils.js:19 - function processFiles(files) {
  📄 ./test-files\example.ts:23 - export function createExample(name: string): ExampleClass {

🔍 演示2: 搜索类定义
🔍 开始搜索: "class" 在目录 "./test-files"
✅ 搜索完成，耗时: 19ms，找到 2 个匹配项
找到 2 个类定义:
  📄 ./test-files\utils.js:5 - class FileUtils {
  📄 ./test-files\example.ts:2 - export class ExampleClass {

...

⚡ 开始性能测试...

🔍 搜索 "function":
  📁 文件数: 5
  🔍 匹配数: 8
  ⏱️  耗时: 18ms
  📊 平均每文件: 3.6ms

✅ 所有示例执行完成！
```

## 注意事项

1. 确保已安装 `@vscode/ripgrep` 依赖包
2. 搜索大量文件时注意性能，建议使用适当的排除模式
3. 正则表达式搜索需要设置 `regexp: true` 选项
4. 搜索结果的文件路径使用系统默认分隔符（Windows 使用 `\`，Unix 使用 `/`）

## 故障排除

### 安装问题

如果 `@vscode/ripgrep` 安装失败，可以尝试：

1. 使用替代包：`npm install @opensumi/vscode-ripgrep`
2. 配置代理或使用国内镜像源
3. 手动下载 ripgrep 二进制文件

### 搜索问题

1. **路径不存在**: 检查搜索目录是否存在
2. **权限问题**: 确保有读取文件的权限
3. **模式错误**: 检查搜索模式是否正确
4. **超时问题**: 对于大型项目，可能需要增加超时时间

这个示例展示了如何在实际项目中使用 `@vscode/ripgrep` 进行高效的文件搜索，特别适合处理大量文件的场景。

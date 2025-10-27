/**
 * 使用示例和测试文件
 * 
 * 演示如何使用 LargeScaleFileSearcher 进行文件搜索
 */

import { LargeScaleFileSearcher, SearchResult } from './file-search';

/**
 * 创建测试文件用于演示搜索功能
 */
async function createTestFiles(): Promise<void> {
  const fs = require('fs').promises;
  
  // 创建测试目录
  await fs.mkdir('./test-files', { recursive: true });
  
  // 创建各种类型的测试文件
  const testFiles = [
    {
      path: './test-files/example.ts',
      content: `// TypeScript 示例文件
export class ExampleClass {
  private name: string;
  
  constructor(name: string) {
    this.name = name;
  }
  
  public getName(): string {
    return this.name;
  }
  
  public async processData(): Promise<void> {
    console.log('Processing data...');
  }
}

export interface ExampleInterface {
  id: number;
  title: string;
}

export function createExample(name: string): ExampleClass {
  return new ExampleClass(name);
}

// TODO: 添加更多功能
// FIXME: 修复类型定义问题
`
    },
    {
      path: './test-files/config.json',
      content: `{
  "name": "test-project",
  "version": "1.0.0",
  "description": "测试项目",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "build": "tsc",
    "test": "jest"
  },
  "dependencies": {
    "@vscode/ripgrep": "^1.0.0"
  }
}`
    },
    {
      path: './test-files/utils.js',
      content: `// JavaScript 工具文件
const fs = require('fs');
const path = require('path');

class FileUtils {
  static readFile(filePath) {
    return fs.readFileSync(filePath, 'utf8');
  }
  
  static writeFile(filePath, content) {
    fs.writeFileSync(filePath, content);
  }
  
  static exists(filePath) {
    return fs.existsSync(filePath);
  }
}

function processFiles(files) {
  return files.map(file => {
    if (FileUtils.exists(file)) {
      return FileUtils.readFile(file);
    }
    return null;
  });
}

module.exports = { FileUtils, processFiles };
`
    },
    {
      path: './test-files/README.md',
      content: `# 测试项目

这是一个用于演示 @vscode/ripgrep 搜索功能的测试项目。

## 功能特性

- 高性能文件搜索
- 支持正则表达式
- 支持多种文件类型
- 批量搜索功能

## 使用方法

\`\`\`typescript
import { LargeScaleFileSearcher } from './file-search';

const searcher = new LargeScaleFileSearcher();
const results = await searcher.searchText('function', '.');
\`\`\`

## 注意事项

- 确保已安装 @vscode/ripgrep 依赖
- 搜索大量文件时注意性能
- 使用适当的排除模式避免搜索不必要的文件
`
    }
  ];
  
  for (const file of testFiles) {
    await fs.writeFile(file.path, file.content, 'utf8');
    console.log(`✅ 创建测试文件: ${file.path}`);
  }
}

/**
 * 运行搜索演示
 */
async function runSearchDemo(): Promise<void> {
  console.log('🎯 开始文件搜索演示...\n');
  
  // 创建测试文件
  await createTestFiles();
  
  const searcher = new LargeScaleFileSearcher();
  
  try {
    // 演示1: 搜索函数定义
    console.log('🔍 演示1: 搜索函数定义');
    const functions = await searcher.searchInCodeFiles('function\\s+\\w+', './test-files', {
      regexp: true,
      lineNumber: true
    });
    console.log(`找到 ${functions.length} 个函数定义:`);
    functions.forEach(f => {
      console.log(`  📄 ${f.file}:${f.lineNumber} - ${f.content.trim()}`);
    });
    console.log('---\n');
    
    // 演示2: 搜索类定义
    console.log('🔍 演示2: 搜索类定义');
    const classes = await searcher.searchInCodeFiles('class\\s+\\w+', './test-files', {
      regexp: true,
      lineNumber: true
    });
    console.log(`找到 ${classes.length} 个类定义:`);
    classes.forEach(c => {
      console.log(`  📄 ${c.file}:${c.lineNumber} - ${c.content.trim()}`);
    });
    console.log('---\n');
    
    // 演示3: 搜索 TODO 和 FIXME 注释
    console.log('🔍 演示3: 搜索 TODO 和 FIXME 注释');
    const todos = await searcher.searchText('TODO|FIXME', './test-files', {
      regexp: true,
      lineNumber: true,
      caseSensitive: false
    });
    console.log(`找到 ${todos.length} 个待办事项:`);
    todos.forEach(t => {
      console.log(`  📄 ${t.file}:${t.lineNumber} - ${t.content.trim()}`);
    });
    console.log('---\n');
    
    // 演示4: 搜索配置文件中的特定字段
    console.log('🔍 演示4: 搜索配置文件');
    const configs = await searcher.searchInConfigFiles('"name"|"version"', './test-files', {
      regexp: true,
      lineNumber: true
    });
    console.log(`找到 ${configs.length} 个配置项:`);
    configs.forEach(c => {
      console.log(`  📄 ${c.file}:${c.lineNumber} - ${c.content.trim()}`);
    });
    console.log('---\n');
    
    // 演示5: 搜索导入语句
    console.log('🔍 演示5: 搜索导入语句');
    const imports = await searcher.searchInCodeFiles('import|require', './test-files', {
      regexp: true,
      lineNumber: true
    });
    console.log(`找到 ${imports.length} 个导入语句:`);
    imports.forEach(i => {
      console.log(`  📄 ${i.file}:${i.lineNumber} - ${i.content.trim()}`);
    });
    console.log('---\n');
    
    // 演示6: 获取搜索统计
    console.log('📊 演示6: 搜索统计信息');
    const stats = await searcher.getSearchStats('export', './test-files');
    console.log(`搜索 "export" 的统计信息:`);
    console.log(`  📁 总文件数: ${stats.totalFiles}`);
    console.log(`  🔍 总匹配数: ${stats.totalMatches}`);
    console.log(`  ⏱️  搜索耗时: ${stats.searchTime}ms`);
    console.log(`  📄 有匹配的文件数: ${stats.filesWithMatches}`);
    console.log('---\n');
    
    // 演示7: 批量搜索
    console.log('🔄 演示7: 批量搜索');
    const patterns = ['class', 'function', 'interface'];
    const batchResults = await searcher.batchSearch(patterns, './test-files', { 
      maxCount: 5 
    });
    
    batchResults.forEach((results, pattern) => {
      console.log(`模式 "${pattern}" 找到 ${results.length} 个匹配项:`);
      results.forEach(r => {
        console.log(`  📄 ${r.file}:${r.lineNumber} - ${r.content.trim()}`);
      });
    });
    console.log('---\n');
    
    // 演示8: 搜索并保存结果
    console.log('💾 演示8: 搜索并保存结果');
    await searcher.searchAndSave('export', './test-files', './search-results.json', {
      maxCount: 10
    });
    console.log('搜索结果已保存到 search-results.json');
    
  } catch (error) {
    console.error('❌ 演示执行失败:', error);
  }
}

/**
 * 性能测试
 */
async function runPerformanceTest(): Promise<void> {
  console.log('⚡ 开始性能测试...\n');
  
  const searcher = new LargeScaleFileSearcher();
  
  try {
    // 测试搜索当前项目中的文件
    const testPatterns = [
      'function',
      'class',
      'interface',
      'export',
      'import'
    ];
    
    for (const pattern of testPatterns) {
      const startTime = Date.now();
      const stats = await searcher.getSearchStats(pattern, './src');
      const endTime = Date.now();
      
      console.log(`🔍 搜索 "${pattern}":`);
      console.log(`  📁 文件数: ${stats.totalFiles}`);
      console.log(`  🔍 匹配数: ${stats.totalMatches}`);
      console.log(`  ⏱️  耗时: ${endTime - startTime}ms`);
      console.log(`  📊 平均每文件: ${stats.totalFiles > 0 ? (endTime - startTime) / stats.totalFiles : 0}ms`);
      console.log('---');
    }
    
  } catch (error) {
    console.error('❌ 性能测试失败:', error);
  }
}

// 如果直接运行此文件，则执行演示
if (require.main === module) {
  runSearchDemo()
    .then(() => runPerformanceTest())
    .catch(console.error);
}

export { runSearchDemo, runPerformanceTest, createTestFiles };

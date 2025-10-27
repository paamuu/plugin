/**
 * 运行文件搜索示例的脚本
 * 
 * 使用方法:
 * npm run search-demo
 * 或
 * node examples/run-search.js
 */

const { LargeScaleFileSearcher } = require('./file-search.js');

async function createTestFiles() {
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
    }
  ];
  
  for (const file of testFiles) {
    await fs.writeFile(file.path, file.content, 'utf8');
    console.log(`✅ 创建测试文件: ${file.path}`);
  }
}

async function runSearchDemo() {
  console.log('🎯 开始文件搜索演示...\n');
  
  // 创建测试文件
  await createTestFiles();
  
  const searcher = new LargeScaleFileSearcher();
  
  try {
    // 演示1: 搜索函数定义
    console.log('🔍 演示1: 搜索函数定义');
    const functions = await searcher.searchText('function', './test-files', {
      lineNumber: true,
      includePattern: '*.{ts,js}'
    });
    console.log(`找到 ${functions.length} 个函数定义:`);
    functions.forEach(f => {
      console.log(`  📄 ${f.file}:${f.lineNumber} - ${f.content.trim()}`);
    });
    console.log('---\n');
    
    // 演示2: 搜索类定义
    console.log('🔍 演示2: 搜索类定义');
    const classes = await searcher.searchText('class', './test-files', {
      lineNumber: true,
      includePattern: '*.{ts,js}'
    });
    console.log(`找到 ${classes.length} 个类定义:`);
    classes.forEach(c => {
      console.log(`  📄 ${c.file}:${c.lineNumber} - ${c.content.trim()}`);
    });
    console.log('---\n');
    
    // 演示3: 搜索 TODO 和 FIXME 注释
    console.log('🔍 演示3: 搜索 TODO 和 FIXME 注释');
    const todos = await searcher.searchText('TODO', './test-files', {
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
    const configs = await searcher.searchText('name', './test-files', {
      lineNumber: true,
      includePattern: '*.json'
    });
    console.log(`找到 ${configs.length} 个配置项:`);
    configs.forEach(c => {
      console.log(`  📄 ${c.file}:${c.lineNumber} - ${c.content.trim()}`);
    });
    console.log('---\n');
    
    // 演示5: 获取搜索统计
    console.log('📊 演示5: 搜索统计信息');
    const stats = await searcher.getSearchStats('export', './test-files');
    console.log(`搜索 "export" 的统计信息:`);
    console.log(`  📁 总文件数: ${stats.totalFiles}`);
    console.log(`  🔍 总匹配数: ${stats.totalMatches}`);
    console.log(`  ⏱️  搜索耗时: ${stats.searchTime}ms`);
    console.log(`  📄 有匹配的文件数: ${stats.filesWithMatches}`);
    console.log('---\n');
    
    // 演示6: 搜索并保存结果
    console.log('💾 演示6: 搜索并保存结果');
    await searcher.searchAndSave('export', './test-files', './search-results.json', {
      maxCount: 10
    });
    console.log('搜索结果已保存到 search-results.json');
    
  } catch (error) {
    console.error('❌ 演示执行失败:', error);
  }
}

async function runPerformanceTest() {
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
      try {
        const startTime = Date.now();
        const stats = await searcher.getSearchStats(pattern, '.');
        const endTime = Date.now();
        
        console.log(`🔍 搜索 "${pattern}":`);
        console.log(`  📁 文件数: ${stats.totalFiles}`);
        console.log(`  🔍 匹配数: ${stats.totalMatches}`);
        console.log(`  ⏱️  耗时: ${endTime - startTime}ms`);
        console.log(`  📊 平均每文件: ${stats.totalFiles > 0 ? (endTime - startTime) / stats.totalFiles : 0}ms`);
        console.log('---');
      } catch (error) {
        console.log(`🔍 搜索 "${pattern}": 跳过（目录不存在或权限问题）`);
      }
    }
    
  } catch (error) {
    console.error('❌ 性能测试失败:', error);
  }
}

async function main() {
  console.log('🚀 启动 @vscode/ripgrep 文件搜索示例\n');
  
  try {
    // 运行搜索演示
    await runSearchDemo();
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // 运行性能测试
    await runPerformanceTest();
    
    console.log('\n✅ 所有示例执行完成！');
    
  } catch (error) {
    console.error('❌ 示例执行失败:', error);
    process.exit(1);
  }
}

// 运行主函数
main();

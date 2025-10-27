/**
 * @vscode/ripgrep 高级使用示例
 * 
 * 包含正则表达式搜索、结果解析、错误处理等高级功能
 */

const { rgPath } = require('@vscode/ripgrep');
const { spawn } = require('child_process');
const fs = require('fs').promises;

/**
 * 搜索结果接口
 */
interface SearchResult {
  file: string;
  lineNumber: number;
  column?: number;
  content: string;
  match?: string;
}

/**
 * 搜索选项接口
 */
interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
  lineNumber?: boolean;
  column?: boolean;
  context?: number;
  includePattern?: string;
  excludePattern?: string;
  maxCount?: number;
  maxDepth?: number;
}

/**
 * 高级搜索类
 */
class AdvancedRipgrepSearch {
  private rgPath: string;

  constructor() {
    this.rgPath = rgPath;
  }

  /**
   * 执行搜索并返回结构化结果
   */
  async search(pattern: string, directory: string = '.', options: SearchOptions = {}): Promise<SearchResult[]> {
    return new Promise((resolve, reject) => {
      const args = this.buildArgs(pattern, directory, options);
      
      console.log(`执行搜索: ${this.rgPath} ${args.join(' ')}`);
      
      const rg = spawn(this.rgPath, args);
      let output = '';
      let error = '';

      rg.stdout.on('data', (data) => {
        output += data.toString();
      });

      rg.stderr.on('data', (data) => {
        error += data.toString();
      });

      rg.on('close', (code) => {
        if (code === 0) {
          const results = this.parseResults(output, options);
          resolve(results);
        } else {
          reject(new Error(error || `搜索失败，退出码: ${code}`));
        }
      });
    });
  }

  /**
   * 构建 ripgrep 参数
   */
  private buildArgs(pattern: string, directory: string, options: SearchOptions): string[] {
    const args = [];
    
    if (options.caseSensitive) args.push('--case-sensitive');
    if (options.wholeWord) args.push('--word-regexp');
    if (options.regexp) args.push('--regexp');
    if (options.lineNumber) args.push('--line-number');
    if (options.column) args.push('--column');
    if (options.context) args.push('--context', options.context.toString());
    if (options.includePattern) args.push('--glob', options.includePattern);
    if (options.excludePattern) args.push('--glob', `!${options.excludePattern}`);
    if (options.maxCount) args.push('--max-count', options.maxCount.toString());
    if (options.maxDepth) args.push('--max-depth', options.maxDepth.toString());
    
    args.push(pattern, directory);
    return args;
  }

  /**
   * 解析搜索结果
   */
  private parseResults(output: string, options: SearchOptions): SearchResult[] {
    const lines = output.split('\n').filter(line => line.trim());
    const results: SearchResult[] = [];

    for (const line of lines) {
      const result = this.parseLine(line, options);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * 解析单行结果
   */
  private parseLine(line: string, options: SearchOptions): SearchResult | null {
    // 带行号和列号的格式: file:line:column:content
    // 带行号的格式: file:line:content
    // 基本格式: file:content
    
    let match;
    if (options.column) {
      match = line.match(/^(.+):(\d+):(\d+):(.+)$/);
      if (match) {
        return {
          file: match[1],
          lineNumber: parseInt(match[2]),
          column: parseInt(match[3]),
          content: match[4]
        };
      }
    }
    
    if (options.lineNumber) {
      match = line.match(/^(.+):(\d+):(.+)$/);
      if (match) {
        return {
          file: match[1],
          lineNumber: parseInt(match[2]),
          content: match[3]
        };
      }
    }
    
    // 基本格式
    match = line.match(/^(.+):(.+)$/);
    if (match) {
      return {
        file: match[1],
        lineNumber: 0,
        content: match[2]
      };
    }
    
    return null;
  }

  /**
   * 搜索函数定义
   */
  async searchFunctionDefinitions(directory: string = '.'): Promise<SearchResult[]> {
    return this.search('^(export\\s+)?(async\\s+)?function\\s+\\w+', directory, {
      regexp: true,
      lineNumber: true,
      includePattern: '*.ts'
    });
  }

  /**
   * 搜索类定义
   */
  async searchClassDefinitions(directory: string = '.'): Promise<SearchResult[]> {
    return this.search('^(export\\s+)?class\\s+\\w+', directory, {
      regexp: true,
      lineNumber: true,
      includePattern: '*.ts'
    });
  }

  /**
   * 搜索导入语句
   */
  async searchImports(directory: string = '.'): Promise<SearchResult[]> {
    return this.search('^import\\s+.*from\\s+[\'"]', directory, {
      regexp: true,
      lineNumber: true,
      includePattern: '*.ts'
    });
  }

  /**
   * 搜索 TODO 注释
   */
  async searchTodos(directory: string = '.'): Promise<SearchResult[]> {
    return this.search('TODO|FIXME|HACK|NOTE', directory, {
      caseSensitive: false,
      lineNumber: true,
      includePattern: '*.{ts,js,tsx,jsx}'
    });
  }

  /**
   * 搜索特定文件中的内容
   */
  async searchInFile(filePath: string, pattern: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    try {
      await fs.access(filePath);
      return this.search(pattern, filePath, options);
    } catch (error) {
      throw new Error(`文件不存在: ${filePath}`);
    }
  }

  /**
   * 获取文件统计信息
   */
  async getFileStats(directory: string = '.'): Promise<{ totalFiles: number; totalLines: number }> {
    const results = await this.search('.', directory, {
      includePattern: '*.{ts,js,tsx,jsx}',
      lineNumber: true
    });

    const fileMap = new Map<string, number>();
    let totalLines = 0;

    for (const result of results) {
      if (!fileMap.has(result.file)) {
        fileMap.set(result.file, 0);
      }
      fileMap.set(result.file, fileMap.get(result.file)! + 1);
      totalLines++;
    }

    return {
      totalFiles: fileMap.size,
      totalLines
    };
  }
}

/**
 * 高级搜索示例函数
 */
async function runAdvancedExamples() {
  const searcher = new AdvancedRipgrepSearch();
  
  try {
    console.log('=== @vscode/ripgrep 高级使用示例 ===\n');
    
    // 示例1: 搜索函数定义
    console.log('1. 搜索函数定义:');
    const functions = await searcher.searchFunctionDefinitions('./src');
    functions.forEach(f => {
      console.log(`${f.file}:${f.lineNumber} - ${f.content}`);
    });
    console.log('---\n');
    
    // 示例2: 搜索类定义
    console.log('2. 搜索类定义:');
    const classes = await searcher.searchClassDefinitions('./src');
    classes.forEach(c => {
      console.log(`${c.file}:${c.lineNumber} - ${c.content}`);
    });
    console.log('---\n');
    
    // 示例3: 搜索导入语句
    console.log('3. 搜索导入语句:');
    const imports = await searcher.searchImports('./src');
    imports.slice(0, 5).forEach(i => {
      console.log(`${i.file}:${i.lineNumber} - ${i.content}`);
    });
    console.log('---\n');
    
    // 示例4: 搜索 TODO 注释
    console.log('4. 搜索 TODO 注释:');
    const todos = await searcher.searchTodos('.');
    todos.forEach(t => {
      console.log(`${t.file}:${t.lineNumber} - ${t.content}`);
    });
    console.log('---\n');
    
    // 示例5: 获取文件统计
    console.log('5. 文件统计信息:');
    const stats = await searcher.getFileStats('./src');
    console.log(`总文件数: ${stats.totalFiles}`);
    console.log(`总行数: ${stats.totalLines}`);
    
  } catch (error) {
    console.error('高级搜索失败:', error.message);
    console.log('\n提示: 请确保已安装 @vscode/ripgrep 依赖包');
    console.log('npm install @vscode/ripgrep');
  }
}

// 如果直接运行此文件，则执行示例
if (require.main === module) {
  runAdvancedExamples();
}

module.exports = {
  AdvancedRipgrepSearch,
  runAdvancedExamples
};


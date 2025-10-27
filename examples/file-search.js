/**
 * 使用 @vscode/ripgrep 在大规模文件系统中进行文本搜索 (JavaScript 版本)
 * 
 * 适用于处理大量文件（如 70,000+ 文件）的高性能搜索场景
 */

const { rgPath } = require('@vscode/ripgrep');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * 大规模文件搜索器
 */
class LargeScaleFileSearcher {
  constructor() {
    this.rgPath = rgPath;
    // 默认排除的目录和文件模式
    this.defaultExcludePatterns = [
      'node_modules/**',
      '.git/**',
      'dist/**',
      'build/**',
      'out/**',
      '*.log',
      '*.tmp',
      '.DS_Store',
      'Thumbs.db'
    ];
  }

  /**
   * 搜索文本内容
   * @param {string} pattern - 搜索模式
   * @param {string} searchDirectory - 搜索目录
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>} 搜索结果
   */
  async searchText(pattern, searchDirectory = '.', options = {}) {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const args = this.buildSearchArgs(pattern, searchDirectory, options);
      
      console.log(`🔍 开始搜索: "${pattern}" 在目录 "${searchDirectory}"`);
      console.log(`📋 执行命令: ${this.rgPath} ${args.join(' ')}`);
      
      const rg = spawn(this.rgPath, args);
      let output = '';
      let error = '';
      let isResolved = false;

      // 设置超时
      const timeout = setTimeout(() => {
        if (!isResolved) {
          rg.kill();
          reject(new Error('搜索超时（30秒）'));
        }
      }, 30000);

      rg.stdout?.on('data', (data) => {
        output += data.toString();
      });

      rg.stderr?.on('data', (data) => {
        error += data.toString();
      });

      rg.on('close', (code) => {
        clearTimeout(timeout);
        
        if (isResolved) {
          return;
        }
        isResolved = true;

        const searchTime = Date.now() - startTime;
        
        if (code === 0) {
          const results = this.parseSearchResults(output, options);
          console.log(`✅ 搜索完成，耗时: ${searchTime}ms，找到 ${results.length} 个匹配项`);
          resolve(results);
        } else {
          const errorMsg = error || `ripgrep 退出码: ${code}`;
          console.error(`❌ 搜索失败: ${errorMsg}`);
          reject(new Error(errorMsg));
        }
      });

      rg.on('error', (err) => {
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          console.error(`❌ 进程错误: ${err.message}`);
          reject(err);
        }
      });
    });
  }

  /**
   * 构建搜索参数
   */
  buildSearchArgs(pattern, directory, options) {
    const args = [];

    // 基本选项
    if (options.caseSensitive) {
      args.push('--case-sensitive');
    }
    if (options.wholeWord) {
      args.push('--word-regexp');
    }
    if (options.regexp) {
      args.push('--regexp');
    }
    if (options.lineNumber) {
      args.push('--line-number');
    }
    if (options.column) {
      args.push('--column');
    }
    if (options.multiline) {
      args.push('--multiline');
    }
    if (options.followSymlinks) {
      args.push('--follow');
    }
    
    // 上下文行数
    if (options.context) {
      args.push('--context', options.context.toString());
    }
    
    // 限制选项
    if (options.maxCount) {
      args.push('--max-count', options.maxCount.toString());
    }
    if (options.maxDepth) {
      args.push('--max-depth', options.maxDepth.toString());
    }
    
    // 包含模式
    if (options.includePattern) {
      const patterns = Array.isArray(options.includePattern) 
        ? options.includePattern 
        : [options.includePattern];
      patterns.forEach(pattern => {
        args.push('--glob', pattern);
      });
    }
    
    // 排除模式
    const excludePatterns = [
      ...this.defaultExcludePatterns,
      ...(options.excludePattern ? 
        (Array.isArray(options.excludePattern) ? options.excludePattern : [options.excludePattern]) 
        : [])
    ];
    excludePatterns.forEach(pattern => {
      args.push('--glob', `!${pattern}`);
    });
    
    args.push(pattern, directory);
    return args;
  }

  /**
   * 解析搜索结果
   */
  parseSearchResults(output, options) {
    const lines = output.split('\n').filter(line => line.trim());
    const results = [];

    for (const line of lines) {
      const result = this.parseSearchLine(line, options);
      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * 解析单行搜索结果
   */
  parseSearchLine(line, options) {
    let match = null;
    
    // 带行号和列号的格式: file:line:column:content
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
    
    // 带行号的格式: file:line:content
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
    
    // 基本格式: file:content
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
   * 搜索特定文件类型
   */
  async searchInFileTypes(pattern, fileTypes, searchDirectory = '.', options = {}) {
    const includePattern = fileTypes.map(type => `*.${type}`).join(',');
    
    return this.searchText(pattern, searchDirectory, {
      ...options,
      includePattern,
      lineNumber: true
    });
  }

  /**
   * 搜索代码文件（TypeScript, JavaScript, JSON 等）
   */
  async searchInCodeFiles(pattern, searchDirectory = '.', options = {}) {
    return this.searchInFileTypes(pattern, ['ts', 'js', 'tsx', 'jsx', 'json'], searchDirectory, options);
  }

  /**
   * 搜索配置文件
   */
  async searchInConfigFiles(pattern, searchDirectory = '.', options = {}) {
    return this.searchInFileTypes(pattern, ['json', 'yaml', 'yml', 'toml', 'ini', 'conf'], searchDirectory, options);
  }

  /**
   * 获取搜索统计信息
   */
  async getSearchStats(pattern, searchDirectory = '.', options = {}) {
    const startTime = Date.now();
    const results = await this.searchText(pattern, searchDirectory, options);
    const searchTime = Date.now() - startTime;
    
    const fileSet = new Set(results.map(r => r.file));
    
    return {
      totalFiles: fileSet.size,
      totalMatches: results.length,
      searchTime,
      filesWithMatches: fileSet.size
    };
  }

  /**
   * 批量搜索多个模式
   */
  async batchSearch(patterns, searchDirectory = '.', options = {}) {
    const results = new Map();
    
    console.log(`🔄 开始批量搜索 ${patterns.length} 个模式...`);
    
    for (const pattern of patterns) {
      try {
        const patternResults = await this.searchText(pattern, searchDirectory, options);
        results.set(pattern, patternResults);
        console.log(`✅ 模式 "${pattern}" 找到 ${patternResults.length} 个匹配项`);
      } catch (error) {
        console.error(`❌ 模式 "${pattern}" 搜索失败:`, error);
        results.set(pattern, []);
      }
    }
    
    return results;
  }

  /**
   * 搜索并保存结果到文件
   */
  async searchAndSave(pattern, searchDirectory = '.', outputFile, options = {}) {
    const results = await this.searchText(pattern, searchDirectory, options);
    
    const output = {
      searchPattern: pattern,
      searchDirectory,
      searchTime: new Date().toISOString(),
      totalResults: results.length,
      results: results
    };
    
    await fs.promises.writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8');
    console.log(`💾 搜索结果已保存到: ${outputFile}`);
  }
}

/**
 * 示例使用函数
 */
async function runFileSearchExamples() {
  const searcher = new LargeScaleFileSearcher();
  
  try {
    console.log('🚀 开始大规模文件搜索示例...\n');
    
    // 示例1: 搜索函数定义
    console.log('📝 示例1: 搜索函数定义');
    const functions = await searcher.searchInCodeFiles('function\\s+\\w+\\s*\\(', '.', {
      regexp: true,
      maxCount: 10
    });
    console.log(`找到 ${functions.length} 个函数定义:`);
    functions.slice(0, 5).forEach(f => {
      console.log(`  ${f.file}:${f.lineNumber} - ${f.content.substring(0, 80)}...`);
    });
    console.log('---\n');
    
    // 示例2: 搜索类定义
    console.log('📝 示例2: 搜索类定义');
    const classes = await searcher.searchInCodeFiles('class\\s+\\w+', '.', {
      regexp: true,
      maxCount: 5
    });
    console.log(`找到 ${classes.length} 个类定义:`);
    classes.forEach(c => {
      console.log(`  ${c.file}:${c.lineNumber} - ${c.content}`);
    });
    console.log('---\n');
    
    // 示例3: 搜索导入语句
    console.log('📝 示例3: 搜索导入语句');
    const imports = await searcher.searchInCodeFiles('import.*from', '.', {
      regexp: true,
      maxCount: 10
    });
    console.log(`找到 ${imports.length} 个导入语句:`);
    imports.slice(0, 5).forEach(i => {
      console.log(`  ${i.file}:${i.lineNumber} - ${i.content}`);
    });
    console.log('---\n');
    
    // 示例4: 搜索配置文件中的特定内容
    console.log('📝 示例4: 搜索配置文件');
    const configs = await searcher.searchInConfigFiles('"name"', '.', {
      maxCount: 5
    });
    console.log(`找到 ${configs.length} 个配置文件:`);
    configs.forEach(c => {
      console.log(`  ${c.file}:${c.lineNumber} - ${c.content}`);
    });
    console.log('---\n');
    
    // 示例5: 获取搜索统计
    console.log('📝 示例5: 搜索统计信息');
    const stats = await searcher.getSearchStats('export', './src');
    console.log(`搜索 "export" 的统计信息:`);
    console.log(`  总文件数: ${stats.totalFiles}`);
    console.log(`  总匹配数: ${stats.totalMatches}`);
    console.log(`  搜索耗时: ${stats.searchTime}ms`);
    console.log(`  有匹配的文件数: ${stats.filesWithMatches}`);
    console.log('---\n');
    
    // 示例6: 批量搜索
    console.log('📝 示例6: 批量搜索');
    const patterns = ['function', 'class', 'interface'];
    const batchResults = await searcher.batchSearch(patterns, './src', { maxCount: 3 });
    
    batchResults.forEach((results, pattern) => {
      console.log(`模式 "${pattern}" 找到 ${results.length} 个匹配项`);
    });
    
  } catch (error) {
    console.error('❌ 搜索示例执行失败:', error);
  }
}

// 如果直接运行此文件，则执行示例
if (require.main === module) {
  runFileSearchExamples().catch(console.error);
}

module.exports = {
  LargeScaleFileSearcher,
  runFileSearchExamples
};
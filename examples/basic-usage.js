/**
 * @vscode/ripgrep 基本使用示例
 * 
 * 安装依赖：
 * npm install @vscode/ripgrep
 * 
 * 如果安装失败，可以尝试：
 * npm install @opensumi/vscode-ripgrep
 */

const { rgPath } = require('@vscode/ripgrep');
const { spawn } = require('child_process');
const path = require('path');

/**
 * 基本文本搜索函数
 * @param {string} pattern - 搜索模式
 * @param {string} directory - 搜索目录
 * @param {Object} options - 搜索选项
 * @returns {Promise<string>} 搜索结果
 */
function searchText(pattern, directory = '.', options = {}) {
  return new Promise((resolve, reject) => {
    const args = [pattern, directory];
    
    // 添加选项
    if (options.caseSensitive) args.push('--case-sensitive');
    if (options.wholeWord) args.push('--word-regexp');
    if (options.lineNumber) args.push('--line-number');
    if (options.includePattern) args.push('--glob', options.includePattern);
    if (options.excludePattern) args.push('--glob', `!${options.excludePattern}`);
    if (options.maxCount) args.push('--max-count', options.maxCount.toString());
    
    console.log(`执行命令: ${rgPath} ${args.join(' ')}`);
    
    const rg = spawn(rgPath, args);
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
        resolve(output);
      } else {
        reject(new Error(error || `ripgrep 退出码: ${code}`));
      }
    });
  });
}

/**
 * 搜索示例函数
 */
async function runExamples() {
  try {
    console.log('=== @vscode/ripgrep 基本使用示例 ===\n');
    
    // 示例1: 基本搜索
    console.log('1. 基本搜索 "function" 关键字:');
    const basicResults = await searchText('function', './src');
    console.log(basicResults);
    console.log('---\n');
    
    // 示例2: 搜索特定文件类型
    console.log('2. 搜索 TypeScript 文件中的 "export" 关键字:');
    const tsResults = await searchText('export', '.', {
      includePattern: '*.ts',
      excludePattern: 'node_modules/**',
      lineNumber: true
    });
    console.log(tsResults);
    console.log('---\n');
    
    // 示例3: 区分大小写搜索
    console.log('3. 区分大小写搜索 "Angular":');
    const caseResults = await searchText('Angular', '.', {
      caseSensitive: true,
      maxCount: 5
    });
    console.log(caseResults);
    console.log('---\n');
    
    // 示例4: 整词匹配
    console.log('4. 整词匹配搜索 "angular":');
    const wordResults = await searchText('angular', '.', {
      wholeWord: true,
      includePattern: '*.json'
    });
    console.log(wordResults);
    
  } catch (error) {
    console.error('搜索失败:', error.message);
    console.log('\n提示: 请确保已安装 @vscode/ripgrep 依赖包');
    console.log('npm install @vscode/ripgrep');
  }
}

// 如果直接运行此文件，则执行示例
if (require.main === module) {
  runExamples();
}

module.exports = {
  searchText,
  runExamples
};

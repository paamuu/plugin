import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

// tree-sitter 类型定义
interface Parser {
  parse(content: string): Tree;
  setLanguage(language: Language): void;
}

interface Tree {
  rootNode: SyntaxNode;
}

interface SyntaxNode {
  type: string;
  startIndex: number;
  endIndex: number;
  children: SyntaxNode[];
  childForFieldName(name: string): SyntaxNode | null;
}

interface Language {
  // tree-sitter language interface
}

/**
 * Python 类提取器：使用 tree-sitter 精确解析 Python 文件，提取所有 class 名称并保存到文件。
 * 
 * 使用 tree-sitter 进行语法树解析，比正则表达式更准确，能正确处理：
 * - 嵌套类定义
 * - 字符串和注释中的 class 关键字
 * - 各种 Python 语法特性
 * - 装饰器语法
 * - 类型注解
 */
export class PythonClassExtractor {
  private readonly textDecoder = new TextDecoder('utf-8');
  private parser: Parser | null = null;
  private pythonLanguage: Language | null = null;
  private parserInitialized = false;

  /**
   * 初始化 tree-sitter 解析器（延迟加载）
   */
  private async initializeParser(): Promise<void> {
    if (this.parserInitialized) {
      return;
    }

    this.parserInitialized = true;

    try {
      // 动态导入 tree-sitter 和 Python 语法
      // 使用 require 方式以确保在 VSCode 扩展环境中正常工作
      const ParserModule = require('tree-sitter');
      const PythonModule = require('tree-sitter-python');
      
      const ParserClass = ParserModule.default || ParserModule;
      const PythonLang = PythonModule.default || PythonModule;
      
      this.pythonLanguage = PythonLang;
      this.parser = new ParserClass() as Parser;
      this.parser.setLanguage(this.pythonLanguage);
    } catch (error) {
      console.warn('[PythonClassExtractor] tree-sitter 初始化失败，将回退到正则表达式方法:', error);
      // 如果 tree-sitter 不可用，继续使用正则表达式方法
      this.parser = null;
      this.pythonLanguage = null;
    }
  }

  /**
   * 使用 tree-sitter 从 Python 文件内容中提取所有 class 名称
   * 
   * @param content Python 文件内容
   * @returns class 名称数组
   */
  private async extractClassNamesWithTreeSitter(content: string): Promise<string[]> {
    await this.initializeParser();

    if (!this.parser || !this.pythonLanguage) {
      // 回退到正则表达式方法
      return this.extractClassNamesWithRegex(content);
    }

    const classNames: string[] = [];

    try {
      const tree = this.parser.parse(content);
      const rootNode = tree.rootNode;

      // 遍历语法树，查找所有 class_def 节点
      this.traverseTree(rootNode, (node) => {
        if (node.type === 'class_definition') {
          // class_definition 节点的第一个命名子节点是类名
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            const className = content.substring(nameNode.startIndex, nameNode.endIndex);
            classNames.push(className);
          }
        }
      });
    } catch (error) {
      console.warn('[PythonClassExtractor] tree-sitter 解析失败，回退到正则表达式:', error);
      return this.extractClassNamesWithRegex(content);
    }

    return classNames;
  }

  /**
   * 递归遍历语法树
   */
  private traverseTree(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children) {
      this.traverseTree(child, callback);
    }
  }

  /**
   * 使用正则表达式提取 class 名称（回退方法）
   * 
   * @param content Python 文件内容
   * @returns class 名称数组
   */
  private extractClassNamesWithRegex(content: string): string[] {
    const classNames: string[] = [];
    
    // 匹配 Python class 定义的正则表达式
    const classRegex = /^(\s*)class\s+(\w+)/gm;
    
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      const className = match[2];
      
      // 简单检查：确保不在字符串或注释中
      const beforeMatch = content.substring(0, match.index);
      const lastNewlineIndex = beforeMatch.lastIndexOf('\n');
      const lineStart = lastNewlineIndex >= 0 ? lastNewlineIndex + 1 : 0;
      const lineBeforeMatch = content.substring(lineStart, match.index);
      
      // 检查是否在字符串中
      const singleQuotes = (lineBeforeMatch.match(/'/g) || []).length;
      const doubleQuotes = (lineBeforeMatch.match(/"/g) || []).length;
      const isInString = (singleQuotes % 2 !== 0) || (doubleQuotes % 2 !== 0);
      
      // 检查是否在注释中
      const commentIndex = lineBeforeMatch.lastIndexOf('#');
      const isInComment = commentIndex >= 0 && !isInString;
      
      if (!isInString && !isInComment) {
        classNames.push(className);
      }
    }
    
    return classNames;
  }

  /**
   * 从 Python 文件内容中提取所有 class 名称（主方法）
   * 
   * @param content Python 文件内容
   * @returns class 名称数组
   */
  private async extractClassNames(content: string): Promise<string[]> {
    return this.extractClassNamesWithTreeSitter(content);
  }

  /**
   * 扫描工作区中的所有 Python 文件并提取 class 名称
   * 
   * @param options 配置选项
   * @returns 文件路径到 class 名称数组的映射
   */
  async extractFromWorkspace(options?: {
    include?: string;
    exclude?: string;
    maxConcurrency?: number;
  }): Promise<Record<string, string[]>> {
    const {
      include = '**/*.py',
      exclude = '**/{node_modules,.git,__pycache__,venv,env,.venv}/**',
      maxConcurrency = 32,
    } = options ?? {};

    // 查找所有 Python 文件
    const uris = await vscode.workspace.findFiles(include, exclude);
    
    if (!uris.length) {
      return {};
    }

    const results: Record<string, string[]> = {};
    let index = 0;
    const lock = new Set<string>();

    const worker = async () => {
      while (index < uris.length) {
        const currentIndex = index++;
        if (currentIndex >= uris.length) {
          return;
        }

        const uri = uris[currentIndex];
        const filePath = uri.fsPath;

        // 避免重复处理
        if (lock.has(filePath)) {
          continue;
        }
        lock.add(filePath);

        try {
          // 使用 Node fs 直接读取文件
          const buffer = await fs.readFile(filePath);
          const content = this.textDecoder.decode(buffer, { fatal: false });
          
          const classNames = await this.extractClassNames(content);
          
          if (classNames.length > 0) {
            results[filePath] = classNames;
          }
        } catch (err) {
          console.warn(`[PythonClassExtractor] 读取文件失败: ${filePath}`, err);
        } finally {
          lock.delete(filePath);
        }
      }
    };

    // 并发处理文件
    const concurrency = Math.min(maxConcurrency, uris.length);
    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    return results;
  }

  /**
   * 将提取结果保存到本地文件
   * 
   * @param results 文件路径到 class 名称数组的映射
   * @param outputPath 输出文件路径（相对于工作区根目录或绝对路径，默认为 'python-classes.json'）
   * @param context 可选的扩展上下文（用于保存到 globalStorageUri）
   * @returns 保存的文件路径
   */
  async saveToFile(
    results: Record<string, string[]>,
    outputPath?: string,
    context?: vscode.ExtensionContext
  ): Promise<string> {
    let outputUri: vscode.Uri;
    
    if (outputPath) {
      // 如果是绝对路径，直接使用
      if (path.isAbsolute(outputPath)) {
        outputUri = vscode.Uri.file(outputPath);
      } else {
        // 相对路径，相对于第一个工作区文件夹
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          outputUri = vscode.Uri.joinPath(workspaceFolders[0].uri, outputPath);
        } else {
          throw new Error('无法确定工作区路径，请使用绝对路径');
        }
      }
    } else {
      // 如果没有指定路径，优先使用 context 的 globalStorageUri，否则使用工作区根目录
      if (context) {
        outputUri = vscode.Uri.joinPath(
          context.globalStorageUri,
          'python-classes.json'
        );
      } else {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          outputUri = vscode.Uri.joinPath(
            workspaceFolders[0].uri,
            'python-classes.json'
          );
        } else {
          throw new Error('无法确定输出路径，请指定 outputPath 或提供 context');
        }
      }
    }

    // 确保目录存在
    const dirUri = vscode.Uri.joinPath(outputUri, '..');
    await vscode.workspace.fs.createDirectory(dirUri);

    // 格式化输出内容
    const outputContent = JSON.stringify(results, null, 2);
    
    // 写入文件
    await vscode.workspace.fs.writeFile(
      outputUri,
      Buffer.from(outputContent, 'utf-8')
    );

    return outputUri.fsPath;
  }

  /**
   * 扫描并保存（一步完成）
   * 
   * @param outputPath 输出文件路径（可选）
   * @param options 扫描选项和扩展上下文
   * @returns 保存的文件路径和结果统计
   */
  async extractAndSave(
    outputPath?: string,
    options?: {
      include?: string;
      exclude?: string;
      maxConcurrency?: number;
      context?: vscode.ExtensionContext;
    }
  ): Promise<{
    outputPath: string;
    fileCount: number;
    totalClasses: number;
  }> {
    const { context, ...extractOptions } = options ?? {};
    const results = await this.extractFromWorkspace(extractOptions);
    const savedPath = await this.saveToFile(results, outputPath, context);
    
    const fileCount = Object.keys(results).length;
    const totalClasses = Object.values(results).reduce(
      (sum, classes) => sum + classes.length,
      0
    );

    return {
      outputPath: savedPath,
      fileCount,
      totalClasses,
    };
  }
}

/**
 * 使用示例：
 * 
 * // 在 extension.ts 的 activate 函数中：
 * 
 * import { PythonClassExtractor } from './utils/pythonClassExtractor';
 * 
 * const extractor = new PythonClassExtractor();
 * 
 * // 方式1：分步执行
 * const results = await extractor.extractFromWorkspace({
 *   include: '**/*.py',
 *   exclude: '**/{node_modules,venv}/**',
 *   maxConcurrency: 32
 * });
 * // 保存到工作区根目录
 * const outputPath = await extractor.saveToFile(results, 'python-classes.json');
 * // 或保存到扩展存储目录
 * const outputPath2 = await extractor.saveToFile(results, undefined, context);
 * 
 * // 方式2：一步完成（推荐）
 * const { outputPath, fileCount, totalClasses } = await extractor.extractAndSave(
 *   'python-classes.json',  // 输出路径，可选
 *   {
 *     include: '**/*.py',
 *     exclude: '**/{node_modules,venv}/**',
 *     maxConcurrency: 32,
 *     context: context  // 可选，用于保存到扩展存储目录
 *   }
 * );
 * console.log(`已扫描 ${fileCount} 个文件，找到 ${totalClasses} 个类`);
 * console.log(`结果已保存到: ${outputPath}`);
 * 
 * // 输出文件格式示例：
 * // {
 * //   "D:\\project\\src\\module1.py": ["MyClass", "AnotherClass"],
 * //   "D:\\project\\src\\module2.py": ["TestClass"]
 * // }
 */


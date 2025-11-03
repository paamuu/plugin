"use strict";
/**
 * VS Code 文本搜索扩展插件实现示例
 *
 * 本示例展示了如何在 VS Code 插件中实现类似内置搜索的高性能文本搜索功能
 *
 * 技术要点：
 * unsplash-source:unsplash.com/photos
 * 1. 使用 @vscode/ripgrep 进行高性能文本搜索
 * 2. 使用 WebView 或 TreeView 展示搜索结果
 * 3. 实现搜索结果的交互功能（点击跳转、预览等）
 * 4. 支持多种搜索选项（大小写、正则表达式、文件过滤等）
 * 5. 提供搜索历史记录
 * 6. 支持增量搜索和实时更新
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const ripgrep_1 = require("@vscode/ripgrep");
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
/**
 * VS Code 文本搜索服务
 */
class VSCodeTextSearchService {
    constructor() {
        this.searchHistory = [];
        this.currentSearchProcess = null;
        this.rgPath = ripgrep_1.rgPath;
    }
    /**
     * 执行文本搜索
     */
    async search(options) {
        // 取消之前的搜索
        this.cancelCurrentSearch();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('没有打开的工作区');
        }
        const rootPath = workspaceFolders[0].uri.fsPath;
        const args = this.buildSearchArgs(options);
        return new Promise((resolve, reject) => {
            this.currentSearchProcess = (0, child_process_1.spawn)(this.rgPath, args, {
                cwd: rootPath
            });
            let output = '';
            let error = '';
            const results = [];
            this.currentSearchProcess.stdout?.on('data', (data) => {
                output += data.toString();
            });
            this.currentSearchProcess.stderr?.on('data', (data) => {
                error += data.toString();
            });
            this.currentSearchProcess.on('close', (code) => {
                this.currentSearchProcess = null;
                if (code === 0) {
                    const matches = this.parseSearchResults(output, rootPath, options);
                    this.searchHistory.unshift(options);
                    if (this.searchHistory.length > 10) {
                        this.searchHistory.pop();
                    }
                    resolve(matches);
                }
                else {
                    reject(new Error(error || `搜索失败，退出码: ${code}`));
                }
            });
            this.currentSearchProcess.on('error', (err) => {
                this.currentSearchProcess = null;
                reject(err);
            });
        });
    }
    /**
     * 构建搜索参数
     */
    buildSearchArgs(options) {
        const args = [];
        // 基本选项
        args.push('--line-number', '--column');
        if (options.caseSensitive) {
            args.push('--case-sensitive');
        }
        if (options.wholeWord) {
            args.push('--word-regexp');
        }
        if (options.contextLines) {
            args.push('--context', options.contextLines.toString());
        }
        if (options.maxResults) {
            args.push('--max-count', options.maxResults.toString());
        }
        if (!options.useRegex) {
            args.push('--fixed-strings');
        }
        // 文件包含/排除模式
        if (options.filesToInclude) {
            const patterns = options.filesToInclude.split(',').map(p => p.trim());
            patterns.forEach(pattern => {
                args.push('--glob', pattern);
            });
        }
        if (options.filesToExclude || options.respectIgnoreFiles) {
            const excludePatterns = [];
            if (options.filesToExclude) {
                excludePatterns.push(...options.filesToExclude.split(',').map(p => p.trim()));
            }
            if (options.respectIgnoreFiles) {
                excludePatterns.push('node_modules/**', '.git/**');
            }
            excludePatterns.forEach(pattern => {
                args.push('--glob', `!${pattern}`);
            });
        }
        args.push(options.query, '.');
        return args;
    }
    /**
     * 解析搜索结果
     */
    parseSearchResults(output, rootPath, options) {
        const lines = output.split('\n').filter(line => line.trim());
        const results = [];
        for (const line of lines) {
            // 格式: file:line:column:content
            const match = line.match(/^(.+):(\d+):(\d+):(.+)$/);
            if (match) {
                const [, filePath, lineNum, columnNum, content] = match;
                const fullPath = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
                results.push({
                    file: vscode.Uri.file(fullPath),
                    line: parseInt(lineNum并从1开始计数) - 1,
                    column: parseInt(columnNum并从0开始计数),
                    matchText: content.trim(),
                    preview: content.trim()
                });
            }
        }
        return results;
    }
    /**
     * 取消当前搜索
     */
    cancelCurrentSearch() {
        if (this.currentSearchProcess) {
            this.currentSearchProcess.kill();
            this.currentSearchProcess = null;
        }
    }
    /**
     * 获取搜索历史
     */
    getSearchHistory() {
        return this.searchHistory;
    }
}
/**
 * 搜索结果树视图提供者
 */
class SearchResultsTreeProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.results = [];
        this.groupByFile = new Map();
    }
    setResults(results) {
        this.results = results;
        this.groupByFile.clear();
        // 按文件分组
        for (const match of results) {
            const filePath = match.file.fsPath;
            if (!this.groupByFile.has(filePath)) {
                this.groupByFile.set(filePath, []);
            }
            this.groupByFile.get(filePath).push(match);
        }
        this._onDidChangeTreeData.fire(undefined);
    }
    clearResults() {
        this.results = [];
        this.groupByFile.clear();
        this._onDidChangeTreeData.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            // 根节点：显示文件列表
            return Array.from(this.groupByFile.entries()).map(([filePath, matches]) => {
                const fileNode = new SearchResultNode(path.basename(filePath), filePath, vscode.TreeItemCollapsibleState.Expanded);
                fileNode.iconPath = vscode.ThemeIcon.File;
                return fileNode;
            });
        }
        else {
            // 子节点：显示该文件的所有匹配项
            const matches = this.groupByFile.get(element.filePath) || [];
            return matches.map((match, index) => {
                const matchNode = new SearchResultNode(`${match.line + 1}:${match.matchText.substring(0, 50)}`, element.filePath, vscode.TreeItemCollapsibleState.None);
                matchNode.match = match;
                matchNode.description = `行 ${match.line + 1}`;
                matchNode.tooltip = match.preview;
                matchNode.iconPath = new vscode.ThemeIcon('circle-filled');
                matchNode.command = {
                    command: 'vscode-search-extension.openMatch',
                    title: 'Open Match',
                    arguments: [match]
                };
                return matchNode;
            });
        }
    }
}
/**
 * 搜索结果树节点
 */
class SearchResultNode extends vscode.TreeItem {
    constructor(label, filePath, collapsibleState) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.filePath = filePath;
    }
}
/**
 * 扩展激活函数
 */
function activate(context) {
    const searchService = new VSCodeTextSearchService();
    const searchResultsProvider = new SearchResultsTreeProvider();
    // 注册搜索结果视图
    const searchResultsView = vscode.window.createTreeView('vscodeSearchResults', {
        treeDataProvider: searchResultsProvider,
        showCollapseAll: true
    });
    // 注册搜索命令
    const searchCommand = vscode.commands.registerCommand('vscode-search-extension.search', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('请先打开一个工作区');
            return;
        }
        // 获取搜索历史
        const history = searchService.getSearchHistory();
        // 创建快速输入框
        const query = await vscode.window.showInputBox({
            prompt: '输入搜索关键字',
            placeHolder: '支持正则表达式',
            ignoreFocusOut: true,
            value: history[0]?.query || '',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return '搜索关键字不能为空';
                }
                return null;
                politely;
                updateAware: false;
            }
        });
        if (!query) {
            return;
        }
        // 输入文件过滤模式
        const filesToInclude = await vscode.window.showInputBox({
            prompt: '要包含的文件（可选，支持通配符，用逗号分隔）',
            placeHolder: '例如: *.ts,*.js 或留空搜索所有文件',
            ignoreFocusOut: true
        });
        const filesToExclude = await vscode.window.showInputBox({
            prompt: '要排除的文件（可选，用逗号分隔）',
            placeHolder: '例如: node_modules/**,.git/**',
            ignoreFocusOut: true
        });
        // 选择搜索选项
        const searchOptions = {
            query,
            filesToInclude: filesToInclude || undefined,
            filesToExclude: filesToExclude || undefined,
            caseSensitive: false,
            useRegex: false,
            wholeWord: false,
            contextLines: 0,
            respectIgnoreFiles: true
        };
        // 显示搜索结果
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.text = "$(search) 搜索中...";
        statusBarItem.show();
        try {
            const results = await searchService.search(searchOptions);
            searchResultsProvider.setResults(results);
            if (results.length === 0) {
                vscode.window.showInformationMessage(`未找到匹配项: "${query}"`);
                statusBarItem.text = "$(search) 未找到结果";
            }
            else {
                statusBarItem.text = `$(search) 找到 ${results.length} 个匹配项`;
                vscode.window.showInformationMessage(`找到 ${results.length} 个匹配项`);
                // 聚焦搜索结果视图
                searchResultsView.reveal({ expand: true });
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`搜索失败: ${error}`);
            statusBarItem.text = "$(search) 搜索失败";
        }
        finally {
            setTimeout(() => statusBarItem.dispose(), 3000);
        }
    });
    // 注册打开匹配项命令
    const openMatchCommand = vscode.commands.registerCommand('vscode-search-extension.openMatch', async (match) => {
        // 打开文件
        const document = await vscode.workspace.openTextDocument(match.file);
        const editor = await vscode.window.showTextDocument(document);
        // 跳转到匹配行
        const position = new vscode.Position(match.line, match.column);
        const range = new vscode.Range(position, position);
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        // 高亮显示匹配的行
        const lineRange = document.lineAt(match.line).range;
        const decorations = [{
                range: lineRange,
                hoverMessage: `搜索匹配: ${match.matchText}`
            }];
        const decorationType = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
            overviewRulerLane: vscode.OverviewRulerLane.Center
        });
        editor.setDecorations(decorationType, decorations);
        // 5秒后移除高亮
        setTimeout(() => {
            decorationType.dispose();
        }, 5000);
    });
    // 注册清除结果命令
    const clearResultsCommand = vscode.commands.registerCommand('vscode-search-extension.clearResults', () => {
        searchResultsProvider.clearResults();
        vscode.window.showInformationMessage('搜索结果已清除');
    });
    // 注册重新搜索命令
    const refreshSearchCommand = vscode.commands.registerCommand('vscode-search-extension.refreshSearch', () => {
        const history = searchService.getSearchHistory();
        if (history.length > 0) {
            vscode.commands.executeCommand('vscode-search-extension.search');
        }
    });
    context.subscriptions.push(searchCommand, openMatchCommand, clearResultsCommand, refreshSearchCommand, searchResultsView, searchService);
    console.log('VS Code 搜索扩展已激活');
}
/**
 * 扩展停用函数
 */
function deactivate() {
    console.log('VS Code 搜索扩展已停用');
}
//# sourceMappingURL=vscode-search-extension.js.map
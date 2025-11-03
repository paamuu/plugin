"use strict";
/**
 * VS Code 自带 ripgrep 调用示例
 *
 * 该文件展示如何在扩展中复用 VS Code 内建的 ripgrep 可执行文件，
 * 无需额外安装 `@vscode/ripgrep` 依赖，即可在工作区执行文本搜索。
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
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
/**
 * 解析 VS Code 安装目录内置的 ripgrep 路径。
 */
function resolveBuiltinRgPath() {
    const exeName = process.platform === 'win32' ? 'rg.exe' : 'rg';
    const appRoot = vscode.env.appRoot;
    const candidates = [
        path.join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', exeName),
        path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', exeName),
        path.join(appRoot, 'node_modules', 'vscode-ripgrep', 'bin', exeName),
        path.join(appRoot, 'node_modules.asar.unpacked', 'vscode-ripgrep', 'bin', exeName)
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error('无法定位 VS Code 自带的 ripgrep 可执行文件');
}
/**
 * 利用外部 ripgrep 进程完成搜索。
 */
async function searchWithBuiltinRg(query) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('请先打开一个工作区');
    }
    const rgPath = resolveBuiltinRgPath();
    const cwd = workspaceFolders[0].uri.fsPath;
    const args = ['--json', '--line-number', '--column', query, cwd];
    return new Promise((resolve, reject) => {
        const results = [];
        const rg = (0, child_process_1.spawn)(rgPath, args, { cwd });
        let buffer = '';
        rg.stdout.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim()) {
                    continue;
                }
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.type === 'match') {
                        const match = parsed.data.submatches[0];
                        results.push({
                            uri: vscode.Uri.file(parsed.data.path.text),
                            line: parsed.data.line_number - 1,
                            column: match.start,
                            preview: parsed.data.lines.text.trim()
                        });
                    }
                }
                catch (error) {
                    console.warn('解析 ripgrep 输出失败:', error);
                }
            }
        });
        rg.stderr.on('data', (chunk) => {
            console.error('ripgrep 错误输出:', chunk.toString());
        });
        rg.on('close', (code) => {
            if (code === 0) {
                resolve(results);
                return;
            }
            if (code === 1 && results.length === 0) {
                resolve([]);
                return;
            }
            if (results.length > 0) {
                resolve(results);
                return;
            }
            reject(new Error(`ripgrep 退出码: ${code}`));
        });
        rg.on('error', reject);
    });
}
//# sourceMappingURL=vscode-built-in-ripgrep.js.map
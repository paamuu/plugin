import * as vscode from 'vscode';
import { sortPythonImportsInText } from './pythonImportSorter';

/**
 * 对一段 Python 代码片段的导入部分进行排序，返回排序后的完整代码片段。
 * 顺序：系统库 → 三方库 → 本地导入。
 *
 * 优先尝试调用已安装的 Python 相关插件的「整理导入」能力（三者之一即可）：
 * - Python (Microsoft)
 * - isort
 * - Ruff (Astral Software)
 *
 * 若未安装或调用失败，则使用插件内置的 tree-sitter / 正则 排序逻辑。
 *
 * @param snippet 原始 Python 代码片段
 * @returns 排序后的代码片段（若无改动或解析失败则返回原片段）
 */
export async function sortPythonImportsFromSnippet(snippet: string): Promise<string> {
    if (!snippet || typeof snippet !== 'string') {
        return snippet;
    }

    // 1. 尝试通过临时文档调用扩展的「整理导入」
    const viaExtension = await trySortViaOrganizeImports(snippet);
    if (viaExtension !== null) {
        return viaExtension;
    }

    // 2. 回退到内置排序
    return sortPythonImportsFromSnippetSync(snippet);
}

/**
 * 仅使用内置逻辑对 Python 代码片段的导入进行排序（不调用 Python/isort/Ruff 扩展）。
 * 顺序：系统库 → 三方库 → 本地导入。
 *
 * @param snippet 原始 Python 代码片段
 * @returns 排序后的代码片段（若无改动或解析失败则返回原片段）
 */
export function sortPythonImportsFromSnippetSync(snippet: string): string {
    if (!snippet || typeof snippet !== 'string') {
        return snippet;
    }
    const result = sortPythonImportsInText(snippet);
    return result ?? snippet;
}

/**
 * 通过创建临时 Python 文档并执行 editor.action.organizeImports 尝试排序。
 * 若当前环境有 Python / isort / Ruff 等扩展并注册了该命令，则会生效。
 */
async function trySortViaOrganizeImports(snippet: string): Promise<string | null> {
    let doc: vscode.TextDocument | undefined;
    let editor: vscode.TextEditor | undefined;

    try {
        doc = await vscode.workspace.openTextDocument({
            content: snippet,
            language: 'python',
        });

        // 在侧栏打开临时文档并聚焦，以便 organizeImports 作用于它
        editor = await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preserveFocus: false,
            preview: true,
        });

        await vscode.commands.executeCommand('editor.action.organizeImports');

        // 给扩展一点时间应用编辑
        await sleep(80);

        const sorted = doc.getText();
        // 若内容未变，可能扩展未处理或未安装，返回 null 走内置逻辑
        if (sorted === snippet) {
            return null;
        }
        return sorted;
    } catch {
        return null;
    } finally {
        if (doc) {
            const active = vscode.window.activeTextEditor;
            if (active && active.document.uri.toString() === doc.uri.toString()) {
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            }
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

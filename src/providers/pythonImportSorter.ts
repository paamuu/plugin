import * as vscode from 'vscode';

// tree-sitter 类型定义（与 pythonClassExtractor 一致）
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

/** Python 标准库常见模块名（用于区分系统库与三方库） */
const PYTHON_STDLIB_MODULES = new Set([
    'abc', 'aifc', 'argparse', 'array', 'ast', 'asynchat', 'asyncio', 'asyncore', 'atexit', 'audioop',
    'base64', 'bdb', 'binascii', 'binhex', 'bisect', 'builtins', 'bz2', 'calendar', 'cgi', 'cgitb',
    'chunk', 'cmath', 'cmd', 'code', 'codecs', 'codeop', 'collections', 'colorsys', 'compileall',
    'concurrent', 'configparser', 'contextlib', 'contextvars', 'copy', 'copyreg', 'cProfile', 'crypt',
    'csv', 'ctypes', 'curses', 'dataclasses', 'datetime', 'dbm', 'decimal', 'difflib', 'dis',
    'distutils', 'doctest', 'email', 'encodings', 'enum', 'errno', 'faulthandler', 'fcntl',
    'fileinput', 'fnmatch', 'fractions', 'ftplib', 'functools', 'gc', 'getopt', 'getpass', 'gettext',
    'glob', 'graphlib', 'grp', 'gzip', 'hashlib', 'heapq', 'hmac', 'html', 'http', 'idlelib',
    'imaplib', 'imghdr', 'imp', 'importlib', 'inspect', 'io', 'ipaddress', 'itertools', 'json',
    'keyword', 'lib2to3', 'linecache', 'locale', 'logging', 'lzma', 'mailbox', 'mailcap', 'marshal',
    'math', 'mimetypes', 'mmap', 'modulefinder', 'multiprocessing', 'netrc', 'nis', 'nntplib',
    'numbers', 'operator', 'optparse', 'os', 'ossaudiodev', 'pathlib', 'pdb', 'pickle', 'pickletools',
    'pipes', 'pkgutil', 'platform', 'plistlib', 'poplib', 'posix', 'posixpath', 'pprint', 'profile',
    'pwd', 'py_compile', 'pyclbr', 'pydoc', 'queue', 'quopri', 'random', 're', 'readline', 'reprlib',
    'resource', 'rlcompleter', 'runpy', 'sched', 'secrets', 'select', 'selectors', 'shelve',
    'shlex', 'shutil', 'signal', 'site', 'smtpd', 'smtplib', 'sndhdr', 'socket', 'socketserver',
    'spwd', 'sqlite3', 'ssl', 'stat', 'statistics', 'string', 'stringprep', 'struct', 'subprocess',
    'sunau', 'sunaudio', 'symtable', 'sys', 'sysconfig', 'syslog', 'tabnanny', 'tarfile', 'telnetlib',
    'tempfile', 'termios', 'test', 'textwrap', 'threading', 'time', 'timeit', 'tkinter', 'token',
    'tokenize', 'trace', 'traceback', 'tracemalloc', 'tty', 'turtle', 'turtledemo', 'types',
    'typing', 'unicodedata', 'unittest', 'urllib', 'uu', 'uuid', 'warnings', 'wave', 'weakref',
    'webbrowser', 'winreg', 'winsound', 'wsgiref', 'xdrlib', 'xml', 'xmlrpc', 'zipapp', 'zipfile', 'zipimport', 'zlib', '_thread'
]);

type ImportCategory = 'stdlib' | 'thirdparty' | 'local';

interface ImportLine {
    category: ImportCategory;
    text: string;
    sortKey: string;
}

/**
 * 对 Python 代码片段的导入部分进行排序：系统库 → 三方库 → 本地导入。
 * 优先调用 VSCode Python 相关插件的「整理导入」；若无可用则使用内置 tree-sitter 解析排序。
 */
export async function sortPythonImportsInDocument(editor: vscode.TextEditor): Promise<boolean> {
    const doc = editor.document;
    if (doc.languageId !== 'python') {
        vscode.window.showWarningMessage('当前文件不是 Python 文件，请打开 .py 文件后再执行。');
        return false;
    }

    // 1. 优先尝试执行 Python 相关插件的「整理导入」命令
    try {
        await vscode.commands.executeCommand('editor.action.organizeImports');
        // 若未抛出且文档可能已被修改，视为成功（部分插件会直接改文档）
        return true;
    } catch {
        // 无可用扩展或执行失败，使用内置排序
    }

    const fullText = doc.getText();
    const sorted = sortPythonImportsInText(fullText);
    if (sorted === null || sorted === fullText) {
        return false;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), sorted);
    await vscode.workspace.applyEdit(edit);
    return true;
}

/**
 * 对传入的 Python 代码字符串的导入部分进行排序（系统库 → 三方库 → 本地导入）。
 * 可用于当前文档全文或选中的代码片段。
 * @returns 排序后的完整代码，若无需修改或解析失败则返回 null
 */
export function sortPythonImportsInText(content: string): string | null {
    const result = extractAndSortImports(content);
    if (!result) return null;
    const { importBlockText, before, after } = result;
    const newContent = (before ? before + '\n\n' : '') + importBlockText + (after ? '\n\n' + after : '');
    return newContent === content ? null : newContent;
}

interface SortResult {
    importBlockText: string;
    before: string;
    after: string;
}

function extractAndSortImports(content: string): SortResult | null {
    let parser: Parser | null = null;
    let pythonLanguage: Language | null = null;
    try {
        const ParserModule = require('tree-sitter');
        const PythonModule = require('tree-sitter-python');
        const ParserClass = ParserModule.default || ParserModule;
        const PythonLang = PythonModule.default || PythonModule;
        pythonLanguage = PythonLang;
        parser = new ParserClass() as Parser;
        parser.setLanguage(pythonLanguage);
    } catch {
        return fallbackSortImportsWithRegex(content);
    }

    const tree = parser.parse(content);
    const root = tree.rootNode;
    const lines: ImportLine[] = [];
    let startOfImports = -1;
    let endOfImports = 0;

    for (const child of root.children) {
        const type = child.type;
        if (type === 'import_statement' || type === 'import_from_statement') {
            if (startOfImports < 0) startOfImports = child.startIndex;
            const text = content.substring(child.startIndex, child.endIndex).trim();
            if (!text) continue;
            const category = classifyImport(content, child, type);
            const sortKey = getSortKey(content, child, type);
            lines.push({ category, text, sortKey });
            endOfImports = child.endIndex;
        } else if (type === 'expression_statement') {
            const text = content.substring(child.startIndex, child.endIndex).trim();
            if (/^["']{3}/.test(text) || (text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
                endOfImports = child.endIndex;
                continue;
            }
            break;
        } else {
            break;
        }
    }

    if (lines.length === 0 || startOfImports < 0) return null;

    const stdlib: ImportLine[] = [];
    const thirdparty: ImportLine[] = [];
    const local: ImportLine[] = [];
    for (const line of lines) {
        if (line.category === 'stdlib') stdlib.push(line);
        else if (line.category === 'local') local.push(line);
        else thirdparty.push(line);
    }

    const sortLines = (arr: ImportLine[]) =>
        arr.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'en'));

    sortLines(stdlib);
    sortLines(thirdparty);
    sortLines(local);

    const blocks: string[] = [];
    if (stdlib.length) blocks.push(stdlib.map((l) => l.text).join('\n'));
    if (thirdparty.length) blocks.push(thirdparty.map((l) => l.text).join('\n'));
    if (local.length) blocks.push(local.map((l) => l.text).join('\n'));

    const importBlockText = blocks.join('\n\n');
    const before = content.slice(0, startOfImports).replace(/\n*$/, '');
    const after = content.slice(endOfImports).replace(/^\n*/, '');
    return { importBlockText, before, after };
}

function getModuleNameForImport(content: string, node: SyntaxNode, type: string): string {
    if (type === 'import_statement') {
        // import x / import x as y / import x, y
        const firstDotted = node.children.find((c) => c.type === 'dotted_name');
        if (firstDotted) {
            return content.substring(firstDotted.startIndex, firstDotted.endIndex).split('.')[0].trim();
        }
        return '';
    }
    // import_from_statement: from module import ...
    const fromKeyword = node.children.find((c) => c.type === 'from');
    if (!fromKeyword) return '';
    const idx = node.children.indexOf(fromKeyword);
    const next = node.children[idx + 1];
    if (!next) return '';
    if (next.type === 'dotted_name') {
        const name = content.substring(next.startIndex, next.endIndex);
        return name.split('.')[0].trim();
    }
    if (next.type === '.') {
        return '';
    }
    return '';
}

function classifyImport(content: string, node: SyntaxNode, type: string): ImportCategory {
    const raw = content.substring(node.startIndex, node.endIndex);
    if (raw.includes(' from .') || raw.startsWith('from .') || /from\s+\.\./.test(raw)) {
        return 'local';
    }
    const topModule = getModuleNameForImport(content, node, type);
    if (!topModule) return 'local';
    if (PYTHON_STDLIB_MODULES.has(topModule)) return 'stdlib';
    return 'thirdparty';
}

function getSortKey(content: string, node: SyntaxNode, type: string): string {
    const text = content.substring(node.startIndex, node.endIndex).trim();
    return text;
}

function fallbackSortImportsWithRegex(content: string): SortResult | null {
    const lines = content.split(/\r?\n/);
    const importLines: { line: string; category: ImportCategory; index: number }[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            i++;
            continue;
        }
        if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
            let category: ImportCategory = 'thirdparty';
            if (/^from\s+\./.test(trimmed)) category = 'local';
            else if (trimmed.startsWith('import ')) {
                const m = trimmed.match(/^import\s+(\w+)/);
                if (m && PYTHON_STDLIB_MODULES.has(m[1])) category = 'stdlib';
            } else {
                const m = trimmed.match(/^from\s+(\w+)/);
                if (m && PYTHON_STDLIB_MODULES.has(m[1])) category = 'stdlib';
            }
            importLines.push({ line: line, category, index: i });
            i++;
        } else {
            break;
        }
    }
    if (importLines.length === 0) return null;

    const stdlib = importLines.filter((x) => x.category === 'stdlib').map((x) => x.line);
    const third = importLines.filter((x) => x.category === 'thirdparty').map((x) => x.line);
    const local = importLines.filter((x) => x.category === 'local').map((x) => x.line);
    stdlib.sort();
    third.sort();
    local.sort();
    const importBlockText = [...stdlib, ...third, ...local].join('\n');
    const firstLineIndex = importLines[0].index;
    const lastLineIndex = importLines[importLines.length - 1].index;
    const before = lines.slice(0, firstLineIndex).join('\n').replace(/\n*$/, '');
    const after = lines.slice(lastLineIndex + 1).join('\n').replace(/^\n*/, '');
    return { importBlockText, before, after };
}

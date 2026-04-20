import * as vscode from 'vscode';

/**
 * 代码续写（内联补全）提供者
 *
 * 通过实现 vscode.InlineCompletionItemProvider，在编辑器中以"幽灵文本"形式
 * 展示代码续写建议。可以通过 Alt+V 快捷键触发 editor.action.inlinesuggest.trigger
 * 手动拉起补全。
 */
export class CodeContinuationProvider implements vscode.InlineCompletionItemProvider {

    /**
     * 标记：是否由用户通过 Alt+V 手动触发。
     * - 为 true 时，无论是否满足自动触发条件都会请求一次补全。
     * - 为 false 时，仅在满足条件（如光标处于行尾）时才提供补全，避免打扰输入。
     */
    private manualTrigger = false;

    /** 正在进行中的请求，用于防抖与取消 */
    private pendingRequest: { cancel: () => void } | undefined;

    /** 由命令调用，标记下一次 provide 为手动触发 */
    public setManualTrigger(): void {
        this.manualTrigger = true;
    }

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
        console.log('provideInlineCompletionItems-------');
        const isManual = this.manualTrigger;
        this.manualTrigger = false;

        const isInvokeTrigger =
            context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;

        const line = document.lineAt(position.line);
        const textBeforeCursor = line.text.substring(0, position.character);
        const isLineEnd = position.character >= line.text.length;

        if (!isManual && !isInvokeTrigger) {
            if (!isLineEnd) {
                return undefined;
            }
            if (textBeforeCursor.trim().length === 0) {
                return undefined;
            }
        }

        if (this.pendingRequest) {
            this.pendingRequest.cancel();
            this.pendingRequest = undefined;
        }

        const prefix = this.getPrefixContext(document, position, 40);
        const suffix = this.getSuffixContext(document, position, 20);

        try {
            const suggestion = await this.requestCompletion(
                prefix,
                suffix,
                document.languageId,
                token
            );

            if (token.isCancellationRequested || !suggestion) {
                return undefined;
            }

            return [
                new vscode.InlineCompletionItem(
                    suggestion,
                    new vscode.Range(position, position)
                )
            ];
        } catch (err) {
            console.error('[CodeContinuation] 生成续写失败:', err);
            return undefined;
        }
    }

    /** 获取光标前 N 行作为上文 */
    private getPrefixContext(
        document: vscode.TextDocument,
        position: vscode.Position,
        maxLines: number
    ): string {
        const startLine = Math.max(0, position.line - maxLines);
        const range = new vscode.Range(
            new vscode.Position(startLine, 0),
            position
        );
        return document.getText(range);
    }

    /** 获取光标后 N 行作为下文 */
    private getSuffixContext(
        document: vscode.TextDocument,
        position: vscode.Position,
        maxLines: number
    ): string {
        const endLine = Math.min(document.lineCount - 1, position.line + maxLines);
        const endChar = document.lineAt(endLine).text.length;
        const range = new vscode.Range(
            position,
            new vscode.Position(endLine, endChar)
        );
        return document.getText(range);
    }

    /**
     * 向模型请求代码续写。
     *
     * 这里保留了两种实现：
     *  1) 如果配置了 HTTP 接口，则通过 axios 请求远端模型
     *  2) 否则使用简单的本地启发式生成器（兜底演示）
     *
     * 可按需修改为调用自有的 AI 服务。
     */
    private async requestCompletion(
        prefix: string,
        suffix: string,
        languageId: string,
        token: vscode.CancellationToken
    ): Promise<string | undefined> {
        const config = vscode.workspace.getConfiguration('codeContinuation');
        const endpoint = config.get<string>('endpoint', '').trim();
        const apiKey = config.get<string>('apiKey', '').trim();
        const timeoutMs = config.get<number>('timeoutMs', 8000);

        if (endpoint) {
            return await this.requestFromHttp(
                endpoint,
                apiKey,
                { prefix, suffix, languageId },
                timeoutMs,
                token
            );
        }

        return this.mockCompletion(prefix, languageId);
    }

    /** 通过 HTTP 请求远端模型（可替换为你的服务） */
    private async requestFromHttp(
        endpoint: string,
        apiKey: string,
        payload: { prefix: string; suffix: string; languageId: string },
        timeoutMs: number,
        token: vscode.CancellationToken
    ): Promise<string | undefined> {
        const axios = (await import('axios')).default;

        const controller = new AbortController();
        this.pendingRequest = { cancel: () => controller.abort() };
        token.onCancellationRequested(() => controller.abort());

        try {
            const res = await axios.post(
                endpoint,
                payload,
                {
                    timeout: timeoutMs,
                    signal: controller.signal,
                    headers: apiKey
                        ? { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
                        : { 'Content-Type': 'application/json' }
                }
            );

            const data = res.data;
            if (typeof data === 'string') {
                return data;
            }
            if (data && typeof data.completion === 'string') {
                return data.completion;
            }
            if (data && typeof data.text === 'string') {
                return data.text;
            }
            return undefined;
        } finally {
            this.pendingRequest = undefined;
        }
    }

    /**
     * 本地简易兜底：根据最近一行内容给出演示性的续写。
     * 真实场景请替换为 LLM 调用。
     */
    private mockCompletion(prefix: string, languageId: string): string | undefined {
        const trimmed = prefix.trimEnd();
        if (!trimmed) {
            return undefined;
        }

        const lastLine = trimmed.split(/\r?\n/).pop() ?? '';

        if (/\bfunction\s+\w+\s*\([^)]*\)\s*\{?\s*$/.test(lastLine)) {
            return `\n    // TODO: 实现函数逻辑\n    return;\n}`;
        }
        if (/\bif\s*\([^)]*\)\s*\{?\s*$/.test(lastLine)) {
            return `\n    // TODO: 条件成立时的处理\n}`;
        }
        if (/\bfor\s*\([^)]*\)\s*\{?\s*$/.test(lastLine)) {
            return `\n    // TODO: 循环体\n}`;
        }
        if (/\bclass\s+\w+\s*\{?\s*$/.test(lastLine)) {
            return `\n    constructor() {\n        // TODO\n    }\n}`;
        }
        if (languageId === 'python' && /:\s*$/.test(lastLine)) {
            return `\n    pass  # TODO: 实现逻辑`;
        }

        return ` /* TODO: 在此继续书写 (${languageId}) */`;
    }
}

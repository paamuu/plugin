import * as vscode from 'vscode';

/**
 * Alt+V 触发的流式代码续写：用定时器模拟分块到达，每有新内容时
 * 先 hide 再 trigger，强制编辑器重新走一遍内联补全流程（否则会合并/跳过对 provider 的调用）。
 */
export function registerStreamingCodeContinuation(context: vscode.ExtensionContext): void {
    const provider = new StreamingInlineCompletionProvider();
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.triggerCodeContinuation', () => provider.handleAltV())
    );
    context.subscriptions.push(
        new vscode.Disposable(() => {
            provider.dispose();
        })
    );
}

class StreamingInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private runId = 0;
    /** 当前会话是否由 Alt+V 发起（用于与自动内联补全区分） */
    private altVSession = false;
    /** 当前建议展示的完整前缀（流式累积） */
    private visibleText = '';
    private pendingFullText = '';

    dispose(): void {
        this.runId++;
        this.altVSession = false;
        this.visibleText = '';
        this.pendingFullText = '';
    }

    async handleAltV(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('请先在编辑器中打开一个文件');
            return;
        }

        this.runId++;
        const myRun = this.runId;
        this.altVSession = true;
        this.visibleText = '';
        this.pendingFullText = await this.resolveCompletionText(editor.document, editor.selection.active);

        const chunkMs = 100;
        const charsPerTick = 4;
        let offset = 0;

        const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

        /** 与 VS Code 内置去重逻辑配合：先关掉当前内联建议，再请求，才会稳定走到 provideInlineCompletionItems */
        const refreshInlineSuggestion = async (): Promise<void> => {
            try {
                await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');
            } catch {
                // 当前无内联建议时 hide 可能失败，忽略
            }
            console.log('refreshInlineSuggestion--');
            await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
        };

        // 串行循环，避免 setInterval + async 叠多个 pump 导致多次 trigger 被合并为一次 provider 调用
        while (myRun === this.runId && offset < this.pendingFullText.length) {
            offset = Math.min(offset + charsPerTick, this.pendingFullText.length);
            this.visibleText = this.pendingFullText.slice(0, offset);

            if (this.visibleText.length > 0) {
                try {
                    await refreshInlineSuggestion();
                } catch {
                    // 命令不可用时跳过本帧
                }
            }

            if (offset >= this.pendingFullText.length) {
                break;
            }
            await delay(chunkMs);
        }

        if (myRun === this.runId) {
            this.altVSession = false;
        }
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionList | vscode.InlineCompletionItem[] | null | undefined> {
        console.log('provideInlineCompletionItems--');
        if (token.isCancellationRequested) {
            return { items: [] };
        }

        if (!this.altVSession || !this.visibleText) {
            return { items: [] };
        }

        if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
            return { items: [] };
        }

        const item = new vscode.InlineCompletionItem(this.visibleText, new vscode.Range(position, position));
        return { items: [item] };
    }

    /**
     * 模拟「流式接口」：先异步拉取整段文本，再由循环按块「播放」并反复 hide+trigger。
     * 可替换为真实 fetch / SSE / WebSocket。
     */
    private async resolveCompletionText(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<string> {
        await new Promise<void>((resolve) => setTimeout(resolve, 80));

        const prefixLine = document.lineAt(position.line).text.slice(0, position.character);
        const lang = document.languageId;
        return [
            `// ${lang} 续写（模拟流式）`,
            `// 光标前行片段: ${prefixLine.slice(-24)}`,
            '',
            'function streamedSuggestion(): string {',
            '  return "chunk-by-chunk";',
            '}',
            '',
        ].join('\n');
    }
}

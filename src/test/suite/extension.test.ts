import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('开始运行测试。');

  test('扩展应该被激活', async () => {
    const extension = vscode.extensions.getExtension('angular-schematics-extension');
    assert.ok(extension);
  });

  test('应该注册了 angular-schematics.generate 命令', async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes('angular-schematics.generate'));
  });
});

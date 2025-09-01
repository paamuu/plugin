import * as vscode from 'vscode';
import { AngularSchematicsProvider, SchematicInfo } from '../providers/angularSchematicsProvider';

export class SchematicsQuickPick {
    private schematicsProvider: AngularSchematicsProvider;

    constructor(schematicsProvider: AngularSchematicsProvider) {
        this.schematicsProvider = schematicsProvider;
    }

    /**
     * 显示schematics选择器
     */
    async show(): Promise<void> {
        try {
            // 显示加载提示
            vscode.window.showInformationMessage('正在加载可用的schematics...');

            // 获取可用的schematics
            const schematics = await this.schematicsProvider.getAvailableSchematics();

            if (schematics.length === 0) {
                vscode.window.showErrorMessage('未找到可用的schematics');
                return;
            }

            // 创建QuickPick项目
            const items = schematics.map(schematic => ({
                label: `$(file-code) ${schematic.name}`,
                description: schematic.description,
                detail: `生成一个新的 ${schematic.name}`,
                schematic: schematic
            }));

            // 显示schematics选择器
            const selectedSchematic = await vscode.window.showQuickPick(items, {
                placeHolder: '选择要生成的Angular原理图',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selectedSchematic) {
                return; // 用户取消了选择
            }

            // 获取schematic名称
            const name = await this.getSchematicName(selectedSchematic.schematic);
            if (!name) {
                return; // 用户取消了输入
            }

            // 获取额外选项
            const options = await this.getSchematicOptions(selectedSchematic.schematic);
            if (options === undefined) {
                return; // 用户取消了选项设置
            }

            // 执行生成
            await this.schematicsProvider.generateSchematic(
                selectedSchematic.schematic.name,
                name,
                options
            );

        } catch (error) {
            vscode.window.showErrorMessage(`显示schematics选择器失败: ${error}`);
        }
    }

    /**
     * 获取schematic名称
     */
    private async getSchematicName(schematic: SchematicInfo): Promise<string | undefined> {
        const name = await vscode.window.showInputBox({
            placeHolder: `输入${schematic.name}的名称`,
            prompt: `请输入要生成的${schematic.name}的名称`,
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return '名称不能为空';
                }
                if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(value)) {
                    return '名称只能包含字母、数字和连字符，且必须以字母开头';
                }
                return null;
            }
        });

        return name?.trim();
    }

    /**
     * 获取schematic选项
     */
    private async getSchematicOptions(schematic: SchematicInfo): Promise<Record<string, any> | undefined> {
        const options: Record<string, any> = {};

        // 根据schematic类型提供常用选项
        switch (schematic.name) {
            case 'component':
                const createSpec = await this.getBooleanOption('是否创建测试文件?', true);
                if (createSpec !== undefined) {
                    options['skip-tests'] = !createSpec;
                }

                const createStylesheet = await this.getBooleanOption('是否创建样式文件?', true);
                if (createStylesheet !== undefined) {
                    options['skip-stylesheet'] = !createStylesheet;
                }

                const flat = await this.getBooleanOption('是否创建扁平结构?', false);
                if (flat !== undefined) {
                    options['flat'] = flat;
                }
                break;

            case 'service':
                const serviceCreateSpec = await this.getBooleanOption('是否创建测试文件?', true);
                if (serviceCreateSpec !== undefined) {
                    options['skip-tests'] = !serviceCreateSpec;
                }
                break;

            case 'module':
                const routing = await this.getBooleanOption('是否包含路由模块?', false);
                if (routing !== undefined) {
                    options['routing'] = routing;
                }
                break;

            case 'guard':
                const guardType = await this.getGuardType();
                if (guardType) {
                    options['implements'] = guardType;
                }
                break;
        }

        return options;
    }

    /**
     * 获取布尔选项
     */
    private async getBooleanOption(question: string, defaultValue: boolean): Promise<boolean | undefined> {
        const items = [
            { label: '是', value: true },
            { label: '否', value: false }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: question,
            canPickMany: false
        });

        return selected?.value;
    }

    /**
     * 获取守卫类型
     */
    private async getGuardType(): Promise<string | undefined> {
        const guardTypes = [
            { label: 'CanActivate', value: 'CanActivate' },
            { label: 'CanActivateChild', value: 'CanActivateChild' },
            { label: 'CanDeactivate', value: 'CanDeactivate' },
            { label: 'CanLoad', value: 'CanLoad' },
            { label: 'Resolve', value: 'Resolve' }
        ];

        const selected = await vscode.window.showQuickPick(guardTypes, {
            placeHolder: '选择守卫类型',
            canPickMany: false
        });

        return selected?.value;
    }
}

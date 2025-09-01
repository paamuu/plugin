import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface SchematicInfo {
    name: string;
    description: string;
    schema?: any;
}

export class AngularSchematicsProvider {
    private projectPath: string;
    private schematicsCache: Map<string, SchematicInfo[]> = new Map();

    constructor(projectPath: string) {
        this.projectPath = projectPath;
    }

    /**
     * 获取所有可用的schematics
     */
    async getAvailableSchematics(): Promise<SchematicInfo[]> {
        try {
            // 检查缓存
            if (this.schematicsCache.has(this.projectPath)) {
                return this.schematicsCache.get(this.projectPath) || [];
            }

            // 首先检查 Angular CLI 是否可用
            try {
                await execAsync('ng version', {
                    cwd: this.projectPath,
                    timeout: 5000
                });
            } catch (error) {
                console.error('Angular CLI 不可用:', error);
                vscode.window.showWarningMessage('Angular CLI 不可用，将使用默认 schematics');
                return this.getDefaultSchematics();
            }

            // 执行 ng generate --help 获取可用schematics
            const { stdout, stderr } = await execAsync('ng generate --help', {
                cwd: this.projectPath,
                timeout: 10000
            });

            console.log('ng generate --help 输出:', stdout);
            if (stderr) {
                console.log('ng generate --help 错误:', stderr);
            }

            const schematics = this.parseSchematicsFromHelp(stdout);
            
            if (schematics.length === 0) {
                console.log('解析 schematics 失败，使用默认列表');
                return this.getDefaultSchematics();
            }
            
            // 缓存结果
            this.schematicsCache.set(this.projectPath, schematics);
            
            return schematics;
        } catch (error) {
            console.error('获取schematics失败:', error);
            vscode.window.showWarningMessage('获取 schematics 失败，将使用默认列表');
            // 返回默认的常用schematics
            return this.getDefaultSchematics();
        }
    }

    /**
     * 解析ng generate --help的输出
     */
    private parseSchematicsFromHelp(helpOutput: string): SchematicInfo[] {
        const schematics: SchematicInfo[] = [];
        const lines = helpOutput.split('\n');
        
        console.log('开始解析 schematics，总行数:', lines.length);
        
        let inSchematicsSection = false;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            console.log(`行 ${i}: "${line}"`);
            
            // 查找 schematics 部分
            if (line.includes('Available schematics:') || line.includes('Schematics:')) {
                inSchematicsSection = true;
                console.log('找到 schematics 部分');
                continue;
            }
            
            if (inSchematicsSection && line.trim()) {
                // 尝试多种匹配模式
                let match = line.match(/^\s*(\w+)\s+(.+)$/);
                if (!match) {
                    // 尝试匹配只有名称的行
                    match = line.match(/^\s*(\w+)\s*$/);
                }
                
                if (match) {
                    const name = match[1].trim();
                    const description = match[2] ? match[2].trim() : `生成一个新的 ${name}`;
                    
                    // 过滤掉一些常见的非 schematics 行
                    if (!['Options:', 'Arguments:', 'Description:', 'Examples:'].includes(name)) {
                        schematics.push({
                            name: name,
                            description: description
                        });
                        console.log(`找到 schematic: ${name} - ${description}`);
                    }
                }
            }
            
            // 如果遇到新的部分，停止解析
            if (inSchematicsSection && (
                line.includes('Options:') || 
                line.includes('Arguments:') || 
                line.includes('Examples:') ||
                (line.trim() === '' && schematics.length > 0)
            )) {
                console.log('停止解析 schematics');
                break;
            }
        }
        
        console.log(`解析完成，找到 ${schematics.length} 个 schematics`);
        return schematics;
    }

    /**
     * 获取默认的常用schematics
     */
    private getDefaultSchematics(): SchematicInfo[] {
        return [
            { name: 'component', description: '生成一个新的组件' },
            { name: 'service', description: '生成一个新的服务' },
            { name: 'pipe', description: '生成一个新的管道' },
            { name: 'directive', description: '生成一个新的指令' },
            { name: 'module', description: '生成一个新的模块' },
            { name: 'class', description: '生成一个新的类' },
            { name: 'interface', description: '生成一个新的接口' },
            { name: 'enum', description: '生成一个新的枚举' },
            { name: 'guard', description: '生成一个新的路由守卫' },
            { name: 'resolver', description: '生成一个新的路由解析器' },
            { name: 'interceptor', description: '生成一个新的HTTP拦截器' }
        ];
    }

    /**
     * 执行schematic生成
     */
    async generateSchematic(schematicName: string, name: string, options: Record<string, any> = {}): Promise<void> {
        try {
            const optionArgs = Object.entries(options)
                .map(([key, value]) => `--${key}=${value}`)
                .join(' ');

            const command = `ng generate ${schematicName} ${name} ${optionArgs}`.trim();
            
            vscode.window.showInformationMessage(`正在生成 ${schematicName}: ${name}...`);
            
            const { stdout, stderr } = await execAsync(command, {
                cwd: this.projectPath,
                timeout: 30000
            });

            if (stderr && !stderr.includes('WARNING')) {
                throw new Error(stderr);
            }

            vscode.window.showInformationMessage(`成功生成 ${schematicName}: ${name}`);
            
            // 刷新文件资源管理器
            vscode.commands.executeCommand('workbench.action.files.revert');
            
        } catch (error) {
            console.error('生成schematic失败:', error);
            throw new Error(`生成 ${schematicName} 失败: ${error}`);
        }
    }

    /**
     * 获取schematic的schema信息
     */
    async getSchematicSchema(schematicName: string): Promise<any> {
        try {
            const { stdout } = await execAsync(`ng generate ${schematicName} --help`, {
                cwd: this.projectPath,
                timeout: 10000
            });

            // 这里可以解析schema信息，简化版本直接返回空对象
            return {};
        } catch (error) {
            console.error('获取schematic schema失败:', error);
            return {};
        }
    }
}

/**
 * IDE 插件健康检查服务（文件心跳方案）。
 *
 * 每个 IDE 实例在共享目录下维护独立的心跳文件，通过文件时间戳判断实例存活状态。
 * 相比 SQLite 方案，此实现：
 *   - 零原生依赖，天然跨平台
 *   - 单实例单文件，无并发写冲突
 *   - 可打包为单一 VSIX 支持所有平台
 *
 * 默认每 10 秒写一次心跳，超过 60 秒未更新即视为离线。可通过构造参数调整。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

export interface HealthCheckOptions {
    /** 写入心跳的间隔（毫秒）。默认 10000。 */
    heartbeatIntervalMs?: number;
    /** 多久未更新心跳即视为离线（毫秒）。默认 60000。 */
    aliveThresholdMs?: number;
    /** 心跳文件存放目录。默认使用 `context.globalStorageUri`。 */
    storageDir?: string;
}

export interface InstanceHeartbeat {
    instanceId: string;
    pid: number;
    hostname: string;
    platform: string;
    arch: string;
    extensionVersion: string;
    startedAt: number;
    lastHeartbeat: number;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10000;
const DEFAULT_ALIVE_THRESHOLD_MS = 60000;
const HEALTH_DIR_NAME = 'ide-health';

export class HealthCheckService implements vscode.Disposable {
    private readonly instanceId: string;
    private readonly pid: number;
    private readonly hostname: string;
    private readonly platform: string;
    private readonly arch: string;
    private readonly extensionVersion: string;
    private readonly startedAt: number;
    private readonly heartbeatIntervalMs: number;
    private readonly aliveThresholdMs: number;
    private readonly healthDir: string;
    private readonly heartbeatFilePath: string;

    private heartbeatTimer: NodeJS.Timeout | null = null;
    private disposed = false;
    private startCalled = false;

    constructor(context: vscode.ExtensionContext, options: HealthCheckOptions = {}) {
        this.instanceId = generateInstanceId();
        this.pid = process.pid;
        this.hostname = safeHostname();
        this.platform = process.platform;
        this.arch = process.arch;
        this.extensionVersion = readExtensionVersion(context);
        this.startedAt = Date.now();
        this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
        this.aliveThresholdMs = options.aliveThresholdMs ?? DEFAULT_ALIVE_THRESHOLD_MS;

        const storageDir = options.storageDir ?? context.globalStorageUri.fsPath;
        this.healthDir = path.join(storageDir, HEALTH_DIR_NAME);
        this.heartbeatFilePath = path.join(this.healthDir, `${this.instanceId}.json`);
    }

    /**
     * 启动健康检查：创建心跳目录、写入第一条心跳，并按间隔持续写入。
     */
    start(): void {
        if (this.disposed) {
            return;
        }
        try {
            if (!fs.existsSync(this.healthDir)) {
                fs.mkdirSync(this.healthDir, { recursive: true });
            }
            this.writeHeartbeat();
            this.heartbeatTimer = setInterval(() => {
                this.writeHeartbeat();
            }, this.heartbeatIntervalMs);
            this.startCalled = true;
            console.log(
                `[HealthCheckService] 已启动，dir=${this.healthDir}，instanceId=${this.instanceId}`
            );
            // 不阻塞 VS Code 退出。
            if (typeof this.heartbeatTimer.unref === 'function') {
                this.heartbeatTimer.unref();
            }
        } catch (err) {
            console.error('[HealthCheckService] 启动失败:', err);
        }
    }

    /** 当前 IDE 实例的唯一 ID。 */
    getInstanceId(): string {
        return this.instanceId;
    }

    /** 心跳文件存放目录的绝对路径，便于诊断。 */
    getHealthDir(): string {
        return this.healthDir;
    }

    /**
     * 列出所有"活的" IDE 实例（在 `aliveThresholdMs` 内有过心跳）。
     */
    listAliveInstances(now: number = Date.now()): InstanceHeartbeat[] {
        const cutoff = now - this.aliveThresholdMs;
        const result: InstanceHeartbeat[] = [];

        if (!fs.existsSync(this.healthDir)) {
            return result;
        }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(this.healthDir, { withFileTypes: true });
        } catch {
            return result;
        }

        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) {
                continue;
            }
            const filePath = path.join(this.healthDir, entry.name);
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const hb = JSON.parse(raw) as InstanceHeartbeat;
                if (hb && typeof hb.lastHeartbeat === 'number' && hb.lastHeartbeat >= cutoff) {
                    result.push(hb);
                }
            } catch {
                // 文件可能损坏或被并发删除，跳过
            }
        }

        result.sort((a, b) => b.lastHeartbeat - a.lastHeartbeat);
        return result;
    }

    /** 是否至少有一个 IDE 实例（包括自己）正在使用本插件。 */
    isAnyInstanceAlive(now: number = Date.now()): boolean {
        return this.listAliveInstances(now).length > 0;
    }

    /** 当前实例自身是否还被视作活的（用于自检）。 */
    isSelfAlive(now: number = Date.now()): boolean {
        if (!fs.existsSync(this.heartbeatFilePath)) {
            return false;
        }
        try {
            const raw = fs.readFileSync(this.heartbeatFilePath, 'utf-8');
            const hb = JSON.parse(raw) as InstanceHeartbeat;
            return hb && typeof hb.lastHeartbeat === 'number'
                && hb.lastHeartbeat >= now - this.aliveThresholdMs;
        } catch {
            return false;
        }
    }

    /**
     * 立即写一次心跳。
     */
    writeHeartbeat(): void {
        try {
            const hb: InstanceHeartbeat = {
                instanceId: this.instanceId,
                pid: this.pid,
                hostname: this.hostname,
                platform: this.platform,
                arch: this.arch,
                extensionVersion: this.extensionVersion,
                startedAt: this.startedAt,
                lastHeartbeat: Date.now(),
            };
            fs.writeFileSync(this.heartbeatFilePath, JSON.stringify(hb, null, 2), 'utf-8');
            // 顺便清理过期的心跳文件
            this.cleanupDeadInstances();
        } catch (err) {
            console.error('[HealthCheckService] 写入心跳失败:', err);
        }
    }

    /**
     * 清理过期的心跳文件（超过 `aliveThresholdMs` 未更新）。
     */
    cleanupDeadInstances(now: number = Date.now()): void {
        const cutoff = now - this.aliveThresholdMs;
        if (!fs.existsSync(this.healthDir)) {
            return;
        }
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(this.healthDir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) {
                continue;
            }
            // 跳过自身文件
            if (entry.name === `${this.instanceId}.json`) {
                continue;
            }
            const filePath = path.join(this.healthDir, entry.name);
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const hb = JSON.parse(raw) as InstanceHeartbeat;
                if (hb && typeof hb.lastHeartbeat === 'number' && hb.lastHeartbeat < cutoff) {
                    fs.unlinkSync(filePath);
                    console.log(`[HealthCheckService] 清理过期心跳: ${entry.name}`);
                }
            } catch {
                // 读取失败的文件可能是损坏的，也尝试清理
                try {
                    fs.unlinkSync(filePath);
                } catch {
                    // 忽略清理失败
                }
            }
        }
    }

    /** 停止心跳、删除自身心跳文件。 */
    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        try {
            if (fs.existsSync(this.heartbeatFilePath)) {
                fs.unlinkSync(this.heartbeatFilePath);
            }
        } catch (err) {
            console.error('[HealthCheckService] 删除心跳文件失败:', err);
        }
    }
}

function generateInstanceId(): string {
    return `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeHostname(): string {
    try {
        return os.hostname();
    } catch {
        return 'unknown';
    }
}

function readExtensionVersion(context: vscode.ExtensionContext): string {
    try {
        const pkg = context.extension?.packageJSON as { version?: string } | undefined;
        return pkg?.version ?? '0.0.0';
    } catch {
        return '0.0.0';
    }
}

/**
 * IDE 插件健康检查服务。
 *
 * 通过 better-sqlite3 的 .node 原生绑定，将每个 VS Code 进程（即每个挂载了
 * 本插件的 IDE 窗口）的心跳写入一个共享的 SQLite 数据库文件，从而可以判断：
 *   1) 当前插件是否正在被任何 IDE 实例使用（`isAnyInstanceAlive`）；
 *   2) 哪些 IDE 实例当前活跃（`listAliveInstances`）；
 *   3) 自身实例是否仍被认为是“活的”（`isSelfAlive`）。
 *
 * 默认每 15 秒写一次心跳，超过 60 秒未更新即视为离线。可通过构造参数调整。
 */
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Database } from './sqliteAddon';

export interface HealthCheckOptions {
    /** 写入心跳的间隔（毫秒）。默认 15000。 */
    heartbeatIntervalMs?: number;
    /** 多久未更新心跳即视为离线（毫秒）。默认 60000。 */
    aliveThresholdMs?: number;
    /** SQLite 数据库文件存放目录。默认使用 `context.globalStorageUri`。 */
    storageDir?: string;
    /** SQLite 文件名。默认 `ide-health.db`。 */
    databaseFileName?: string;
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

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_ALIVE_THRESHOLD_MS = 60_000;
const DEFAULT_DB_FILE_NAME = 'ide-health.db';

export class HealthCheckService implements vscode.Disposable {
    private readonly extensionPath: string;
    private readonly instanceId: string;
    private readonly pid: number;
    private readonly hostname: string;
    private readonly platform: string;
    private readonly arch: string;
    private readonly extensionVersion: string;
    private readonly startedAt: number;
    private readonly heartbeatIntervalMs: number;
    private readonly aliveThresholdMs: number;
    private readonly dbFilePath: string;

    private db: Database | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private disposed = false;

    constructor(context: vscode.ExtensionContext, options: HealthCheckOptions = {}) {
        this.extensionPath = context.extensionPath;
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
        this.dbFilePath = path.join(storageDir, options.databaseFileName ?? DEFAULT_DB_FILE_NAME);
    }

    /**
     * 启动健康检查：建立数据库连接、写入第一条心跳，并按间隔持续写入。
     * 失败时返回 false 但不抛错——健康检查不应阻塞插件主流程。
     */
    start(): boolean {
        if (this.disposed) {
            return false;
        }
        try {
            this.db = new Database(this.extensionPath, this.dbFilePath, { timeout: 5000 });
            this.initSchema(this.db);
            // 启动时清理一次明显过期的记录，避免历史数据无限增长。
            this.pruneStale(this.db);
            this.writeHeartbeat();
            this.heartbeatTimer = setInterval(() => {
                this.writeHeartbeat();
            }, this.heartbeatIntervalMs);
            // 避免阻塞 VS Code 退出。
            if (typeof this.heartbeatTimer.unref === 'function') {
                this.heartbeatTimer.unref();
            }
            return true;
        } catch (err) {
            console.error('[HealthCheckService] 启动失败:', err);
            this.safeCloseDb();
            return false;
        }
    }

    /** 当前 IDE 实例的唯一 ID。 */
    getInstanceId(): string {
        return this.instanceId;
    }

    /** SQLite 数据库文件的绝对路径，便于诊断。 */
    getDatabaseFilePath(): string {
        return this.dbFilePath;
    }

    /**
     * 列出所有“活的” IDE 实例（在 `aliveThresholdMs` 内有过心跳）。
     */
    listAliveInstances(now: number = Date.now()): InstanceHeartbeat[] {
        if (!this.db) {
            return [];
        }
        const cutoff = now - this.aliveThresholdMs;
        try {
            const rows = this.db
                .prepare(
                    `SELECT instance_id, pid, hostname, platform, arch, extension_version, started_at, last_heartbeat
                     FROM ide_health_instances
                     WHERE last_heartbeat >= ?
                     ORDER BY last_heartbeat DESC`
                )
                .all<{
                    instance_id: string;
                    pid: number;
                    hostname: string;
                    platform: string;
                    arch: string;
                    extension_version: string;
                    started_at: number;
                    last_heartbeat: number;
                }>(cutoff);
            return rows.map((r) => ({
                instanceId: r.instance_id,
                pid: r.pid,
                hostname: r.hostname,
                platform: r.platform,
                arch: r.arch,
                extensionVersion: r.extension_version,
                startedAt: r.started_at,
                lastHeartbeat: r.last_heartbeat,
            }));
        } catch (err) {
            console.error('[HealthCheckService] listAliveInstances 失败:', err);
            return [];
        }
    }

    /** 是否至少有一个 IDE 实例（包括自己）正在使用本插件。 */
    isAnyInstanceAlive(now: number = Date.now()): boolean {
        return this.listAliveInstances(now).length > 0;
    }

    /** 当前实例自身是否还被视作活的（用于自检）。 */
    isSelfAlive(now: number = Date.now()): boolean {
        if (!this.db) {
            return false;
        }
        const cutoff = now - this.aliveThresholdMs;
        try {
            const row = this.db
                .prepare(
                    `SELECT last_heartbeat FROM ide_health_instances
                     WHERE instance_id = ? AND last_heartbeat >= ?`
                )
                .get<{ last_heartbeat: number }>(this.instanceId, cutoff);
            return !!row;
        } catch (err) {
            console.error('[HealthCheckService] isSelfAlive 失败:', err);
            return false;
        }
    }

    /**
     * 立即写一次心跳。在收到外部健康检查请求时也可主动调用以"刷一下"自己。
     */
    writeHeartbeat(): void {
        if (!this.db) {
            return;
        }
        const now = Date.now();
        try {
            this.db
                .prepare(
                    `INSERT INTO ide_health_instances (
                         instance_id, pid, hostname, platform, arch, extension_version, started_at, last_heartbeat
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(instance_id) DO UPDATE SET
                         pid = excluded.pid,
                         hostname = excluded.hostname,
                         platform = excluded.platform,
                         arch = excluded.arch,
                         extension_version = excluded.extension_version,
                         last_heartbeat = excluded.last_heartbeat`
                )
                .run(
                    this.instanceId,
                    this.pid,
                    this.hostname,
                    this.platform,
                    this.arch,
                    this.extensionVersion,
                    this.startedAt,
                    now
                );
        } catch (err) {
            console.error('[HealthCheckService] 写入心跳失败:', err);
        }
    }

    /** 停止心跳、删除自身记录并关闭数据库。 */
    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.db) {
            try {
                this.db
                    .prepare(`DELETE FROM ide_health_instances WHERE instance_id = ?`)
                    .run(this.instanceId);
            } catch (err) {
                console.error('[HealthCheckService] 注销实例失败:', err);
            }
        }
        this.safeCloseDb();
    }

    private initSchema(db: Database): void {
        // 使用 WAL 提升并发性，多个 IDE 实例同时读写同一个 db 文件更友好。
        db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS ide_health_instances (
                instance_id        TEXT PRIMARY KEY,
                pid                INTEGER NOT NULL,
                hostname           TEXT NOT NULL,
                platform           TEXT NOT NULL,
                arch               TEXT NOT NULL,
                extension_version  TEXT NOT NULL,
                started_at         INTEGER NOT NULL,
                last_heartbeat     INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_ide_health_last_heartbeat
                ON ide_health_instances(last_heartbeat);
        `);
    }

    private pruneStale(db: Database): void {
        // 清理超过 7 天没有心跳的死实例，避免无限增长。
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        try {
            db.prepare(`DELETE FROM ide_health_instances WHERE last_heartbeat < ?`).run(
                sevenDaysAgo
            );
        } catch (err) {
            console.error('[HealthCheckService] pruneStale 失败:', err);
        }
    }

    private safeCloseDb(): void {
        if (!this.db) {
            return;
        }
        try {
            this.db.close();
        } catch (err) {
            console.error('[HealthCheckService] 关闭数据库失败:', err);
        }
        this.db = null;
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

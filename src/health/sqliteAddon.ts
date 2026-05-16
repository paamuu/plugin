/**
 * better-sqlite3 原生绑定（.node 二进制）加载与最小封装。
 *
 * 该文件不依赖 npm 上的 `better-sqlite3` 包，直接加载预先放置在 `resource/`
 * 目录下的 .node 二进制文件，并暴露够用的 `Database` / `Statement` API
 * 供 IDE 健康检查使用。
 *
 * 二进制文件命名约定（位于 `<extensionRoot>/resource/`）：
 *   - 默认（含 Windows / 其他平台）：`better_sqlite3.node`
 *   - Linux ARM64：                  `better_sqlite3-linux-arm64.node`
 *
 * 使用 `process.dlopen` 而非 `require()` 加载，原因是：
 *   1) esbuild 在 `bundle: true` 模式下不会尝试解析 .node 文件，避免打包报错；
 *   2) 可以使用运行期计算出的绝对路径，跨平台行为更稳定。
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * 与 better-sqlite3 内部 `SqliteError` 形态保持一致：构造函数签名为
 * `(message, code)`，并暴露 `code` 字段。native 层在出错时会通过
 * `setErrorConstructor` 注册的构造函数创建错误对象。
 */
export class SqliteError extends Error {
    public code: string;

    constructor(message: string, code: string) {
        super(message);
        this.code = code;
        this.name = 'SqliteError';
    }
}

interface NativeAddon {
    Database: new (
        filename: string,
        filenameGiven: string,
        anonymous: boolean,
        readonly: boolean,
        fileMustExist: boolean,
        timeout: number,
        verbose: ((sql: string) => void) | null,
        buffer: Buffer | null
    ) => NativeDatabase;
    setErrorConstructor: (ctor: new (message: string, code: string) => Error) => void;
    isInitialized?: boolean;
}

interface NativeDatabase {
    prepare(sql: string, dbWrapper: unknown, isPragma: boolean): NativeStatement;
    exec(sql: string): void;
    close(): void;
    readonly open: boolean;
    readonly inTransaction: boolean;
    readonly name: string;
    readonly memory: boolean;
    readonly readonly: boolean;
}

interface NativeStatement {
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    iterate(...args: unknown[]): IterableIterator<unknown>;
    pluck(toggle?: boolean): NativeStatement;
    bind(...args: unknown[]): NativeStatement;
}

let cachedAddon: NativeAddon | null = null;

/**
 * 根据当前进程的平台 / 架构选择应当加载的二进制文件名。
 */
export function resolveBinaryFileName(
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch
): string {
    if (platform === 'linux' && arch === 'arm64') {
        return 'better_sqlite3-linux-arm64.node';
    }
    return 'better_sqlite3.node';
}

/**
 * 根据扩展根目录定位二进制文件的绝对路径。
 */
export function resolveBinaryPath(extensionPath: string): string {
    return path.join(extensionPath, 'resource', resolveBinaryFileName());
}

/**
 * 加载并初始化 better-sqlite3 的原生绑定。多次调用返回同一个 addon。
 *
 * 备注：`setErrorConstructor` 只允许调用一次，因此使用 `isInitialized`
 * 作为幂等标记（与 better-sqlite3 官方 wrapper 行为一致）。
 */
export function loadSqliteAddon(extensionPath: string): NativeAddon {
    if (cachedAddon) {
        return cachedAddon;
    }

    const binaryPath = resolveBinaryPath(extensionPath);
    if (!fs.existsSync(binaryPath)) {
        throw new Error(
            `未找到 SQLite 原生二进制文件：${binaryPath}（平台: ${process.platform}/${process.arch}）`
        );
    }

    const m: { exports: NativeAddon } = { exports: {} as NativeAddon };
    process.dlopen(m as unknown as NodeJS.Module, binaryPath);
    const addon = m.exports;

    if (!addon.isInitialized) {
        addon.setErrorConstructor(SqliteError);
        addon.isInitialized = true;
    }

    cachedAddon = addon;
    return addon;
}

export interface DatabaseOpenOptions {
    readonly?: boolean;
    fileMustExist?: boolean;
    /** SQLite 锁等待超时，单位毫秒。默认 5000。 */
    timeout?: number;
    /** 调试时的 SQL 日志回调。 */
    verbose?: (sql: string) => void;
}

/**
 * 单条预编译 SQL 语句的轻量封装。
 */
export class Statement {
    private readonly native: NativeStatement;

    constructor(native: NativeStatement) {
        this.native = native;
    }

    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
        return this.native.run(...params);
    }

    get<T = unknown>(...params: unknown[]): T | undefined {
        return this.native.get(...params) as T | undefined;
    }

    all<T = unknown>(...params: unknown[]): T[] {
        return this.native.all(...params) as T[];
    }

    iterate<T = unknown>(...params: unknown[]): IterableIterator<T> {
        return this.native.iterate(...params) as IterableIterator<T>;
    }

    pluck(toggle: boolean = true): this {
        this.native.pluck(toggle);
        return this;
    }
}

/**
 * SQLite 数据库连接的最小封装：仅保留 IDE 健康检查所需的能力。
 */
export class Database {
    private readonly native: NativeDatabase;

    constructor(extensionPath: string, filename: string, options: DatabaseOpenOptions = {}) {
        const addon = loadSqliteAddon(extensionPath);

        const trimmed = (filename ?? '').trim();
        const anonymous = trimmed === '' || trimmed === ':memory:';
        const readonly = options.readonly === true;
        const fileMustExist = options.fileMustExist === true;
        const timeout = Number.isInteger(options.timeout) ? (options.timeout as number) : 5000;
        const verbose = typeof options.verbose === 'function' ? options.verbose : null;

        if (readonly && anonymous) {
            throw new TypeError('In-memory/temporary databases cannot be readonly');
        }
        if (!Number.isInteger(timeout) || timeout < 0) {
            throw new TypeError('Expected the "timeout" option to be a positive integer');
        }

        if (!anonymous) {
            const dir = path.dirname(trimmed);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        // native 构造签名（与 better-sqlite3 v11 保持一致）：
        // (filename, filenameGiven, anonymous, readonly, fileMustExist, timeout, verbose, buffer)
        this.native = new addon.Database(
            trimmed,
            trimmed,
            anonymous,
            readonly,
            fileMustExist,
            timeout,
            verbose,
            null
        );
    }

    prepare(sql: string): Statement {
        // 第二个参数本是 JS 端的 Database wrapper，用于 native 侧反向引用；
        // 这里直接传 `this`，对我们的用法已经足够。
        const stmt = this.native.prepare(sql, this, false);
        return new Statement(stmt);
    }

    exec(sql: string): this {
        this.native.exec(sql);
        return this;
    }

    pragma<T = unknown>(source: string, options: { simple?: boolean } = {}): T {
        const stmt = new Statement(this.native.prepare(`PRAGMA ${source}`, this, true));
        return (options.simple ? stmt.pluck().get<T>() : (stmt.all() as unknown as T)) as T;
    }

    close(): this {
        if (this.native.open) {
            this.native.close();
        }
        return this;
    }

    get open(): boolean {
        return this.native.open;
    }

    get inTransaction(): boolean {
        return this.native.inTransaction;
    }
}

/**
 * better-sqlite3 原生绑定（.node 二进制）加载与最小封装。
 *
 * 该文件不依赖 npm 上的 `better-sqlite3` 包，直接加载预先放置在 `resource/`
 * 目录下的 .node 二进制文件，并暴露够用的 `Database` / `Statement` API
 * 供 IDE 健康检查使用。
 */
import * as fs from 'fs';
import * as path from 'path';

/** 与 better-sqlite3 一致：native Database 挂在 JS 包装对象的该 Symbol 上。 */
const CPPDB = Symbol();

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

type DatabaseWithCppdb = Database & { [typeof CPPDB]: NativeDatabase };

let cachedAddon: NativeAddon | null = null;

export function resolveBinaryFileName(
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch
): string {
    if (platform === 'linux' && arch === 'arm64') {
        return 'better_sqlite3-linux-arm64.node';
    }
    return 'better_sqlite3.node';
}

export function resolveBinaryPath(extensionPath: string): string {
    return path.join(extensionPath, 'resource', resolveBinaryFileName());
}

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
    timeout?: number;
    verbose?: (sql: string) => void;
}

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

export class Database {
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

        const native = new addon.Database(
            trimmed,
            trimmed,
            anonymous,
            readonly,
            fileMustExist,
            timeout,
            verbose,
            null
        );

        // 必须与官方 better-sqlite3 相同：native 库通过该 Symbol 关联 JS 包装对象。
        Object.defineProperty(this, CPPDB, { value: native, writable: false, configurable: false });
    }

    private get cppdb(): NativeDatabase {
        return (this as DatabaseWithCppdb)[CPPDB];
    }

    prepare(sql: string): Statement {
        return new Statement(this.cppdb.prepare(sql, this, false));
    }

    exec(sql: string): this {
        this.cppdb.exec(sql);
        return this;
    }

    pragma<T = unknown>(source: string, options: { simple?: boolean } = {}): T {
        const stmt = new Statement(this.cppdb.prepare(`PRAGMA ${source}`, this, true));
        return (options.simple ? stmt.pluck().get<T>() : (stmt.all() as unknown as T)) as T;
    }

    /** 将 WAL 合并进主库，便于外部工具直接打开 ide-health.db 查看数据。 */
    checkpointWal(): void {
        try {
            this.pragma('wal_checkpoint(PASSIVE)', { simple: true });
        } catch {
            // 非 WAL 模式时忽略
        }
    }

    close(): this {
        if (this.cppdb.open) {
            this.cppdb.close();
        }
        return this;
    }

    get open(): boolean {
        return this.cppdb.open;
    }

    get inTransaction(): boolean {
        return this.cppdb.inTransaction;
    }
}

import { spawn, type SpawnOptions } from "child_process";

export interface StartDetachedExeOptions {
  /** 传给可执行文件的命令行参数 */
  args?: string[];
  /** 工作目录；不传则继承扩展宿主进程当前目录 */
  cwd?: string;
  /** 额外环境变量（会与 `process.env` 合并） */
  env?: NodeJS.ProcessEnv;
  /**
   * 是否 `spawn(..., { detached: true })`。
   *
   * 在 VS Code 扩展里，父进程一般是 **无可见控制台** 的 Electron/扩展宿主。此时常见现象是：
   * - `detached: false`：子进程沿用该创建上下文，再配合 `windowsHide`，**很多控制台 exe 反而不弹 CMD**。
   * - `detached: true`：子进程进入新的进程组/会话，**部分**控制台子程序会被系统安排到“需要自己的控制台”的路径上，从而出现 CMD 闪烁或常驻——**不一定**是 exe 里主动 `AllocConsole`，也可能是 PE 子系统 + 启动标志组合导致的。
   *
   * 是否与“exe 自身分配控制台”有关：控制台子系统（`SUBSYSTEM:CONSOLE`）的 exe 在“没有可继承控制台”时，行为依赖创建标志与父进程类型；**以本机实测为准**即可。可用 `dumpbin /headers xxx.exe` 看子系统。
   *
   * 默认 `false`：优先避免弹窗。若你更在意「关闭 VS Code 后子进程是否仍被连带结束」，可改为 `true` 并在目标环境实测（二者在 Windows 上常存在取舍）。
   */
  detached?: boolean;
}

/**
 * 在后台启动 exe；尽量无 CMD 窗口；扩展卸载后子进程是否仍存活取决于 `detached` 与系统/作业对象等，请实测。
 *
 * 其它要点：
 * - `stdio: 'ignore'`：不继承父进程 stdio，减少句柄把子进程拴在宿主上。
 * - `windowsHide: true`（Windows）：对应 `CREATE_NO_WINDOW`，对控制台程序通常用于抑制新控制台窗口。
 * - `child.unref()`：宿主不必在事件循环里等待该子进程。
 */
export function startDetachedExe(
  exePath: string,
  options: StartDetachedExeOptions = {}
): void {
  const { args = [], cwd, env, detached = false } = options;

  const spawnOptions: SpawnOptions = {
    detached,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(env !== undefined ? { env: { ...process.env, ...env } } : {}),
  };

  const child = spawn(exePath, args, spawnOptions);
  child.on("error", (err) => {
    // 启动失败时仅记录；可按需改为 `vscode.window.showErrorMessage`
    console.error("[startDetachedExe] spawn failed:", exePath, err);
  });
  child.unref();
}

import {
  ChildProcess,
  SpawnOptions,
  spawn,
  spawnSync,
} from 'child_process';

const tracked = new Set<ChildProcess>();
let observer: ((event: TrackedProcessEvent) => void) | undefined;

export interface TrackedProcessEvent {
  state: 'spawn' | 'close';
  pid: number;
}

export interface TrackedSpawnOptions extends SpawnOptions {
  timeoutMs?: number;
}

export function spawnTracked(command: string, args: readonly string[] = [], options: TrackedSpawnOptions = {}): ChildProcess {
  const { timeoutMs, ...spawnOptions } = options;
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1)) {
    throw new Error('Tracked process timeout must be a positive integer');
  }
  const child = spawn(command, [...args], {
    ...spawnOptions,
    shell: false,
    windowsHide: true,
    detached: process.platform === 'win32' ? false : true,
  });
  tracked.add(child);
  if (child.pid) observer?.({ state: 'spawn', pid: child.pid });
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => terminateTree(child), timeoutMs);
  timer?.unref?.();
  const untrack = () => {
    if (timer) clearTimeout(timer);
    if (tracked.delete(child) && child.pid) observer?.({ state: 'close', pid: child.pid });
  };
  child.once('close', untrack);
  child.once('error', untrack);
  return child;
}

export function terminateProcessTreeByPid(pid: number): void {
  if (!Number.isInteger(pid) || pid < 1) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
      timeout: 5000,
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
}

function terminateTree(child: ChildProcess): void {
  if (!child.pid) return;
  terminateProcessTreeByPid(child.pid);
  if (!child.killed) {
    try { child.kill(); } catch {}
  }
}

export function terminateTrackedProcesses(): void {
  for (const child of [...tracked]) terminateTree(child);
}

export async function terminateTrackedProcessesAndWait(timeoutMs = 5000): Promise<void> {
  const children = [...tracked];
  if (children.length === 0) return;
  for (const child of children) terminateTree(child);
  await Promise.all(children.map((child) => new Promise<void>((resolve) => {
    if (!tracked.has(child)) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once('close', finish);
    child.once('error', finish);
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
  })));
}

export function setTrackedProcessObserver(next: ((event: TrackedProcessEvent) => void) | undefined): void {
  observer = next;
}

export function trackedProcessCount(): number {
  return tracked.size;
}

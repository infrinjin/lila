import fg from 'fast-glob';
import mm from 'micromatch';
import fs from 'node:fs';
import p from 'node:path';
import { randomToken } from './algo.ts';
import { env, c, errorMark } from './env.ts';

const fsWatches = new Map<AbsPath, FSWatch>();
const watches = new Map<WatchKey, Watch>();
const fileTimes = new Map<AbsPath, number>();

type Path = string;
type AbsPath = string;
type CwdPath = { cwd: AbsPath; path: Path };
type CwdDepth = { cwd: AbsPath; depth: number };
type Debounce = { time: number; timeout?: NodeJS.Timeout; rename: boolean; files: Set<AbsPath> };
type WatchKey = string;
type FSWatch = { watcher: fs.FSWatcher; cwd: AbsPath; keys: Set<WatchKey> };
type Watch = Omit<WatchOpts, 'debounce'> & {
  glob: CwdPath[];
  key: WatchKey;
  debounce: Debounce;
  fileTimes: Map<AbsPath, number>;
  status?: 'ok' | 'error';
};
type WatchOpts = {
  glob: CwdPath | CwdPath[];
  build: (touched: AbsPath[], fullList: AbsPath[]) => Promise<any>;
  key?: WatchKey; // optional key for replace & cancel
  ctx?: string; // optional context for logging
  pkg?: string; // optional package for logging
  debounce?: number; // optional number in ms
  noTouch?: boolean; // default false - if true ignore file mods, only notify when glob list changes
  noInitial?: boolean; // default false - if true don't fire on initial traverse (just monitor)
};

export async function watch(o: WatchOpts): Promise<void> {
  const { noInitial, noTouch, build, debounce, ctx, pkg, key: inKey } = o;
  const glob = Array<CwdPath>().concat(o.glob ?? []);
  if (glob.length === 0) return;
  if (inKey) stopWatch(inKey);
  const newWatch: Watch = {
    key: inKey ?? randomToken(),
    ctx,
    pkg,
    glob,
    noInitial,
    noTouch,
    build,
    status: noInitial ? 'ok' : undefined,
    debounce: { time: debounce ?? 0, rename: !noInitial, files: new Set<AbsPath>() },
    fileTimes: noInitial ? await globTimes(glob) : new Map(),
  };
  watches.set(newWatch.key, newWatch);
  if (env.watch)
    for (const path of newWatch.glob) {
      const { cwd, depth } = await rootAndDepth(path);
      for (const folder of await subfolders(cwd, depth)) {
        addFsWatch(folder, newWatch.key);
      }
    }
  if (!noInitial) return fire(newWatch);
}

export function stopWatch(keys?: WatchKey | WatchKey[]) {
  const stopKeys = Array<WatchKey>().concat(keys ?? [...watches.keys()]);
  for (const key of stopKeys) {
    clearTimeout(watches.get(key)?.debounce.timeout);
    watches.delete(key);
    for (const [folder, fw] of fsWatches) {
      if (fw.keys.delete(key) && fw.keys.size === 0) {
        fw.watcher.close();
        fsWatches.delete(folder);
      }
    }
  }
}

export function watchOk() {
  const all = [...watches.values()];
  return all.filter(w => !w.noInitial).length && all.every(w => w.status === 'ok');
}

export async function rootAndDepth({ cwd, path }: CwdPath): Promise<CwdDepth> {
  const globIndex = path.search(/[*?!{}[\]()]/);
  const isGlob = globIndex >= 0 || (await fs.promises.stat(p.join(cwd, path))).isDirectory();

  const globRoot = !isGlob
    ? p.dirname(path)
    : globIndex === 0
      ? ''
      : path[globIndex - 1] === p.sep
        ? path.slice(0, globIndex - 1)
        : p.dirname(path.slice(0, globIndex));
  return {
    cwd: p.join(cwd, globRoot),
    depth: !isGlob
      ? 0
      : globIndex === -1 || /\*\*/.test(path)
        ? 10
        : path.slice(globIndex).split('/').length - 1,
  };
}

async function onChange(fsw: FSWatch, event: string, f: string | null) {
  const fullpath = p.join(fsw.cwd, f ?? '');

  if (event === 'change') {
    fileTimes.set(fullpath, await cachedTime(fullpath, true));
  }
  for (const watch of [...fsw.keys].map(k => watches.get(k)!)) {
    const matches = watch.glob.map(({ cwd, path }) => p.join(cwd, path));
    if (!mm.isMatch(fullpath, matches)) continue;
    if (event === 'rename') watch.debounce.rename = true;
    if (event === 'change') watch.debounce.files.add(fullpath);
    clearTimeout(watch.debounce.timeout);
    watch.debounce.timeout = setTimeout(() => fire(watch), watch.debounce.time);
  }
}

async function fire(watch: Watch): Promise<void> {
  let modified: AbsPath[] = [];
  if (watch.debounce.rename) {
    const files = await globTimes(watch.glob);
    const keys = [...files.keys()];
    if (watch.noTouch && (watch.fileTimes.size !== files.size || !keys.every(f => watch.fileTimes.has(f)))) {
      modified = keys;
    } else if (!watch.noTouch) {
      for (const [fullpath, time] of [...files]) {
        if (watch.fileTimes.get(fullpath) !== time) modified.push(fullpath);
      }
    }
    watch.fileTimes = files;
  } else if (!watch.noTouch) {
    const files = watch.debounce.files;
    await Promise.all(
      (files ? [...files] : []).map(async file => {
        const fileTime = await cachedTime(file);
        if (watch.fileTimes.get(file) === fileTime) return;
        watch.fileTimes.set(file, fileTime);
        modified.push(file);
      }),
    );
  }
  if (modified.length > 0)
    try {
      watch.status = undefined;
      await watch.build(modified, [...watch.fileTimes.keys()]);
      watch.status = 'ok';
    } catch (e) {
      watch.status = 'error';
      const message = e instanceof Error ? e.message : String(e);
      if (message)
        env.log(`${errorMark} ${watch.pkg ? `[${c.grey(watch.pkg)}] ` : ''}- ${c.error(message)}`, {
          ctx: watch.ctx,
        });
    }
  watch.debounce.rename = false;
  watch.debounce.files.clear();
}

function addFsWatch(root: AbsPath, key: WatchKey) {
  if (fsWatches.has(root)) {
    fsWatches.get(root)?.keys.add(key);
    return;
  }
  const fsWatch = { watcher: fs.watch(root), cwd: root, keys: new Set([key]) };
  fsWatch.watcher.on('change', (event, f) => onChange(fsWatch, event, String(f)));
  fsWatches.set(root, fsWatch);
}

async function cachedTime(file: AbsPath, update = false): Promise<number> {
  if (fileTimes.has(file) && !update) return fileTimes.get(file)!;
  const stat = (await fs.promises.stat(file)).mtimeMs;
  fileTimes.set(file, stat);
  return stat;
}

async function subfolders(folder: string, depth = 1): Promise<string[]> {
  const folders = [folder];
  if (depth > 0)
    for (const file of await fs.promises.readdir(folder, { withFileTypes: true })) {
      if (file.isDirectory()) folders.push(...(await subfolders(p.join(folder, file.name), depth - 1)));
    }
  return folders;
}

async function globTimes(paths: CwdPath[]): Promise<Map<AbsPath, number>> {
  const globs = paths.map(({ path, cwd }) => fg.glob(path, { cwd, absolute: true }));
  return new Map(
    await Promise.all(
      (await Promise.all(globs)).flat().map(async f => [f, await cachedTime(f)] as [string, number]),
    ),
  );
}

import fs from 'node:fs';
import p from 'node:path';
import fg from 'fast-glob';
import { env } from './env.ts';

export type Bundle = { module?: string; inline?: string };

export interface Package {
  root: string; // absolute path to package.json parentdir (package root)
  name: string; // dirname of package root
  pkg: any; // the entire package.json object
  bundle: { module?: string; inline?: string }[]; // TODO doc
  hash: { glob: string; update?: string }[]; // TODO doc
  sync: Sync[]; // pre-bundle filesystem copies from package json
}

export interface Sync {
  src: string; // src must be a file or a glob expression, use <dir>/** to sync entire directories
  dest: string; // TODO doc
  pkg: Package;
}

export async function parsePackages(): Promise<void> {
  for (const dir of (await glob('[^@.]*/package.json')).map(pkg => p.dirname(pkg))) {
    const pkgInfo = await parsePackage(dir);
    env.packages.set(pkgInfo.name, pkgInfo);
  }

  for (const pkgInfo of env.packages.values()) {
    const deplist: string[] = [];
    for (const dep in pkgInfo.pkg.dependencies) {
      if (env.packages.has(dep)) deplist.push(dep);
    }
    env.workspaceDeps.set(pkgInfo.name, deplist);
  }
}

export async function glob(glob: string[] | string | undefined, opts: fg.Options = {}): Promise<string[]> {
  if (!glob) return [];
  const results = await Promise.all(
    Array()
      .concat(glob)
      .map(async g => fg.glob(g, { cwd: env.uiDir, absolute: true, onlyFiles: true, ...opts })),
  );
  return [...new Set(results.flat())];
}

export async function folderSize(folder: string): Promise<number> {
  async function getSize(dir: string): Promise<number> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    const sizes = await Promise.all(
      entries.map(async entry => {
        const fullPath = p.join(dir, entry.name);
        if (entry.isDirectory()) return getSize(fullPath);
        if (entry.isFile()) return (await fs.promises.stat(fullPath)).size;
        return 0;
      }),
    );
    return sizes.reduce((acc: number, size: number) => acc + size, 0);
  }
  return getSize(folder);
}

export async function readable(file: string): Promise<boolean> {
  return fs.promises
    .access(file, fs.constants.R_OK)
    .then(() => true)
    .catch(() => false);
}

async function parsePackage(packageDir: string): Promise<Package> {
  const pkgInfo: Package = {
    pkg: JSON.parse(await fs.promises.readFile(p.join(packageDir, 'package.json'), 'utf8')),
    name: p.basename(packageDir),
    root: packageDir,
    bundle: [],
    sync: [],
    hash: [],
  };
  if (!('build' in pkgInfo.pkg)) return pkgInfo;
  const build = pkgInfo.pkg.build;

  if ('hash' in build)
    pkgInfo.hash = [].concat(build.hash).map(glob => (typeof glob === 'string' ? { glob } : glob));

  if ('bundle' in build)
    for (const one of [].concat(build.bundle).map<Bundle>(b => (typeof b === 'string' ? { module: b } : b))) {
      if (one.module ?? one.inline) pkgInfo.bundle.push(one);
    }

  if ('sync' in build)
    pkgInfo.sync = Object.entries<string>(build.sync).map(x => ({
      src: x[0],
      dest: x[1],
      pkg: pkgInfo,
    }));

  return pkgInfo;
}

export function compressWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

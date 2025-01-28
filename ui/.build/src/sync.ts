import fs from 'node:fs';
import p from 'node:path';
import { watch, rootAndDepth } from './watch.ts';
import { env, c } from './env.ts';
import { quantize } from './algo.ts';

export async function sync(): Promise<any> {
  if (!env.begin('sync')) return;
  return Promise.all(
    env.building.flatMap(
      async pkg =>
        await Promise.all(
          pkg.sync.map(async sync => {
            const { cwd } = await rootAndDepth({ cwd: pkg.root, path: sync.src });
            const syncOp = async (sources: string[]) => {
              env.log(`[${c.grey(pkg.name)}] - Sync '${c.cyan(sync.src)}' to '${c.cyan(sync.dest)}'`);
              return Promise.all(
                sources.map(
                  async src => await syncOne(src, p.join(env.rootDir, sync.dest, src.slice(cwd.length))),
                ),
              );
            };
            await watch({
              glob: { path: sync.src, cwd: pkg.root },
              debounce: 300,
              build: syncOp,
            });
          }),
        ),
    ),
  );
}

async function syncOne(absSrc: string, absDest: string) {
  const [src, dest] = (
    await Promise.allSettled([
      fs.promises.stat(absSrc),
      fs.promises.stat(absDest),
      fs.promises.mkdir(p.dirname(absDest), { recursive: true }),
    ])
  ).map(x => (x.status === 'fulfilled' ? (x.value as fs.Stats) : undefined));
  if (src && (!dest || quantize(src.mtimeMs, 300) !== quantize(dest.mtimeMs, 300))) {
    await fs.promises.copyFile(absSrc, absDest);
    fs.utimes(absDest, src.atime, src.mtime, () => {});
  }
}

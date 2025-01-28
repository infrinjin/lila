import fs from 'node:fs';
import p from 'node:path';
import crypto from 'node:crypto';
import { watch } from './watch.ts';
import { type Manifest, updateManifest } from './manifest.ts';
import { env, c } from './env.ts';

export async function hash(): Promise<void> {
  if (!env.begin('sync')) return;
  const hashed: Manifest = {};
  const hashesOnly = [];
  const hashesWithUpdates = [];
  for (const pkg of env.building) {
    for (const h of pkg.hash) {
      if (h.update) hashesWithUpdates.push({ path: h.glob, replaceAllIn: h.update, pkgRoot: pkg.root });
      else hashesOnly.push(h);
      env.log(`[${c.grey(pkg.name)}] - Hash '${c.cyan(h.glob)}'`);
    }
  }
  await Promise.all([
    watch({
      glob: hashesOnly.map(h => ({ cwd: env.outDir, path: h.glob })),
      debounce: 300,
      build: async files => {
        await Promise.all(
          files.map(async src => {
            const { name, hash } = await hashLink(src.slice(env.outDir.length + 1));
            hashed[name] = { hash };
          }),
        );
        updateManifest({ hashed, merge: true });
      },
    }),
    ...hashesWithUpdates.map(async ({ path, replaceAllIn, pkgRoot }) =>
      watch({
        glob: [{ cwd: env.outDir, path }],
        debounce: 300,
        build: async (files, fullList) => {
          await Promise.all(
            files.map(async src => {
              const { name, hash } = await hashLink(src.slice(env.outDir.length + 1));
              hashed[name] = { hash };
            }),
          );
          const updates: Record<string, string> = {};
          for (const src of fullList.map(f => f.slice(env.outDir.length + 1))) {
            updates[src] = asHashed(src, hashed[src].hash!);
          }
          const { name, hash } = await update(replaceAllIn!, pkgRoot, updates);
          hashed[name] = { hash };
          updateManifest({ hashed, merge: true });
        },
      }),
    ),
  ]);
}

async function update(name: string, root: string, files: Record<string, string>) {
  const result = Object.entries(files).reduce(
    (data, [from, to]) => data.replaceAll(from, to),
    await fs.promises.readFile(p.join(root, name), 'utf8'),
  );
  const hash = crypto.createHash('sha256').update(result).digest('hex').slice(0, 8);
  await fs.promises.writeFile(p.join(env.hashOutDir, asHashed(name, hash)), result);
  return { name, hash };
}

async function hashLink(name: string) {
  const src = p.join(env.outDir, name);
  const hash = crypto
    .createHash('sha256')
    .update(await fs.promises.readFile(src))
    .digest('hex')
    .slice(0, 8);
  await link(name, hash);
  return { name, hash };
}

async function link(name: string, hash: string) {
  const link = p.join(env.hashOutDir, asHashed(name, hash));
  return fs.promises.symlink(p.join('..', name), link).catch(() => {});
}

function asHashed(path: string, hash: string) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const extPos = name.indexOf('.');
  return extPos < 0 ? `${name}.${hash}` : `${name.slice(0, extPos)}.${hash}${name.slice(extPos)}`;
}

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { chdir } from 'node:process';
import { parsePackages } from './parse.ts';
import { watch, stopWatch } from './watch.ts';
import { tsc, stopTsc } from './tsc.ts';
import { sass, stopSass } from './sass.ts';
import { esbuild, stopEsbuild } from './esbuild.ts';
import { sync } from './sync.ts';
import { hash } from './hash.ts';
import { stopManifest } from './manifest.ts';
import { env, errorMark, c } from './env.ts';
import { i18n } from './i18n.ts';
import { unique } from './algo.ts';
import { clean } from './clean.ts';

export async function build(pkgs: string[]): Promise<void> {
  if (env.install) execSync('pnpm install', { cwd: env.rootDir, stdio: 'inherit' });
  if (!pkgs.length) env.log(`Parsing packages in '${c.cyan(env.uiDir)}'`);

  chdir(env.uiDir);
  await parsePackages();

  pkgs
    .filter(x => !env.packages.has(x))
    .forEach(x => env.exit(`${errorMark} - unknown package '${c.magenta(x)}'`));

  env.building = pkgs.length === 0 ? [...env.packages.values()] : unique(pkgs.flatMap(p => env.deps(p)));

  if (pkgs.length) env.log(`Building ${c.grey(env.building.map(x => x.name).join(', '))}`);

  await Promise.allSettled([
    fs.promises.mkdir(env.jsOutDir),
    fs.promises.mkdir(env.cssOutDir),
    fs.promises.mkdir(env.hashOutDir),
    fs.promises.mkdir(env.themeGenDir),
    fs.promises.mkdir(env.buildTempDir),
  ]);
  await Promise.all([sync().then(hash), sass(), i18n().then(tsc), esbuild()]);
  await monitor(pkgs);
}

function stopBuild(): Promise<any> {
  stopWatch();
  stopSass();
  stopManifest(true);
  return Promise.allSettled([stopTsc(), stopEsbuild()]);
}

function monitor(pkgs: string[]) {
  if (!env.watch) return;
  return Promise.all([
    watch({
      key: 'monitor',
      glob: [
        { cwd: env.rootDir, path: 'package.json' },
        { cwd: env.typesDir, path: '*/package.json' },
        { cwd: env.uiDir, path: '*/package.json' },
        { cwd: env.typesDir, path: '*/*.d.ts' },
        { cwd: env.uiDir, path: '*/tsconfig.json' },
      ],
      debounce: 1000,
      noInitial: true,
      build: async files => {
        if (files.some(x => x.endsWith('package.json'))) {
          if (!env.install) env.exit('Exiting due to package.json change');
          await stopBuild();
          if (env.clean) await clean();
          build(pkgs);
        } else if (files.some(x => x.endsWith('.d.ts') || x.endsWith('tsconfig.json'))) {
          stopManifest();
          await Promise.allSettled([stopTsc(), stopEsbuild()]);
          tsc();
          esbuild();
        }
      },
    }),
  ]);
}

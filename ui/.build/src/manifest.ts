import cps from 'node:child_process';
import p from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { env, c, warnMark } from './env.ts';
import { allSources as allCssSources } from './sass.ts';
import { jsLogger } from './console.ts';
import { glob } from './parse.ts';
import { watchOk } from './watch.ts';
import { shallowSort, isEquivalent, isContained } from './algo.ts';

const manifest: { js: Manifest; i18n: Manifest; css: Manifest; hashed: Manifest; dirty: boolean } = {
  i18n: {},
  js: {},
  css: {},
  hashed: {},
  dirty: false,
};
let writeTimer: NodeJS.Timeout;

type SplitAsset = { hash?: string; path?: string; imports?: string[]; inline?: string; mtime?: number };

export type Manifest = { [key: string]: SplitAsset };
export type ManifestUpdate = Partial<typeof manifest> & { merge?: boolean };

export function stopManifest(clear = false): void {
  clearTimeout(writeTimer);
  if (clear) {
    manifest.i18n = manifest.js = manifest.css = manifest.hashed = {};
    manifest.dirty = false;
  }
}

export function updateManifest(update: ManifestUpdate = {}): void {
  if (update.dirty) manifest.dirty = true;

  for (const key of Object.keys(update) as (keyof ManifestUpdate)[]) {
    if (key === 'dirty' || key === 'merge') continue;

    if (update.merge && !isContained(manifest[key], update[key])) {
      const clone = structuredClone(update[key]);
      for (const k in clone) {
        manifest[key][k] ??= {};
        Object.assign(manifest[key][k], clone[k]);
      }
    } else if (!update.merge && !isEquivalent(manifest[key], update[key])) {
      manifest[key] = structuredClone(update[key])!;
    } else {
      continue;
    }
    manifest[key] = shallowSort(manifest[key]);
    manifest.dirty = true;
  }
  if (manifest.dirty) {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(writeManifest, 500);
  }
}

async function writeManifest() {
  if (!(env.buildersOk && watchOk() && (await isComplete()))) return;
  const commitMessage = cps
    .execSync('git log -1 --pretty=%s', { encoding: 'utf-8' })
    .trim()
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;');

  const clientJs: string[] = [
    'if (!window.site) window.site={};',
    'if (!window.site.info) window.site.info={};',
    `window.site.info.commit='${cps.execSync('git rev-parse -q HEAD', { encoding: 'utf-8' }).trim()}';`,
    `window.site.info.message='${commitMessage}';`,
    `window.site.debug=${env.debug};`,
  ];
  if (env.remoteLog) clientJs.push(jsLogger());

  const pairLine = ([name, info]: [string, SplitAsset]) => `'${name.replaceAll("'", "\\'")}':'${info.hash}'`;
  const jsLines = Object.entries(manifest.js)
    .filter(([name, _]) => !/common\.[A-Z0-9]{8}/.test(name))
    .map(pairLine)
    .join(',');
  const cssLines = Object.entries(manifest.css).map(pairLine).join(',');
  const hashedLines = Object.entries(manifest.hashed).map(pairLine).join(',');

  clientJs.push(`window.site.manifest={\ncss:{${cssLines}},\njs:{${jsLines}},\nhashed:{${hashedLines}}\n};`);

  const hashable = clientJs.join('\n');
  const hash = crypto.createHash('sha256').update(hashable).digest('hex').slice(0, 8);

  const clientManifest =
    hashable +
    `\nwindow.site.info.date='${
      new Date(new Date().toUTCString()).toISOString().split('.')[0] + '+00:00'
    }';\n`;
  const serverManifest = {
    js: { manifest: { hash }, ...manifest.js, ...manifest.i18n },
    css: { ...manifest.css },
    hashed: { ...manifest.hashed },
  };
  await Promise.all([
    fs.promises.writeFile(p.join(env.jsOutDir, `manifest.${hash}.js`), clientManifest),
    fs.promises.writeFile(
      p.join(env.jsOutDir, `manifest.${env.prod ? 'prod' : 'dev'}.json`),
      JSON.stringify(serverManifest, null, env.prod ? undefined : 2),
    ),
  ]);
  manifest.dirty = false;
  env.log(
    `Manifest '${c.cyan(`public/compiled/manifest.${env.prod ? 'prod' : 'dev'}.json`)}' -> '${c.cyan(
      `public/compiled/manifest.${hash}.js`,
    )}'`,
  );
}

async function isComplete() {
  if (env.building.length < env.packages.size) return false;

  for (const pkg of env.building) {
    const globs = pkg.bundle.map(b => b.module).filter((x): x is string => Boolean(x));
    for (const file of await glob(globs, { cwd: pkg.root })) {
      const name = p.basename(file, '.ts');
      if (!manifest.js[name]) {
        env.log(`${warnMark} - No manifest without building '${c.cyan(name + '.ts')}'`);
        return false;
      }
    }
  }
  for (const css of await allCssSources()) {
    const name = p.basename(css, '.scss');
    if (!manifest.css[name]) {
      env.log(`${warnMark} - No manifest without building '${c.cyan(name + '.scss')}'`);
      return false;
    }
  }
  return Object.keys(manifest.i18n).length > 0;
}

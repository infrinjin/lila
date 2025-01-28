import p from 'node:path';
import type { Package } from './parse.ts';
import { unique, isEquivalent } from './algo.ts';
import { updateManifest } from './manifest.ts';
import { watchOk } from './watch.ts';

// state, logging, and status logic

export const env = new (class {
  readonly rootDir = p.resolve(p.dirname(new URL(import.meta.url).pathname), '../../..');
  readonly uiDir = p.join(this.rootDir, 'ui');
  readonly outDir = p.join(this.rootDir, 'public');
  readonly cssOutDir = p.join(this.outDir, 'css');
  readonly jsOutDir = p.join(this.outDir, 'compiled');
  readonly hashOutDir = p.join(this.outDir, 'hashed');
  readonly themeDir = p.join(this.uiDir, 'common', 'css', 'theme');
  readonly themeGenDir = p.join(this.themeDir, 'gen');
  readonly buildDir = p.join(this.uiDir, '.build');
  readonly cssTempDir = p.join(this.buildDir, 'build', 'css');
  readonly buildSrcDir = p.join(this.uiDir, '.build', 'src');
  readonly buildTempDir = p.join(this.buildDir, 'build');
  readonly typesDir = p.join(this.uiDir, '@types');
  readonly i18nSrcDir = p.join(this.rootDir, 'translation', 'source');
  readonly i18nDestDir = p.join(this.rootDir, 'translation', 'dest');
  readonly i18nJsDir = p.join(this.rootDir, 'translation', 'js');

  watch = false;
  clean = false;
  prod = false;
  debug = false;
  rgb = false;
  test = false;
  install = true;
  logTime = true;
  logCtx = true;
  logColor = true;
  remoteLog: string | boolean = false;
  startTime: number | undefined = Date.now();

  packages: Map<string, Package> = new Map();
  workspaceDeps: Map<string, string[]> = new Map();
  building: Package[] = [];

  private status: { [key in Context]?: number | false } = {};

  get buildersOk(): boolean {
    return (
      isEquivalent(this.building, [...this.packages.values()]) &&
      (['tsc', 'esbuild', 'sass', 'i18n'] as const).map(b => this.status[b]).every(x => x === 0)
    );
  }

  get manifestFile(): string {
    return p.join(this.jsOutDir, `manifest.${this.prod ? 'prod' : 'dev'}.json`);
  }

  deps(pkgName: string): Package[] {
    const depList = (dep: string): string[] => [
      ...(this.workspaceDeps.get(dep) ?? []).flatMap(d => depList(d)),
      dep,
    ];
    return unique(depList(pkgName).map(name => this.packages.get(name)));
  }

  log(d: any, { ctx = 'build', error = false, warn = false }: any = {}): void {
    let text: string =
      !d || typeof d === 'string' || d instanceof Buffer
        ? String(d)
        : Array.isArray(d)
          ? d.join('\n')
          : JSON.stringify(d);

    const prefix = (
      (this.logTime ? prettyTime() : '') + (ctx && this.logCtx ? `[${escape(ctx, colorForCtx(ctx))}]` : '')
    ).trim();

    lines(this.logColor ? text : stripColorEscapes(text)).forEach(line =>
      console.log(
        `${prefix ? prefix + ' - ' : ''}${escape(line, error ? codes.error : warn ? codes.warn : undefined)}`,
      ),
    );
  }

  warn(d: any, ctx = 'build'): void {
    this.log(d, { ctx: ctx, warn: true });
  }

  error(d: any, ctx = 'build'): void {
    this.log(d, { ctx: ctx, error: true });
  }

  exit(d: any, ctx = 'build'): void {
    this.log(d, { ctx: ctx, error: true });
    process.exit(1);
  }

  good(ctx = 'build'): void {
    this.log(c.good('No errors') + this.watch ? ` - ${c.grey('Watching')}...` : '', { ctx: ctx });
  }

  begin(ctx: Context, enable?: boolean): boolean {
    if (enable === false) this.status[ctx] = false;
    else if (enable === true || this.status[ctx] !== false) this.status[ctx] = undefined;
    return this.status[ctx] !== false;
  }

  done(ctx: Context, code: number = 0): void {
    if (code !== this.status[ctx]) {
      this.log(
        `${code === 0 ? 'Done' : c.red('Failed')}` + (this.watch ? ` - ${c.grey('Watching')}...` : ''),
        { ctx },
      );
    }
    this.status[ctx] = code;
    if (this.buildersOk && watchOk()) {
      if (this.startTime) this.log(`Done in ${c.green((Date.now() - this.startTime) / 1000 + '')}s`);
      this.startTime = undefined;
      updateManifest();
    }
    //if (!this.watch) process.exitCode = Object.values(this.status).find(x => x) || 0;
    if (!this.watch && code) process.exit(code);
  }
})();

export const lines = (s: string): string[] => s.split(/[\n\r\f]+/).filter(x => x.trim());

type Context = 'sass' | 'tsc' | 'esbuild' | 'sync' | 'i18n';

const escape = (text: string, code?: string): string =>
  env.logColor && code ? `\x1b[${code}m${stripColorEscapes(text)}\x1b[0m` : text;

const colorLines = (text: string, code: string) =>
  lines(text)
    .map(t => escape(t, code))
    .join('\n');

const codes: Record<string, string> = {
  black: '30',
  red: '31',
  green: '32',
  yellow: '33',
  blue: '34',
  magenta: '35',
  cyan: '36',
  grey: '90',
  error: '31',
  warn: '33',
};

export const c: Record<string, (text: string) => string> = {
  red: (text: string): string => colorLines(text, codes.red),
  green: (text: string): string => colorLines(text, codes.green),
  yellow: (text: string): string => colorLines(text, codes.yellow),
  blue: (text: string): string => colorLines(text, codes.blue),
  magenta: (text: string): string => colorLines(text, codes.magenta),
  cyan: (text: string): string => colorLines(text, codes.cyan),
  grey: (text: string): string => colorLines(text, codes.grey),
  black: (text: string): string => colorLines(text, codes.black),
  error: (text: string): string => colorLines(text, codes.error),
  warn: (text: string): string => colorLines(text, codes.warn),
  good: (text: string): string => colorLines(text, codes.green + ';1'),
  cyanBold: (text: string): string => colorLines(text, codes.cyan + ';1'),
};

export const errorMark: string = c.red('✘ ') + c.error('[ERROR]');
export const warnMark: string = c.yellow('⚠ ') + c.warn('[WARNING]');

const colorForCtx = (ctx: string): string =>
  ({
    build: codes.green,
    sass: codes.magenta,
    tsc: codes.yellow,
    esbuild: codes.blue,
    // inline: codes.blue,
    // sync: codes.cyan,
    // hash: codes.cyan,
    i18n: codes.cyan,
  })[ctx] ?? codes.grey;

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

function stripColorEscapes(text: string) {
  return text.replace(/\x1b\[[0-9;]*m/, '');
}

function prettyTime() {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())} `;
}

import p from 'node:path';
import es from 'esbuild';
import fs from 'node:fs';
import { env, errorMark, warnMark, c } from './env.ts';
import { type Manifest, updateManifest } from './manifest.ts';
import { watch, stopWatch } from './watch.ts';
import { compressWhitespace } from './parse.ts';

let esbuildCtx: es.BuildContext | undefined;

function esbuildOptions(entryPoints: string[]): es.BuildOptions {
  return {
    entryPoints,
    bundle: true,
    metafile: true,
    treeShaking: true,
    splitting: true,
    format: 'esm',
    target: 'es2020',
    logLevel: 'silent',
    sourcemap: !env.prod,
    minify: env.prod,
    outdir: env.jsOutDir,
    entryNames: '[name].[hash]',
    chunkNames: 'common.[hash]',
    plugins,
  };
}

export async function esbuild(): Promise<any> {
  if (!env.begin('esbuild')) return;

  return Promise.all([
    inline(),
    await watch({
      key: 'bundle',
      ctx: 'esbuild',
      glob: env.building.flatMap(pkg =>
        pkg.bundle
          .map(bundle => bundle.module)
          .filter((module): module is string => Boolean(module))
          .map(module => ({ cwd: pkg.root, path: module })),
      ),
      debounce: 300,
      noTouch: true,
      build: async entryPoints => {
        try {
          await esbuildCtx?.dispose();
          env.begin('esbuild');
          entryPoints.sort();
          esbuildCtx = await es.context(esbuildOptions(entryPoints));
          if (env.watch) esbuildCtx.watch();
          else {
            await esbuildCtx.rebuild();
            await esbuildCtx.dispose();
          }
        } catch (e) {
          //env.log(`${errorMark} - esbuild failed ${c.grey(JSON.stringify(e))}`);
          env.done('esbuild', -1);
        }
      },
    }),
  ]);
}

export async function stopEsbuild(): Promise<void> {
  stopWatch(['bundle', 'inline']);
  await esbuildCtx?.dispose();
  esbuildCtx = undefined;
}

// our html minifier will only process characters between the first two backticks encountered
// so:
//   $html`     <div>    ${    x ?      `<- 2nd backtick   ${y}${z}` : ''    }     </div>`
//
// minifies (partially) to:
//   `<div> ${ x ? `<- 2nd backtick   ${y}${z}` : ''    }     </div>`
//
// nested template literals in interpolations are unchanged and still work, but they
// won't be minified. this is fine, we don't need an ast parser as it's pretty rare

const plugins = [
  {
    name: '$html',
    setup(build: es.PluginBuild) {
      build.onLoad({ filter: /\.ts$/ }, async (args: es.OnLoadArgs) => ({
        loader: 'ts',
        contents: (await fs.promises.readFile(args.path, 'utf8')).replace(
          /\$html`([^`]*)`/g,
          (_, s) => `\`${compressWhitespace(s)}\``,
        ),
      }));
    },
  },
  {
    name: 'onBundleDone',
    setup(build: es.PluginBuild) {
      build.onEnd(async (result: es.BuildResult) => {
        esbuildLog(result.errors, true);
        esbuildLog(result.warnings);
        env.done('esbuild', result.errors.length);
        if (result.errors.length === 0) bundleManifest(result.metafile!);
      });
    },
  },
];

function esbuildLog(msgs: es.Message[], error = false): void {
  for (const msg of msgs) {
    const file = msg.location?.file.replace(/^[./]*/, '') ?? '<unknown>';
    const line = msg.location?.line
      ? `:${msg.location.line}`
      : '' + (msg.location?.column ? `:${msg.location.column}` : '');
    const srcText = msg.location?.lineText;
    env.log(`${error ? errorMark : warnMark} - '${c.cyan(file + line)}' - ${msg.text}`, {
      ctx: 'esbuild',
    });
    if (srcText) env.log('  ' + c.magenta(srcText), { ctx: 'esbuild' });
  }
}

function bundleManifest(meta: es.Metafile = { inputs: {}, outputs: {} }) {
  const js: Manifest = {};
  for (const [filename, info] of Object.entries(meta.outputs)) {
    const out = splitPath(filename);
    if (!out) continue;
    if (out.name === 'common') {
      out.name = `common.${out.hash}`;
      js[out.name] = {};
    } else js[out.name] = { hash: out.hash };
    const imports: string[] = [];
    for (const imp of info.imports) {
      if (imp.kind === 'import-statement') {
        const path = splitPath(imp.path);
        if (path) imports.push(`${path.name}.${path.hash}.js`);
      }
    }
    js[out.name].imports = imports;
  }
  updateManifest({ js, merge: true });
}

async function inline() {
  // TODO we actually need to subtract outdated inline entries from the manifest in watch mode
  const js: Manifest = {};
  const inlineToModule: Record<string, string> = {};
  for (const pkg of env.building) {
    for (const bundle of pkg.bundle) {
      if (!bundle.inline) continue;
      inlineToModule[p.join(pkg.root, bundle.inline)] = bundle.module
        ? p.basename(bundle.module, '.ts')
        : p.basename(bundle.inline, '.inline.ts');
    }
  }
  watch({
    key: 'inline',
    ctx: 'esbuild',
    glob: env.building.flatMap(pkg =>
      pkg.bundle
        .map(b => b.inline)
        .filter((i): i is string => Boolean(i))
        .map(i => ({ cwd: pkg.root, path: i })),
    ),
    debounce: 300,
    build: async (_, fullList) => {
      await Promise.all(
        fullList.map(async inlineSrc => {
          const moduleName = inlineToModule[inlineSrc];
          try {
            const res = await es.transform(await fs.promises.readFile(inlineSrc), {
              minify: true,
              loader: 'ts',
            });
            esbuildLog(res.warnings);
            js[moduleName] ??= {};
            js[moduleName].inline = res.code;
          } catch (e) {
            if (e && typeof e === 'object' && 'errors' in e)
              esbuildLog((e as es.TransformFailure).errors, true);
            throw '';
          }
        }),
      );
      updateManifest({ js, merge: true });
    },
  });
}

function splitPath(path: string) {
  const match = path.match(/\/public\/compiled\/(.*)\.([A-Z0-9]+)\.js$/);
  return match ? { name: match[1], hash: match[2] } : undefined;
}

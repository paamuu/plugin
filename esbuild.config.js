const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  target: 'node16',
  sourcemap: true,
  minify: false,
  platform: 'node',
}).catch(() => process.exit(1));

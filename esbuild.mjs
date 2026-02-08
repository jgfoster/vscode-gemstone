import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['server/src/server.ts'],
  bundle: true,
  outfile: 'server/out/server.js',
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: true,
});

await esbuild.build({
  entryPoints: ['client/src/extension.ts'],
  bundle: true,
  outfile: 'client/out/extension.js',
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: true,
});

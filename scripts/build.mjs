import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';

const css = fs.readFileSync(path.join(ROOT, 'src/ui/style.css'), 'utf8');
await build({
  entryPoints: [path.join(ROOT, 'src/ui/client.jsx')],
  outfile: path.join(ROOT, 'lib/client.js'),
  bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  define: { __DELEGATE_CSS__: JSON.stringify(css) },
  banner: { js: 'window.__ModuleLoader__.load({id:"dsh-deepseek-delegate",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' },
});
console.log('Built lib/client.js');

// The plugin runs from whatever directory the user installed it into. A plain
// `link:` install (zip or cloned directory) never gets node_modules, so bundle
// runtime dependencies such as yaml into the host and MCP entries.
for (const [entry, outfile] of [['src/plugin.mjs', 'lib/plugin.js'], ['src/cli.mjs', 'lib/cli.js']]) {
  await build({
    entryPoints: [path.join(ROOT, entry)],
    outfile: path.join(ROOT, outfile),
    bundle: true, format: 'esm', platform: 'node', target: 'es2022', packages: 'bundle',
    // yaml's CommonJS branch calls require() for node builtins at runtime.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  });
  console.log(`Built ${outfile}`);
}

// Сборка плагина: dist/code.js (песочница Figma) и dist/ui.html (UI с инлайн-скриптом).
import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const common = { bundle: true, target: 'es2020', charset: 'utf8', minify: !watch, logLevel: 'info' };

const inlineUi = {
  name: 'inline-ui',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return;
      const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
      const html = await readFile('src/ui/index.html', 'utf8');
      // Скрипт вставляется функцией, чтобы `$&` и подобные последовательности в коде не интерпретировались.
      await writeFile('dist/ui.html', html.replace('</body>', () => `<script>${js.replace(/<\/script/g, '<\/script')}</script>\n</body>`));
    });
  },
};

await mkdir('dist', { recursive: true });

const code = await esbuild.context({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist/code.js', format: 'iife' });
const ui = await esbuild.context({
  ...common,
  entryPoints: ['src/ui/main.tsx'],
  outfile: 'dist/ui.js',
  write: false,
  jsx: 'automatic',
  jsxImportSource: 'preact',
  plugins: [inlineUi],
});

if (watch) {
  await Promise.all([code.watch(), ui.watch()]);
} else {
  await Promise.all([code.rebuild(), ui.rebuild()]);
  await Promise.all([code.dispose(), ui.dispose()]);
}

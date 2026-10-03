/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';

// Build targets:
//   vite build                   -> dist/             YouTube Playables (ytgame SDK first, cloud save only)
//   vite build --mode crazygames -> dist-crazygames/  CrazyGames (SDK v3 first, Data Module saves)
//   vite build --mode preview    -> dist-preview/     one self-contained HTML file for testing anywhere
//                                                    (no SDK, progress kept in localStorage)
type Target = 'playables' | 'crazygames' | 'preview' | 'dev';

const SDK_TAGS: Partial<Record<Target, string>> = {
  playables: '<script src="https://www.youtube.com/game_api/v1"></script>',
  crazygames: '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>',
};
const OUT_DIRS: Partial<Record<Target, string>> = { playables: 'dist', crazygames: 'dist-crazygames', preview: 'dist-preview' };

function platformSdk(target: Target): Plugin {
  return {
    name: 'platform-sdk',
    transformIndexHtml(html) {
      // The platform SDK has to be the first script on the page, before any game code.
      return html.replace('<!--PLATFORM_SDK-->', SDK_TAGS[target] ?? '');
    },
  };
}

// Inlines the single JS chunk into index.html so the preview build is one file.
function inlineIntoHtml(): Plugin {
  return {
    name: 'inline-into-html',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName.endsWith('.html'));
      if (!html || html.type !== 'asset') return;
      let source = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type !== 'chunk' || !file.isEntry) continue;
        const tag = new RegExp(`<script[^>]*src="[^"]*${file.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*></script>`);
        const code = file.code.replace(/<\/script/gi, '<\\/script');
        source = source.replace(tag, () => `<script type="module">${code}</script>`);
        delete bundle[name];
      }
      html.source = source;
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const target: Target = command === 'serve' ? 'dev' : mode === 'preview' || mode === 'crazygames' ? mode : 'playables';
  return {
    base: './',
    define: {
      __PLAYABLES__: JSON.stringify(target === 'playables'),
      __CRAZYGAMES__: JSON.stringify(target === 'crazygames'),
      __DEV_TOOLS__: JSON.stringify(command === 'serve'),
    },
    plugins: [platformSdk(target), ...(target === 'preview' ? [inlineIntoHtml()] : [])],
    build: {
      outDir: OUT_DIRS[target] ?? 'dist',
      target: 'es2019',
      assetsInlineLimit: 100_000,
      modulePreload: false,
      sourcemap: false,
    },
    test: {
      include: ['tests/**/*.test.ts'],
      testTimeout: 120_000,
    },
  };
});

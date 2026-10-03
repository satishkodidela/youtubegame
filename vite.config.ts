/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';

// Two build targets:
//   vite build                -> dist/          YouTube Playables bundle (SDK script first, cloud save only)
//   vite build --mode preview -> dist-preview/  one self-contained HTML file for testing anywhere
//                                               (no SDK, progress kept in localStorage)
const SDK_TAG = '<script src="https://www.youtube.com/game_api/v1"></script>';

function playablesSdk(enabled: boolean): Plugin {
  return {
    name: 'playables-sdk',
    transformIndexHtml(html) {
      // The SDK has to be the first script on the page, before any game code.
      return html.replace('<!--YT_SDK-->', enabled ? SDK_TAG : '');
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
  const preview = mode === 'preview';
  const playables = command === 'build' && !preview;
  return {
    base: './',
    define: {
      __PLAYABLES__: JSON.stringify(playables),
      __DEV_TOOLS__: JSON.stringify(command === 'serve'),
    },
    plugins: [playablesSdk(playables), ...(preview ? [inlineIntoHtml()] : [])],
    build: {
      outDir: preview ? 'dist-preview' : 'dist',
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

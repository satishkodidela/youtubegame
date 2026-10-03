// Renders store art from the real game: cover images and gameplay preview videos.
//   npm run promo                  -> promo-out/ (covers + videos)
//   npm run promo -- --covers      covers only
//   npm run promo -- --videos      videos only
// Covers: 1920x1080, 800x1200, 800x800 PNG. Videos: 1920x1080 and 1080x1620 H.264 MP4, 30 fps.
// Needs ffmpeg with libx264 on PATH for the videos. Shots and clips are chosen in src/editor/promo.ts.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const doCovers = !args.includes('--videos');
const doVideos = !args.includes('--covers');
const OUT = new URL('../promo-out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const server = await createServer({ server: { port: 0 }, logLevel: 'error' });
await server.listen();
const url = `${server.resolvedUrls.local[0]}promo.html`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(url);
await page.waitForFunction(() => document.title === 'ready', null, { timeout: 30000 });

const decode = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');

try {
  if (doCovers) {
    for (const [layout, name] of [
      ['landscape', 'cover-landscape-1920x1080.png'],
      ['portrait', 'cover-portrait-800x1200.png'],
      ['square', 'cover-square-800x800.png'],
    ]) {
      const png = await page.evaluate((l) => window.promo.renderCover(l), layout);
      writeFileSync(OUT + name, decode(png));
      console.log('wrote', name);
    }
  }
  if (doVideos) {
    for (const [layout, name] of [
      ['landscape', 'video-landscape-1920x1080.mp4'],
      ['portrait', 'video-portrait-1080x1620.mp4'],
    ]) {
      const frames = await page.evaluate((l) => window.promo.setupVideo(l), layout);
      const fps = await page.evaluate(() => window.promo.FPS);
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT + name], { stdio: ['pipe', 'inherit', 'inherit'] });
      const done = new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
      for (let i = 0; i < frames; i++) {
        const jpg = await page.evaluate((n) => window.promo.renderFrame(n), i);
        if (!ff.stdin.write(decode(jpg))) await new Promise((r) => ff.stdin.once('drain', r));
      }
      ff.stdin.end();
      await done;
      console.log(`wrote ${name} (${frames} frames, ${(frames / fps).toFixed(1)} s)`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}

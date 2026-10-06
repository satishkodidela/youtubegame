import semibold from '../assets/fonts/fredoka-latin-600-normal.woff2';
import bold from '../assets/fonts/fredoka-latin-700-normal.woff2';

/**
 * Loads the bundled UI font (Fredoka, SIL Open Font License; see assets/fonts/OFL.txt). The files
 * are small enough for Vite to inline, so this makes no network request. Resolves when the font is
 * ready or after `timeout` ms, whichever is first: text falls back to the system font meanwhile.
 */
export function loadFonts(timeout = 600): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  const faces = [
    new FontFace('Fredoka', `url(${semibold})`, { weight: '600' }),
    new FontFace('Fredoka', `url(${bold})`, { weight: '700' }),
  ];
  const loaded = Promise.all(faces.map((f) => f.load().then((face) => void document.fonts.add(face)))).then(
    () => undefined,
    () => undefined,
  );
  return Promise.race([loaded, new Promise<void>((resolve) => setTimeout(resolve, timeout))]);
}

// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// Printing a page with its pictures (used by components/PageActions.astro, browser only).
// Pictures load only when scrolled near (loading="lazy") and come in several widths (srcset),
// so a print could show empty spaces: pictures never scrolled to are not downloaded, and the
// paper width makes the browser pick a width it has not downloaded. So before printing, every
// picture loads now (10 s at most), then keeps the file it already has (srcset put aside) until
// the print is done. Ctrl+P cannot wait: pictures already loaded print, the others may not.

const WAIT_MS = 10000;
let frozen = [];

const pictures = () => [...document.querySelectorAll('main img')];

// Start loading every picture now (they were waiting to be scrolled to)
export function loadPictures() {
  for (const img of pictures()) if (img.loading === 'lazy') img.loading = 'eager';
}

// Keep the file the picture already shows: no other width is picked for the paper
function freeze(img) {
  if (!img.hasAttribute('srcset') || !img.currentSrc) return;
  frozen.push({ img, srcset: img.getAttribute('srcset'), sizes: img.getAttribute('sizes'), src: img.getAttribute('src') });
  img.removeAttribute('sizes');
  img.removeAttribute('srcset');
  img.src = img.currentSrc;
}

function unfreeze() {
  for (const f of frozen) {
    f.img.setAttribute('src', f.src);
    if (f.sizes) f.img.setAttribute('sizes', f.sizes);
    f.img.setAttribute('srcset', f.srcset);
  }
  frozen = [];
}

// Print the page once its pictures have loaded (or after WAIT_MS)
export async function printPage() {
  loadPictures();
  const root = document.documentElement;
  root.style.cursor = 'progress';
  const loaded = pictures().map((img) => img.complete ? null : new Promise((done) => {
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  }));
  await Promise.race([Promise.all(loaded), new Promise((done) => setTimeout(done, WAIT_MS))]);
  root.style.cursor = '';
  pictures().forEach(freeze);
  window.print();
}

let ready = false;
// Ctrl+P and the browser's own Print: freeze the pictures already loaded
export function watchPrinting() {
  if (ready) return;
  ready = true;
  window.addEventListener('beforeprint', () => {
    if (frozen.length) return; // printPage() already prepared them
    loadPictures();
    pictures().filter((img) => img.complete).forEach(freeze);
  });
  window.addEventListener('afterprint', unfreeze);
}

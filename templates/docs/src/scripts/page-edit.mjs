// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// Changing a page's text in the browser (components/PageEdit.astro): the parts that need no
// browser (labels, the list of changes sent to the docs server), tested by the agent kit.

export const EDIT_API = '/_kit/edit'; // the kit's docs server (lib/docs-edit.mjs)
export const SAVED_KEY = 'kit-page-edit-saved'; // sessionStorage: "saved" after the page reloads

const TEXTS = {
  en: {
    edit: 'Edit',
    editHint: "Change this page's text here, then save it",
    region: 'Page editing',
    idle: 'Editing: click a text to change it',
    change: (n) => `${n} change${n === 1 ? '' : 's'}`,
    discard: 'Discard',
    discardHint: 'Put the text back as it was',
    save: 'Save',
    saveHint: 'Save the changes into the page (Ctrl+S)',
    saving: 'Saving… the website is being rebuilt',
    saved: (version) => (version ? `Saved (version ${version})` : 'Saved'),
    savedNoGit: 'Saved, but not recorded in git: run kit doctor',
    linksUpdated: (n) => `${n} link${n === 1 ? '' : 's'} to the renamed section${n === 1 ? '' : 's'} updated`,
    newLine: 'New lines can’t go in a title, a heading, bold or italic text, a link or code',
    errors: {
      off: 'Editing is turned off for this website. Nothing was saved.',
      forbidden: 'The website refused the change: open it with its usual address. Nothing was saved.',
      changed: 'This page changed since you opened it. Copy your text, reload the page and edit again.',
      unsaved: 'This page has changes not saved in the project yet (kit docs update). Nothing was saved.',
      bad: 'The change could not be read. Reload the page and try again.',
      code: 'A backtick (`) can’t be typed inside code. Nothing was saved.',
      title: 'The page needs a title. Nothing was saved.',
      notfound: 'This page was not found on the website. Reload it.',
      build: 'The website could not be rebuilt with this change, so nothing was saved.',
      links: 'This heading is linked to from a place that can’t be updated, so nothing was saved. Keep the heading, or change this link first:',
      network: 'No answer from the website. It may still be saving: reload the page in a minute to check.',
      failed: 'Saving failed. Nothing was saved.',
      value: 'This value could not be saved, so nothing was saved:',
    },
  },
  fr: {
    edit: 'Modifier',
    editHint: 'Modifier le texte de cette page ici, puis l’enregistrer',
    region: 'Modification de la page',
    idle: 'Modification : cliquez sur un texte pour le changer',
    change: (n) => `${n} modification${n === 1 ? '' : 's'}`,
    discard: 'Annuler',
    discardHint: 'Remettre le texte comme avant',
    save: 'Enregistrer',
    saveHint: 'Enregistrer les modifications dans la page (Ctrl+S)',
    saving: 'Enregistrement… le site est reconstruit',
    saved: (version) => (version ? `Enregistré (version ${version})` : 'Enregistré'),
    savedNoGit: 'Enregistré, mais pas dans git : lancez kit doctor',
    linksUpdated: (n) => `${n} lien${n === 1 ? '' : 's'} vers la section renommée mis à jour`,
    newLine: 'Pas de nouvelle ligne dans un titre, du gras ou de l’italique, un lien ou du code',
    errors: {
      off: 'La modification est désactivée sur ce site. Rien n’a été enregistré.',
      forbidden: 'Le site a refusé la modification : ouvrez-le avec son adresse habituelle. Rien n’a été enregistré.',
      changed: 'Cette page a changé depuis son ouverture. Copiez votre texte, rechargez la page et recommencez.',
      unsaved: 'Cette page a des changements pas encore enregistrés dans le projet (kit docs update). Rien n’a été enregistré.',
      bad: 'La modification n’a pas pu être lue. Rechargez la page et réessayez.',
      code: 'Un accent grave (`) ne peut pas être tapé dans du code. Rien n’a été enregistré.',
      title: 'La page doit avoir un titre. Rien n’a été enregistré.',
      notfound: 'Cette page est introuvable sur le site. Rechargez-la.',
      build: 'Le site n’a pas pu être reconstruit avec cette modification : rien n’a été enregistré.',
      links: 'Ce titre est la cible d’un lien qui ne peut pas être mis à jour : rien n’a été enregistré. Gardez le titre, ou changez d’abord ce lien :',
      network: 'Pas de réponse du site. Il enregistre peut-être encore : rechargez la page dans une minute pour vérifier.',
      failed: 'L’enregistrement a échoué. Rien n’a été enregistré.',
      value: 'Cette valeur n’a pas pu être enregistrée, donc rien n’a été enregistré :',
    },
  },
};

export const labels = (fr) => TEXTS[fr ? 'fr' : 'en'];

// The bar's message for a refused save; `detail`: the server's list (the links that couldn't be
// updated); `reason`: the server's message (why a project value was refused)
export function errorMessage(code, fr, detail, reason) {
  const errors = labels(fr).errors;
  const message = Object.hasOwn(errors, code) ? errors[code] : errors.failed;
  if (code === 'value' && reason) return `${message} ${reason}`;
  return code === 'links' && Array.isArray(detail) && detail.length ? `${message} ${detail[0]}` : message;
}

// The message after the page reloaded: { version, warning, links } as the server answered
export function savedMessage(info, fr) {
  const t = labels(fr);
  const saved = info?.warning === 'git' ? t.savedNoGit : t.saved(info?.version || '');
  return info?.links > 0 ? `${saved} · ${t.linksUpdated(info.links)}` : saved;
}

// "S-E" (data-kit-src) -> { s, e }, or null
export function parseRange(text) {
  const m = /^(\d{1,9})-(\d{1,9})$/.exec(String(text ?? ''));
  if (!m) return null;
  const s = Number(m[1]), e = Number(m[2]);
  return e > s ? { s, e } : null;
}

// The texts changed while editing -> what the server gets: [{ s, e, before, after }]
// `pieces`: [{ range: 'S-E', before: text when editing started, after: text now }]
export function collectEdits(pieces) {
  const edits = [];
  for (const piece of pieces ?? []) {
    const range = parseRange(piece?.range);
    const before = String(piece?.before ?? ''), after = String(piece?.after ?? '');
    if (range && before !== after) edits.push({ s: range.s, e: range.e, before, after });
  }
  return edits;
}

// The project values changed while editing -> what the server gets: [{ id, before, after }]
// `pieces`: [{ id: data-kit-value, before, after }]
export function collectValues(pieces) {
  const values = [];
  for (const piece of pieces ?? []) {
    const id = String(piece?.id ?? '');
    const before = String(piece?.before ?? ''), after = String(piece?.after ?? '');
    if (id && before !== after) values.push({ id, before, after });
  }
  return values;
}

// Pasted text: plain, on one line
export function cleanPaste(text) {
  return String(text ?? '').replace(/[ \t]*[\r\n\u2028\u2029]+[ \t]*/g, ' ').replace(/\t/g, ' ');
}

// A new line typed while editing (a <br> in the text), as it is sent to the docs server: U+2028.
// One = a line break, two or more in a row = a new paragraph (src/page-edit/markdown-text.mjs).
export const LINE_BREAK = '\u2028';

// The text of an editable piece as it is sent: its text, each <br> typed as a LINE_BREAK (not the
// one marked data-kit-end: put after a new line at the very end, so the browser shows that line)
export const END_MARK = 'data-kit-end';
export function pieceText(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.nodeValue ?? '';
  if (node.nodeName === 'BR') return node.hasAttribute?.(END_MARK) ? '' : LINE_BREAK;
  let text = '';
  for (const child of node.childNodes ?? []) text += pieceText(child);
  return text;
}

// How many <br> a key puts: Enter = a new paragraph (2: an empty line shows it), Shift+Enter or
// any new line in a table cell = a line break (1)
export const breaksFor = ({ shift, cell }) => (shift || cell ? 1 : 2);

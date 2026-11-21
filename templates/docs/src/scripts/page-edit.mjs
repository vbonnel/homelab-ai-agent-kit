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
    newLine: 'One line at a time: new lines can’t be added here',
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
      network: 'No answer from the website. It may still be saving: reload the page in a minute to check.',
      failed: 'Saving failed. Nothing was saved.',
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
    newLine: 'Une ligne à la fois : pas de nouvelle ligne ici',
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
      network: 'Pas de réponse du site. Il enregistre peut-être encore : rechargez la page dans une minute pour vérifier.',
      failed: 'L’enregistrement a échoué. Rien n’a été enregistré.',
    },
  },
};

export const labels = (fr) => TEXTS[fr ? 'fr' : 'en'];

export function errorMessage(code, fr) {
  const errors = labels(fr).errors;
  return Object.hasOwn(errors, code) ? errors[code] : errors.failed;
}

// The message after the page reloaded: { version, warning } as the server answered
export function savedMessage(info, fr) {
  const t = labels(fr);
  return info?.warning === 'git' ? t.savedNoGit : t.saved(info?.version || '');
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

// Pasted text: plain, on one line
export function cleanPaste(text) {
  return String(text ?? '').replace(/[ \t]*[\r\n]+[ \t]*/g, ' ').replace(/\t/g, ' ');
}

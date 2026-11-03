// End-to-end tests for dialogue books (DIALOGUE BOOKS in app.js): a new
// one from the shelf, each chapter's panel, characters, a speaker picked in
// the margin, Create linked, the problems listed, and what reaches the
// disk. Run with `npm run test:dialogue`; NEO_SHOTS=<folder> saves pictures.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-dialogue-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
const lib = path.join(tmp, 'NEO Library');
fs.mkdirSync(lib);
fs.writeFileSync(path.join(lib, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: false,
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const shot = async (name) => {
  if (!process.env.NEO_SHOTS) return;
  const img = await wc.capturePage();
  fs.writeFileSync(path.join(process.env.NEO_SHOTS, name + '.png'), img.toPNG());
};
const bookDir = () => path.join(lib, fs.readdirSync(lib).find((n) => n.startsWith('book-')));
const onDisk = () => JSON.parse(fs.readFileSync(path.join(bookDir(), 'book.json'), 'utf8'));
const chapterFile = (id) => fs.readFileSync(path.join(bookDir(), 'chapters', id + '.html'), 'utf8');
// the caret at the end of a chapter's line
const caretIn = (n, line = 0) => js(`(() => {
  const id = book.chapterOrder[${n}];
  const p = document.querySelectorAll('.chapter[data-id="' + id + '"] .chapter-body p')[${line}];
  p.closest('.chapter-body').focus();
  const r = document.createRange();
  r.selectNodeContents(p);
  r.collapse(false);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  currentChapterId = id;
})()`);
const type = async (text) => { await js(`document.execCommand('insertText', false, ${JSON.stringify(text)})`); await tick(60); };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a new dialogue book: its chapter is a dialogue, with its panel', async () => {
  assert.equal(await js('book.format'), 'dialogue');
  assert.equal(await js('document.querySelectorAll("#chapters .dlg-panel").length'), 1);
  assert.equal(await js('document.querySelector(".dlg-id").value'), 'dialogue_01');
  assert.equal(await js('chapterName(book.chapterOrder[0])'), 'dialogue_01');
});

test('the first character names the dialogue; a second joins it', async () => {
  await js('dlgNewCharacter("Succy", book.chapterOrder[0])');
  await js('dlgNewCharacter("The Smith", book.chapterOrder[0])');
  await tick(100);
  assert.deepEqual(await js('book.dialogue.characters'), [{ id: 'succy', name: 'Succy' }, { id: 'the_smith', name: 'The Smith' }]);
  assert.deepEqual(await js('dlgChapter(book.chapterOrder[0]).characters'), ['succy', 'the_smith']);
  assert.equal(await js('dlgChapter(book.chapterOrder[0]).id'), 'succy_01');
  assert.deepEqual(await js('[...document.querySelectorAll(".dlg-panel .dlg-chip")].map((c) => c.firstChild.textContent)'), ['Succy', 'The Smith']);
});

test('a line without a speaker is a problem; the margin menu offers the dialogue\'s characters', async () => {
  await caretIn(0);
  await type('Oh! Boss. You came all the way down here?');
  await tick(500);
  assert.match(await js('document.querySelector(".dlg-problems").textContent'), /line 1: nobody says it/);
  assert.equal(await js('document.getElementById("dlg-speaker").hidden'), false);
  assert.deepEqual(await js('[...document.getElementById("dlg-speaker").options].map((o) => o.value)'), ['', 'succy', 'the_smith', '+new']);
});

test('picking a speaker tags the line, and the file keeps the tag but not the margin\'s name', async () => {
  await js(`(() => { const s = document.getElementById('dlg-speaker'); s.value = 'succy'; s.dispatchEvent(new Event('change')); })()`);
  await tick(200);
  assert.equal(await js('document.querySelector(".dialogue-body p").getAttribute("data-speaker")'), 'succy');
  assert.equal(await js('document.querySelector(".dialogue-body p").getAttribute("data-who")'), 'Succy');
  assert.equal(await js('document.querySelector(".dlg-problems").hidden'), true);
  await js('flushAllSaves()');
  await tick(1200);
  const html = chapterFile(await js('book.chapterOrder[0]'));
  assert.match(html, /<p data-speaker="succy">Oh! Boss/);
  assert.ok(!html.includes('data-who'));
});

test('Enter: the next line keeps the speaker but not the line\'s game id', async () => {
  await js(`document.querySelector('.dialogue-body p').setAttribute('data-line', 'succy_01_01')`);
  await caretIn(0);
  await js(`document.execCommand('insertParagraph')`);
  await tick(60);
  await type('I made the key.');
  const ps = await js(`[...document.querySelectorAll('.dialogue-body p')].map((p) => [p.getAttribute('data-line'), p.getAttribute('data-speaker')])`);
  assert.deepEqual(ps, [['succy_01_01', 'succy'], [null, 'succy']]);
});

test('Create linked: the next dialogue, the same characters, this one read first and leading to it', async () => {
  await js(`(() => { const s = document.getElementById('dlg-speaker'); s.value = 'the_smith'; s.dispatchEvent(new Event('change')); })()`);
  await tick(100);
  await js('document.querySelector(".dlg-panel .dlg-linked").click()');
  await tick(400);
  const [a, b] = await js('book.chapterOrder');
  assert.deepEqual(await js(`dlgChapter(${JSON.stringify(b)})`), { id: 'succy_02', idAuto: false, characters: ['succy', 'the_smith'], events: [], reads: [a], next: [] });
  assert.deepEqual(await js(`dlgChapter(${JSON.stringify(a)}).next`), [b]);
  // the one who answers is the next character after the last to speak
  assert.equal(await js(`chapterHTML[${JSON.stringify(b)}]`), '<p data-speaker="succy"><br></p>');
  assert.match(await js(`document.querySelectorAll('.dlg-problems')[1].textContent`), /has no lines yet/);
  assert.deepEqual(await js('[...document.querySelectorAll(".dlg-panel")[1].querySelectorAll(".dlg-chip")].map((c) => c.firstChild.textContent)'), ['Succy', 'The Smith', 'succy_01']);
});

test('a story event, added from the panel, is something the dialogue waits for', async () => {
  const b = await js('book.chapterOrder[1]');
  await js(`(() => { const d = dlgMeta(); d.events.push({ id: 'chest_built', description: 'A chest stands in the room.' }); const c = dlgChapter(${JSON.stringify(b)}); c.events.push('chest_built'); dlgChanged(${JSON.stringify(b)}); })()`);
  await caretIn(1);
  await type('It locks!');
  await tick(500);
  assert.equal(await js(`document.querySelectorAll('.dlg-problems')[1].hidden`), true);
  assert.ok((await js('[...document.querySelectorAll(".dlg-panel")[1].querySelectorAll(".dlg-chip.event")].length')) === 1);
  await shot('dialogue-book');
  await caretIn(0, 1);
  await js(`document.querySelector('.chapter').scrollIntoView()`);
  await tick(200);
  await shot('dialogue-lines');
});

test('the book flattens into the game\'s one-line dialogues', async () => {
  const story = await js('NeoDialogue.flatten(dlgModel()).story');
  assert.deepEqual(story.dialogues, [
    { id: 'succy_01_01', character: 'succy', requires: { events: [], dialogues: [] }, next: ['succy_01_02'] },
    { id: 'succy_01_02', character: 'the_smith', requires: { events: [], dialogues: ['succy_01_01'] }, next: ['succy_02_01'] },
    { id: 'succy_02_01', character: 'succy', requires: { events: ['chest_built'], dialogues: ['succy_01_02'] }, next: [] }
  ]);
});

test('book.json holds the characters, the events and each dialogue', async () => {
  await js('flushAllSaves()');
  await tick(1200);
  const d = onDisk();
  assert.equal(d.format, 'dialogue');
  assert.deepEqual(d.dialogue.characters.map((c) => c.id), ['succy', 'the_smith']);
  assert.deepEqual(d.dialogue.events.map((e) => e.id), ['chest_built']);
  assert.deepEqual(d.chapterOrder.map((k) => d.dialogue.chapters[k].id), ['succy_01', 'succy_02']);
});

// ---- the game's story files ----
const D = require('../dialogue.js');
const game = path.join(tmp, 'BlackestSmith');
fs.mkdirSync(path.join(game, 'data', 'text'), { recursive: true });
const GAME_STORY = {
  characters: [{ id: 'smith', name: 'The Smith' }],
  events: [{ id: 'chest_built', description: 'A chest stands in the room.' }],
  dialogues: [
    { id: 'imp_talk_01', character: 'imp', requires: { events: [], dialogues: [] }, next: ['imp_talk_02'] },
    { id: 'imp_talk_02', character: 'smith', requires: { events: [], dialogues: ['imp_talk_01'] }, next: [] },
    { id: 'imp_chest_01', character: 'imp', requires: { events: ['chest_built'], dialogues: ['imp_talk_02'] }, next: [] }
  ]
};
const GAME_TEXT = { imp_talk_01: 'Boss!', imp_talk_02: 'Imp.', imp_chest_01: 'It locks!' };
const storyFile = path.join(game, 'data', 'story.json');
const textFile = path.join(game, 'data', 'text', 'en.json');
fs.writeFileSync(storyFile, D.storyToJson(GAME_STORY));
fs.writeFileSync(textFile, D.textToJson(GAME_STORY, GAME_TEXT));
fs.writeFileSync(path.join(game, 'data', 'quarters.json'), '{\n  // the minions\n  "minions": [ { "id": "imp", "name": "Impy" } ]\n}\n');
const gameBook = async () => {
  await js(`(async () => {
    await backToShelf();
    await createDialogueOnShelf(library.shelves[0]);
    book.dialogue.source = { repo: ${JSON.stringify(game)}, language: 'en' };
    await dlgUpdateFromGame();
  })()`);
  await tick(600);
};

test('a game\'s story comes in: a dialogue per conversation, its minions as speakers', async () => {
  await gameBook();
  const ids = await js('book.chapterOrder.map((k) => dlgChapter(k).id)');
  assert.deepEqual(ids, ['imp_talk', 'imp_chest']);
  assert.deepEqual(await js('dlgChapter(book.chapterOrder[1]).reads'), [await js('book.chapterOrder[0]')]);
  assert.deepEqual(await js('book.dialogue.gameSpeakers'), [{ id: 'imp', name: 'Impy', source: 'minion' }]);
  assert.equal(await js(`chapterHTML[book.chapterOrder[0]]`), '<p data-line="imp_talk_01" data-speaker="imp">Boss!</p><p data-line="imp_talk_02" data-speaker="smith">Imp.</p>');
  assert.equal(await js('document.querySelector(".dialogue-body p").getAttribute("data-who")'), 'Impy');
  assert.deepEqual(await js('dlgProblems()'), []);
  assert.match(await js('document.getElementById("tp-dialogue").textContent'), /Update from Game.*Save to Game/);
});

test('Save to Game with nothing changed leaves the files as they were, byte for byte', async () => {
  const before = [fs.readFileSync(storyFile, 'utf8'), fs.readFileSync(textFile, 'utf8')];
  await js('dlgSaveToGame()');
  await tick(300);
  assert.deepEqual([fs.readFileSync(storyFile, 'utf8'), fs.readFileSync(textFile, 'utf8')], before);
});

test('a new line and an edit go into the game, beside what someone else pushed meanwhile', async () => {
  // the writer: a new line at the end of the first dialogue, and an edit
  await caretIn(0, 1);
  await js(`document.execCommand('insertParagraph')`);
  await tick(60);
  await type('Get out.');
  await js(`(() => { const p = document.querySelector('.dialogue-body p'); p.textContent = 'Boss! Hello!'; syncChapter(p.parentElement, book.chapterOrder[0]); })()`);
  // meanwhile, in the game
  const s = structuredClone(GAME_STORY);
  s.dialogues.push({ id: 'smith_01', character: 'smith', requires: { events: [], dialogues: [] }, next: [] });
  fs.writeFileSync(storyFile, D.storyToJson(s));
  fs.writeFileSync(textFile, D.textToJson(s, { ...GAME_TEXT, smith_01: 'Heh.' }));
  await js('dlgSaveToGame()');
  await tick(800);
  const r = D.readStory(fs.readFileSync(storyFile, 'utf8'), fs.readFileSync(textFile, 'utf8'));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.story.dialogues.map((d) => [d.id, d.character, d.next]), [
    ['imp_talk_01', 'imp', ['imp_talk_02']],
    ['imp_talk_02', 'smith', ['imp_talk_03']],
    ['imp_chest_01', 'imp', []],
    ['smith_01', 'smith', []],
    ['imp_talk_03', 'smith', []]
  ]);
  assert.deepEqual(r.story.dialogues.find((d) => d.id === 'imp_chest_01').requires.dialogues, ['imp_talk_03']);
  assert.equal(r.text.imp_talk_01, 'Boss! Hello!');
  assert.equal(r.text.imp_talk_03, 'Get out.');
  assert.equal(r.text.smith_01, 'Heh.');
  // the book took in the other line, and its new line kept the id it was given
  assert.deepEqual(await js('book.chapterOrder.map((k) => dlgChapter(k).id)'), ['imp_talk', 'imp_chest', 'smith']);
  assert.deepEqual(await js(`[...document.querySelectorAll('.dialogue-body')[0].children].map((p) => [p.getAttribute('data-line'), p.getAttribute('data-speaker')])`),
    [['imp_talk_01', 'imp'], ['imp_talk_02', 'smith'], ['imp_talk_03', 'smith']]);
  assert.match(await js(`chapterHTML[book.chapterOrder[0]]`), /data-line="imp_talk_03"[^>]*>Get out\./);
  await shot('dialogue-game');
  await js(`document.getElementById('title-page').scrollIntoView()`);
  await tick(200);
  await shot('dialogue-title');
});

test('a line the game no longer has: Update from Game sends its dialogue to Darlings', async () => {
  const r = D.readStory(fs.readFileSync(storyFile, 'utf8'), fs.readFileSync(textFile, 'utf8'));
  r.story.dialogues = r.story.dialogues.filter((d) => d.id !== 'smith_01');
  delete r.text.smith_01;
  fs.writeFileSync(storyFile, D.storyToJson(r.story));
  fs.writeFileSync(textFile, D.textToJson(r.story, r.text));
  const darlings = await js('darlings.length');
  await js('dlgUpdateFromGame()');
  await tick(600);
  assert.deepEqual(await js('book.chapterOrder.map((k) => dlgChapter(k).id)'), ['imp_talk', 'imp_chest']);
  assert.equal(await js('darlings.length'), darlings + 1);
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof library !== 'undefined' && !!library && Array.isArray(library.shelves)`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await createDialogueOnShelf(library.shelves[0]);
    })()`);
    await tick(600);
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
}
main();

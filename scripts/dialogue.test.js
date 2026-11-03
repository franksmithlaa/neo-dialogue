'use strict';

// Dialogue books (dialogue.js), without a window: ids, a book flattened
// into the game's one-line dialogues (the Blackest Smith Writer's
// data/story.json and data/text/<language>.json), the game's lines put back
// into chapters, and the problems listed before anything is written out.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const D = require('../dialogue.js');

// the shape of the game's story.json, with its own words swapped for these
const STORY = {
  characters: [{ id: 'smith', name: 'The Smith' }, { id: 'narrator', name: 'Narrator' }],
  events: [{ id: 'chest_built', description: 'A chest stands in the room.' }],
  dialogues: [
    { id: 'imp_talk_01', character: 'imp', requires: { events: [], dialogues: [] }, next: ['imp_talk_02'] },
    { id: 'imp_talk_02', character: 'imp', requires: { events: [], dialogues: ['imp_talk_01'] }, next: ['imp_talk_03'] },
    { id: 'imp_talk_03', character: 'imp', requires: { events: [], dialogues: ['imp_talk_02'] }, next: [] },
    { id: 'imp_chest_01', character: 'imp', requires: { events: ['chest_built'], dialogues: ['imp_talk_03'] }, next: ['smith_reply_01'] },
    { id: 'smith_reply_01', character: 'smith', requires: { events: [], dialogues: ['imp_chest_01'] }, next: [] },
    { id: 'narrator_01', character: 'narrator', requires: { events: [], dialogues: ['smith_reply_01'] }, next: ['smith_01'] },
    { id: 'smith_01', character: 'smith', requires: { events: [], dialogues: ['narrator_01'] }, next: [] }
  ]
};
const TEXT = Object.fromEntries(STORY.dialogues.map((d) => [d.id, 'Words of ' + d.id + '.']));
const keys = (n) => 'ch-' + n;

test('ids are lower case letters, digits and underscores', () => {
  assert.equal(D.slug('  Succy Talk!  '), 'succy_talk');
  assert.equal(D.slug('Brokk’s forge'), 'brokk_s_forge');
  assert.equal(D.slug('Émile'), 'emile');
  assert.equal(D.nextId('brokk', new Set(['brokk_01'])), 'brokk_02');
  assert.equal(D.idAfter('succy_talk_04', new Set()), 'succy_talk_05');
  assert.equal(D.idAfter('succy_talk_04', new Set(['succy_talk_05'])), 'succy_talk_06');
  assert.equal(D.idAfter('smith', new Set()), 'smith_01');
  assert.equal(D.baseOf('succy_talk_01'), 'succy_talk');
});

test('the game\'s lines come back as chapters: a conversation, then what waits for it', () => {
  const m = D.unflatten(STORY, TEXT, keys);
  assert.deepEqual(m.chapters.map((c) => [c.id, c.lines.map((l) => l.id)]), [
    ['imp_talk', ['imp_talk_01', 'imp_talk_02', 'imp_talk_03']],
    ['imp_chest', ['imp_chest_01', 'smith_reply_01']],
    ['narrator', ['narrator_01', 'smith_01']]
  ]);
  const [talk, chest, narr] = m.chapters;
  assert.deepEqual(chest.events, ['chest_built']);
  assert.deepEqual(chest.reads, [talk.key]);
  assert.deepEqual(chest.characters, ['imp', 'smith']);
  assert.deepEqual(narr.reads, [chest.key]);
  assert.deepEqual(talk.next, []);
  assert.equal(chest.lines[1].speaker, 'smith');
  assert.equal(chest.lines[1].text, 'Words of smith_reply_01.');
  assert.deepEqual(m.unknown, []);
});

test('a book flattened is the game\'s story again, line for line', () => {
  const m = D.unflatten(STORY, TEXT, keys);
  const { story, text, assigned } = D.flatten(m);
  assert.deepEqual(story, STORY);
  assert.deepEqual(text, TEXT);
  assert.deepEqual(assigned, []);
});

test('a line something else waits for ends its chapter, so nothing is lost', () => {
  const s = structuredClone(STORY);
  // something needs imp_talk_02 itself read, not the whole conversation
  s.dialogues.push({ id: 'aside_01', character: 'imp', requires: { events: [], dialogues: ['imp_talk_02'] }, next: [] });
  const m = D.unflatten(s, { ...TEXT, aside_01: 'Aside.' }, keys);
  assert.deepEqual(m.chapters[0].lines.map((l) => l.id), ['imp_talk_01', 'imp_talk_02']);
  assert.deepEqual(D.flatten(m).story.dialogues.map((d) => d.id).sort(), s.dialogues.map((d) => d.id).sort());
  assert.deepEqual(D.flatten(m).story.dialogues.find((d) => d.id === 'aside_01').requires.dialogues, ['imp_talk_02']);
});

test('a branch: the last line leads to each next dialogue\'s first line', () => {
  const m = {
    characters: [{ id: 'smith', name: 'The Smith' }],
    events: [],
    chapters: [
      { key: 'a', id: 'greet', characters: ['smith', 'imp'], events: [], reads: [], next: ['b', 'c'], lines: [{ id: '', speaker: 'imp', text: 'Hello.' }, { id: '', speaker: 'smith', text: 'Hi.' }] },
      { key: 'b', id: 'kind', characters: ['imp'], events: [], reads: ['a'], next: [], lines: [{ id: '', speaker: 'imp', text: 'Nice.' }] },
      { key: 'c', id: 'rude', characters: ['imp'], events: [], reads: ['a'], next: [], lines: [{ id: '', speaker: 'imp', text: 'Rude.' }, { id: '', speaker: 'imp', text: '' }] }
    ]
  };
  const { story, assigned } = D.flatten(m);
  assert.deepEqual(story.dialogues.map((d) => [d.id, d.requires.dialogues, d.next]), [
    ['greet_01', [], ['greet_02']],
    ['greet_02', ['greet_01'], ['kind_01', 'rude_01']],
    ['kind_01', ['greet_02'], []],
    ['rude_01', ['greet_02'], []]
  ]);
  // the empty paragraph is no line, and gets no id
  assert.deepEqual(assigned.map((a) => [a.key, a.index, a.id]), [['a', 0, 'greet_01'], ['a', 1, 'greet_02'], ['b', 0, 'kind_01'], ['c', 0, 'rude_01']]);
});

test('a paragraph split in two: the first half keeps the id, the second gets a new one', () => {
  const m = { characters: [], events: [], chapters: [{ key: 'a', id: 'x', characters: ['imp'], events: [], reads: [], next: [], lines: [{ id: 'x_01', speaker: 'imp', text: 'One.' }, { id: 'x_01', speaker: 'imp', text: 'Two.' }] }] };
  const { story, assigned } = D.flatten(m);
  assert.deepEqual(story.dialogues.map((d) => d.id), ['x_01', 'x_02']);
  assert.deepEqual(assigned, [{ key: 'a', index: 1, id: 'x_02' }]);
});

test('problems: ids, speakers, unknown events and dialogues, loops', () => {
  const m = {
    characters: [{ id: 'smith', name: 'The Smith' }],
    events: [{ id: 'door_open', description: '' }],
    chapters: [
      { key: 'a', id: 'Bad Id', characters: ['smith'], events: ['door_open', 'nope'], reads: ['a'], next: ['b'], lines: [{ id: '', speaker: '', text: 'Who?' }, { id: '', speaker: 'imp', text: 'Me.' }] },
      { key: 'b', id: 'same', characters: ['imp'], events: [], reads: ['zzz'], next: ['c'], lines: [{ id: '', speaker: 'smith', text: 'Not mine.' }] },
      { key: 'c', id: 'same', characters: [], events: [], reads: [], next: ['b'], lines: [] }
    ]
  };
  const texts = D.problems(m, ['imp'], (k) => 'Dialogue ' + k).map((p) => p.text);
  assert.deepEqual(texts, [
    'Dialogue a: the dialogue id "Bad Id" must be lower case letters, digits and underscores.',
    'Dialogue a, line 1: nobody says it.',
    'Dialogue a, line 2: imp isn\'t one of this dialogue\'s characters.',
    'Dialogue a waits for the unknown event "nope".',
    'Dialogue a needs itself read first.',
    'Dialogue b, line 1: smith isn\'t one of this dialogue\'s characters.',
    'Dialogue b needs a dialogue that isn\'t in the book.',
    'Dialogue c and Dialogue b share the dialogue id "same".',
    'Dialogue c has no lines yet.',
    'The conversation loops: Dialogue b → Dialogue c → Dialogue b.'
  ]);
  assert.deepEqual(D.problems(D.unflatten(STORY, TEXT, keys), ['imp']), []);
});

// ---- the game's files ----

// story.json as the Writer writes it (its own comment at the top)
const STORY_JSON = D.storyToJson(STORY);

test('story.json and the text file are written the way the Writer writes them', () => {
  assert.ok(STORY_JSON.startsWith('{\n  // The story: who speaks besides the minions'));
  assert.ok(STORY_JSON.includes('\n  "characters": [\n    { "id": "smith", "name": "The Smith" },\n'));
  assert.ok(STORY_JSON.includes('\n    { "id": "imp_talk_02", "character": "imp", "requires": { "events": [], "dialogues": ["imp_talk_01"] }, "next": ["imp_talk_03"] },\n'));
  assert.ok(STORY_JSON.endsWith('"next": [] }\n  ]\n}\n'));
  assert.ok(D.storyToJson({ characters: [], events: [], dialogues: [] }).endsWith('kept.\n  "characters": [],\n\n  "events": [],\n\n  "dialogues": []\n}\n'));
  assert.equal(D.textToJson(STORY, { imp_talk_02: 'Two’s "quoted".', imp_talk_01: 'One.', stray: 'x' }),
    '{\n  "imp_talk_01": "One.",\n  "imp_talk_02": "Two’s \\"quoted\\".",\n  "stray": "x"\n}\n');
  assert.equal(D.textToJson(STORY, {}), '{\n}\n');
});

test('they read back as they were, comments, trailing commas and all', () => {
  const r = D.readStory(STORY_JSON, D.textToJson(STORY, TEXT));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.story, STORY);
  assert.deepEqual(r.text, TEXT);
  assert.equal(D.storyToJson(r.story), STORY_JSON);
  assert.deepEqual(D.parseJsonc('{ /* a */ "a": "// not a comment", // one\n "b": [1, 2,], }'), { a: '// not a comment', b: [1, 2] });
  const bad = D.readStory('{ "dialogues": [ }', null);
  assert.equal(bad.errors.length, 1);
  assert.deepEqual(bad.story.dialogues, []);
});

test('the game\'s speakers: minions from the quarters and the warhost, recruits from HR', () => {
  const s = D.gameSpeakers({
    'quarters.json': '{ // who lives here\n "minions": [ { "id": "imp", "name": "Imp", "kind": "x" }, ] }',
    'commissions.json': '{ "minions": [ { "id": "imp", "name": "Imp again" }, { "id": "ogre" } ] }',
    'hr.json': '{ "candidates": [ { "id": "gob", "name": "Gob" } ] }'
  });
  assert.deepEqual(s, [{ id: 'imp', name: 'Imp', source: 'minion' }, { id: 'ogre', name: 'ogre', source: 'minion' }, { id: 'gob', name: 'Gob', source: 'recruit' }]);
  assert.deepEqual(D.gameSpeakers({ 'quarters.json': null, 'hr.json': 'not json' }), []);
});

test('merge: each side\'s changes are kept; where both changed one, the book\'s', () => {
  const base = { story: structuredClone(STORY), text: { ...TEXT } };
  const ours = structuredClone(base);
  const theirs = structuredClone(base);
  // the book rewrites a line and adds a dialogue
  ours.text.imp_talk_01 = 'Ours.';
  ours.story.dialogues.push({ id: 'new_01', character: 'imp', requires: { events: [], dialogues: [] }, next: [] });
  ours.text.new_01 = 'New.';
  // the game gains an event and a dialogue, loses one, and rewrites another line
  theirs.story.events.push({ id: 'door_open', description: 'The door is open.' });
  theirs.story.dialogues = theirs.story.dialogues.filter((d) => d.id !== 'smith_01');
  theirs.story.dialogues.push({ id: 'theirs_01', character: 'smith', requires: { events: ['door_open'], dialogues: [] }, next: [] });
  theirs.text.theirs_01 = 'Theirs.';
  delete theirs.text.smith_01;
  theirs.text.imp_talk_02 = 'Their edit.';
  // and both rewrite the same line
  ours.text.imp_talk_03 = 'Mine.';
  theirs.text.imp_talk_03 = 'Yours.';
  const m = D.merge(base, ours, theirs);
  assert.deepEqual(m.story.events.map((e) => e.id), ['chest_built', 'door_open']);
  assert.deepEqual(m.story.dialogues.map((d) => d.id), ['imp_talk_01', 'imp_talk_02', 'imp_talk_03', 'imp_chest_01', 'smith_reply_01', 'narrator_01', 'theirs_01', 'new_01']);
  assert.equal(m.text.imp_talk_01, 'Ours.');
  assert.equal(m.text.imp_talk_02, 'Their edit.');
  assert.equal(m.text.imp_talk_03, 'Mine.');
  assert.equal(m.text.theirs_01, 'Theirs.');
  assert.ok(!('smith_01' in m.text));
  assert.deepEqual(m.clashes, [{ kind: 'text', id: 'imp_talk_03' }]);
  // nothing changed anywhere: the story as it was
  assert.deepEqual(D.merge(base, base, base), { ...base, clashes: [] });
});

test('the story tree: each dialogue below what leads to it, a branch side by side', () => {
  const L = D.treeLayout([
    { key: 'a', next: ['b', 'c'], reads: [] },
    { key: 'b', next: ['d'], reads: ['a'] },
    { key: 'c', next: [], reads: ['a'] },
    { key: 'd', next: [], reads: [] },
    { key: 'e', next: [], reads: ['d'] }, // waits for d, isn't led to
    { key: 'f', next: ['g'], reads: [] },
    { key: 'g', next: ['f'], reads: [] } // a loop doesn't hang it
  ]);
  const at = (k) => [L.level.get(k), L.slot.get(k)];
  assert.deepEqual([at('a'), at('b'), at('c'), at('d'), at('e')], [[0, 0], [1, 0], [1, 1], [2, 0], [3, 0]]);
  assert.deepEqual(L.edges.filter((e) => e.kind === 'read').map((e) => e.from + e.to), ['de']);
  assert.ok(L.levels <= 7);
  assert.ok(L.slots >= 2);
});

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

'use strict';

// Dialogue books: NEO's chapters as a game's dialogues (the Blackest Smith
// Writer's story format, data/story.json and data/text/<language>.json).
// Plain JavaScript with no window, so it runs in Node for the tests and in
// the page as window.NeoDialogue.
//
// In the book, a chapter is one dialogue: the characters in it, what it
// waits for (story events that have happened, other dialogues that have
// been read) and the dialogues that come next. Each of its paragraphs is a
// line, said by one of its characters.
//
// In the game, the unit is the line: one id, one speaker, one sentence of
// speech, its preconditions and the lines that follow it. flatten() turns a
// book into the game's lines and unflatten() puts the game's lines back
// into chapters, so a story round-trips:
//   - the lines of a chapter follow one another ("next"), and each needs
//     the one before it read (as the Writer's Create linked does);
//   - the first line carries the chapter's own preconditions, with each
//     dialogue it needs standing for that dialogue's last line;
//   - the last line leads to the first line of each dialogue that comes next.
//
// The model the functions take (book.json keeps all but the lines, which
// are the chapter's paragraphs):
//   { characters: [{ id, name }], events: [{ id, description }],
//     chapters: [{ key, id, characters: [id], events: [id], reads: [key],
//                  next: [key], lines: [{ id, speaker, text }] }] }
// A chapter is named by its key (NEO's chapter id) inside the book, and by
// its dialogue id in the game. A line's id may be empty until it is first
// written out: flatten() gives it the next free <dialogue id>_NN.

(function (root) {
  const ID = /^[a-z0-9_]+$/;

  // what a typed id becomes: lower case letters, digits and underscores
  function slug(text) {
    return String(text || '').trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  // the first of prefix_01, prefix_02… not in used (a Set)
  function nextId(prefix, used) {
    const p = slug(prefix) || 'line';
    for (let n = 1; ; n++) {
      const id = p + '_' + String(n).padStart(2, '0');
      if (!used.has(id)) return id;
    }
  }

  // the id after another: succy_talk_04 → succy_talk_05 (or the next free
  // one); an id with no number after it starts at _01
  function idAfter(id, used) {
    const m = /^(.*)_(\d+)$/.exec(id || '');
    if (!m) return nextId(id, used);
    const width = Math.max(2, m[2].length);
    for (let n = Number(m[2]) + 1; ; n++) {
      const next = m[1] + '_' + String(n).padStart(width, '0');
      if (!used.has(next)) return next;
    }
  }

  // a dialogue's name from its first line: succy_talk_01 → succy_talk
  const baseOf = (lineId) => String(lineId || '').replace(/_\d+$/, '') || lineId;

  const uniq = (list) => [...new Set((list || []).filter(Boolean))];

  // A paragraph is a line when it has words, or when it's a line of the
  // game's already (its id) that has no words in this language yet: an
  // untranslated line stays in the story, listed as a problem, rather than
  // dropping out of it. A blank paragraph with no id is nothing.
  const isLine = (l) => !!String(l.text || '').trim() || !!(l.id && ID.test(l.id));

  // The chapters' lines with ids: the line's own, unless it's empty, badly
  // formed or already taken (a paragraph split in two carries its id into
  // both halves; the first keeps it). Returns the lines per chapter key
  // and the ids handed out, for the book to keep.
  function lineIds(model) {
    const used = new Set();
    for (const ch of model.chapters) for (const l of ch.lines) if (l.id && ID.test(l.id)) used.add(l.id);
    const seen = new Set();
    const lines = new Map();
    const assigned = [];
    for (const ch of model.chapters) {
      const out = [];
      ch.lines.forEach((l, index) => {
        if (!isLine(l)) return;
        let id = l.id && ID.test(l.id) && !seen.has(l.id) ? l.id : '';
        if (!id) {
          id = nextId(ch.id || 'line', used);
          used.add(id);
          assigned.push({ key: ch.key, index, id });
        }
        seen.add(id);
        out.push({ id, speaker: l.speaker || '', text: String(l.text).trim() });
      });
      lines.set(ch.key, out);
    }
    return { lines, assigned };
  }

  // The book as the game's story: { characters, events, dialogues } as
  // story.json holds them, and the text of each line by its id.
  function flatten(model) {
    const { lines, assigned } = lineIds(model);
    const first = (key) => (lines.get(key) || [])[0];
    const last = (key) => (lines.get(key) || []).at(-1);
    const dialogues = [];
    const text = {};
    for (const ch of model.chapters) {
      const ls = lines.get(ch.key);
      ls.forEach((l, i) => {
        const isFirst = i === 0;
        const isLast = i === ls.length - 1;
        dialogues.push({
          id: l.id,
          character: l.speaker,
          requires: {
            events: isFirst ? uniq(ch.events) : [],
            dialogues: isFirst ? uniq((ch.reads || []).map((k) => last(k) && last(k).id)) : [ls[i - 1].id]
          },
          next: isLast ? uniq((ch.next || []).map((k) => first(k) && first(k).id)) : [ls[i + 1].id]
        });
        text[l.id] = l.text;
      });
    }
    return {
      story: {
        characters: (model.characters || []).map((c) => ({ id: c.id, name: c.name || c.id })),
        events: (model.events || []).map((e) => ({ id: e.id, description: e.description || '' })),
        dialogues
      },
      text,
      assigned
    };
  }

  // The game's story as chapters. A line carries on the dialogue of the line
  // before it when that line leads only to it, nothing else leads to it, it
  // needs only that line read and no event, and nothing else waits for that
  // line in particular. makeKey() names each new chapter.
  function unflatten(story, text, makeKey) {
    const ds = (story && story.dialogues) || [];
    const byId = new Map(ds.map((d) => [d.id, d]));
    const req = (d) => (d.requires && d.requires.dialogues) || [];
    const evs = (d) => (d.requires && d.requires.events) || [];
    const ledFrom = new Map();
    const neededBy = new Map();
    for (const d of ds) {
      for (const n of d.next || []) (ledFrom.get(n) || ledFrom.set(n, []).get(n)).push(d.id);
      for (const r of req(d)) (neededBy.get(r) || neededBy.set(r, []).get(r)).push(d.id);
    }
    const continues = (d) => {
      const from = ledFrom.get(d.id) || [];
      if (from.length !== 1) return false;
      const prev = byId.get(from[0]);
      if (!prev || prev === d || (prev.next || []).length !== 1) return false;
      if (evs(d).length || req(d).length !== 1 || req(d)[0] !== prev.id) return false;
      return (neededBy.get(prev.id) || []).every((id) => id === d.id);
    };
    const chapterOf = new Map();
    const chapters = [];
    const taken = new Set();
    for (const head of ds) {
      if (continues(head) || chapterOf.has(head.id)) continue;
      const lines = [];
      for (let d = head; d && !chapterOf.has(d.id); ) {
        lines.push(d);
        const n = (d.next || []).length === 1 ? byId.get(d.next[0]) : null;
        d = n && continues(n) ? n : null;
      }
      let id = baseOf(head.id);
      if (taken.has(id) || byId.has(id) && id !== head.id) id = head.id;
      taken.add(id);
      const ch = { key: makeKey(chapters.length), id, characters: [], events: [], reads: [], next: [], lines: [] };
      for (const d of lines) chapterOf.set(d.id, ch);
      ch.lines = lines.map((d) => ({ id: d.id, speaker: d.character || '', text: (text && text[d.id]) || '' }));
      ch.characters = uniq(lines.map((d) => d.character));
      ch.events = uniq(evs(head));
      ch._reads = req(head);
      ch._next = (lines.at(-1).next || []);
      chapters.push(ch);
    }
    // a loop of lines that each continue the one before has no head: each
    // of its lines left over starts a chapter of its own
    for (const d of ds) {
      if (chapterOf.has(d.id)) continue;
      const ch = { key: makeKey(chapters.length), id: d.id, characters: uniq([d.character]), events: uniq(evs(d)), reads: [], next: [], lines: [{ id: d.id, speaker: d.character || '', text: (text && text[d.id]) || '' }], _reads: req(d), _next: d.next || [] };
      chapterOf.set(d.id, ch);
      chapters.push(ch);
    }
    const unknown = [];
    const keyOf = (id) => {
      const ch = chapterOf.get(id);
      if (!ch) unknown.push(id);
      return ch && ch.key;
    };
    for (const ch of chapters) {
      ch.reads = uniq(ch._reads.map(keyOf));
      ch.next = uniq(ch._next.map(keyOf));
      delete ch._reads;
      delete ch._next;
    }
    return {
      characters: ((story && story.characters) || []).map((c) => ({ id: c.id, name: c.name || c.id })),
      events: ((story && story.events) || []).map((e) => ({ id: e.id, description: e.description || '' })),
      chapters,
      unknown: uniq(unknown)
    };
  }

  // Everything that would stop the game loading the story, in the writer's
  // terms. speakers: every id that may speak (the book's characters, and
  // the game's own, such as its minions). name(key) names a chapter.
  function problems(model, speakers, name) {
    const out = [];
    const nameOf = name || ((k) => k);
    const can = new Set([...(speakers || []), ...(model.characters || []).map((c) => c.id)]);
    const events = new Set((model.events || []).map((e) => e.id));
    const keys = new Set(model.chapters.map((c) => c.key));
    const dialogueIds = new Map();
    const checkId = (id, what) => {
      if (!ID.test(id || '')) out.push({ text: `${what} id "${id || ''}" must be lower case letters, digits and underscores.` });
    };
    for (const c of model.characters || []) checkId(c.id, 'Character');
    for (const e of model.events || []) checkId(e.id, 'Event');
    for (const ch of model.chapters) {
      const where = nameOf(ch.key);
      if (!ch.id) out.push({ key: ch.key, text: `${where} has no dialogue id.` });
      else if (!ID.test(ch.id)) out.push({ key: ch.key, text: `${where}: the dialogue id "${ch.id}" must be lower case letters, digits and underscores.` });
      else if (dialogueIds.has(ch.id)) out.push({ key: ch.key, text: `${where} and ${nameOf(dialogueIds.get(ch.id))} share the dialogue id "${ch.id}".` });
      else dialogueIds.set(ch.id, ch.key);
      const lines = ch.lines.filter(isLine);
      if (!lines.length) out.push({ key: ch.key, text: `${where} has no lines yet.` });
      lines.forEach((l, i) => {
        const n = i + 1;
        if (!String(l.text || '').trim()) out.push({ key: ch.key, line: i, text: `${where}, line ${n} (${l.id}) has no words in this language.` });
        if (!l.speaker) out.push({ key: ch.key, line: i, text: `${where}, line ${n}: nobody says it.` });
        else if (!can.has(l.speaker)) out.push({ key: ch.key, line: i, text: `${where}, line ${n}: unknown character "${l.speaker}".` });
        else if (!(ch.characters || []).includes(l.speaker)) out.push({ key: ch.key, line: i, text: `${where}, line ${n}: ${l.speaker} isn't one of this dialogue's characters.` });
      });
      for (const e of ch.events || []) if (!events.has(e)) out.push({ key: ch.key, text: `${where} waits for the unknown event "${e}".` });
      for (const k of ch.reads || []) {
        if (k === ch.key) out.push({ key: ch.key, text: `${where} needs itself read first.` });
        else if (!keys.has(k)) out.push({ key: ch.key, text: `${where} needs a dialogue that isn't in the book.` });
      }
      for (const k of ch.next || []) if (!keys.has(k)) out.push({ key: ch.key, text: `${where} leads to a dialogue that isn't in the book.` });
    }
    // line ids the writer (or the game) gave twice
    const lineSeen = new Map();
    for (const ch of model.chapters) {
      for (const l of ch.lines) {
        if (!l.id || !isLine(l)) continue;
        if (lineSeen.has(l.id) && lineSeen.get(l.id) !== ch.key) out.push({ key: ch.key, text: `${nameOf(ch.key)} and ${nameOf(lineSeen.get(l.id))} both have a line "${l.id}".` });
        else lineSeen.set(l.id, ch.key);
      }
    }
    const loop = findLoop(model.chapters);
    if (loop) out.push({ key: loop[0], text: `The conversation loops: ${loop.map(nameOf).join(' → ')}.` });
    return out;
  }

  // a run of "leads to" that comes back on itself, as chapter keys, or null
  function findLoop(chapters) {
    const byKey = new Map(chapters.map((c) => [c.key, c]));
    const state = new Map();
    const path = [];
    const visit = (k) => {
      if (state.get(k) === 1) return [...path.slice(path.indexOf(k)), k];
      if (state.get(k) === 2 || !byKey.has(k)) return null;
      state.set(k, 1);
      path.push(k);
      for (const n of byKey.get(k).next || []) {
        const loop = visit(n);
        if (loop) return loop;
      }
      path.pop();
      state.set(k, 2);
      return null;
    };
    for (const c of chapters) {
      const loop = visit(c.key);
      if (loop) return loop;
    }
    return null;
  }


  // ---- the game's files ----

  // JSON as the game reads it: // and /* */ comments and trailing commas allowed
  function parseJsonc(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
      const ch = src[i];
      if (ch === '"') {
        let j = i + 1;
        while (j < n && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
        out += src.slice(i, j + 1);
        i = j + 1;
      } else if (ch === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i++;
      } else if (ch === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        i = end < 0 ? n : end + 2;
      } else {
        out += ch;
        i++;
      }
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  }

  // story.json and one language's text file, read the way the game reads
  // them; problems go in errors and what can be read is kept
  function readStory(storyText, textText, textName) {
    const errors = [];
    let raw = {};
    if (storyText) {
      try { raw = parseJsonc(storyText) || {}; } catch (err) { errors.push('story.json: ' + err.message); }
    }
    let text = {};
    if (textText) {
      try { text = parseJsonc(textText) || {}; } catch (err) { errors.push((textName || 'text') + ': ' + err.message); }
    }
    const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
    const story = {
      characters: (raw.characters || []).map((c) => ({ id: c.id || '', name: c.name || c.id || '' })),
      events: (raw.events || []).map((e) => ({ id: e.id || '', description: e.description || '' })),
      dialogues: (raw.dialogues || []).map((d) => ({
        id: d.id || '',
        character: d.character || '',
        requires: { events: strs(d.requires && d.requires.events), dialogues: strs(d.requires && d.requires.dialogues) },
        next: strs(d.next)
      }))
    };
    return { story, text, errors };
  }

  // Who the game has to speak besides the story's own characters, as the
  // Writer finds them: the minions in quarters.json and commissions.json
  // (the warhost), the recruits in hr.json. files: { name: text or null }
  function gameSpeakers(files) {
    const out = [];
    const add = (file, list, source) => {
      if (!files || !files[file]) return;
      let doc;
      try { doc = parseJsonc(files[file]); } catch { return; }
      for (const item of (doc && Array.isArray(doc[list]) ? doc[list] : [])) {
        if (!item || typeof item.id !== 'string' || out.some((s) => s.id === item.id)) continue;
        out.push({ id: item.id, name: typeof item.name === 'string' ? item.name : item.id, source });
      }
    };
    add('quarters.json', 'minions', 'minion');
    add('commissions.json', 'minions', 'minion');
    add('hr.json', 'candidates', 'recruit');
    return out;
  }

  const STORY_HEADER = '{\n' +
    '  // The story: who speaks besides the minions, the story events (state variables) dialogues can wait for,\n' +
    '  // and the dialogues. Each dialogue is one line, spoken by "character" (a minion\'s id from quarters.json,\n' +
    '  // commissions.json or hr.json, or a character below) once every event in "requires.events" has happened\n' +
    '  // and every dialogue in "requires.dialogues" has been read. "next" are the lines that follow it in the\n' +
    '  // same conversation. The words are in text/<language>.json under the dialogue\'s id. Edited with the\n' +
    '  // Writer (tools/Writer), which rewrites this file: comments other than these are not kept.\n';
  const J = (v) => JSON.stringify(v);
  const L = (ids) => '[' + ids.map(J).join(', ') + ']';
  function list(name, items, line) {
    if (!items.length) return `  "${name}": []`;
    return `  "${name}": [\n` + items.map((x) => '    ' + line(x)).join(',\n') + '\n  ]';
  }
  // data/story.json as the Writer saves it: one entry per line, so changes diff cleanly
  function storyToJson(story) {
    return STORY_HEADER +
      list('characters', story.characters, (c) => `{ "id": ${J(c.id)}, "name": ${J(c.name)} }`) + ',\n\n' +
      list('events', story.events, (e) => `{ "id": ${J(e.id)}, "description": ${J(e.description)} }`) + ',\n\n' +
      list('dialogues', story.dialogues, (d) => `{ "id": ${J(d.id)}, "character": ${J(d.character)}, ` +
        `"requires": { "events": ${L(d.requires.events)}, "dialogues": ${L(d.requires.dialogues)} }, "next": ${L(d.next)} }`) +
      '\n}\n';
  }
  // a language's text file: one line's words per line, in the story's order,
  // then any text for lines the story doesn't have
  function textToJson(story, text) {
    const known = new Set(story.dialogues.map((d) => d.id));
    const ids = [...story.dialogues.map((d) => d.id).filter((id) => id in text), ...Object.keys(text).filter((id) => !known.has(id)).sort()];
    if (!ids.length) return '{\n}\n';
    return '{\n' + ids.map((id) => `  ${J(id)}: ${J(text[id])}`).join(',\n') + '\n}\n';
  }

  // ---- three sides of the story: what the book last read or wrote (base),
  // the book now (ours) and the game now (theirs) ----
  // Every dialogue, character, event and line of text either side changed
  // since the base is taken from that side; where both changed the same one
  // differently, the book's is kept and the clash listed.
  function merge(base, ours, theirs) {
    const clashes = [];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const pick = (kind, id, b, o, th) => {
      if (same(o, th)) return o;
      if (same(b, o)) return th; // only the game changed it (or removed it)
      if (same(b, th)) return o; // only the book did
      clashes.push({ kind, id });
      return o === undefined ? th : o;
    };
    const byId = (list) => new Map((list || []).map((x) => [x.id, x]));
    const mergeList = (kind, b, o, th) => {
      const B = byId(b), O = byId(o), T = byId(th);
      const order = uniq([...(th || []).map((x) => x.id), ...(o || []).map((x) => x.id)]);
      return order.map((id) => pick(kind, id, B.get(id), O.get(id), T.get(id))).filter(Boolean);
    };
    const story = {
      characters: mergeList('character', base.story.characters, ours.story.characters, theirs.story.characters),
      events: mergeList('event', base.story.events, ours.story.events, theirs.story.events),
      dialogues: mergeList('dialogue', base.story.dialogues, ours.story.dialogues, theirs.story.dialogues)
    };
    const text = {};
    for (const id of uniq([...Object.keys(theirs.text || {}), ...Object.keys(ours.text || {})])) {
      const v = pick('text', id, (base.text || {})[id], (ours.text || {})[id], (theirs.text || {})[id]);
      if (v !== undefined) text[id] = v;
    }
    return { story, text, clashes };
  }

  // ---- the story tree ----
  // Where each dialogue sits in the tree, as the Writer draws it: a
  // dialogue's level is the longest path to it from one that starts a
  // conversation (a solid "next", or a dashed "read first" where it isn't
  // already a next); across a level each sits under its parents. chapters:
  // [{ key, next, reads }]. Returns { level: Map, slot: Map, edges, levels, slots }.
  function treeLayout(chapters) {
    const keys = new Set(chapters.map((c) => c.key));
    const edges = [];
    for (const c of chapters) for (const n of c.next || []) if (keys.has(n) && n !== c.key) edges.push({ from: c.key, to: n, kind: 'next' });
    for (const c of chapters) {
      for (const r of c.reads || []) {
        if (keys.has(r) && r !== c.key && !edges.some((e) => e.from === r && e.to === c.key)) edges.push({ from: r, to: c.key, kind: 'read' });
      }
    }
    const level = new Map(chapters.map((c) => [c.key, 0]));
    // loops stop growing after one pass per dialogue
    for (let pass = 0; pass < chapters.length; pass++) {
      let moved = false;
      for (const e of edges) {
        const want = level.get(e.from) + 1;
        if (level.get(e.to) < want && want < chapters.length) { level.set(e.to, want); moved = true; }
      }
      if (!moved) break;
    }
    const byLevel = [];
    for (const c of chapters) (byLevel[level.get(c.key)] = byLevel[level.get(c.key)] || []).push(c.key);
    const slot = new Map();
    byLevel.forEach((ids, lv) => {
      const parentSlot = (id) => {
        const s = edges.filter((e) => e.to === id && level.get(e.from) < lv && slot.has(e.from)).map((e) => slot.get(e.from));
        return s.length ? s.reduce((a, b) => a + b, 0) / s.length : Infinity;
      };
      const order = (ids || []).map((id, i) => ({ id, k: parentSlot(id), i })).sort((a, b) => a.k - b.k || a.i - b.i);
      let next = 0;
      for (const { id, k } of order) {
        const sl = Number.isFinite(k) ? Math.max(next, Math.round(k)) : next;
        slot.set(id, sl);
        next = sl + 1;
      }
    });
    return { level, slot, edges, levels: byLevel.length, slots: Math.max(0, ...[...slot.values()].map((v) => v + 1)) };
  }

  const api = { ID, isLine, slug, nextId, idAfter, baseOf, flatten, unflatten, problems, findLoop, parseJsonc, readStory, gameSpeakers, storyToJson, textToJson, merge, treeLayout };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoDialogue = api;
})(typeof window !== 'undefined' ? window : globalThis);

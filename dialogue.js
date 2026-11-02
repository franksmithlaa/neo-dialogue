/* Neo Dialogue — book characters and paragraph speaker gutter.
 * Controls live outside contenteditable; only data-speaker-id persists in HTML.
 */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const palette = ['#D87B9F','#69A6D8','#8A9A88','#D6A456','#A18DD5','#D27D65'];
  let showingBook = null;
  let paintPending = false;
  const gutter = document.createElement('div');
  gutter.id = 'speaker-gutter';
  gutter.setAttribute('aria-label', 'Paragraph speakers');
  $('#paper-scroll').appendChild(gutter);

  const characters = () => book && Array.isArray(book.characters) ? book.characters : [];
  const ensure = () => { if (book && !Array.isArray(book.characters)) book.characters = []; };
  const id = () => 'character-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  function changed() {
    scheduleMetaSave();
    renderCharacters();
    requestPaint();
  }
  function renderCharacters() {
    const panel = $('#character-manager');
    if (!panel || !book) return;
    ensure();
    panel.replaceChildren();
    const intro = document.createElement('p');
    intro.className = 'character-intro';
    intro.textContent = 'Assign a colour to each speaker. Character names and colours are shared by Manuscript and Notes.';
    panel.append(intro);
    const list = document.createElement('div');
    list.className = 'character-list';
    for (const character of characters()) {
      const row = document.createElement('div');
      row.className = 'character-row';
      const colour = document.createElement('input');
      colour.type = 'color';
      colour.value = /^#[0-9a-f]{6}$/i.test(character.color) ? character.color : palette[0];
      colour.setAttribute('aria-label', 'Colour for ' + character.name);
      colour.addEventListener('input', () => {
        character.color = colour.value;
        scheduleMetaSave();
        requestPaint();
      });
      const name = document.createElement('input');
      name.type = 'text';
      name.value = character.name;
      name.maxLength = 100;
      name.setAttribute('aria-label', 'Character name');
      name.addEventListener('change', () => {
        const next = name.value.trim();
        if (!next) { name.value = character.name; return; }
        character.name = next;
        changed();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + character.name);
      remove.addEventListener('click', () => {
        // Keep the former reference on paragraphs: they become unassigned in
        // the UI without accidentally attributing them to another character.
        book.characters = characters().filter((c) => c.id !== character.id);
        changed();
      });
      row.append(colour,name,remove);
      list.append(row);
    }
    panel.append(list);
    const add = document.createElement('form');
    add.className = 'character-add';
    const name = document.createElement('input');
    name.type = 'text';
    name.placeholder = 'New character';
    name.maxLength = 100;
    name.setAttribute('aria-label', 'New character name');
    const button = document.createElement('button');
    button.type = 'submit';
    button.textContent = 'Add character';
    add.append(name,button);
    add.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = name.value.trim();
      if (!value) return;
      book.characters.push({ id: id(), name: value, color: palette[book.characters.length % palette.length] });
      changed();
      const field = $('#character-manager .character-add input');
      if (field) field.focus();
    });
    panel.append(add);
  }

  function activeBodies() {
    if (!book || $('#editor-view').hidden) return [];
    if (currentTab === 'manuscript') return [...document.querySelectorAll('.chapter-body[contenteditable="true"]')].filter(el => !el.hidden);
    if (currentTab === 'notes' && !$('#aux-editor').hidden) return [$('#aux-editor')];
    return [];
  }
  function visibleParagraphs() {
    const scroll = $('#paper-scroll').getBoundingClientRect();
    const out = [];
    for (const body of activeBodies()) {
      for (const p of body.children) {
        if (p.tagName !== 'P' || p.classList.contains('ghost') || p.classList.contains('scene-break')) continue;
        const r = p.getBoundingClientRect();
        if (r.bottom >= scroll.top && r.top <= scroll.bottom) out.push({p,r});
      }
    }
    return out;
  }
  function paint() {
    paintPending = false;
    gutter.replaceChildren();
    if (!book || !['notes','manuscript'].includes(currentTab)) return;
    const scroll = $('#paper-scroll');
    const rect = scroll.getBoundingClientRect();
    const cast = characters();
    for (const {p,r} of visibleParagraphs()) {
      const selector = document.createElement('select');
      selector.className = 'speaker-selector';
      selector.setAttribute('aria-label', 'Speaker for paragraph: ' + p.textContent.slice(0,65));
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '—';
      selector.append(none);
      for (const character of cast) {
        const opt = document.createElement('option');
        opt.value = character.id;
        opt.textContent = character.name;
        selector.append(opt);
      }
      const assigned = p.dataset.speakerId || '';
      selector.value = cast.some(c => c.id === assigned) ? assigned : '';
      const selected = cast.find(c => c.id === selector.value);
      selector.style.setProperty('--speaker-color', selected ? selected.color : 'transparent');
      selector.style.top = (r.top - rect.top + scroll.scrollTop) + 'px';
      selector.style.left = Math.max(3,r.left - rect.left - 115 + scroll.scrollLeft) + 'px';
      selector.addEventListener('change', () => {
        if (selector.value) p.dataset.speakerId = selector.value;
        else delete p.dataset.speakerId;
        if (currentTab === 'notes') {
          auxDirty = true;
          scheduleAuxSave();
        } else {
          const body = p.closest('.chapter-body');
          const chapter = body && body.closest('.chapter');
          if (chapter) syncChapter(body,chapter.dataset.id);
        }
        requestPaint();
      });
      gutter.append(selector);
    }
  }
  function requestPaint() {
    if (paintPending) return;
    paintPending = true;
    requestAnimationFrame(paint);
  }
  function update() {
    if (!book || $('#editor-view').hidden) { gutter.replaceChildren(); showingBook = null; return; }
    if (showingBook !== book.id) {
      showingBook = book.id;
      renderCharacters();
    }
    requestPaint();
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.tab')) setTimeout(update,0);
  },true);
  $('#paper-scroll').addEventListener('scroll',requestPaint,{passive:true});
  window.addEventListener('resize',requestPaint);
  document.addEventListener('input', (e) => {
    if (e.target.closest && e.target.closest('.chapter-body, #aux-editor')) requestPaint();
  });
  const observer = new MutationObserver(() => update());
  observer.observe($('#chapters'), {subtree:true,childList:true});
  observer.observe($('#aux-editor'), {subtree:true,childList:true});
  observer.observe($('#editor-view'), {attributes:true,attributeFilter:['hidden']});
  // Switching notes pages is asynchronous and doesn't emit a tab click.
  const notesObserver = new MutationObserver(requestPaint);
  notesObserver.observe($('#aux-editor'), {attributes:true,attributeFilter:['data-kind','hidden']});
  window.neoDialogue = {renderCharacters,update};
  update();
})();

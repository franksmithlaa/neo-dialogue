/* Neo Dialogue — book characters and paragraph speaker gutter.
 * Controls live outside contenteditable; only data-speaker-id persists in HTML.
 */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const palette = ['#D87B9F','#69A6D8','#8A9A88','#D6A456','#A18DD5','#D27D65'];
  let showingBook = null;
  let paintPending = false;
  const descriptionsOpen = new Set();
  let activeMenu = null;
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
      const entry = document.createElement('div');
      entry.className = 'character-entry';
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
      const details = document.createElement('button');
      details.type = 'button';
      details.className = 'character-details-toggle';
      const descriptionId = 'character-description-' + character.id;
      const expanded = descriptionsOpen.has(character.id);
      details.setAttribute('aria-controls', descriptionId);
      details.setAttribute('aria-expanded', String(expanded));
      details.textContent = expanded ? 'Hide' : 'Description';
      const description = document.createElement('textarea');
      description.id = descriptionId;
      description.className = 'character-description';
      description.rows = 4;
      description.placeholder = 'Character description (optional)';
      description.setAttribute('aria-label', 'Description for ' + character.name);
      description.value = character.description || '';
      description.hidden = !expanded;
      description.addEventListener('input', () => {
        character.description = description.value;
        scheduleMetaSave();
      });
      details.addEventListener('click', () => {
        const open = !descriptionsOpen.has(character.id);
        if (open) descriptionsOpen.add(character.id);
        else descriptionsOpen.delete(character.id);
        description.hidden = !open;
        details.setAttribute('aria-expanded', String(open));
        details.textContent = open ? 'Hide' : 'Description';
        if (open) description.focus();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + character.name);
      remove.addEventListener('click', () => {
        if (!window.confirm('Remove character "' + character.name + '"? Existing speaker assignments will appear unassigned.')) return;
        descriptionsOpen.delete(character.id);
        // Keep the former reference on paragraphs: they become unassigned in
        // the UI without accidentally attributing them to another character.
        book.characters = characters().filter((c) => c.id !== character.id);
        changed();
      });
      row.append(colour,name,details,remove);
      entry.append(row,description);
      list.append(entry);
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
    const viewport = $('#paper-scroll').getBoundingClientRect();
    const out = [];
    for (const body of activeBodies()) {
      // Notes may start as bare text or DIVs instead of paragraphs.
      const blocks = [...body.children].filter(el => el.matches('p, div') && !el.classList.contains('ghost') && !el.classList.contains('scene-break'));
      if (!blocks.length && body === $('#aux-editor')) {
        // The empty notes page must still offer a first-line speaker control.
        const p = document.createElement('p');
        p.append(document.createElement('br'));
        body.append(p);
        blocks.push(p);
      }
      for (const p of blocks) {
        const r = p.getBoundingClientRect();
        if (r.bottom >= viewport.top && r.top <= viewport.bottom) out.push({p,r});
      }
    }
    return out;
  }
  function closeMenu() {
    if (!activeMenu) return;
    activeMenu.remove();
    activeMenu = null;
  }
  function chooseSpeaker(p, value) {
    if (value) p.dataset.speakerId = value;
    else delete p.dataset.speakerId;
    if (currentTab === 'notes') {
      auxDirty = true;
      scheduleAuxSave();
    } else {
      const body = p.closest('.chapter-body');
      const chapter = body && body.closest('.chapter');
      if (chapter) syncChapter(body,chapter.dataset.id);
    }
    closeMenu();
    requestPaint();
  }
  function openMenu(button,p) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'speaker-menu';
    menu.setAttribute('role','listbox');
    menu.setAttribute('aria-label','Select speaker');
    for (const character of [{id:'',name:'— No speaker',color:''},...characters()]) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'speaker-menu-option';
      option.setAttribute('role','option');
      option.setAttribute('aria-selected',String((p.dataset.speakerId || '') === character.id));
      option.textContent = character.name;
      if (character.id) option.style.setProperty('--speaker-color', character.color);
      option.addEventListener('click',() => chooseSpeaker(p,character.id));
      menu.append(option);
    }
    document.body.append(menu);
    activeMenu = menu;
    const r = button.getBoundingClientRect();
    const menuHeight = menu.getBoundingClientRect().height;
    const top = Math.min(Math.max(4,r.bottom + 3), Math.max(4,window.innerHeight - menuHeight - 4));
    menu.style.top = top + 'px';
    menu.style.left = Math.max(4,Math.min(r.left,window.innerWidth - menu.offsetWidth - 4)) + 'px';
    const first = menu.querySelector('[aria-selected="true"]') || menu.firstElementChild;
    if (first) first.focus();
  }
  function paint() {
    paintPending = false;
    closeMenu();
    gutter.replaceChildren();
    if (!book || !['notes','manuscript'].includes(currentTab)) return;
    const scroll = $('#paper-scroll');
    const rect = scroll.getBoundingClientRect();
    const cast = characters();
    for (const {p,r} of visibleParagraphs()) {
      const assigned = p.dataset.speakerId || '';
      const selected = cast.find(c => c.id === assigned);
      const selector = document.createElement('button');
      selector.type = 'button';
      selector.className = 'speaker-selector' + (selected ? ' has-speaker' : '');
      selector.setAttribute('aria-label','Speaker for paragraph: ' + p.textContent.slice(0,65));
      selector.setAttribute('aria-haspopup','listbox');
      selector.textContent = selected ? selected.name : '—';
      selector.title = selected ? selected.name : 'Select speaker';
      selector.style.setProperty('--speaker-color',selected ? selected.color : 'transparent');
      selector.style.top = (r.top - rect.top + scroll.scrollTop) + 'px';
      selector.style.left = Math.max(3,r.left - rect.left - 115 + scroll.scrollLeft) + 'px';
      selector.addEventListener('click',() => openMenu(selector,p));
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
      descriptionsOpen.clear();
      renderCharacters();
    }
    requestPaint();
  }
  document.addEventListener('pointerdown',(e) => { if (activeMenu && !activeMenu.contains(e.target) && !e.target.closest('.speaker-selector')) closeMenu(); },true);
  document.addEventListener('keydown',(e) => { if(e.key==='Escape') closeMenu(); },true);
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

'use strict';

// 「ずぼら日記」 - GitHub Pages向け、ブラウザ内保存版
// 旧版と同じ保存キーを使い、既存の日記・自由記述項目をできる限り引き継ぎます。
const STORAGE_KEY = 'yohaku-diary-v1';
const DATA_VERSION = 2;
const DEFAULT_FIELDS = [
  { id: 'core-mood', name: '気分', type: 'slider', color: 'pink', locked: true, createdAt: '2025-01-01T00:00:00.000Z' },
  { id: 'core-health', name: '体調', type: 'slider', color: 'green', locked: true, createdAt: '2025-01-01T00:00:00.000Z' },
  { id: 'core-fulfillment', name: '充実度', type: 'slider', color: 'orange', locked: true, createdAt: '2025-01-01T00:00:00.000Z' },
  { id: 'core-note', name: 'ひとこと', type: 'text', color: null, locked: true, createdAt: '2025-01-01T00:00:00.000Z' }
];
const GRAPH_COLORS = [
  { key: 'red', name: '赤色', hex: '#d58f8d' },
  { key: 'pink', name: 'ピンク色', hex: '#d9a0b1' },
  { key: 'orange', name: 'オレンジ色', hex: '#dfa77b' },
  { key: 'yellow', name: '黄色', hex: '#d4bd75' },
  { key: 'green', name: '緑色', hex: '#97b698' },
  { key: 'cyan', name: '水色', hex: '#91bdc1' },
  { key: 'blue', name: '青色', hex: '#91add2' },
  { key: 'purple', name: '紫色', hex: '#ac9bc2' },
  { key: 'brown', name: '茶色', hex: '#ae8974' },
  { key: 'black', name: '黒色', hex: '#6d6864' }
];
const HEAT_COLORS = { 1: '#91add2', 2: '#99c9cb', 3: '#a4c7a0', 4: '#e4cb86', 5: '#dfa5b1' };
const BADGE_DEFS = [
  { id: 'day-total', title: 'はじめの一歩', condition: '累計1日 日記を書いた', kind: 'total', unit: 'day', threshold: 1 },
  { id: 'day-streak', title: '三日坊主じゃないかも', condition: '連続3日 日記を書いた', kind: 'streak', unit: 'day', threshold: 3 },
  { id: 'week-total', title: '週末の記録係', condition: '累計4週間 日記を書いた', kind: 'total', unit: 'week', threshold: 4 },
  { id: 'week-streak', title: '週のリズム', condition: '連続2週間 日記を書いた', kind: 'streak', unit: 'week', threshold: 2 },
  { id: 'month-total', title: 'マイペースの達人', condition: '累計3か月 日記を書いた', kind: 'total', unit: 'month', threshold: 3 },
  { id: 'month-streak', title: '習慣の芽', condition: '連続2か月 日記を書いた', kind: 'streak', unit: 'month', threshold: 2 },
  { id: 'year-total', title: '一年の記録', condition: '累計1年間 日記を書いた', kind: 'total', unit: 'year', threshold: 1 },
  { id: 'year-streak', title: '季節をこえて', condition: '連続2年間 日記を書いた', kind: 'streak', unit: 'year', threshold: 2 }
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let state = loadState();
let currentEntryId = null;
let selectedFieldIds = new Set(DEFAULT_FIELDS.map(field => field.id));
let draftValues = {};
let editingFieldId = null;
let selectedColor = null;
let activePeriod = 'week';
let heatMonth = localMonthString(new Date());
let toastTimer = null;
let confirmAction = null;

function createId(prefix = 'id') {
  return `${prefix}-${window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function localMonthString(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function parseLocalDate(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return localDateString(parseLocalDate(value)) === value;
}
function clampScore(value) { return Math.min(5, Math.max(1, Math.round(Number(value) || 3))); }
function getColor(key) { return GRAPH_COLORS.find(item => item.key === key)?.hex || GRAPH_COLORS[0].hex; }
function colorName(key) { return GRAPH_COLORS.find(item => item.key === key)?.name || '赤色'; }
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function defaultState() {
  return { version: DATA_VERSION, fields: DEFAULT_FIELDS.map(item => ({ ...item })), entries: [] };
}
function normalizeState(candidate) {
  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.entries)) throw new Error('バックアップの形式が正しくありません。');
  const incomingFields = Array.isArray(candidate.fields) ? candidate.fields : [];
  const customFields = incomingFields
    .filter(field => field && typeof field.id === 'string' && typeof field.name === 'string')
    .map(field => {
      const type = field.type === 'slider' || field.type === 'text' ? field.type : 'text'; // 旧版の自由記述項目を引き継ぐ
      return {
        id: field.id.slice(0, 100), name: field.name.trim().slice(0, 30), type,
        color: type === 'slider' ? (GRAPH_COLORS.some(c => c.key === field.color) ? field.color : 'blue') : null,
        locked: false,
        createdAt: typeof field.createdAt === 'string' ? field.createdAt : new Date().toISOString()
      };
    })
    .filter(field => field.name && !DEFAULT_FIELDS.some(base => base.id === field.id));
  const fields = [...DEFAULT_FIELDS.map(item => ({ ...item })), ...customFields];
  const fieldMap = new Map(fields.map(field => [field.id, field]));
  const entries = candidate.entries
    .filter(entry => entry && typeof entry.id === 'string' && isValidDateString(entry.date) && entry.values && typeof entry.values === 'object' && !Array.isArray(entry.values))
    .map(entry => {
      const values = {};
      for (const [id, raw] of Object.entries(entry.values)) {
        if (!raw || typeof raw !== 'object') continue;
        const field = fieldMap.get(id);
        const rawType = raw.type === 'slider' || raw.type === 'text' ? raw.type : (field?.type || 'text');
        if (rawType === 'slider') {
          const score = Number(raw.value);
          if (Number.isFinite(score)) values[id] = { type: 'slider', label: String(raw.label || field?.name || '項目').slice(0, 100), value: clampScore(score) };
        } else {
          values[id] = { type: 'text', label: String(raw.label || field?.name || '項目').slice(0, 100), value: String(raw.value ?? '').slice(0, 50000) };
        }
      }
      return {
        id: entry.id.slice(0, 100), date: entry.date, values,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString()
      };
    });
  return { version: DATA_VERSION, fields, entries };
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const normalized = normalizeState(JSON.parse(raw));
    // Migration is written immediately, so later opens use the new structured format.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (error) {
    console.error('保存データの読み込みに失敗しました:', error);
    return defaultState();
  }
}
function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateMiniStats();
    return true;
  } catch (error) {
    console.error('記録の保存に失敗しました:', error);
    showToast('保存できませんでした。ブラウザの空き容量をご確認ください。');
    return false;
  }
}
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
}
function sortedEntries() { return [...state.entries].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt)); }
function sortedDates() { return [...new Set(state.entries.map(entry => entry.date))].sort(); }
function updateMiniStats() {
  $('#total-entry-days').innerHTML = `${new Set(state.entries.map(entry => entry.date)).size}<span>日</span>`;
  $('#total-entry-count').innerHTML = `${state.entries.length}<span>件</span>`;
}
function navigate(viewName) {
  const views = ['write', 'analytics', 'badges', 'settings', 'archive'];
  if (!views.includes(viewName)) return;
  $$('.view').forEach(view => {
    const active = view.id === `view-${viewName}`;
    view.classList.toggle('is-visible', active);
    view.hidden = !active;
  });
  $$('.nav-button').forEach(button => {
    const active = button.dataset.view === viewName;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (viewName === 'analytics') renderAnalytics();
  if (viewName === 'badges') renderBadges();
  if (viewName === 'settings') renderSettings();
  if (viewName === 'archive') renderArchive();
  if (viewName === 'write') renderRecentEntries();
  window.location.hash = viewName;
}
function getCurrentEntry() { return state.entries.find(entry => entry.id === currentEntryId) || null; }
function getEditorFields() {
  const fields = state.fields.map(field => ({ ...field, historical: false }));
  const current = getCurrentEntry();
  if (!current) return fields;
  const known = new Set(fields.map(field => field.id));
  for (const [id, item] of Object.entries(current.values)) {
    if (!known.has(id)) fields.push({ id, name: item.label || '過去の項目', type: item.type || 'text', color: 'brown', locked: true, historical: true });
  }
  return fields;
}
function startNewEntry() {
  currentEntryId = null;
  selectedFieldIds = new Set(DEFAULT_FIELDS.map(field => field.id));
  draftValues = {};
  $('#editor-heading').textContent = '今日の記録';
  $('#entry-date').value = localDateString();
  $('#save-message').textContent = 'スライダーは3からスタート。ひとことは空欄でも保存できます。';
  renderFieldPicker();
}
function editEntry(entryId) {
  const entry = state.entries.find(item => item.id === entryId);
  if (!entry) return;
  currentEntryId = entry.id;
  selectedFieldIds = new Set(Object.keys(entry.values));
  draftValues = Object.fromEntries(Object.entries(entry.values).map(([id, value]) => [id, value.value]));
  $('#editor-heading').textContent = '記録を編集';
  $('#entry-date').value = entry.date;
  $('#save-message').textContent = '過去の記録を編集中です。';
  renderFieldPicker();
  navigate('write');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderFieldPicker() {
  const picker = $('#field-picker');
  picker.replaceChildren();
  getEditorFields().forEach(field => {
    const label = document.createElement('label');
    label.className = `field-choice${selectedFieldIds.has(field.id) ? ' is-selected' : ''}`;
    const input = document.createElement('input');
    input.type = 'checkbox'; input.value = field.id; input.checked = selectedFieldIds.has(field.id);
    input.addEventListener('change', () => {
      if (input.checked) {
        selectedFieldIds.add(field.id);
        if (field.type === 'slider' && draftValues[field.id] == null) draftValues[field.id] = 3;
      } else selectedFieldIds.delete(field.id);
      label.classList.toggle('is-selected', input.checked);
      renderEditorFields();
    });
    const name = document.createElement('span'); name.textContent = field.name;
    label.append(input, name);
    if (field.locked && !field.historical) { const required = document.createElement('small'); required.className = 'required-mark'; required.textContent = '基本'; label.append(required); }
    picker.append(label);
  });
  renderEditorFields();
}
function renderEditorFields() {
  const container = $('#editor-fields');
  container.replaceChildren();
  const fields = getEditorFields().filter(field => selectedFieldIds.has(field.id));
  $('#selected-count').textContent = `${fields.length} 項目`;
  $('#editor-hint').textContent = fields.length ? '数値は1〜5。真ん中の3から、気軽に動かしてみてください。' : '項目を選ぶと入力欄が表示されます。';
  fields.forEach(field => {
    const card = document.createElement('section');
    card.className = 'editor-card';
    const header = document.createElement('div'); header.className = 'editor-card-header';
    const label = document.createElement('label'); label.textContent = field.name;
    header.append(label);
    if (field.type === 'slider') {
      const value = clampScore(draftValues[field.id] ?? getCurrentEntry()?.values?.[field.id]?.value ?? 3);
      draftValues[field.id] = value;
      const output = document.createElement('output'); output.className = 'editor-value'; output.textContent = `${value} / 5`;
      header.append(output);
      const row = document.createElement('div'); row.className = 'slider-row';
      const range = document.createElement('input'); range.type = 'range'; range.min = '1'; range.max = '5'; range.step = '1'; range.value = String(value); range.style.setProperty('--range-color', getColor(field.color)); range.setAttribute('aria-label', `${field.name} 1から5`);
      updateRangeFill(range);
      range.addEventListener('input', () => {
        draftValues[field.id] = Number(range.value); output.textContent = `${range.value} / 5`; updateRangeFill(range);
      });
      row.append(range);
      const ends = document.createElement('div'); ends.className = 'slider-scale'; ends.innerHTML = '<span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>';
      card.append(header, row, ends);
    } else {
      const textarea = document.createElement('textarea'); textarea.className = 'editor-textarea'; textarea.rows = 2; textarea.maxLength = 5000; textarea.placeholder = 'ひとことだけでも、空欄のままでも。';
      textarea.value = String(draftValues[field.id] ?? getCurrentEntry()?.values?.[field.id]?.value ?? '');
      textarea.setAttribute('aria-label', field.name);
      textarea.addEventListener('input', () => { draftValues[field.id] = textarea.value; });
      card.append(header, textarea);
    }
    container.append(card);
  });
  if (!fields.length) {
    const p = document.createElement('p'); p.className = 'muted-empty'; p.textContent = '記録したい項目を上から選んでください。'; container.append(p);
  }
  $('#save-entry').disabled = fields.length === 0;
}
function updateRangeFill(range) {
  const percent = ((Number(range.value) - 1) / 4) * 100;
  range.style.background = `linear-gradient(90deg, var(--range-color) 0%, var(--range-color) ${percent}%, #ece5da ${percent}%, #ece5da 100%)`;
}
function resetEditor() {
  if (currentEntryId) { editEntry(currentEntryId); return; }
  draftValues = {};
  selectedFieldIds = new Set(DEFAULT_FIELDS.map(field => field.id));
  renderFieldPicker();
  showToast('入力を初期状態に戻しました。');
}
function saveEntry() {
  const date = $('#entry-date').value;
  if (!isValidDateString(date)) { showToast('日付を確認してください。'); return; }
  const selected = getEditorFields().filter(field => selectedFieldIds.has(field.id));
  if (!selected.length) { showToast('記録する項目を選んでください。'); return; }
  const values = {};
  for (const field of selected) {
    if (field.type === 'slider') values[field.id] = { type: 'slider', label: field.name, value: clampScore(draftValues[field.id] ?? getCurrentEntry()?.values?.[field.id]?.value ?? 3) };
    else {
      const text = String(draftValues[field.id] ?? getCurrentEntry()?.values?.[field.id]?.value ?? '').trim();
      if (text) values[field.id] = { type: 'text', label: field.name, value: text };
    }
  }
  if (!Object.keys(values).length) { showToast('数値を記録するか、ひとことを入力してください。'); return; }
  const current = getCurrentEntry();
  if (current) {
    current.date = date; current.values = values; current.updatedAt = new Date().toISOString();
  } else {
    state.entries.push({ id: createId('entry'), date, values, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  if (!persistState()) return;
  const wasEditing = Boolean(current);
  currentEntryId = null;
  startNewEntry();
  renderRecentEntries();
  showToast(wasEditing ? '記録を更新しました。' : '今日の記録を保存しました。');
}
function formatDate(dateString, options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }) {
  return new Intl.DateTimeFormat('ja-JP', options).format(parseLocalDate(dateString));
}
function entrySummary(entry) {
  const sliders = Object.values(entry.values).filter(item => item.type === 'slider').map(item => `${item.label} ${item.value}`);
  const texts = Object.values(entry.values).filter(item => item.type === 'text' && item.value.trim()).map(item => item.value.replace(/\s+/g, ' '));
  return [...sliders, ...texts].join(' ・ ') || '記録あり';
}
function renderRecentEntries() {
  const list = $('#recent-entry-list'); const empty = $('#recent-empty');
  list.replaceChildren();
  const entries = sortedEntries().slice(0, 3);
  empty.hidden = entries.length > 0;
  entries.forEach(entry => {
    const row = document.createElement('div'); row.className = 'recent-entry';
    const date = document.createElement('span'); date.className = 'recent-entry-date'; date.textContent = formatDate(entry.date, { month: 'numeric', day: 'numeric', weekday: 'short' });
    const summary = document.createElement('span'); summary.className = 'recent-entry-summary'; summary.textContent = entrySummary(entry);
    const action = document.createElement('button'); action.type = 'button'; action.textContent = '見る'; action.addEventListener('click', () => editEntry(entry.id));
    row.append(date, summary, action); list.append(row);
  });
  updateMiniStats();
}
function renderArchive() {
  const list = $('#entry-list'); list.replaceChildren();
  const query = ($('#archive-search')?.value || '').trim().toLocaleLowerCase();
  const entries = sortedEntries().filter(entry => `${entry.date} ${formatDate(entry.date)} ${entrySummary(entry)}`.toLocaleLowerCase().includes(query));
  $('#archive-count').textContent = String(entries.length);
  $('#archive-empty').hidden = entries.length > 0;
  entries.forEach(entry => {
    const card = document.createElement('article'); card.className = 'entry-card';
    const header = document.createElement('div'); header.className = 'entry-card-header';
    const time = document.createElement('time'); time.dateTime = entry.date; time.textContent = formatDate(entry.date);
    const actions = document.createElement('div'); actions.className = 'entry-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '編集'; edit.addEventListener('click', () => editEntry(entry.id));
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '削除'; remove.addEventListener('click', () => askConfirm('この記録を削除しますか？', '削除する', () => {
      state.entries = state.entries.filter(item => item.id !== entry.id); persistState(); renderArchive(); renderRecentEntries(); renderAnalytics(); renderBadges(); showToast('記録を削除しました。');
    }));
    actions.append(edit, remove); header.append(time, actions); card.append(header);
    const chips = document.createElement('div'); chips.className = 'entry-values';
    for (const item of Object.values(entry.values)) {
      if (item.type !== 'slider') continue;
      const chip = document.createElement('span'); chip.className = 'entry-value-chip'; chip.textContent = `${item.label} ${item.value}/5`; chips.append(chip);
    }
    if (chips.childElementCount) card.append(chips);
    for (const item of Object.values(entry.values)) {
      if (item.type !== 'text' || !item.value.trim()) continue;
      const text = document.createElement('p'); text.className = 'entry-text'; text.textContent = `${item.label}：${item.value}`; card.append(text);
    }
    list.append(card);
  });
}
function renderSettings() {
  const list = $('#settings-field-list'); list.replaceChildren();
  $('#settings-empty').hidden = state.fields.length > 0;
  state.fields.forEach(field => {
    const row = document.createElement('div'); row.className = 'settings-field-item';
    const main = document.createElement('div'); main.className = 'settings-field-main';
    if (field.type === 'slider') { const swatch = document.createElement('i'); swatch.className = 'settings-color'; swatch.style.background = getColor(field.color); main.append(swatch); }
    const copy = document.createElement('div');
    const strong = document.createElement('strong'); strong.textContent = field.name;
    const small = document.createElement('small'); small.textContent = field.type === 'slider' ? `スライダー型 ・ 線の色：${colorName(field.color)}` : '文章記述型';
    copy.append(strong, small); main.append(copy); row.append(main);
    if (field.locked) { const tag = document.createElement('span'); tag.className = 'lock-tag'; tag.textContent = '基本項目・削除不可'; row.append(tag); }
    else {
      const actions = document.createElement('div'); actions.className = 'field-actions';
      const edit = document.createElement('button'); edit.className = 'small-action'; edit.type = 'button'; edit.textContent = '編集'; edit.addEventListener('click', () => openFieldDialog('edit', field.id));
      const remove = document.createElement('button'); remove.className = 'small-action delete'; remove.type = 'button'; remove.textContent = '削除'; remove.addEventListener('click', () => askConfirm(`「${field.name}」を項目一覧から削除しますか？\n過去の記録に保存された値は残ります。`, '削除する', () => {
        state.fields = state.fields.filter(item => item.id !== field.id); selectedFieldIds.delete(field.id); persistState(); renderSettings(); renderFieldPicker(); renderAnalytics(); showToast('項目を削除しました。');
      }));
      actions.append(edit, remove); row.append(actions);
    }
    list.append(row);
  });
}
function openFieldDialog(mode, fieldId = null) {
  editingFieldId = mode === 'edit' ? fieldId : null;
  const field = state.fields.find(item => item.id === fieldId);
  $('#field-dialog-title').textContent = field ? '項目を編集' : '項目を追加';
  $('#field-name').value = field?.name || '';
  $('#field-type').value = field?.type || 'slider';
  selectedColor = field?.color || null;
  renderColorPicker(); toggleColorPicker();
  $('#field-dialog').showModal();
  $('#field-name').focus();
}
function renderColorPicker() {
  const grid = $('#color-preset-grid'); grid.replaceChildren();
  GRAPH_COLORS.forEach(color => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `color-option${selectedColor === color.key ? ' is-selected' : ''}`; button.setAttribute('aria-label', color.name); button.setAttribute('aria-pressed', String(selectedColor === color.key));
    const dot = document.createElement('i'); dot.style.background = color.hex;
    const name = document.createElement('span'); name.textContent = color.name;
    button.append(dot, name); button.addEventListener('click', () => { selectedColor = color.key; renderColorPicker(); }); grid.append(button);
  });
}
function toggleColorPicker() { $('#color-picker-block').hidden = $('#field-type').value !== 'slider'; }
function saveCustomField(event) {
  event.preventDefault();
  const name = $('#field-name').value.trim(); const type = $('#field-type').value;
  if (!name) { showToast('項目の名前を入力してください。'); return; }
  if (state.fields.some(field => field.name.toLocaleLowerCase() === name.toLocaleLowerCase() && field.id !== editingFieldId)) { showToast('同じ名前の項目がすでにあります。'); return; }
  if (type === 'slider' && !selectedColor) { showToast('グラフ線の色をプリセットから選んでください。'); return; }
  const color = type === 'slider' ? selectedColor : null;
  if (editingFieldId) {
    const field = state.fields.find(item => item.id === editingFieldId);
    if (!field || field.locked) return;
    field.name = name; field.type = type; field.color = color;
  } else {
    state.fields.push({ id: createId('field'), name, type, color, locked: false, createdAt: new Date().toISOString() });
  }
  persistState(); $('#field-dialog').close(); renderSettings(); renderFieldPicker(); renderAnalytics(); showToast(editingFieldId ? '項目を更新しました。' : '項目を追加しました。');
}
function askConfirm(message, buttonLabel, action) {
  $('#confirm-message').textContent = message;
  $('#confirm-accept').textContent = buttonLabel;
  confirmAction = action;
  $('#confirm-dialog').showModal();
}
function currentSliderFields() { return state.fields.filter(field => field.type === 'slider'); }
function dateWithin(dateString, period) {
  const date = parseLocalDate(dateString); const now = new Date();
  if (period === 'week') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return date >= start && date < end;
  }
  if (period === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  return date.getFullYear() === now.getFullYear();
}
function valuesForField(fieldId, entries = state.entries) {
  const items = [];
  entries.forEach(entry => {
    const item = entry.values[fieldId];
    if (item?.type === 'slider' && Number.isFinite(Number(item.value))) items.push({ date: entry.date, value: clampScore(item.value) });
  });
  return items.sort((a, b) => a.date.localeCompare(b.date));
}
function average(values) { return values.length ? values.reduce((sum, item) => sum + item.value, 0) / values.length : null; }
function renderAnalytics() {
  renderAverageCards(); renderTrendChart(); renderHeatMap();
}
function renderAverageCards() {
  const grid = $('#average-grid'); grid.replaceChildren();
  const fields = currentSliderFields();
  if (!fields.length) { grid.innerHTML = '<p class="average-empty">設定からスライダー型の項目を追加すると、平均を表示できます。</p>'; return; }
  fields.forEach(field => {
    const values = valuesForField(field.id).filter(item => dateWithin(item.date, activePeriod));
    const avg = average(values);
    const card = document.createElement('article'); card.className = 'average-card';
    const top = document.createElement('div'); top.className = 'average-card-top';
    const dot = document.createElement('i'); dot.className = 'average-swatch'; dot.style.background = getColor(field.color);
    const name = document.createElement('span'); name.textContent = `${field.name}の平均`; top.append(dot, name);
    const number = document.createElement('p'); number.className = 'average-number';
    number.innerHTML = avg == null ? '— <small>/ 5</small>' : `${avg.toFixed(1)} <small>/ 5</small>`;
    const meta = document.createElement('p'); meta.className = 'average-meta'; meta.textContent = avg == null ? 'この期間の記録はまだありません' : `${values.length}件の記録から計算`;
    card.append(top, number, meta); grid.append(card);
  });
}
function catmullRomPath(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]; const p1 = points[i]; const p2 = points[i + 1]; const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6; const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6; const cp2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x} ${p2.y}`;
  }
  return path;
}
function renderTrendChart() {
  const wrap = $('#trend-chart'); const fields = currentSliderFields();
  const end = parseLocalDate(localDateString()); const dates = [];
  for (let i = 29; i >= 0; i--) { const date = new Date(end); date.setDate(date.getDate() - i); dates.push(localDateString(date)); }
  const hasData = fields.some(field => valuesForField(field.id).some(item => dates.includes(item.date)));
  if (!fields.length || !hasData) { wrap.innerHTML = '<div class="chart-empty">記録が増えると、ここにゆるやかな線が描かれます。</div>'; return; }
  const width = 760, height = 242, left = 42, right = 17, top = 15, bottom = 35;
  const plotW = width - left - right, plotH = height - top - bottom;
  const yFor = value => top + ((5 - value) / 4) * plotH;
  const xFor = index => left + (index / (dates.length - 1)) * plotW;
  let svg = `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="直近30日間のスライダー項目の推移">`;
  for (let score = 1; score <= 5; score++) {
    const y = yFor(score); svg += `<line class="chart-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="chart-axis-label" x="${left - 13}" y="${y + 4}" text-anchor="end">${score}</text>`;
  }
  const labels = [0, 7, 14, 21, 29];
  labels.forEach(index => { const d = parseLocalDate(dates[index]); const text = `${d.getMonth() + 1}/${d.getDate()}`; svg += `<text class="chart-axis-label" x="${xFor(index)}" y="${height - 9}" text-anchor="middle">${text}</text>`; });
  fields.forEach(field => {
    const raw = valuesForField(field.id); const map = new Map(); raw.forEach(item => { if (dates.includes(item.date)) { const arr = map.get(item.date) || []; arr.push(item.value); map.set(item.date, arr); } });
    const points = [];
    dates.forEach((date, index) => { const vals = map.get(date); if (vals?.length) points.push({ x: xFor(index), y: yFor(vals.reduce((a, b) => a + b, 0) / vals.length) }); });
    if (points.length) svg += `<path class="chart-series" d="${catmullRomPath(points)}" stroke="${getColor(field.color)}"/>`;
  });
  svg += '</svg><div class="chart-legend">';
  fields.forEach(field => { svg += `<span><i style="background:${getColor(field.color)}"></i>${escapeHTML(field.name)}</span>`; });
  svg += '</div>';
  wrap.innerHTML = svg;
}
function monthDateRange(monthString) {
  const [year, month] = monthString.split('-').map(Number);
  const first = new Date(year, month - 1, 1, 12); const count = new Date(year, month, 0).getDate();
  return { year, month, first, count, offset: (first.getDay() + 6) % 7 };
}
function renderHeatMap() {
  const select = $('#heat-field-select'); const fields = currentSliderFields();
  const previous = select.value;
  select.replaceChildren();
  fields.forEach(field => { const option = document.createElement('option'); option.value = field.id; option.textContent = field.name; select.append(option); });
  if (fields.some(field => field.id === previous)) select.value = previous;
  else if (fields.some(field => field.id === 'core-fulfillment')) select.value = 'core-fulfillment';
  else if (fields[0]) select.value = fields[0].id;
  $('#heat-title').textContent = `${Number(heatMonth.split('-')[1])}月`;
  const map = $('#heat-map'); map.replaceChildren();
  if (!fields.length) { map.innerHTML = '<p class="average-empty">スライダー型の項目を追加すると、月間カラーマップを使えます。</p>'; return; }
  ['月', '火', '水', '木', '金', '土', '日'].forEach(day => { const head = document.createElement('div'); head.className = 'heatmap-weekday'; head.textContent = day; map.append(head); });
  const { year, month, count, offset } = monthDateRange(heatMonth); const today = localDateString();
  for (let i = 0; i < offset; i++) { const blank = document.createElement('div'); blank.className = 'heat-day empty'; map.append(blank); }
  const fieldId = select.value;
  for (let day = 1; day <= count; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const scores = state.entries.filter(entry => entry.date === date).map(entry => entry.values[fieldId]).filter(item => item?.type === 'slider').map(item => clampScore(item.value));
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const level = avg == null ? 0 : clampScore(avg);
    const button = document.createElement('button'); button.type = 'button'; button.className = `heat-day${level ? ` has-value level-${level}` : ''}${date === today ? ' is-today' : ''}`;
    button.title = avg == null ? `${day}日：記録なし` : `${day}日：平均 ${avg.toFixed(1)} / 5（${scores.length}件）`;
    const number = document.createElement('span'); number.className = 'heat-day-number'; number.textContent = String(day);
    const stamp = document.createElement('span'); stamp.className = 'heat-stamp';
    if (level) { stamp.style.background = HEAT_COLORS[level]; button.addEventListener('click', () => showToast(`${month}月${day}日：${avg.toFixed(1)} / 5`)); }
    button.append(number, stamp); map.append(button);
  }
}
function startOfWeek(dateString) {
  const date = parseLocalDate(dateString); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return localDateString(date);
}
function monthKey(dateString) { return dateString.slice(0, 7); }
function yearKey(dateString) { return dateString.slice(0, 4); }
function keyDiff(a, b, unit) {
  if (unit === 'day') return Math.round((parseLocalDate(b) - parseLocalDate(a)) / 86400000);
  if (unit === 'week') return Math.round((parseLocalDate(b) - parseLocalDate(a)) / (86400000 * 7));
  if (unit === 'month') { const [ay, am] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); }
  return Number(b) - Number(a);
}
function firstEntryDateForKey(key, unit, uniqueDates) {
  if (unit === 'day') return key;
  return uniqueDates.find(date => (unit === 'week' ? startOfWeek(date) : unit === 'month' ? monthKey(date) : yearKey(date)) === key);
}
function badgeUnlockDate(def, uniqueDates) {
  if (!uniqueDates.length) return null;
  if (def.kind === 'total') {
    const keys = [...new Set(uniqueDates.map(date => def.unit === 'day' ? date : def.unit === 'week' ? startOfWeek(date) : def.unit === 'month' ? monthKey(date) : yearKey(date)))];
    return keys.length >= def.threshold ? firstEntryDateForKey(keys[def.threshold - 1], def.unit, uniqueDates) : null;
  }
  if (def.unit === 'day') {
    for (let i = def.threshold - 1; i < uniqueDates.length; i++) {
      let consecutive = true;
      for (let j = i - def.threshold + 1; j < i; j++) if (keyDiff(uniqueDates[j], uniqueDates[j + 1], 'day') !== 1) consecutive = false;
      if (consecutive) return uniqueDates[i];
    }
    return null;
  }
  const keys = [...new Set(uniqueDates.map(date => def.unit === 'week' ? startOfWeek(date) : def.unit === 'month' ? monthKey(date) : yearKey(date)))];
  for (let i = def.threshold - 1; i < keys.length; i++) {
    let consecutive = true;
    for (let j = i - def.threshold + 1; j < i; j++) if (keyDiff(keys[j], keys[j + 1], def.unit) !== 1) consecutive = false;
    if (consecutive) return firstEntryDateForKey(keys[i], def.unit, uniqueDates);
  }
  return null;
}
function renderBadges() {
  const list = $('#badge-list'); list.replaceChildren();
  const dates = sortedDates(); let earned = 0;
  BADGE_DEFS.forEach(def => {
    const unlocked = badgeUnlockDate(def, dates);
    if (unlocked) earned++;
    const card = document.createElement('article'); card.className = `badge-card${unlocked ? '' : ' is-locked'}`;
    const medalWrap = document.createElement('div'); medalWrap.className = 'badge-medal-wrap';
    const medal = document.createElement('img'); medal.className = 'badge-medal'; medal.src = 'medal.png'; medal.alt = unlocked ? '獲得した金色のメダル' : '未獲得のメダル'; medalWrap.append(medal);
    const copy = document.createElement('div'); copy.className = 'badge-copy';
    const title = document.createElement('h3'); title.className = 'badge-title'; title.textContent = unlocked ? def.title : '？？？';
    const condition = document.createElement('p'); condition.className = 'badge-condition'; condition.textContent = unlocked ? def.condition : '？？？';
    copy.append(title, condition);
    const date = document.createElement('time'); date.className = 'badge-earned-date';
    if (unlocked) { date.dateTime = unlocked; date.textContent = `獲得日：${formatDate(unlocked, { year: 'numeric', month: '2-digit', day: '2-digit' })}`; }
    else date.textContent = '未獲得';
    card.append(medalWrap, copy, date); list.append(card);
  });
  $('#badge-count').textContent = `${earned} / ${BADGE_DEFS.length} 獲得`;
}
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'ずぼら日記', version: DATA_VERSION, exportedAt: new Date().toISOString(), fields: state.fields, entries: state.entries }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `zubora-diary-backup-${localDateString()}.json`; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  showToast('バックアップを書き出しました。');
}
async function importData(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const normalized = normalizeState(parsed);
    state = normalized; if (!persistState()) return;
    startNewEntry(); renderAll(); showToast('バックアップを読み込みました。');
  } catch (error) { console.error(error); showToast('読み込めませんでした。JSONファイルをご確認ください。'); }
}
function renderAll() { updateMiniStats(); renderRecentEntries(); renderSettings(); renderAnalytics(); renderBadges(); renderArchive(); }

// UI events
$$('.nav-button').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
$$('[data-go-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.goView)));
$('#save-entry').addEventListener('click', saveEntry);
$('#reset-editor').addEventListener('click', resetEditor);
$('#restore-default-selection').addEventListener('click', () => {
  DEFAULT_FIELDS.forEach(field => { selectedFieldIds.add(field.id); if (field.type === 'slider' && draftValues[field.id] == null) draftValues[field.id] = 3; });
  renderFieldPicker();
});
$('#add-field').addEventListener('click', () => openFieldDialog('add'));
$('#field-type').addEventListener('change', toggleColorPicker);
$('#field-form').addEventListener('submit', saveCustomField);
$('#close-field-dialog').addEventListener('click', () => $('#field-dialog').close());
$('#cancel-field-dialog').addEventListener('click', () => $('#field-dialog').close());
$('#confirm-dialog').addEventListener('close', () => {
  if ($('#confirm-dialog').returnValue === 'confirm' && typeof confirmAction === 'function') confirmAction();
  confirmAction = null;
});
$('#field-dialog').addEventListener('click', event => { if (event.target === $('#field-dialog')) $('#field-dialog').close(); });
$('#export-data').addEventListener('click', exportData);
$('#import-file').addEventListener('change', event => { const file = event.target.files?.[0]; if (file) importData(file); event.target.value = ''; });
$('#archive-search').addEventListener('input', renderArchive);
$$('[data-period]').forEach(button => button.addEventListener('click', () => {
  activePeriod = button.dataset.period; $$('[data-period]').forEach(item => item.classList.toggle('is-active', item === button)); renderAverageCards();
}));
$('#heat-field-select').addEventListener('change', renderHeatMap);
$('#heat-prev').addEventListener('click', () => { const [y, m] = heatMonth.split('-').map(Number); heatMonth = localMonthString(new Date(y, m - 2, 1)); renderHeatMap(); });
$('#heat-next').addEventListener('click', () => { const [y, m] = heatMonth.split('-').map(Number); heatMonth = localMonthString(new Date(y, m, 1)); renderHeatMap(); });
window.addEventListener('hashchange', () => {
  const route = location.hash.slice(1);
  if (['write', 'analytics', 'badges', 'settings', 'archive'].includes(route)) navigate(route);
});

// First render. Existing localStorage entries are migrated by normalizeState().
updateMiniStats();
startNewEntry();
renderRecentEntries();
renderSettings();
renderAnalytics();
renderBadges();
renderArchive();
const initialRoute = location.hash.slice(1);
if (['write', 'analytics', 'badges', 'settings', 'archive'].includes(initialRoute)) navigate(initialRoute);

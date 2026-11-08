'use strict';

const STORAGE_KEY = 'yohaku-diary-v1';
const DATA_VERSION = 1;
const DEFAULT_FIELDS = [
  { id: 'field-events', name: '今日の出来事', createdAt: '2025-01-01T00:00:00.000Z' },
  { id: 'field-mood', name: '気分・感情', createdAt: '2025-01-01T00:00:00.000Z' },
  { id: 'field-study', name: '勉強', createdAt: '2025-01-01T00:00:00.000Z' },
  { id: 'field-reading', name: '読んだ本・見た作品', createdAt: '2025-01-01T00:00:00.000Z' },
  { id: 'field-food', name: '食事', createdAt: '2025-01-01T00:00:00.000Z' },
  { id: 'field-gratitude', name: '感謝したこと', createdAt: '2025-01-01T00:00:00.000Z' },
  { id: 'field-free', name: '自由メモ', createdAt: '2025-01-01T00:00:00.000Z' }
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let state = loadState();
let currentEntryId = null;
let selectedFieldIds = new Set();
let editingFieldId = null;
let confirmAction = null;
let toastTimer = null;

function createId(prefix = 'id') {
  if (window.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function initialState() {
  return { version: DATA_VERSION, fields: DEFAULT_FIELDS.map(field => ({ ...field })), entries: [] };
}

function normalizeState(candidate) {
  if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.fields) || !Array.isArray(candidate.entries)) {
    throw new Error('バックアップの形式が正しくありません。');
  }

  const fields = candidate.fields
    .filter(field => field && typeof field.id === 'string' && typeof field.name === 'string')
    .map(field => ({
      id: field.id.slice(0, 100),
      name: field.name.trim().slice(0, 30),
      createdAt: typeof field.createdAt === 'string' ? field.createdAt : new Date().toISOString()
    }))
    .filter(field => field.name.length > 0);

  const entries = candidate.entries
    .filter(entry => entry && typeof entry.id === 'string' && isValidDateString(entry.date) && entry.values && typeof entry.values === 'object' && !Array.isArray(entry.values))
    .map(entry => {
      const values = {};
      for (const [key, item] of Object.entries(entry.values)) {
        if (!item || typeof item !== 'object' || typeof item.label !== 'string' || typeof item.value !== 'string') continue;
        values[key.slice(0, 100)] = { label: item.label.slice(0, 100), value: item.value.slice(0, 50000) };
      }
      return {
        id: entry.id.slice(0, 100),
        date: entry.date,
        values,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString()
      };
    });

  return { version: DATA_VERSION, fields, entries };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState();
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.error('日記データの読み込みに失敗しました:', error);
    return initialState();
  }
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateStats();
    return true;
  } catch (error) {
    console.error('日記データの保存に失敗しました:', error);
    showToast('保存できませんでした。空き容量を確認してください。');
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

function updateStats() {
  $('#total-entry-count').textContent = String(state.entries.length);
  $('#total-field-count').textContent = String(state.fields.length);
}

function navigate(viewName) {
  const validViews = ['write', 'archive', 'settings'];
  if (!validViews.includes(viewName)) return;
  $$('.view').forEach(view => {
    const active = view.id === `view-${viewName}`;
    view.classList.toggle('is-visible', active);
    view.hidden = !active;
  });
  $$('.nav-button').forEach(button => {
    const active = button.dataset.view === viewName;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (viewName === 'archive') renderArchive();
  if (viewName === 'settings') renderSettings();
  window.location.hash = viewName;
}

function getCurrentEntry() {
  return state.entries.find(entry => entry.id === currentEntryId) || null;
}

function getEditorFields() {
  const active = state.fields.map(field => ({ ...field, historical: false }));
  const current = getCurrentEntry();
  if (!current) return active;
  const activeIds = new Set(active.map(field => field.id));
  const historical = Object.entries(current.values)
    .filter(([id]) => !activeIds.has(id))
    .map(([id, item]) => ({ id, name: item.label, historical: true }));
  return [...active, ...historical];
}

function renderFieldPicker() {
  const picker = $('#field-picker');
  picker.replaceChildren();
  const fields = getEditorFields();

  if (fields.length === 0) {
    const message = document.createElement('p');
    message.className = 'editor-empty';
    message.textContent = '項目がありません。「項目設定」から項目を追加してください。';
    picker.append(message);
    renderEditorFields();
    return;
  }

  fields.forEach(field => {
    const label = document.createElement('label');
    label.className = 'field-choice';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = field.id;
    input.checked = selectedFieldIds.has(field.id);
    input.addEventListener('change', () => {
      if (input.checked) selectedFieldIds.add(field.id);
      else selectedFieldIds.delete(field.id);
      renderEditorFields();
    });
    const text = document.createElement('span');
    text.textContent = field.name + (field.historical ? '（過去の項目）' : '');
    label.append(input, text);
    picker.append(label);
  });
  renderEditorFields();
}

function renderEditorFields() {
  const container = $('#editor-fields');
  container.replaceChildren();
  const fields = getEditorFields().filter(field => selectedFieldIds.has(field.id));
  const current = getCurrentEntry();

  $('#selected-count').textContent = `${fields.length} 項目`;
  $('#editor-hint').textContent = fields.length ? '書ける範囲で自由に記録してください。' : '項目を選ぶと入力欄がここに表示されます。';
  $('#save-entry').disabled = fields.length === 0;

  if (fields.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'editor-empty';
    empty.textContent = '上の項目から、今日書きたいものを選んでください。';
    container.append(empty);
    return;
  }

  fields.forEach(field => {
    const card = document.createElement('div');
    card.className = 'editor-card';
    const label = document.createElement('label');
    const textarea = document.createElement('textarea');
    const inputId = `editor-${field.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    label.htmlFor = inputId;
    label.textContent = field.name;
    textarea.id = inputId;
    textarea.dataset.fieldId = field.id;
    textarea.rows = 4;
    textarea.placeholder = `${field.name}について、自由に書いてみましょう。`;
    textarea.value = current?.values?.[field.id]?.value || '';
    card.append(label, textarea);
    container.append(card);
  });
}

function startNewEntry() {
  currentEntryId = null;
  selectedFieldIds = new Set();
  $('#editor-heading').textContent = '今日の記録';
  $('#entry-date').value = localDateString();
  $('#save-entry').innerHTML = '日記を保存する <span aria-hidden="true">→</span>';
  $('#save-message').textContent = '日記はこのブラウザ内に保存されます。';
  renderFieldPicker();
}

function editEntry(entryId) {
  const entry = state.entries.find(item => item.id === entryId);
  if (!entry) return;
  currentEntryId = entry.id;
  selectedFieldIds = new Set(Object.keys(entry.values));
  $('#editor-heading').textContent = '日記を編集';
  $('#entry-date').value = entry.date;
  $('#save-entry').innerHTML = '変更を保存する <span aria-hidden="true">→</span>';
  $('#save-message').textContent = '過去の日記を編集中です。';
  renderFieldPicker();
  navigate('write');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function saveEntry() {
  const date = $('#entry-date').value;
  if (!isValidDateString(date)) {
    showToast('有効な日付を入力してください。');
    return;
  }
  const selectedFields = getEditorFields().filter(field => selectedFieldIds.has(field.id));
  if (selectedFields.length === 0) {
    showToast('書く項目を1つ以上選んでください。');
    return;
  }

  const current = getCurrentEntry();
  const values = current ? { ...current.values } : {};
  const visibleIds = new Set(getEditorFields().map(field => field.id));
  visibleIds.forEach(id => {
    if (!selectedFieldIds.has(id)) delete values[id];
  });

  selectedFields.forEach(field => {
    const textarea = $(`textarea[data-field-id="${CSS.escape(field.id)}"]`);
    values[field.id] = { label: field.name, value: textarea ? textarea.value.trim() : '' };
  });

  const now = new Date().toISOString();
  if (current) {
    current.date = date;
    current.values = values;
    current.updatedAt = now;
  } else {
    state.entries.push({ id: createId('entry'), date, values, createdAt: now, updatedAt: now });
  }

  if (!persistState()) return;
  showToast(current ? '日記を更新しました。' : '日記を保存しました。');
  startNewEntry();
  renderArchive();
}

function formatDate(dateString, options = {}) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', ...options }).format(date);
}

function getEntrySearchText(entry) {
  return [entry.date, ...Object.values(entry.values).flatMap(item => [item.label, item.value])].join(' ').toLowerCase();
}

function renderArchive() {
  const list = $('#entry-list');
  const search = $('#archive-search').value.trim().toLowerCase();
  list.replaceChildren();
  const entries = [...state.entries]
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))
    .filter(entry => !search || getEntrySearchText(entry).includes(search));

  $('#archive-count').textContent = String(state.entries.length);
  $('#archive-empty').hidden = entries.length !== 0;
  list.hidden = entries.length === 0;

  entries.forEach(entry => {
    const article = document.createElement('article');
    article.className = 'entry-card';
    const date = document.createElement('div');
    date.className = 'entry-date';
    date.textContent = formatDate(entry.date, { year: 'numeric', month: 'short', day: 'numeric' });
    const dateSmall = document.createElement('small');
    dateSmall.textContent = `${Object.keys(entry.values).length} 項目を記録`;
    date.append(dateSmall);

    const content = document.createElement('div');
    content.className = 'entry-content';
    const heading = document.createElement('h3');
    heading.textContent = '日々の記録';
    const preview = document.createElement('div');
    preview.className = 'entry-preview';
    Object.values(entry.values).forEach(item => {
      const chip = document.createElement('span');
      const shortText = item.value.replace(/\s+/g, ' ').trim();
      chip.textContent = shortText ? `${item.label}：${shortText}` : item.label;
      chip.title = chip.textContent;
      preview.append(chip);
    });
    content.append(heading, preview);

    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'small-action';
    edit.textContent = '編集';
    edit.addEventListener('click', () => editEntry(entry.id));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'small-action delete';
    remove.textContent = '削除';
    remove.addEventListener('click', () => askConfirm('この日記を削除しますか？削除した日記は元に戻せません。', '削除する', () => {
      state.entries = state.entries.filter(item => item.id !== entry.id);
      persistState();
      renderArchive();
      showToast('日記を削除しました。');
    }));
    actions.append(edit, remove);
    article.append(date, content, actions);
    list.append(article);
  });
}

function renderSettings() {
  const list = $('#settings-field-list');
  list.replaceChildren();
  $('#settings-empty').hidden = state.fields.length > 0;
  state.fields.forEach(field => {
    const row = document.createElement('div');
    row.className = 'settings-field-row';
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'settings-field-name';
    name.textContent = field.name;
    const meta = document.createElement('div');
    meta.className = 'settings-field-meta';
    const usedCount = state.entries.filter(entry => Object.prototype.hasOwnProperty.call(entry.values, field.id)).length;
    meta.textContent = `${usedCount} 件の日記で使用`;
    info.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'settings-field-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'small-action';
    edit.textContent = '編集';
    edit.addEventListener('click', () => openFieldDialog(field));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'small-action delete';
    remove.textContent = '削除';
    remove.addEventListener('click', () => askConfirm(`「${field.name}」を項目一覧から削除しますか？過去の日記の内容は残ります。`, '削除する', () => {
      state.fields = state.fields.filter(item => item.id !== field.id);
      selectedFieldIds.delete(field.id);
      persistState();
      renderSettings();
      renderFieldPicker();
      showToast('項目を削除しました。');
    }));
    actions.append(edit, remove);
    row.append(info, actions);
    list.append(row);
  });
}

function openFieldDialog(field = null) {
  editingFieldId = field?.id || null;
  $('#field-dialog-title').textContent = field ? '項目を編集' : '項目を追加';
  $('#field-name').value = field?.name || '';
  $('#submit-field').textContent = field ? '変更を保存' : '追加する';
  $('#field-dialog').showModal();
  $('#field-name').focus();
}

function closeFieldDialog() {
  $('#field-dialog').close();
  editingFieldId = null;
  $('#field-form').reset();
}

function saveField(event) {
  event.preventDefault();
  const wasEditing = Boolean(editingFieldId);
  const name = $('#field-name').value.trim();
  if (!name) return;
  const duplicate = state.fields.find(field => field.name.toLowerCase() === name.toLowerCase() && field.id !== editingFieldId);
  if (duplicate) {
    showToast('同じ名前の項目がすでにあります。');
    return;
  }
  if (editingFieldId) {
    const field = state.fields.find(item => item.id === editingFieldId);
    if (field) field.name = name;
  } else {
    state.fields.push({ id: createId('field'), name, createdAt: new Date().toISOString() });
  }
  persistState();
  closeFieldDialog();
  renderSettings();
  renderFieldPicker();
  showToast(wasEditing ? '項目を更新しました。' : '項目を追加しました。');
}

function askConfirm(message, confirmLabel, action) {
  $('#confirm-message').textContent = message;
  $('#confirm-accept').textContent = confirmLabel;
  confirmAction = action;
  $('#confirm-dialog').showModal();
}

function exportBackup() {
  const payload = {
    app: 'ずぼら日記',
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    fields: state.fields,
    entries: state.entries
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `zubora-diary-backup-${localDateString()}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast('バックアップを書き出しました。');
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const normalized = normalizeState(parsed);
    if (!window.confirm(`バックアップ内の日記 ${normalized.entries.length} 件、項目 ${normalized.fields.length} 件で現在のデータを置き換えます。よろしいですか？`)) {
      event.target.value = '';
      return;
    }
    state = normalized;
    if (!persistState()) return;
    startNewEntry();
    renderSettings();
    renderArchive();
    showToast('バックアップを読み込みました。');
  } catch (error) {
    console.error('バックアップの読み込みに失敗しました:', error);
    showToast(error instanceof SyntaxError ? 'JSONファイルを読み取れませんでした。' : (error.message || '読み込みに失敗しました。'));
  } finally {
    event.target.value = '';
  }
}

function bindEvents() {
  $$('.nav-button').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
  $$('[data-go-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.goView)));
  $('#save-entry').addEventListener('click', saveEntry);
  $('#clear-selection').addEventListener('click', () => {
    selectedFieldIds.clear();
    renderFieldPicker();
  });
  $('#reset-editor').addEventListener('click', () => {
    if (currentEntryId) editEntry(currentEntryId);
    else startNewEntry();
  });
  $('#add-field').addEventListener('click', () => openFieldDialog());
  $('#field-form').addEventListener('submit', saveField);
  $('#close-field-dialog').addEventListener('click', closeFieldDialog);
  $('#cancel-field-dialog').addEventListener('click', closeFieldDialog);
  $('#archive-search').addEventListener('input', renderArchive);
  $('#export-data').addEventListener('click', exportBackup);
  $('#import-file').addEventListener('change', importBackup);
  $('#confirm-dialog').addEventListener('close', () => {
    if ($('#confirm-dialog').returnValue === 'confirm' && confirmAction) confirmAction();
    confirmAction = null;
  });
  $('#entry-date').value = localDateString();
}

function init() {
  bindEvents();
  updateStats();
  startNewEntry();
  const initialView = window.location.hash.replace('#', '');
  if (['write', 'archive', 'settings'].includes(initialView)) navigate(initialView);
}

init();

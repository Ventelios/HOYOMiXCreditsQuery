/* ==========================================================================
   HOYO-MiX 歌曲数据库查询 —— 前端逻辑
   纯原生 JS，无构建步骤、无框架。

   核心口径：**不做任何多值拆分**。
   「张三、李四」或「A/B」整串是一个不可分割的选项，只有勾选完整文本才命中该行。
   同一个筛选面板内多选 = OR；不同筛选面板之间 = AND。
   ========================================================================== */

'use strict';

/* ---------------------------------------------------------------- 常量 */

// 四个固定筛选项。key 必须与 config.json 里 column_roles 的键一致。
// mode: 'search' = 上一版的「框内输入关键词搜索」下拉（单选，适合曲名这种超长列表）
//       'panel'  = Excel 式多选筛选面板
const ROLE_DEFS = [
  { key: 'title',    label: '曲名', mode: 'search' },
  { key: 'album',    label: '专辑', mode: 'panel' },
  { key: 'composer', label: '作曲', mode: 'panel' },
  { key: 'arranger', label: '编曲', mode: 'panel' },
];

const SEARCH_PLACEHOLDER = '搜包含任一关键字';
const PAGE_SIZE = 50;   // 每条记录是一个独立的双列表格，一次渲染 50 条已不算少

/* ---------------------------------------------------------------- 状态 */

const state = {
  meta: null,
  rows: null,
  colIndex: {},
  filters: {},        // id -> 筛选器实例
  matched: [],
  shown: 0,
};

const MASK_CACHE = new Map();   // (列下标, 完整值) -> 命中行下标集合
let openPanel = null;           // 当前展开的筛选面板
let extraTom = null;            // 「其他表头」的列名下拉实例

/* ---------------------------------------------------------------- 工具 */

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (ch) {
    return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;';
  });
}

function num(n) { return Number(n).toLocaleString('zh-CN'); }
function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function icon(path) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" ' +
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
}

/* ==========================================================================
   筛选面板：Excel 式「搜索 + 多选 + 计数 + 确定/取消」
   ========================================================================== */

/**
 * 创建一个筛选器。
 * @param {string} id       唯一标识
 * @param {string} label    显示名
 * @param {string|null} column 对应列名；null 表示尚未选择列（按钮禁用）
 * @param {Array|null} options [[选项文本, 全库计数], ...]
 * @param {Function} onCommit 点「确定」后的回调
 */
function createFilter(id, label, column, options, onCommit) {
  let applied = new Set();          // 已生效的勾选
  let draft = new Set();            // 面板内正在编辑的勾选
  let built = false;
  let rows = [];                    // [{value, lower, cb, el}]
  let searchInput, selText, listEl, panelEl, buttonEl, hintEl;

  const wrap = document.createElement('div');
  wrap.className = 'fwrap';

  buttonEl = document.createElement('button');
  buttonEl.type = 'button';
  buttonEl.className = 'fbtn';
  buttonEl.setAttribute('aria-expanded', 'false');
  buttonEl.innerHTML =
    '<span class="fbtn-text"></span>' +
    '<span class="fbtn-tag" hidden></span>' +
    '<svg class="fbtn-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M6 9.5l6 6 6-6"/></svg>';
  wrap.appendChild(buttonEl);

  const api = { id: id, column: column, applied: applied, el: wrap, buttonEl: buttonEl };

  /* ---- 懒构建面板（选项多的列只建一次，之后靠 hidden 切换） */
  function build() {
    if (built) return;
    built = true;

    panelEl = document.createElement('div');
    panelEl.className = 'fp';
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', label + ' 筛选');
    panelEl.hidden = true;
    panelEl.innerHTML =
      '<div class="fp-search-wrap">' +
        icon('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>') +
        '<input class="fp-search" type="text" placeholder="' + SEARCH_PLACEHOLDER + '">' +
      '</div>' +
      '<div class="fp-tools">' +
        '<button type="button" data-act="all">全选</button>' +
        '<button type="button" data-act="inv">反选</button>' +
        '<button type="button" data-act="none">清空</button>' +
        '<span class="fp-sel"></span>' +
      '</div>' +
      '<div class="fp-list"></div>' +
      '<div class="fp-hint" hidden>没有匹配的选项</div>' +
      '<div class="fp-foot">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="cancel">取消</button>' +
        '<button type="button" class="btn btn-primary btn-sm" data-act="ok">确定</button>' +
      '</div>';

    searchInput = panelEl.querySelector('.fp-search');
    selText = panelEl.querySelector('.fp-sel');
    listEl = panelEl.querySelector('.fp-list');
    hintEl = panelEl.querySelector('.fp-hint');

    const frag = document.createDocumentFragment();
    rows = (options || []).map(function (pair) {
      const value = pair[0], count = pair[1];

      const rowEl = document.createElement('label');
      rowEl.className = 'fp-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';

      const textEl = document.createElement('span');
      textEl.className = 'fp-text';
      textEl.textContent = value;

      const nEl = document.createElement('span');
      nEl.className = 'fp-n';
      nEl.textContent = '(' + count + ')';

      rowEl.appendChild(cb);
      rowEl.appendChild(textEl);
      rowEl.appendChild(nEl);

      cb.addEventListener('change', function () {
        if (cb.checked) draft.add(value);
        else draft.delete(value);
        updateSelText();
      });

      frag.appendChild(rowEl);
      return { value: value, lower: String(value).toLowerCase(), cb: cb, el: rowEl };
    });
    listEl.appendChild(frag);

    searchInput.addEventListener('input', applySearch);
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });

    panelEl.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'ok') commit();
      else if (act === 'cancel') cancel();
      else if (act === 'all') bulk('all');
      else if (act === 'inv') bulk('inv');
      else if (act === 'none') bulk('none');
    });

    wrap.appendChild(panelEl);
  }

  /* ---- 搜索：只切换行的显示，不动勾选状态 ——
         所以搜索框清空后，之前勾选的项依然保持选中。 */
  function applySearch() {
    const raw = searchInput.value.trim().toLowerCase();
    const kws = raw ? raw.split(/\s+/).filter(Boolean) : null;
    let visible = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const show = !kws || kws.some(function (k) { return r.lower.indexOf(k) !== -1; });
      r.el.hidden = !show;
      if (show) visible++;
    }
    hintEl.hidden = visible > 0;
  }

  function syncAll() {
    for (let i = 0; i < rows.length; i++) rows[i].cb.checked = draft.has(rows[i].value);
  }

  function syncVisible() {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.el.hidden) r.cb.checked = draft.has(r.value);
    }
  }

  /** 全选 / 反选 只作用于「当前搜索出来的项」；清空则清空整个面板 */
  function bulk(act) {
    if (act === 'none') {
      draft = new Set();
      syncAll();
    } else {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.el.hidden) continue;
        if (act === 'all') draft.add(r.value);
        else if (draft.has(r.value)) draft.delete(r.value);
        else draft.add(r.value);
      }
      syncVisible();
    }
    updateSelText();
  }

  function updateSelText() {
    selText.textContent = '已选 ' + draft.size + ' 项';
  }

  function updateButton() {
    const textEl = buttonEl.querySelector('.fbtn-text');
    const tagEl = buttonEl.querySelector('.fbtn-tag');

    if (column === null) {
      textEl.textContent = '先选择列名';
      buttonEl.disabled = true;
      buttonEl.classList.remove('is-active');
      tagEl.hidden = true;
      return;
    }
    if (!options || !options.length) {
      textEl.textContent = '该列为空';
      buttonEl.disabled = true;
      buttonEl.classList.remove('is-active');
      tagEl.hidden = true;
      return;
    }
    buttonEl.disabled = false;
    if (applied.size === 0) {
      textEl.textContent = '全部';
      buttonEl.classList.remove('is-active');
      tagEl.hidden = true;
    } else {
      textEl.textContent = '已选 ' + applied.size + ' 项';
      buttonEl.classList.add('is-active');
      tagEl.textContent = applied.size;
      tagEl.hidden = false;
    }
  }

  /* ---- 位置：靠近视口右缘时改从右边对齐 */
  function place() {
    panelEl.classList.remove('fp-flip');
    const r = panelEl.getBoundingClientRect();
    if (r.right > document.documentElement.clientWidth - 12) {
      panelEl.classList.add('fp-flip');
    }
  }

  function open() {
    if (column === null || !options || !options.length) return;
    build();
    if (openPanel && openPanel !== api) openPanel.cancel();

    draft = new Set(applied);          // 每次打开都从「已生效」状态开始编辑
    searchInput.value = '';
    syncAll();
    applySearch();
    updateSelText();

    panelEl.hidden = false;            // 必须先显示，隐藏元素无法聚焦
    buttonEl.setAttribute('aria-expanded', 'true');
    place();
    openPanel = api;
    searchInput.focus();
  }

  /** discard=true 表示放弃本次修改（取消 / 点击别处 / 再次点击按钮） */
  function close(discard) {
    if (panelEl) panelEl.hidden = true;
    buttonEl.setAttribute('aria-expanded', 'false');
    if (discard) draft = new Set(applied);
    if (openPanel === api) openPanel = null;
  }

  function cancel() { close(true); }

  function commit() {
    applied = new Set(draft);
    api.applied = applied;
    close(false);
    updateButton();
    if (onCommit) onCommit();
  }

  /** 外部重置：清空已生效条件 */
  function reset() {
    applied = new Set();
    api.applied = applied;
    if (built) { draft = new Set(); syncAll(); }
    close(true);
    updateButton();
  }

  function destroy() {
    if (openPanel === api) openPanel = null;
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
  }

  buttonEl.addEventListener('click', function () {
    if (panelEl && !panelEl.hidden) cancel();
    else open();
  });

  api.open = open;
  api.cancel = cancel;
  api.reset = reset;
  api.destroy = destroy;
  api.isOpen = function () { return panelEl ? !panelEl.hidden : false; };

  updateButton();
  return api;
}

/* ==========================================================================
   单选搜索下拉：框内直接输入关键词搜索（曲名用这个，3015 个选项用面板太重）
   与 createFilter 暴露同一套接口（column / applied / reset / destroy / el），
   所以匹配逻辑完全不用区分类型。
   ========================================================================== */

function createSearchFilter(id, label, column, options, onCommit) {
  const applied = new Set();   // 0 或 1 个值；就地增删，保证引用不变

  const wrap = document.createElement('div');
  wrap.className = 'fwrap';

  const selEl = document.createElement('select');
  selEl.id = 'f-' + id;          // 与多选面板的命名保持一致，也便于 <label for> 关联
  selEl.setAttribute('aria-label', label);
  wrap.appendChild(selEl);

  const ts = new TomSelect(selEl, {
    maxOptions: 200,
    openOnFocus: true,
    placeholder: '全部（输入关键词搜索）',
    plugins: ['clear_button'],
    onChange: function (v) {
      applied.clear();
      if (v) applied.add(v);
      if (onCommit) onCommit();
    },
  });
  ts.addOptions((options || []).map(function (pair) {
    return { value: pair[0], text: pair[0] };   // 顺序照搬 meta（已按数量降序）
  }));
  ts.refreshOptions(false);

  const api = { id: id, column: column, applied: applied, el: wrap };

  api.reset = function () {
    ts.clear(true);          // 静默清空，避免触发多次 onCommit
    applied.clear();
  };
  api.destroy = function () {
    ts.destroy();
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
  };

  return api;
}

/* ---------------------------------------------------------------- 匹配 */

/** 某列等于某个完整值（不做任何拆分）的命中行集合 */
function maskFor(colIdx, value) {
  const key = colIdx + '\u0000' + value;
  const cached = MASK_CACHE.get(key);
  if (cached) return cached;

  const set = new Set();
  const rows = state.rows;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][colIdx] === value) set.add(i);
  }
  MASK_CACHE.set(key, set);
  return set;
}

function computeMatched() {
  const total = state.rows.length;

  // 每个生效的筛选面板算一个条件；同一面板内多选取并集（OR），面板之间取交集（AND）
  const crit = [];
  Object.keys(state.filters).forEach(function (id) {
    const f = state.filters[id];
    if (!f.column || !f.applied.size) return;
    const ci = state.colIndex[f.column];
    if (ci === undefined) return;
    crit.push({ ci: ci, values: f.applied });
  });

  if (!crit.length) {
    state.matched = new Array(total);
    for (let i = 0; i < total; i++) state.matched[i] = i;
    return;
  }

  let acc = null;
  for (let k = 0; k < crit.length; k++) {
    const c = crit[k];
    const union = new Set();
    c.values.forEach(function (v) {
      maskFor(c.ci, v).forEach(function (i) { union.add(i); });
    });
    if (acc === null) {
      acc = union;
    } else {
      const next = new Set();
      acc.forEach(function (i) { if (union.has(i)) next.add(i); });
      acc = next;
    }
    if (!acc.size) break;
  }

  const out = [];
  acc.forEach(function (i) { out.push(i); });
  out.sort(function (a, b) { return a - b; });   // 保持 Excel 里的原始行序
  state.matched = out;
}

/* ---------------------------------------------------------------- 渲染 */

function chipSVG(path) { return icon(path); }

function renderChips() {
  const m = state.meta;
  let timeText = m.generatedAt || '';
  const t = String(m.generatedAt || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (t) timeText = t[1] + '-' + t[2] + '-' + t[3] + ' ' + t[4] + ':' + t[5];

  $('meta-chips').innerHTML =
    '<span class="chip">' + chipSVG('<path d="M4 6h16M4 12h16M4 18h16"/>') +
      '记录 <b>' + num(m.rowCount) + ' 行</b></span>' +
    '<span class="chip">' + chipSVG('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/>' +
      '<path d="M3.5 9.5h17M10 9.5v10"/>') + '字段 <b>' + num(m.columnCount) + ' 列</b></span>' +
    '<span class="chip">' + chipSVG('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>') +
      '更新 <b>' + esc(timeText) + '</b></span>';
}

function renderWarnings() {
  const box = $('filter-warnings');
  const m = state.meta;
  const items = [];

  const missing = ROLE_DEFS.filter(function (d) { return !m.roles[d.key]; })
                           .map(function (d) { return d.label; });
  if (missing.length) {
    items.push('这些筛选项在数据里找不到对应列，已隐藏：<b>' + esc(missing.join(' / ')) +
               '</b>。请修改 <code>song-db-web/config.json</code> 里的 <code>column_roles</code>。');
  }
  if (m.droppedEmptyColumns && m.droppedEmptyColumns.length) {
    items.push('有 <b>' + m.droppedEmptyColumns.length + '</b> 列在当前数据里整列为空，已忽略。');
  }

  if (m.warnings && m.warnings.length && window.console) {
    console.groupCollapsed('[歌曲数据库] 构建期提示 ' + m.warnings.length + ' 条');
    m.warnings.forEach(function (w) { console.warn(w); });
    console.groupEnd();
  }

  if (!items.length) { box.hidden = true; return; }
  box.innerHTML = items.map(function (s) { return '<div>' + s + '</div>'; }).join('');
  box.hidden = false;
}

function renderStatbar() {
  const total = state.matched.length;
  $('stat-count').innerHTML = '匹配 <b>' + num(total) + '</b> 条';
  $('stat-sub').textContent = total
    ? '已显示 ' + num(state.shown) + ' 条 · 全库共 ' + num(state.rows.length) + ' 条'
    : '';
}

/** 每条记录一个「表头 | 结果」双列表格，只输出有值的字段 */
function renderRecords(from, count, append) {
  const idx = state.matched;
  const end = Math.min(from + count, idx.length);
  const cols = state.meta.columns;
  const rows = state.rows;
  const parts = [];

  for (let r = from; r < end; r++) {
    const row = rows[idx[r]];
    let body = '';
    for (let c = 0; c < cols.length; c++) {
      const v = row[c];
      if (!v) continue;                    // 只显示有结果的表头
      body += '<tr><th scope="row">' + esc(cols[c]) + '</th><td>' + esc(v) + '</td></tr>';
    }
    parts.push('<article class="rec"><table><tbody>' + body + '</tbody></table></article>');
  }

  const host = $('records');
  if (append) host.insertAdjacentHTML('beforeend', parts.join(''));
  else host.innerHTML = parts.join('');

  state.shown = end;
}

function renderFooter() {
  const total = state.matched.length;
  const foot = $('list-foot');
  if (!total) { foot.hidden = true; return; }

  foot.hidden = false;
  const btn = $('btn-more');
  if (state.shown < total) {
    btn.hidden = false;
    btn.disabled = false;
    btn.textContent = '加载更多（还有 ' + num(total - state.shown) + ' 条）';
    $('foot-hint').textContent = '已显示前 ' + num(state.shown) + ' 条，共 ' + num(total) + ' 条';
  } else {
    btn.hidden = true;
    $('foot-hint').textContent = '已显示全部 ' + num(total) + ' 条';
  }
}

function refresh() {
  computeMatched();

  const empty = $('empty-state');
  if (!state.matched.length) {
    $('records').innerHTML = '';
    $('list-foot').hidden = true;
    empty.hidden = false;
    state.shown = 0;
    renderStatbar();
    return;
  }

  empty.hidden = true;
  renderRecords(0, PAGE_SIZE, false);
  renderStatbar();
  renderFooter();
}

/* ---------------------------------------------------------------- 筛选器搭建 */

function buildFilters() {
  const m = state.meta;

  // ---- 四个固定筛选项：曲名用框内搜索下拉，其余用 Excel 式多选面板
  const host = $('role-filters');
  host.innerHTML = '';
  ROLE_DEFS.forEach(function (def) {
    const col = m.roles[def.key] || null;

    const field = document.createElement('div');
    field.className = 'field';

    const label = document.createElement('label');
    label.textContent = def.label;
    if (def.mode === 'search') label.setAttribute('for', 'f-' + def.key);
    field.appendChild(label);

    const opts = col ? m.options[col] : null;
    const f = def.mode === 'search'
      ? createSearchFilter(def.key, def.label, col, opts, refresh)
      : createFilter(def.key, def.label, col, opts, refresh);

    field.appendChild(f.el);
    field.hidden = (col === null);   // 找不到列时整项隐藏（顶部已有提示）
    host.appendChild(field);

    state.filters[def.key] = f;
  });

  // ---- 「其他表头」：先选列名（可搜索下拉），再打开该列的筛选面板
  if (extraTom) { extraTom.destroy(); extraTom = null; }
  const sel = $('f-extra-col');
  // 不要往 select 里塞空的 <option>：tom-select 会把它当成一个「已选中项」渲染出来，
  // 那个空 item 会把输入框挤到只剩 min-width，导致 placeholder 看不见。
  sel.innerHTML = '';

  const usableCols = m.columns.filter(function (c) {
    return m.options[c] && m.options[c].length;
  });

  extraTom = new TomSelect(sel, {
    maxOptions: 200,
    openOnFocus: true,
    placeholder: '选择列名（可输入搜索）',
    plugins: ['clear_button'],        // 自带一个 × 让用户清空选择
    onChange: function (v) { setExtraColumn(v || ''); },
  });
  extraTom.addOptions(usableCols.map(function (c) { return { value: c, text: c }; }));
  extraTom.refreshOptions(false);

  // 占位筛选器：还没选列名时按钮禁用
  let extra = createFilter('extra', '其他表头', null, null, refresh);
  $('extra-val-slot').appendChild(extra.el);
  state.filters.extra = extra;

  function setExtraColumn(colName) {
    extra.destroy();
    extra = createFilter('extra', '其他表头', colName || null,
                         colName ? m.options[colName] : null, refresh);
    $('extra-val-slot').appendChild(extra.el);
    state.filters.extra = extra;
    refresh();
  }
}

/* ---------------------------------------------------------------- CSV 导出 */

function csvCell(v) {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function exportCSV() {
  const idx = state.matched;
  if (!idx.length) return;

  const btn = $('btn-csv');
  const btnHTML = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = '正在导出…';

  // 让按钮状态先渲染出来，再做可能耗时的字符串拼接
  setTimeout(function () {
    try {
      const cols = state.meta.columns;
      const lines = [cols.map(csvCell).join(',')];

      const buf = [];
      for (let r = 0; r < idx.length; r++) {
        const row = state.rows[idx[r]];
        buf.length = 0;
        for (let c = 0; c < cols.length; c++) buf.push(csvCell(row[c]));
        lines.push(buf.join(','));
      }

      // \ufeff 是 UTF-8 BOM，Excel 靠它识别编码，否则中文会乱码
      const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });

      const d = new Date();
      const stamp = '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
                    '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'HoYoMiX_SongDB_' + idx.length + 'rows_' + stamp + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    } catch (err) {
      window.alert('导出失败：' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = btnHTML;
    }
  }, 30);
}

/* ---------------------------------------------------------------- 加载 */

function showLoading(title, sub) {
  $('error-panel').hidden = true;
  $('loading-title').textContent = title || '正在加载数据';
  $('loading-sub').textContent = sub || '首次打开需要下载几 MB 数据，请稍候…';
  $('loading').hidden = false;
}

function hideLoading() { $('loading').hidden = true; }

function showError(err) {
  hideLoading();
  let msg = err && err.message ? err.message : String(err);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    msg += '\n\n常见原因：\n' +
           '1. data/ 目录下的 JSON 不存在 —— 检查 GitHub Actions 构建有没有成功；\n' +
           '2. 用 file:// 直接双击打开 index.html 会被浏览器的同源策略拦截，' +
           '请通过 http(s) 访问（GitHub Pages 或本地 python -m http.server）。';
  }
  $('error-msg').textContent = msg;
  $('error-panel').hidden = false;
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('请求失败 HTTP ' + res.status + ' ' + res.statusText + '\n地址：' + url +
                    '\n\n如果是 404，说明 data 目录还没生成：请先运行\n' +
                    'python song-db-web/scripts/excel_to_json.py');
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('返回的不是合法 JSON（' + url + '）。\n' + e.message);
  }
}

async function load() {
  showLoading();
  try {
    showLoading('正在加载数据', '读取字段结构与筛选项…');
    const meta = await fetchJSON('data/meta.json');
    state.meta = meta;

    state.colIndex = {};
    meta.columns.forEach(function (c, i) { state.colIndex[c] = i; });

    showLoading('正在加载数据',
      '读取 ' + num(meta.rowCount) + ' 行记录（约 3 MB，仅首次较慢）…');
    const bust = encodeURIComponent(String(meta.generatedAt || ''));
    const rows = await fetchJSON('data/rows.json' + (bust ? '?v=' + bust : ''));

    if (!Array.isArray(rows)) throw new Error('rows.json 结构不正确：期望二维数组');
    if (meta.rowCount && rows.length !== meta.rowCount) {
      throw new Error('数据不一致：meta.json 说有 ' + meta.rowCount + ' 行，rows.json 实际 ' +
                      rows.length + ' 行。请重新运行构建。');
    }
    state.rows = rows;

    MASK_CACHE.clear();
    Object.keys(state.filters).forEach(function (id) { state.filters[id].destroy(); });
    state.filters = {};

    renderChips();
    renderWarnings();
    buildFilters();
    refresh();

    hideLoading();
  } catch (err) {
    if (window.console) console.error(err);
    showError(err);
  }
}

/* ---------------------------------------------------------------- 事件 */

function bindEvents() {
  $('btn-reset').addEventListener('click', function () {
    Object.keys(state.filters).forEach(function (id) { state.filters[id].reset(); });
    refresh();
  });

  $('btn-refresh').addEventListener('click', function () {
    MASK_CACHE.clear();
    load();
  });

  $('btn-retry').addEventListener('click', function () {
    MASK_CACHE.clear();
    load();
  });

  $('btn-more').addEventListener('click', function () {
    renderRecords(state.shown, PAGE_SIZE, true);
    renderStatbar();
    renderFooter();
  });

  $('btn-csv').addEventListener('click', exportCSV);

  // 点击面板以外的地方 = 取消（不生效），符合「只有点确定才应用」的规则
  document.addEventListener('mousedown', function (e) {
    if (openPanel && !openPanel.el.contains(e.target)) openPanel.cancel();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openPanel) openPanel.cancel();
  });
}

/* ---------------------------------------------------------------- 启动 */

document.addEventListener('DOMContentLoaded', function () {
  bindEvents();
  load();
});

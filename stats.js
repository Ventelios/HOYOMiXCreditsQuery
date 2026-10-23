/* ==========================================================================
   HOYO-MiX 歌曲数据库 —— 统计与排名页
   纯原生 JS，无框架、无图表库（图表用 CSS 条形绘制）。

   统计口径与 ../../../build_analysis.py（Excel「数据分析」表）保持一致：
     按分隔符拆分署名 → 去掉 (HOYO-MiX) 后缀 → 中英文之间补空格
     → 同一曲目内去重 → 跨曲目累加
   注意：筛选器那边是「整格为一个不可分割的选项」，与这里的拆分不冲突，
   因为筛选要的是完整文本，统计要的是归到人。
   ========================================================================== */

'use strict';

const TOP_ROLE = 12;    // 单角色榜单条数
const TOP_AGG = 20;     // 跨角色榜单条数

const HOYO_RE = /\(\s*HOYO-MiX\s*\)/gi;
// 中文 <-> 拉丁字母/数字 的紧邻边界（与 build_analysis 的正则完全一致）
const SPACING_RE = /(?<=[\u4e00-\u9fff])(?=[0-9A-Za-z])|(?<=[0-9A-Za-z])(?=[\u4e00-\u9fff])/g;

const state = {
  meta: null,
  rows: null,
  colIndex: {},
  roles: [],        // [{label, columns:[列名...], filled}]
  sepRe: null,
  sel: 0,           // 当前选中的角色下标
  perRole: [],      // [{name -> {songs, solo}}]
  agg: null,        // name -> {songs, roles:Set}
  histo: null,      // 每首署名人数 -> 曲目数
};

const TOK_CACHE = new Map();

/* ---------------------------------------------------------------- 工具 */

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (ch) {
    return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;';
  });
}

function num(n) { return Number(n).toLocaleString('zh-CN'); }

function pct(part, whole) {
  if (!whole) return '0%';
  const v = part / whole * 100;
  return (v >= 10 ? v.toFixed(1) : v.toFixed(2)) + '%';
}

function icon(path) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" ' +
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
}

/** 与前端筛选器一致的排序：曲目数降序，并列时按姓名（中文用拼音序） */
function cmpRank(a, b, valueOf) {
  const d = valueOf(b) - valueOf(a);
  if (d) return d;
  return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
}

/* ---------------------------------------------------------------- 分词 */

function buildSeparatorRe(seps) {
  if (!seps || !seps.length) return null;
  const singles = [];
  const multis = [];
  seps.forEach(function (s) {
    if (!s) return;
    if (s.length === 1) singles.push('\\' + s);
    else multis.push(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  });
  const out = [];
  if (singles.length) out.push('[' + singles.join('') + ']');
  if (multis.length) out.push(multis.join('|'));
  return out.length ? new RegExp(out.join('|')) : null;
}

const EMPTY = [];

/**
 * 单元格 -> 归一化后的署名数组（同一格内已去重）。
 * 结果按单元格文本缓存，3020 行里大量重复值，只算一次。
 */
function tokensOf(cell) {
  if (!cell) return EMPTY;
  const hit = TOK_CACHE.get(cell);
  if (hit) return hit;

  const parts = state.sepRe ? cell.split(state.sepRe) : [cell];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i]
      .replace(HOYO_RE, '')
      .replace(SPACING_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  TOK_CACHE.set(cell, out);
  return out;
}

/* ---------------------------------------------------------------- 计算 */

function compute() {
  const roles = state.roles;
  const rows = state.rows;
  const n = roles.length;
  // 一个角色可能由多列合并而成，所以每个角色对应一组列下标
  const ci = roles.map(function (r) {
    return r.columns.map(function (c) { return state.colIndex[c]; });
  });

  const perRole = [];
  for (let k = 0; k < n; k++) perRole.push(new Map());
  const agg = new Map();
  const histo = new Map();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const seenRow = new Set();   // 本曲目内已出现的人（用于跨角色去重）

    for (let k = 0; k < n; k++) {
      const cols = ci[k];
      let toks;

      if (cols.length === 1) {
        toks = tokensOf(row[cols[0]]);
      } else {
        // 合并角色：把这些列在同一曲目里的署名取并集、再去重
        const set = new Set();
        toks = [];
        for (let c = 0; c < cols.length; c++) {
          const t = tokensOf(row[cols[c]]);
          for (let j = 0; j < t.length; j++) {
            if (!set.has(t[j])) { set.add(t[j]); toks.push(t[j]); }
          }
        }
      }
      if (!toks.length) continue;

      const solo = toks.length === 1;    // 该角色只有他一人署名 = 独作
      const map = perRole[k];

      for (let j = 0; j < toks.length; j++) {
        const name = toks[j];

        let e = map.get(name);
        if (!e) { e = { songs: 0, solo: 0 }; map.set(name, e); }
        e.songs++;
        if (solo) e.solo++;

        let a = agg.get(name);
        if (!a) { a = { songs: 0, roles: new Set() }; agg.set(name, a); }
        a.roles.add(k);
        if (!seenRow.has(name)) { seenRow.add(name); a.songs++; }
      }
    }

    const cnt = seenRow.size;
    histo.set(cnt, (histo.get(cnt) || 0) + 1);
  }

  state.perRole = perRole;
  state.agg = agg;
  state.histo = histo;
}

/**
 * 直方图分箱。
 * 直方图的横轴必须连续，所以空区间也要占一列（计数为 0），否则间距会失真。
 */
function binHisto(histo, maxCols) {
  const keys = [];
  histo.forEach(function (_v, k) { keys.push(k); });
  if (!keys.length) return [];
  keys.sort(function (a, b) { return a - b; });

  const min = keys[0];
  const max = keys[keys.length - 1];
  const span = max - min + 1;

  // 跨度不大：每个整数一列
  if (span <= maxCols) {
    const out = [];
    for (let v = min; v <= max; v++) {
      out.push({ label: String(v), count: histo.get(v) || 0 });
    }
    return out;
  }

  // 跨度太大：合并成区间，同样补齐空区间
  const w = Math.ceil(span / maxCols);
  const out = [];
  for (let from = min; from <= max; from += w) {
    const to = Math.min(from + w - 1, max);
    let count = 0;
    for (let v = from; v <= to; v++) count += histo.get(v) || 0;
    out.push({ from: from, label: from === to ? String(from) : from + '-' + to, count: count });
  }
  return out;
}

/* ---------------------------------------------------------------- 渲染 */

function renderChips() {
  const m = state.meta;
  let timeText = m.generatedAt || '';
  const t = String(m.generatedAt || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (t) timeText = t[1] + '-' + t[2] + '-' + t[3] + ' ' + t[4] + ':' + t[5];

  $('meta-chips').innerHTML =
    '<span class="chip">' + icon('<path d="M4 6h16M4 12h16M4 18h16"/>') +
      '记录 <b>' + num(m.rowCount) + ' 行</b></span>' +
    '<span class="chip">' + icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/>' +
      '<path d="M3.5 9.5h17M10 9.5v10"/>') + '字段 <b>' + num(m.columnCount) + ' 列</b></span>' +
    '<span class="chip">' + icon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>') +
      '更新 <b>' + esc(timeText) + '</b></span>';
}

/**
 * 横向条形图通用渲染。
 * items: [{name, value, text, tag}]；maxValue 用于固定分母（不传则用榜首值）
 */
function renderBars(host, items, maxValue) {
  if (!items.length) { host.innerHTML = '<p class="chart-foot">没有可统计的数据</p>'; return; }
  const max = maxValue || items[0].value || 1;
  const html = items.map(function (it, i) {
    const w = (it.value / max * 100).toFixed(2);
    return '<div class="bar-row">' +
      '<span class="bar-idx">' + (i + 1) + '</span>' +
      '<span class="bar-name" title="' + esc(it.name) + '">' + esc(it.name) + '</span>' +
      '<span class="bar-track"><i class="bar-fill" style="width:' + w + '%"></i></span>' +
      '<span class="bar-val">' + esc(it.text) + '</span>' +
      '<span class="bar-tag" title="' + esc(it.tag || '') + '">' + esc(it.tag || '') + '</span>' +
    '</div>';
  });
  host.innerHTML = html.join('');
}

function renderRoleTabs() {
  $('role-tabs').innerHTML = state.roles.map(function (r, i) {
    return '<button type="button" class="role-tab" role="tab" data-i="' + i + '"' +
      ' aria-selected="' + (i === state.sel ? 'true' : 'false') + '">' +
      esc(r.label) + '<span class="tab-n">' + state.perRole[i].size + '</span></button>';
  }).join('');
}

function renderRoleChart() {
  const k = state.sel;
  const role = state.roles[k];
  const map = state.perRole[k];

  const arr = [];
  map.forEach(function (v, name) { arr.push({ name: name, v: v }); });
  arr.sort(function (a, b) { return cmpRank(a, b, function (x) { return x.v.songs; }); });

  const items = arr.slice(0, TOP_ROLE).map(function (x) {
    return {
      name: x.name,
      value: x.v.songs,
      text: num(x.v.songs),
      tag: '独作 ' + num(x.v.solo),
    };
  });

  // 合并角色在标题右侧说明来源：列多时只列前两列 + 总数，完整清单放 title 里
  const cols = role.columns;
  $('role-note').textContent = cols.length === 1 ? cols[0]
    : cols.length === 2 ? cols.join(' + ')
    : cols[0] + ' + ' + cols[1] + ' 等 ' + cols.length + ' 列';
  $('role-note').title = cols.join('\n');
  renderBars($('role-bars'), items);

  $('role-foot').textContent =
    '该角色共 ' + num(map.size) + ' 位署名者，覆盖 ' + num(role.filled) + ' 首曲目（' +
    pct(role.filled, state.rows.length) + '）；上表为曲目数前 ' +
    Math.min(TOP_ROLE, arr.length) + ' 位。「独作」= 该曲目该角色仅他一人署名。';
}

function renderAggChart() {
  const arr = [];
  state.agg.forEach(function (v, name) {
    arr.push({ name: name, v: v });
  });
  arr.sort(function (a, b) { return cmpRank(a, b, function (x) { return x.v.songs; }); });

  const items = arr.slice(0, TOP_AGG).map(function (x) {
    // 角色构成标签：最多显示 2 个，其余用 +N 收尾，避免被截断
    const labels = [];
    x.v.roles.forEach(function (k) {
      if (labels.length < 2) labels.push(state.roles[k].label);
    });
    const more = x.v.roles.size - labels.length;
    return {
      name: x.name,
      value: x.v.songs,
      text: num(x.v.songs),
      tag: labels.join('·') + (more > 0 ? ' +' + more : ''),
    };
  });

  renderBars($('agg-bars'), items);
}

function renderHist() {
  const bins = binHisto(state.histo, 20);
  const maxCount = Math.max.apply(null, bins.map(function (b) { return b.count; }));

  $('hist').innerHTML = bins.map(function (b) {
    const h = maxCount ? (b.count / maxCount * 100) : 0;
    return '<div class="hist-col" title="' + esc(b.label + ' 位署名者：' + num(b.count) + ' 首') + '">' +
      '<span class="hist-val">' + num(b.count) + '</span>' +
      '<span class="hist-track"><i style="height:' + h.toFixed(2) + '%"></i></span>' +
      '<span class="hist-x">' + esc(b.label) + '</span>' +
    '</div>';
  }).join('');

  $('hist-note').textContent =
    '横轴：每首曲目的署名人数 · 纵轴：曲目数 · 共 ' +
    state.roles.length + ' 个角色列';
}

function renderCaliber() {
  const seps = (state.meta.statsSeparators || ['/']).join(' ');
  const items = [
    '<b>曲目数</b> = 该署名者在某角色下出现过的不同曲目条数。同一曲目内担任多个角色，' +
      '在各角色榜中分别计数，但在「参与曲目最多」榜中<b>只计 1 首</b>。',
    '<b>合作署名</b>（如 <code>A/B</code>、<code>A、B</code>）按 <code>' + esc(seps) +
      '</code> 拆开，每位署名者各计 1 次，<b>不按份额折算</b>。因此两首同样署名的曲目，' +
      '个人计数不受合作人数影响，可与他人直接比较。',
    '<b>署名归一</b>：去掉 <code>(HOYO-MiX)</code> 后缀，并在中文与英文/数字之间补一个空格，' +
      '所以 <code>陈致逸 Yu-Peng Chen</code> 与 <code>陈致逸 Yu-Peng Chen (HOYO-MiX)</code>、' +
      '<code>林一凡Fan</code> 与 <code>林一凡 Fan</code> 都合并为同一人。',
    '<b>独作</b> = 该曲目在该角色下只有他一位署名者（用于区分「独立完成」与「合作参与」）。',
    '<b>合并角色</b>：「人声·演唱」把 人声 / 演唱 / 合唱 / 伴唱 / 和声 等 20 个表演类列合成一项，' +
      '同一曲目内多列重复出现只计 1 首。人声录音师、人声编辑、演唱指导、配唱制作人、合唱指挥、' +
      '合唱作词、和声编写、人声采样等技术/制作类列<b>不计入</b>演唱者。',
    '<b>排序</b>：按曲目数从多到少；并列时按姓名的中文拼音顺序，保证结果可复现。',
    '本页口径与数据库「数据分析」工作表一致；其中「作曲」「编曲」「母带」等只使用 <code>/</code> 的列，两处数字完全相同；' +
      '「录音师」「录音棚」等含 <code>、</code> 的列本页会正确拆开，故人数略少于按 <code>/</code> 单一拆分的结果。',
  ];
  $('caliber').innerHTML = items.map(function (s) { return '<li>' + s + '</li>'; }).join('');
}

/* ---------------------------------------------------------------- 交互 */

function bindRoleTabs() {
  $('role-tabs').addEventListener('click', function (e) {
    const btn = e.target.closest('.role-tab');
    if (!btn) return;
    const i = Number(btn.getAttribute('data-i'));
    if (i === state.sel) return;
    state.sel = i;
    Array.prototype.forEach.call($('role-tabs').children, function (el, k) {
      el.setAttribute('aria-selected', k === i ? 'true' : 'false');
    });
    renderRoleChart();
  });
}

/* ---------------------------------------------------------------- 加载 */

function showLoading(title, sub) {
  $('loading-title').textContent = title || '正在统计';
  $('loading-sub').textContent = sub || '读取数据并计算排名…';
  $('loading').hidden = false;
}

function showError(msg) {
  $('loading').hidden = true;
  $('error-msg').textContent = msg;
  $('error-panel').hidden = false;
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error('请求失败 HTTP ' + res.status + ' ' + res.statusText + '\n地址：' + url);
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
    showLoading('正在统计', '读取字段与筛选项…');
    const meta = await fetchJSON('data/meta.json');
    state.meta = meta;

    if (!meta.statsRoles || !meta.statsRoles.length) {
      throw new Error('meta.json 里没有 statsRoles。请重新运行构建：\n' +
                      'python song-db-web/scripts/excel_to_json.py');
    }

    state.colIndex = {};
    meta.columns.forEach(function (c, i) { state.colIndex[c] = i; });
    state.roles = meta.statsRoles.filter(function (r) {
      return r.columns && r.columns.length && r.columns.every(function (c) {
        return state.colIndex[c] !== undefined;
      });
    });
    state.sepRe = buildSeparatorRe(meta.statsSeparators || ['/']);

    showLoading('正在统计', '读取 ' + num(meta.rowCount) + ' 行记录…');
    const bust = encodeURIComponent(String(meta.generatedAt || ''));
    const rows = await fetchJSON('data/rows.json' + (bust ? '?v=' + bust : ''));
    if (!Array.isArray(rows)) throw new Error('rows.json 结构不正确：期望二维数组');
    state.rows = rows;

    showLoading('正在统计', '按角色归并署名、计算排名…');
    compute();

    renderChips();
    renderRoleTabs();
    renderRoleChart();
    renderAggChart();
    renderHist();
    renderCaliber();
    bindRoleTabs();

    $('loading').hidden = true;
  } catch (err) {
    if (window.console) console.error(err);
    showError((err && err.message) ? err.message : String(err));
  }
}

document.addEventListener('DOMContentLoaded', load);

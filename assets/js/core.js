function matchSearch(name, q) {
  if (!q) return true;
  const ql = q.toLowerCase().trim();
  if (!ql) return true;
  if (name.toLowerCase().includes(ql)) return true;
  try {
    const lib = window.pinyinPro;
    if (lib) {
      const initials = lib.pinyin(name, { pattern: 'first', toneType: 'none', separator: '' });
      if (initials.toLowerCase().includes(ql)) return true;
      const full = lib.pinyin(name, { toneType: 'none', separator: '' });
      if (full.toLowerCase().includes(ql)) return true;
    }
  } catch(e) {}
  return false;
}

/* ═══ Date Utils ════════════════════════════════════════════════════════════ */
function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDays(d, n) { const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function getMonday(d) {
  const r=new Date(d); const day=r.getDay();
  r.setDate(r.getDate()+(day===0?-6:1-day)); return r;
}
function weekDates(mon) { return Array.from({length:7},(_,i)=>addDays(mon,i)); }
function isToday(d) {
  const t=new Date();
  return d.getFullYear()===t.getFullYear()&&d.getMonth()===t.getMonth()&&d.getDate()===t.getDate();
}
function fmtShort(d) { return `${d.getMonth()+1}/${d.getDate()}`; }
function fmtMid(d) { return `${d.getMonth()+1}月${d.getDate()}日`; }

const WD = ['周一','周二','周三','周四','周五','周六','周日'];
const WD_FULL = ['周日','周一','周二','周三','周四','周五','周六'];

/* ═══ Defaults ══════════════════════════════════════════════════════════════ */
const DEF_TYPES = [
  {id:'t1',name:'巡查',hours:1,  color:'#3fb950'},
  {id:'t2',name:'值班1',hours:2, color:'#58a6ff'},
  {id:'t3',name:'值班2',hours:2.5,color:'#d29922'},
];
const DEF_PERSONNEL = [
  {id:'p1',name:'张三'},
  {id:'p2',name:'李四'},
  {id:'p3',name:'王五'},
];

let _id = 1000;
function uid() { return `id_${++_id}_${Date.now()%100000}`; }

function loadLS(key, def) {
  try { const v=localStorage.getItem(key); return v?JSON.parse(v):def; } catch { return def; }
}

function makeEmptyScheduleRules() {
  return { personAliases:{}, typeRules:[], weekdayRules:[], ignoreRules:[] };
}

function normalizeScheduleRules(input) {
  const base = makeEmptyScheduleRules();
  if (!input || typeof input !== 'object') return base;
  const personAliases = input.personAliases && typeof input.personAliases === 'object' ? input.personAliases : {};
  const mapArr = (arr, mapFn) => Array.isArray(arr) ? arr.map(mapFn).filter(Boolean) : [];
  return {
    personAliases,
    typeRules: mapArr(input.typeRules, r => {
      const keyword = normStr(r?.keyword || '');
      const typeName = normStr(r?.typeName || '');
      if (!keyword || !typeName) return null;
      return { id:r?.id || uid(), keyword, typeName };
    }),
    weekdayRules: mapArr(input.weekdayRules, r => {
      const keyword = normStr(r?.keyword || '');
      const weekday = Number.isInteger(r?.weekday) ? r.weekday : parseInt(r?.weekday,10);
      if (!keyword || Number.isNaN(weekday) || weekday < 0 || weekday > 6) return null;
      return { id:r?.id || uid(), keyword, weekday };
    }),
    ignoreRules: mapArr(input.ignoreRules, r => {
      const keyword = normStr(r?.keyword || '');
      if (!keyword) return null;
      return { id:r?.id || uid(), keyword };
    }),
  };
}

function ensureScheduleRules(rules) {
  return rules && rules.personAliases && Array.isArray(rules.typeRules) && Array.isArray(rules.weekdayRules) && Array.isArray(rules.ignoreRules)
    ? rules
    : normalizeScheduleRules(rules);
}

/* ═══ App ═══════════════════════════════════════════════════════════════════ */

function normStr(s) {
  if (s == null) return '';
  return String(s).replace(/：/g,':').replace(/[－—\u2014\u2013]/g,'-').replace(/\s+/g,' ').trim();
}

function parseTimeMins(label) {
  const s = normStr(label);
  const m = s.match(/(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let start = parseInt(m[1])*60+parseInt(m[2]);
  let end   = parseInt(m[3])*60+parseInt(m[4]);
  if (end <= start) end += 24*60;
  return end - start;
}

// Type labels that explicitly map to 1h (shortest type)
const ONE_HOUR_LABELS = new Set(['负责人','晚上值日','值日','巡视','夜巡','值守']);

function classifyByTypes(label, types, parserRules) {
  const s = normStr(label);
  const shortest = () => [...types].sort((a,b)=>a.hours-b.hours)[0] || null;
  const typeRules = ensureScheduleRules(parserRules).typeRules;
  for (const rule of typeRules) {
    if (s.includes(rule.keyword)) {
      const hit = types.find(t=>t.name===rule.typeName);
      if (hit) return hit;
    }
  }
  // Explicit 1h labels (负责人, 晚上值日, etc.)
  if (ONE_HOUR_LABELS.has(s) || ONE_HOUR_LABELS.has(label)) return shortest();
  // Type d: pure weekday with no time → 1h
  if (extractWeekday(s, parserRules) !== null && !/\d{1,2}:\d{2}/.test(s)) return shortest();
  // Type a/b/e: contains a time range → match by duration
  const mins = parseTimeMins(s);
  if (mins != null && mins > 0) {
    let best=null, bestDiff=Infinity;
    for (const t of types) {
      const d = Math.abs(t.hours - mins/60);
      if (d < bestDiff) { bestDiff=d; best=t; }
    }
    if (best && bestDiff <= 0.65) return best;
  }
  // Fallback: keyword contains type name
  for (const t of [...types].sort((a,b)=>b.hours-a.hours)) {
    if (s.includes(t.name)) return t;
  }
  return shortest();
}

const WD_MAP_TABLE = [
  [['星期一','周一'],0],[['星期二','周二'],1],[['星期三','周三'],2],
  [['星期四','周四'],3],[['星期五','周五'],4],[['星期六','周六'],5],
  [['星期日','周日','星期天','周天'],6],
];
function extractWeekday(s, parserRules) {
  if (!s) return null;
  const n = normStr(s);
  const weekdayRules = ensureScheduleRules(parserRules).weekdayRules;
  for (const rule of weekdayRules) {
    if (n.includes(rule.keyword)) return rule.weekday;
  }
  for (const [keys, wd] of WD_MAP_TABLE) {
    for (const k of keys) {
      if (n.startsWith(k) || n === k) return wd;
    }
  }
  return null;
}

const HEADER_KW_SET = new Set(['签到','楼层','负责人','值班','洗板擦布','洗抹布','洗板']);
// Match exact set OR anything starting with "洗"（洗抹布/洗板擦布 etc）
function isHeaderKW(s) {
  if (!s) return false;
  return HEADER_KW_SET.has(s) || s.startsWith('洗');
}
// Keep HEADER_KW as alias for Set-style usage in isPersonName
const HEADER_KW = HEADER_KW_SET;
const SKIP_NAMES = new Set(['无需值日','无需值班','无','时间','综合楼','s1楼','负责人','楼层','值班组','巡视组','周一','周二','周三','周四','周五','周六','周日','周天','星期一','星期二','星期三','星期四','星期五','星期六','星期日','星期天']);

function isPersonName(s, parserRules) {
  if (!s) return false;
  const t = normStr(s).toLowerCase();
  const ignoreRules = ensureScheduleRules(parserRules).ignoreRules;
  if (!t) return false;
  if (ignoreRules.some(rule => t.includes(rule.keyword.toLowerCase()))) return false;
  if (SKIP_NAMES.has(t)) return false;
  if (SKIP_NAMES.has(s)) return false;
  if (/^\d+$/.test(t)) return false;     // pure number
  if (t.length > 12) return false;        // too long
  if (isHeaderKW(s) || [...HEADER_KW].some(kw=>t.includes(kw))) return false;
  const BAD = ['排班','安排','校历','周末','巡视','综合楼','s1楼','值班组','巡视组'];
  if (BAD.some(k => t.includes(k))) return false;
  // Reject time-range strings and pure weekday names
  if (/\d{1,2}:\d{2}/.test(normStr(s))) return false;
  const cjk = (s.match(/[\u4e00-\u9fff]/g)||[]).length;
  return cjk >= 1;
}

function buildGrid(ws) {
  // Expand merged cells; returns getCellFn(row0, col0) → string|null (0-indexed)
  const mergeVals = {};
  for (const m of (ws['!merges']||[])) {
    const topLeft = ws[XLSX.utils.encode_cell({r:m.s.r, c:m.s.c})];
    const val = topLeft?.v != null ? normStr(String(topLeft.v)) : null;
    for (let r=m.s.r; r<=m.e.r; r++)
      for (let cc=m.s.c; cc<=m.e.c; cc++)
        mergeVals[`${r},${cc}`] = val;
  }
  return function(r, cc) {
    const key = `${r},${cc}`;
    if (key in mergeVals) return mergeVals[key] || null;
    const cell = ws[XLSX.utils.encode_cell({r, c:cc})];
    return cell?.v != null ? normStr(String(cell.v)) : null;
  };
}

function getSheetDims(ws) {
  const ref = ws['!ref'];
  if (!ref) return {maxR:0, maxC:0};
  const rng = XLSX.utils.decode_range(ref);
  return {maxR: rng.e.r, maxC: rng.e.c};
}

function parseScheduleSheetNew(ws, types, personnel, parserRules) {
  const rules = ensureScheduleRules(parserRules);
  const G = buildGrid(ws);
  const {maxR, maxC} = getSheetDims(ws);
  const rawGrid = Array.from({length:maxR+1}, (_, r)=>
    Array.from({length:maxC+1}, (_, cc)=>({ val: G(r,cc) || '' }))
  );
  const cellMatchType = {};
  const cellTypeName = {};
  const cellSlotMap = {};

  function tryMatch(rawName) {
    if (!rawName) return null;
    const check = (name) => {
      let p = personnel.find(p => p.name === name);
      if (p) return p;
      const part = name.split(/[·•]/)[0].trim();
      p = personnel.find(p => p.name === part || p.name.startsWith(part) || part.startsWith(p.name));
      if (p) return p;
      if (part.length >= 2) p = personnel.find(p => p.name.includes(part) || part.includes(p.name));
      return p || null;
    };
    if (rules.personAliases[rawName]) return check(rules.personAliases[rawName]);
    return check(rawName);
  }

  // Safe read: falls back left up to 2 cells for non-topleft merged cells
  function Gsafe(r, cc) {
    const v = G(r, cc);
    if (v != null) return v;
    if (cc > 0) { const v1 = G(r, cc-1); if (v1 != null) return v1; }
    if (cc > 1) { const v2 = G(r, cc-2); if (v2 != null) return v2; }
    return null;
  }

  // Normalize typeCol to the merge top-left in the header row
  function normTypeCol(hr, col) {
    const val = G(hr, col);
    if (!val) return col;
    let left = col;
    while (left > 0 && G(hr, left-1) === val) left--;
    return left;
  }

  // ── 1. Find 签到 header rows ──────────────────────────────────────────
  const signRowSet = new Set();
  for (let r=0; r<=maxR; r++)
    for (let cc=0; cc<=maxC; cc++)
      if (G(r,cc) === '签到') signRowSet.add(r);
  const signRows = [...signRowSet].sort((a,b)=>a-b);
  if (signRows.length === 0) return {error:'未找到包含「签到」的表头行'};

  const result = {};
  const unmatchedSet = new Set();
  const signRowsExt = [...signRows, maxR+1];

  for (let si=0; si<signRows.length; si++) {
    const hr        = signRows[si];
    const dataStart = hr + 1;
    const dataEnd   = signRowsExt[si+1] - 2;
    if (dataStart > dataEnd) continue;

    // ── 2a. Deduplicate sign_cols: keep first of each consecutive run ──
    const rawSC = [];
    for (let cc=0; cc<=maxC; cc++)
      if (G(hr,cc) === '签到') rawSC.push(cc);
    const signCols = [];
    let runEnd = -2;
    for (const cc of rawSC) {
      if (cc > runEnd+1) signCols.push(cc);
      runEnd = cc;
    }

    // ── 2b. Build groups ──────────────────────────────────────────────
    const groups = [];
    for (const sc of signCols) {
      let foundWd = null, foundWdCol = -1;
      // Scan left from sign col to find weekday header
      for (let cc=sc-1; cc>=0; cc--) {
        const cv = G(hr, cc);
        if (!cv) continue;
        if (isHeaderKW(cv)) continue;
        const wd = extractWeekday(cv, rules);
        if (wd !== null) { foundWd=wd; foundWdCol=cc; break; }
        if (cv === '时间') continue;
        break;
      }

      let pcols;
      if (foundWdCol >= 0) {
        // Standard weekday-column block: extend left through merged header
        const wdVal = G(hr, foundWdCol);
        let leftBound = foundWdCol;
        while (leftBound > 0 && G(hr, leftBound-1) === wdVal) leftBound--;
        pcols = [];
        for (let cc=leftBound; cc<sc; cc++) pcols.push(cc);
      } else {
        // Section-3 style: date/type lives in the data cell itself (e.g. 周一, 周六7:30-9:30)
        // Find typeCol = rightmost '时间' to the left, skipping all separator keywords
        let typeColR = 0;
        for (let cc=sc-1; cc>=0; cc--) {
          const cv = G(hr, cc);
          if (!cv) continue;
          if (cv === '时间') { typeColR = cc; break; }
          if (isHeaderKW(cv)) continue;
          if (extractWeekday(cv, rules) !== null) { typeColR = cc; break; }
          typeColR = cc; break;
        }
        pcols = [];
        for (let cc=typeColR+1; cc<sc; cc++) pcols.push(cc);
      }

      // typeCol: scan left from first pcol to find '时间' source column,
      // then normalize to the merge top-left so data-row lookups hit the actual cell
      let typeCol = 0;
      if (pcols.length > 0) {
        const firstP = pcols[0];
        for (let cc=firstP-1; cc>=0; cc--) {
          const cv = G(hr, cc);
          if (!cv) continue;
          if (cv === '时间') { typeCol = normTypeCol(hr, cc); break; }
          if (isHeaderKW(cv)) continue;
          if (extractWeekday(cv, rules) !== null) continue;
          typeCol = normTypeCol(hr, cc); break;
        }
      }

      groups.push({wd: foundWd, pcols, typeCol, sc});
    }

    // ── 2c. Process data rows ─────────────────────────────────────────
    for (let r=dataStart; r<=dataEnd; r++) {
      for (const grp of groups) {
        const typeRaw = Gsafe(r, grp.typeCol);
        if (!typeRaw) continue;
        const typeNorm = normStr(typeRaw);

        let wd = grp.wd;
        if (wd === null) wd = extractWeekday(typeRaw, rules);
        if (wd === null) continue;

        const wt = classifyByTypes(typeNorm, types, rules);
        if (!wt) continue;
        cellMatchType[`${r},${grp.typeCol}`] = 'type';

        const seen = new Set();
        for (const cc of grp.pcols) {
          const nm = G(r, cc);
          if (!nm || seen.has(nm) || !isPersonName(nm, rules)) continue;
          seen.add(nm);
          const pObj = tryMatch(nm);
          if (pObj) {
            result[wd] = result[wd]||{};
            result[wd][pObj.name] = result[wd][pObj.name]||{};
            result[wd][pObj.name][wt.name] = (result[wd][pObj.name][wt.name]||0)+1;
            cellMatchType[`${r},${cc}`] = 'matched';
            cellTypeName[`${r},${cc}`] = wt.name;
            cellSlotMap[`${r},${cc}`] = {
              weekday: wd,
              personName: pObj.name,
              typeName: wt.name,
            };
          } else {
            unmatchedSet.add(nm);
            cellMatchType[`${r},${cc}`] = 'unmatched';
          }
        }
      }
    }
  }

  return {
    result,
    unmatched:[...unmatchedSet],
    rawGrid,
    rawMerges:(ws['!merges'] || []).map(m=>({ s:{r:m.s.r,c:m.s.c}, e:{r:m.e.r,c:m.e.c} })),
    cellMatchType,
    cellTypeName,
    cellSlotMap
  };
}

/* ── PreviewTabs: summary + raw grid view ── */

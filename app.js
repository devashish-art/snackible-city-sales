/* ═══════════════════════════════════════════════════
   Snackible · City Sales Dashboard · app.js
   Data: City Sales backend (pivot pastes) + CM2 backend (rates, cost, ads/vis, SKU_Map)
   ═══════════════════════════════════════════════════ */

// ── Settings ──────────────────────────────────────────
const CITY_API = 'https://script.google.com/macros/s/AKfycbwc6Eyn_J52UHlhGo6yHCg5LYI4S79TvzT1i_0tUkhxRJjwd62yYg0oNsq9F2m8Crmi/exec';
const CM2_API  = 'https://script.google.com/macros/s/AKfycbzZWmiZk9RCmg6RTqqgObYjzMn545VGHorUQg66yHo1R-f9NbpDqyjBqRXlnJWpLHU-/exec';
const CM2_URL  = 'https://cm-2-snackible.vercel.app/';
const DEMO = /PASTE_/.test(CITY_API) || new URLSearchParams(location.search).get('demo') === '1';

const PORTALS = ['blinkit', 'zepto', 'instamart'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DEFAULT_CFG = { commission:35, tax:5, directExp:2.90, labour:2.00, logistics:8.00 };
const PERIODS = { all:'Full month', 1:'1st – 10th', 2:'11th – 20th', 3:'21st – month end' };

const ST = { geo:'city', view:'overview', ym:null, period:'all', portal:'all', split:'netSales', city:null,
             metric:'ns', open:{}, sideCollapsed:false, loading:false };
let MONTHS_AVAIL = [], DATA = {}, CM2 = { config:{}, data:{} }, CM2_OK = false;
let MAP = null, MAP_OK = false, FACTS = [], INFO = {}, CHARTS = [], LOAD_ERR = '';

// ── Helpers ───────────────────────────────────────────
const fmt    = n => Math.round(+n || 0).toLocaleString('en-IN');
const fmtPct = n => (isFinite(n) ? (+n || 0) : 0).toFixed(2) + '%';
const fmtL   = n => { const a = Math.abs(n), s = n < 0 ? '-' : ''; return a >= 1e7 ? '₹' + s + (a/1e7).toFixed(2) + 'Cr' : a >= 1e5 ? '₹' + s + (a/1e5).toFixed(1) + 'L' : '₹' + s + fmt(a); };
const pct    = (a, b) => b ? a / b * 100 : 0;
const pc     = v => v >= 0 ? 'pos' : 'neg';
const pLabel = p => ({ blinkit:'Blinkit', zepto:'Zepto', instamart:'Instamart' }[p] || p);
const pColor = p => ({ blinkit:'#FBAE25', zepto:'#E35C25', instamart:'#4C94D0' }[p] || '#02514F');
const esc    = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const ymLabel = ym => { const [y, m] = ym.split('-'); return MONTH_NAMES[+m - 1] + ' ' + y; };
const bucketOf = iso => { const d = +String(iso || '').slice(8, 10) || 1; return d <= 10 ? 1 : d <= 20 ? 2 : 3; };
const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };

function toast(msg, type) {
  let t = document.getElementById('_toast');
  if (!t) { t = document.createElement('div'); t.id = '_toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = 'toast show' + (type === 'err' ? ' err' : '');
  clearTimeout(t._t); t._t = setTimeout(() => { t.className = 'toast'; }, 2800);
}
async function getJSON(url) { const r = await fetch(url, { cache:'no-store' }); return r.json(); }

// ── CM2 calculation (copied from CM2 dashboard so totals match exactly) ──
const blankOrUndef = v => v === '' || v === null || v === undefined || v === 0 || v === 0.0;
function calcSKU(sku, cfg, isNLC, adsAlloc, visAlloc, promosAlloc) {
  const gmv = +sku.gmv || 0, qty = +sku.qty || 0, cost = +sku.cost || 0, nlcPrice = +sku.nlc_price || 0;
  const _p = sku.promos, _a = sku.ads, _v = sku.visibility;
  const promos = (_p === '' || _p === null || _p === undefined) ? (promosAlloc || 0) : (+_p || 0);
  const ads    = (_a === '' || _a === null || _a === undefined) ? (adsAlloc || 0)    : (+_a || 0);
  const vis    = (_v === '' || _v === null || _v === undefined) ? (visAlloc || 0)    : (+_v || 0);
  const commPct = (+cfg.commission) / 100, taxPct = (+cfg.tax) / 100;
  const dePct = (+cfg.directExp) / 100, labPct = (+cfg.labour) / 100, logPct = (+cfg.logistics) / 100;
  let commission, grossSales, netSales;
  if (sku.custom && (+sku.c_gross > 0 || +sku.c_net > 0)) { grossSales = +sku.c_gross || 0; netSales = +sku.c_net || 0; commission = gmv - grossSales; }
  else if (isNLC) { commission = 0; grossSales = nlcPrice * qty; netSales = grossSales / (1 + taxPct); }
  else { commission = gmv * commPct; grossSales = gmv * (1 - commPct); netSales = grossSales / (1 + taxPct); }
  const cogs = cost * qty, directExp = netSales * dePct, grossMargin = netSales - cogs - directExp;
  const labour = netSales * labPct, logistics = netSales * logPct, cm1 = grossMargin - labour - logistics;
  return { gmv, qty, cost, commission, grossSales, netSales, cogs, directExp, grossMargin, labour, logistics, cm1, promos, ads, vis, cm2: cm1 - promos - ads - vis };
}
function totals(skus, nlcSkus, cfg, portalTotals, nlcPortalTotals) {
  const acc = { gmv:0, qty:0, grossSales:0, netSales:0, cogs:0, cm1:0, promos:0, ads:0, vis:0, cm2:0 };
  const nlcPT = nlcPortalTotals || portalTotals || {};
  const splitBy = portalTotals?.splitBy || nlcPT?.splitBy || 'netSales';
  function group(arr, isNLC, gpt) {
    const raw = arr.map(s => { const c = calcSKU(s, cfg, isNLC, 0, 0, 0); return { ns:c.netSales, qty:c.qty || (+s.qty || 0) }; });
    const tw = splitBy === 'qty' ? raw.reduce((a, v) => a + (v.qty || 0), 0) : raw.reduce((a, v) => a + (v.ns || 0), 0);
    arr.forEach((s, i) => {
      const w = splitBy === 'qty' ? (raw[i].qty || 0) : (raw[i].ns || 0), sh = tw > 0 ? w / tw : 0;
      const c = calcSKU(s, cfg, isNLC, blankOrUndef(s.ads) ? (gpt?.ads || 0) * sh : 0, blankOrUndef(s.visibility) ? (gpt?.vis || 0) * sh : 0, blankOrUndef(s.promos) ? (gpt?.promos || 0) * sh : 0);
      ['gmv','qty','cogs','cm1','promos','ads','vis','cm2'].forEach(k => acc[k] += c[k]);
      acc.grossSales += c.grossSales; acc.netSales += c.netSales;
    });
  }
  group(skus || [], false, portalTotals); group(nlcSkus || [], true, nlcPT);
  return acc;
}

// ── SKU identity (shared SKU_Map from CM2 backend) ──
const UE_STOP = new Set(['snackible','dipsters','with','made','millet','millets','no','palm','oil','high','fibre','fiber','roasted','baked','source','of','rich','in','dietary','refined','sugar','healthy','snack','snacks','per','serve','vacuum','fried','less','supergrains','popped','maida','jaggery','creme','a','the','and','gram','grams','g','gm','piece','pieces','pc','pcs','ml','kg','pack','cheesy']);
function ueKey(name) {
  let n = (name || '').toLowerCase();
  n = n.replace(/\d+\s*%\s*protein\s*per\s*serve/g, ' ').replace(/(high|source of|rich in)\s+protein/g, ' ')
       .replace(/khakhra/g, 'khakra').replace(/piri/g, 'peri').replace(/barbeque|barbecue/g, 'bbq')
       .replace(/[0-9.]+/g, ' ').replace(/[^a-z]+/g, ' ');
  return [...new Set(n.split(' ').filter(w => w && !UE_STOP.has(w)))].sort().join(' ');
}
function ueDisplay(name) {
  let n = (name || '').replace(/^Snackible\s+/i, '');
  n = n.split('|')[0].split('(')[0].replace(/[\s\-]+\d+[\.\d]*\s*(g|gram|grams|piece|pieces|ml)\b.*$/i, '').trim();
  if (/^dipsters\s*-\s*/i.test(n)) n = n.replace(/^dipsters\s*-\s*/i, '');
  else if (n.indexOf(' - ') > 0 && n.split(' - ')[0].length > 12) n = n.split(' - ')[0];
  return n.trim().replace(/\b\w/g, c => c.toUpperCase());
}
function ueGrams(name) { const m = (name || '').match(/(\d+(?:\.\d+)?)\s*(g|gm|gms|gram|grams)\b/i); return m ? Math.round(parseFloat(m[1])) + 'g' : ''; }
function ueNormPack(v) { const t = String(v || '').trim(); if (!t) return ''; const m = t.match(/(\d+(?:\.\d+)?)/); return m ? Math.round(parseFloat(m[1])) + 'g' : t; }
function ueNorm(n) { return String(n || '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function ueBase(n) { return ueNorm(String(n || '').toLowerCase().replace(/\d+(?:\.\d+)?\s*(g|gm|gms|gram|grams|piece|pieces|pc|pcs)\b/g, ' ')); }

function buildMap(rows) {
  const exact = {}, base = {};
  (rows || []).forEach(x => {
    const master = String(x.master || '').trim(); if (!x.name || !master) return;
    const val = { master, pack: ueNormPack(x.pack) };
    const pt = String(x.portal || '').trim().toLowerCase().replace(/\s*nlc$/, '').replace('swiggy', 'instamart') || '*';
    const nn = ueNorm(x.name), bb = ueBase(x.name);
    exact[pt + '|' + nn] = val; if (!exact['*|' + nn]) exact['*|' + nn] = val;
    (base[pt + '|' + bb] = base[pt + '|' + bb] || []).push(val);
  });
  return { exact, base, n: (rows || []).length };
}
function mapLookup(p, name) {
  if (!MAP) return null;
  const nn = ueNorm(name), hit = MAP.exact[p + '|' + nn] || MAP.exact['*|' + nn];
  if (hit) return hit;
  const b = ueBase(name), list = MAP.base[p + '|' + b] || MAP.base['*|' + b];
  if (!list || !list.length) return null;
  const g = parseFloat(ueGrams(name)) || 0;
  const ok = list.filter(v => { const pk = parseFloat(v.pack) || 0; return !g || !pk || Math.abs(g - pk) / pk <= 0.15; });
  return ok.length ? (ok.find(v => (parseFloat(v.pack) || 0) === g) || ok[0]) : null;
}
const ID_CACHE = {};
function identify(p, name) {
  const ck = p + '|' + name; if (ID_CACHE[ck]) return ID_CACHE[ck];
  const mp = mapLookup(p, name); let r;
  if (mp) r = { key:'M|' + mp.master.toLowerCase() + '|' + mp.pack, label: mp.master + (mp.pack ? ' · ' + mp.pack : ''), mapped:true };
  else { const g = ueGrams(name); r = { key:'A|' + (ueKey(name) || ueNorm(name)) + '|' + g, label: ueDisplay(name) + (g ? ' · ' + g : ''), mapped:false }; }
  return (ID_CACHE[ck] = r);
}

// ── City names ────────────────────────────────────────
const CITY_ALIAS = { bangalore:'Bengaluru', bengaluru:'Bengaluru', gurgaon:'Gurugram', gurugram:'Gurugram', bombay:'Mumbai',
  calcutta:'Kolkata', madras:'Chennai', 'new delhi':'Delhi', poona:'Pune', 'navi mumbai':'Navi Mumbai', vizag:'Visakhapatnam' };
const CITY_STATE = {"mumbai":"Maharashtra","navi mumbai":"Maharashtra","thane":"Maharashtra","pune":"Maharashtra","nagpur":"Maharashtra","nashik":"Maharashtra","aurangabad":"Maharashtra","chhatrapati sambhajinagar":"Maharashtra","kolhapur":"Maharashtra","solapur":"Maharashtra","amravati":"Maharashtra","akola":"Maharashtra","nanded":"Maharashtra","sangli":"Maharashtra","satara":"Maharashtra","jalgaon":"Maharashtra","ahmednagar":"Maharashtra","ahilyanagar":"Maharashtra","latur":"Maharashtra","dhule":"Maharashtra","kalyan":"Maharashtra","dombivli":"Maharashtra","bhiwandi":"Maharashtra","vasai":"Maharashtra","virar":"Maharashtra","panvel":"Maharashtra","ulhasnagar":"Maharashtra","mira bhayandar":"Maharashtra","palghar":"Maharashtra","lonavala":"Maharashtra","baramati":"Maharashtra","ratnagiri":"Maharashtra","wardha":"Maharashtra","chandrapur":"Maharashtra","pimpri chinchwad":"Maharashtra","kharghar":"Maharashtra","ambernath":"Maharashtra","badlapur":"Maharashtra","delhi":"Delhi","new delhi":"Delhi","gurugram":"Haryana","faridabad":"Haryana","sonipat":"Haryana","panipat":"Haryana","karnal":"Haryana","ambala":"Haryana","rohtak":"Haryana","hisar":"Haryana","bahadurgarh":"Haryana","panchkula":"Haryana","rewari":"Haryana","kurukshetra":"Haryana","yamunanagar":"Haryana","bhiwani":"Haryana","jhajjar":"Haryana","palwal":"Haryana","sirsa":"Haryana","kaithal":"Haryana","jind":"Haryana","manesar":"Haryana","noida":"Uttar Pradesh","greater noida":"Uttar Pradesh","ghaziabad":"Uttar Pradesh","lucknow":"Uttar Pradesh","kanpur":"Uttar Pradesh","agra":"Uttar Pradesh","varanasi":"Uttar Pradesh","prayagraj":"Uttar Pradesh","allahabad":"Uttar Pradesh","meerut":"Uttar Pradesh","bareilly":"Uttar Pradesh","aligarh":"Uttar Pradesh","moradabad":"Uttar Pradesh","gorakhpur":"Uttar Pradesh","jhansi":"Uttar Pradesh","mathura":"Uttar Pradesh","vrindavan":"Uttar Pradesh","saharanpur":"Uttar Pradesh","firozabad":"Uttar Pradesh","ayodhya":"Uttar Pradesh","muzaffarnagar":"Uttar Pradesh","shahjahanpur":"Uttar Pradesh","rampur":"Uttar Pradesh","hapur":"Uttar Pradesh","bulandshahr":"Uttar Pradesh","etawah":"Uttar Pradesh","sitapur":"Uttar Pradesh","raebareli":"Uttar Pradesh","bengaluru":"Karnataka","mysuru":"Karnataka","mysore":"Karnataka","mangaluru":"Karnataka","mangalore":"Karnataka","hubli":"Karnataka","hubballi":"Karnataka","dharwad":"Karnataka","belagavi":"Karnataka","belgaum":"Karnataka","davanagere":"Karnataka","ballari":"Karnataka","bellary":"Karnataka","udupi":"Karnataka","shivamogga":"Karnataka","shimoga":"Karnataka","tumakuru":"Karnataka","tumkur":"Karnataka","kalaburagi":"Karnataka","gulbarga":"Karnataka","hosur road":"Karnataka","hyderabad":"Telangana","secunderabad":"Telangana","warangal":"Telangana","karimnagar":"Telangana","nizamabad":"Telangana","khammam":"Telangana","sangareddy":"Telangana","chennai":"Tamil Nadu","coimbatore":"Tamil Nadu","madurai":"Tamil Nadu","tiruchirappalli":"Tamil Nadu","trichy":"Tamil Nadu","salem":"Tamil Nadu","tiruppur":"Tamil Nadu","erode":"Tamil Nadu","vellore":"Tamil Nadu","tirunelveli":"Tamil Nadu","thoothukudi":"Tamil Nadu","hosur":"Tamil Nadu","kanchipuram":"Tamil Nadu","pondicherry road":"Tamil Nadu","thanjavur":"Tamil Nadu","nagercoil":"Tamil Nadu","kochi":"Kerala","ernakulam":"Kerala","thiruvananthapuram":"Kerala","trivandrum":"Kerala","kozhikode":"Kerala","calicut":"Kerala","thrissur":"Kerala","kollam":"Kerala","kannur":"Kerala","alappuzha":"Kerala","kottayam":"Kerala","palakkad":"Kerala","malappuram":"Kerala","ahmedabad":"Gujarat","surat":"Gujarat","vadodara":"Gujarat","rajkot":"Gujarat","gandhinagar":"Gujarat","bhavnagar":"Gujarat","jamnagar":"Gujarat","anand":"Gujarat","nadiad":"Gujarat","vapi":"Gujarat","valsad":"Gujarat","navsari":"Gujarat","bharuch":"Gujarat","mehsana":"Gujarat","junagadh":"Gujarat","morbi":"Gujarat","gandhidham":"Gujarat","jaipur":"Rajasthan","jodhpur":"Rajasthan","udaipur":"Rajasthan","kota":"Rajasthan","ajmer":"Rajasthan","bikaner":"Rajasthan","alwar":"Rajasthan","bhilwara":"Rajasthan","sikar":"Rajasthan","bhiwadi":"Rajasthan","sri ganganagar":"Rajasthan","pali":"Rajasthan","kolkata":"West Bengal","howrah":"West Bengal","siliguri":"West Bengal","durgapur":"West Bengal","asansol":"West Bengal","kharagpur":"West Bengal","bardhaman":"West Bengal","barasat":"West Bengal","salt lake":"West Bengal","indore":"Madhya Pradesh","bhopal":"Madhya Pradesh","gwalior":"Madhya Pradesh","jabalpur":"Madhya Pradesh","ujjain":"Madhya Pradesh","sagar":"Madhya Pradesh","ratlam":"Madhya Pradesh","rewa":"Madhya Pradesh","satna":"Madhya Pradesh","dewas":"Madhya Pradesh","ludhiana":"Punjab","amritsar":"Punjab","jalandhar":"Punjab","patiala":"Punjab","bathinda":"Punjab","mohali":"Punjab","sahibzada ajit singh nagar":"Punjab","zirakpur":"Punjab","phagwara":"Punjab","pathankot":"Punjab","hoshiarpur":"Punjab","kharar":"Punjab","chandigarh":"Chandigarh","dehradun":"Uttarakhand","haridwar":"Uttarakhand","rishikesh":"Uttarakhand","haldwani":"Uttarakhand","roorkee":"Uttarakhand","rudrapur":"Uttarakhand","kashipur":"Uttarakhand","nainital":"Uttarakhand","visakhapatnam":"Andhra Pradesh","vijayawada":"Andhra Pradesh","guntur":"Andhra Pradesh","nellore":"Andhra Pradesh","tirupati":"Andhra Pradesh","kakinada":"Andhra Pradesh","rajahmundry":"Andhra Pradesh","kurnool":"Andhra Pradesh","anantapur":"Andhra Pradesh","eluru":"Andhra Pradesh","ongole":"Andhra Pradesh","bhubaneswar":"Odisha","cuttack":"Odisha","rourkela":"Odisha","puri":"Odisha","sambalpur":"Odisha","berhampur":"Odisha","patna":"Bihar","gaya":"Bihar","muzaffarpur":"Bihar","bhagalpur":"Bihar","darbhanga":"Bihar","ranchi":"Jharkhand","jamshedpur":"Jharkhand","dhanbad":"Jharkhand","bokaro":"Jharkhand","raipur":"Chhattisgarh","bhilai":"Chhattisgarh","bilaspur":"Chhattisgarh","durg":"Chhattisgarh","korba":"Chhattisgarh","guwahati":"Assam","dibrugarh":"Assam","silchar":"Assam","jorhat":"Assam","goa":"Goa","panaji":"Goa","margao":"Goa","vasco da gama":"Goa","mapusa":"Goa","north goa":"Goa","south goa":"Goa","jammu":"Jammu and Kashmir","srinagar":"Jammu and Kashmir","shimla":"Himachal Pradesh","solan":"Himachal Pradesh","baddi":"Himachal Pradesh","dharamshala":"Himachal Pradesh","mandi":"Himachal Pradesh","puducherry":"Puducherry","pondicherry":"Puducherry"};
let CITY_MAP = {}, STATE_MAP = {};
function stateOf(city) {
  const k = String(city || '').trim().toLowerCase();
  return STATE_MAP[k] || CITY_STATE[k] || PAREN_STATE[k] || 'Unmapped state';
}
const PAREN_STATE = {};
function normCity(c) {
  let k = String(c || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (CITY_MAP[k]) return CITY_MAP[k];
  // "Aurangabad (Maharashtra)" → city Aurangabad, state Maharashtra
  const pm = k.match(/^(.+?)\s*\((.+)\)$/);
  if (pm) { k = pm[1].trim(); PAREN_STATE[k] = pm[2].trim().replace(/\b\w/g, x => x.toUpperCase()); }
  if (!k) return 'Unknown';
  if (CITY_MAP[k]) return CITY_MAP[k];
  if (CITY_ALIAS[k]) return CITY_ALIAS[k];
  if (k === 'sahibzada ajit singh nagar') return 'Mohali';
  return k.replace(/\b\w/g, x => x.toUpperCase());
}

// ── Loading ───────────────────────────────────────────
async function loadCM2() {
  try { const r = await getJSON(CM2_API + '?action=loadAllChunks'); if (r && r.data) { CM2 = { config: r.config || {}, data: r.data }; CM2_OK = true; } }
  catch (e) { CM2_OK = false; }
  if (!CM2_OK && DEMO) { CM2 = demoCM2(); CM2_OK = true; }
}
let MAP_INFO = { n: 0, err: '' };
async function loadMap() {
  // SKU_Map lives in the CM2 backend; retry a couple of times because it is fetched alongside CM2 data
  MAP_INFO = { n: 0, err: '' };
  for (let i = 0; i < 3; i++) {
    try {
      const r = await getJSON(CM2_API + '?action=getSkuMap&t=' + Date.now());
      if (r && r.error) throw new Error(r.error);
      const rows = (r && r.rows) || [];
      MAP = buildMap(rows); MAP_OK = true; MAP_INFO = { n: rows.length, err: rows.length ? '' : 'SKU_Map returned 0 rows' };
      break;
    } catch (e) { MAP = buildMap([]); MAP_OK = false; MAP_INFO = { n: 0, err: String(e.message || e) }; await new Promise(res => setTimeout(res, 800)); }
  }
  Object.keys(ID_CACHE).forEach(k => delete ID_CACHE[k]);
}
async function loadMonths() {
  if (DEMO) { MONTHS_AVAIL = ['2026-08', '2026-09']; return; }
  const r = await getJSON(CITY_API + '?action=months');
  MONTHS_AVAIL = r.months || []; INFO.backendWarnings = r.warnings || [];
}
async function loadMonth(ym, nocache) {
  if (DATA[ym] && !nocache) return;
  if (DEMO) { DATA[ym] = demoMonth(ym); return; }
  const r = await getJSON(CITY_API + '?action=month&m=' + ym + (nocache ? '&nocache=1' : ''));
  if (r.error) throw new Error(r.error);
  DATA[ym] = r;
}

// ── Build facts: one row per portal · city · SKU · period ──
function cm2Entry(p, label) { const e = (CM2.data || {})[p + '_' + label]; return e && typeof e === 'object' ? e : null; }
function latestCM2Before(p, label) {
  const ord = l => { const [m, y] = String(l || '').split(' '); const mi = MONTH_NAMES.indexOf(m); return mi < 0 || !+y ? -1 : (+y) * 12 + mi; };
  const target = ord(label); let best = null, bestO = -1;
  Object.keys(CM2.data || {}).forEach(k => {
    if (String(k).split('_')[0] !== p) return;
    const l = String(k).split('_').slice(1).join('_'), o = ord(l), en = CM2.data[k];
    if (o >= 0 && o < target && o > bestO && en && typeof en === 'object') { best = { e: en, label: l }; bestO = o; }
  });
  return best;
}
function adsNote() {
  const ests = PORTALS.map(p => (INFO.portals || {})[p]).filter(x => x && x.est);
  return ests.length ? ' (estimated from ' + ests[0].est.from + ')' : '';
}
function cfgFor(p, label) {
  const e = cm2Entry(p, label);
  if (e && e.config) return { cfg: e.config, src: 'CM2 · ' + label };
  // Month not in CM2 yet → rates of the latest earlier month in CM2 for this portal
  const ord = l => { const [m, y] = String(l || '').split(' '); const mi = MONTH_NAMES.indexOf(m); return mi < 0 || !+y ? -1 : (+y) * 12 + mi; };
  const target = ord(label);
  let best = null, bestO = -1;
  Object.keys(CM2.data || {}).forEach(k => {
    if (String(k).split('_')[0] !== p) return;
    const l = String(k).split('_').slice(1).join('_'), o = ord(l), en = CM2.data[k];
    if (o >= 0 && o < target && o > bestO && en && en.config) { best = { cfg: en.config, src: 'CM2 · ' + l + ' (latest available)' }; bestO = o; }
  });
  if (best) return best;
  if (CM2.config && CM2.config[p]) return { cfg: CM2.config[p], src: 'CM2 latest settings' };
  return { cfg: DEFAULT_CFG, src: 'Default (CM2 not loaded)' };
}
function costIndex(label) {
  // key → cost per portal for this month, then any portal this month, then most recent earlier month
  const idx = { byP:{}, any:{}, hist:{} };
  const keys = Object.keys(CM2.data || {});
  const order = l => { const [m, y] = String(l || '').split(' '); const mi = MONTH_NAMES.indexOf(m); return mi < 0 || !+y ? -1 : (+y) * 12 + mi; };
  const target = order(label);
  const lab = k => String(k).split('_').slice(1).join('_');
  keys.filter(k => order(lab(k)) >= 0 && CM2.data[k] && typeof CM2.data[k] === 'object')
      .sort((a, b) => order(lab(a)) - order(lab(b))).forEach(k => {
    const p = String(k).split('_')[0], e = CM2.data[k], o = order(lab(k));
    [...(Array.isArray(e.skus) ? e.skus : []), ...(Array.isArray(e.nlcSkus) ? e.nlcSkus : [])].forEach(s => {
      if (!s || !s.name) return;
      const c = +s.cost || 0; if (!c) return; const id = identify(p, s.name).key;
      if (o === target) { (idx.byP[p] = idx.byP[p] || {})[id] = c; idx.any[id] = c; }
      else if (o < target) idx.hist[id] = c;
    });
  });
  return (p, key) => (idx.byP[p] && idx.byP[p][key]) || idx.any[key] || idx.hist[key] || null;
}
function nlcIndex(label) {
  const exact = {}, base = {};
  ((DATA[ST.ym] || {}).nlc || []).forEach(([n, price]) => { const v = +String(price).replace(/[₹,\s]/g, '') || 0; if (!v) return; exact[ueNorm(n)] = v; base[ueBase(n)] = v; });
  const e = cm2Entry('instamart', label), cm2n = {};
  ((e && e.nlcSkus) || []).forEach(s => { if (+s.nlc_price) cm2n[ueNorm(s.name)] = +s.nlc_price; });
  return name => {
    const nn = ueNorm(name);
    if (exact[nn]) return { price: exact[nn], src: 'NLC sheet' };
    if (base[ueBase(name)]) return { price: base[ueBase(name)], src: 'NLC sheet' };
    if (cm2n[nn]) return { price: cm2n[nn], src: 'CM2 NLC price' };
    return null;
  };
}

function buildFacts() {
  const ym = ST.ym, label = ymLabel(ym), D = DATA[ym]; FACTS = [];
  INFO = Object.assign({ backendWarnings: INFO.backendWarnings || [] }, { portals:{}, unmapped:{}, missingCost:{}, nlc:{}, cities:{} });
  if (!D) return;
  CITY_MAP = {}; STATE_MAP = {};
  (D.cityMap || []).forEach(([a, b, st]) => {
    const std = String(b || a || '').trim(); if (!std) return;
    if (a && b) CITY_MAP[String(a).trim().toLowerCase().replace(/\s+/g, ' ')] = std;
    if (st) STATE_MAP[std.toLowerCase()] = String(st).trim();
  });
  const cost = costIndex(label), nlc = nlcIndex(label), nDays = daysIn(ym);
  // Instamart NLC share per product from CM2 for this month (NLC qty ÷ total qty).
  // Handles products that moved to NLC mid-way: before the switch CM2 has only regular qty → 0% NLC.
  const imE = cm2Entry('instamart', label), nlcSplit = {};
  if (imE) {
    const addQ = (s, isN) => { const k = ueKey(s.name); const o = nlcSplit[k] = nlcSplit[k] || { reg:0, nlc:0 }; o[isN ? 'nlc' : 'reg'] += +s.qty || 0; };
    (imE.skus || []).forEach(s => addQ(s, false)); (imE.nlcSkus || []).forEach(s => addQ(s, true));
  }
  const nlcShareOf = (sku, listed) => {
    const o = nlcSplit[ueKey(sku)];
    if (o && o.reg + o.nlc > 0) return { share: o.nlc / (o.reg + o.nlc), src: 'CM2 ' + label + ' qty split' };
    return { share: listed ? 1 : 0, src: listed ? 'NLC sheet (not in CM2 this month)' : '' };
  };
  INFO.nlcSplit = {}; INFO.nlcNoPrice = {};
  const src = {
    blinkit:   { sales: D.blinkit || [], promoDaily: [], promoRange: [] },
    zepto:     { sales: (D.zepto || {}).sales || [], promoDaily: (D.zepto || {}).promos || [], promoRange: [] },
    instamart: { sales: (D.swiggy || {}).sales || [], promoDaily: (D.swiggy || {}).promos || [], promoRange: [] },
  };
  PORTALS.forEach(p => {
    const { cfg, src: rateSrc } = cfgFor(p, label);
    const comm = (+cfg.commission || 0) / 100, tax = (+cfg.tax || 0) / 100;
    const de = (+cfg.directExp || 0) / 100, lab = (+cfg.labour || 0) / 100, lg = (+cfg.logistics || 0) / 100;
    const out = [];
    const mk = (city, sku, b) => {
      const id = identify(p, sku);
      if (!id.mapped) INFO.unmapped[p + '|' + sku] = { p, sku, label: id.label };
      const cn = normCity(city);
      return { p, city: cn, state: stateOf(cn), key: id.key, label: id.label, mapped: id.mapped, b, gmv:0, qty:0, gross:0, ns:0, comm:0, cogs:0, de:0, lab:0, log:0, promos:0, adsvis:0, nlc:false };
    };
    src[p].sales.forEach(([date, city, sku, qty, gmv, promos]) => {
      const f = mk(city, sku, bucketOf(date)); qty = +qty || 0; gmv = +gmv || 0;
      let gross;
      let n = p === 'instamart' ? nlc(sku) : null, sh = 0;
      if (p === 'instamart') {
        const r = nlcShareOf(sku, !!n); sh = r.share;
        if (sh > 0 && !n) { INFO.nlcNoPrice = INFO.nlcNoPrice || {}; INFO.nlcNoPrice[sku] = true; sh = 0; }
        if (n || sh > 0) INFO.nlcSplit[sku] = { share: sh, src: r.src, price: n ? n.price : null, priceSrc: n ? n.src : '' };
      }
      // NLC part: Qty × NLC price, no commission · Regular part: GMV less commission
      gross = qty * sh * (n ? n.price : 0) + gmv * (1 - sh) * (1 - comm);
      f.comm = gmv * (1 - sh) * comm;
      if (sh > 0) { f.nlc = true; INFO.nlc[sku] = n; }
      const ns = gross / (1 + tax), c = cost(p, f.key);
      if (c === null && qty) INFO.missingCost[p + '|' + f.key] = { p, label: f.label, qty: ((INFO.missingCost[p + '|' + f.key] || {}).qty || 0) + qty };
      Object.assign(f, { gmv, qty, gross, ns, cogs: qty * (c || 0), de: ns * de, lab: ns * lab, log: ns * lg, promos: +promos || 0,
        sh, nlcPrice: n ? n.price : 0, cost: c || 0 });
      out.push(f);
      (INFO.cities[f.city] = INFO.cities[f.city] || {})[p] = true;
    });
    // Promos without a SKU are spread over that city's SKUs in the same period by net sales
    const placePromo = (city, sku, b, amt) => {
      if (!amt) return;
      if (String(sku || '').trim()) {
        const f = mk(city, sku, b); f.promos = amt;
        // Promo files often drop the pack size: reuse the sales row's SKU identity if only the grams differ
        if (!f.mapped && f.key.endsWith('|')) {
          const twin = out.find(x => x.key.startsWith(f.key) && x.key !== f.key);
          if (twin) { f.key = twin.key; f.label = twin.label; f.mapped = twin.mapped; delete INFO.unmapped[p + '|' + sku]; }
        }
        out.push(f); return;
      }
      const c = normCity(city), pool = out.filter(x => x.city === c && x.b === b && x.ns > 0);
      const tw = pool.reduce((a, x) => a + x.ns, 0);
      if (tw > 0) pool.forEach(x => { x.promos += amt * x.ns / tw; });
      else { const f = mk(city, '(Promos with no sales)', b); f.key = '__promo_only'; f.label = '(Promos with no sales)'; f.mapped = true; f.promos = amt; out.push(f); }
    };
    src[p].promoDaily.forEach(([date, city, sku, amt]) => placePromo(city, sku, bucketOf(date), +amt || 0));
    src[p].promoRange.forEach(([from, to, city, sku, amt]) => {
      // Zepto ranges: split by days falling in each 1-10 / 11-20 / 21-end bucket of this month
      const ymF = String(from).slice(0, 7), ymT = String(to).slice(0, 7);
      const d1 = ymF < ym ? 1 : +String(from).slice(8, 10) || 1, d2 = ymT > ym ? nDays : +String(to).slice(8, 10) || nDays;
      const totalDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 864e5) + 1);
      [[1, 1, 10], [2, 11, 20], [3, 21, nDays]].forEach(([b, s, e]) => {
        const ov = Math.max(0, Math.min(e, d2) - Math.max(s, d1) + 1);
        if (ov) placePromo(city, sku, b, (+amt || 0) * ov / totalDays);
      });
    });
    // Ads + visibility: CM2 total for this portal-month, spread by net sales (or qty) share
    const e = cm2Entry(p, label); let t = null, adsvis = 0, est = null;
    const tot = en => totals(en.skus, en.nlcSkus, en.config || cfg, Object.assign({}, en.portalTotals || {}, { splitBy: ST.split }), Object.assign({}, en.nlcTotals || {}, { splitBy: ST.split }));
    if (e) { t = tot(e); adsvis = t.ads + t.vis; }
    else {
      // Month not in CM2 yet: estimate with the latest earlier month's Ads + Vis as % of Net Sales
      const prev = latestCM2Before(p, label);
      if (prev) {
        const pt = tot(prev.e), pctAV = pt.netSales > 0 ? (pt.ads + pt.vis) / pt.netSales : 0;
        const ns = out.reduce((a, x) => a + x.ns, 0);
        adsvis = ns * pctAV; est = { from: prev.label, pct: pctAV * 100 };
      }
    }
    if (adsvis) {
      const w = x => ST.split === 'qty' ? x.qty : x.ns, tw = out.reduce((a, x) => a + w(x), 0);
      if (tw > 0) out.forEach(x => { x.adsvis = adsvis * w(x) / tw; });
    }
    INFO.portals[p] = { cfg, rateSrc, cm2: t, adsvis, est, hasCM2: !!e, rows: src[p].sales.length };
    FACTS.push(...out);
  });
}

// ── Aggregation ───────────────────────────────────────
const SUMS = ['gmv','qty','gross','ns','comm','cogs','de','lab','log','promos','adsvis'];
function blank() { const a = {}; SUMS.forEach(k => a[k] = 0); return a; }
function add(a, f) { SUMS.forEach(k => a[k] += f[k] || 0); return a; }
function fin(a) { a.gm = a.ns - a.cogs - a.de; a.cm1 = a.gm - a.lab - a.log; a.cm2 = a.cm1 - a.promos - a.adsvis; return a; }
function view(extra) {
  return FACTS.filter(f => (ST.period === 'all' || f.b === +ST.period) && (ST.portal === 'all' || f.p === ST.portal) && (!extra || extra(f)));
}
function groupBy(list, keyFn, labelFn) {
  const g = {};
  list.forEach(f => { const k = keyFn(f); if (!g[k]) g[k] = { key:k, label: labelFn ? labelFn(f) : k, tot: blank(), portals:{} }; add(g[k].tot, f); add(g[k].portals[f.p] = g[k].portals[f.p] || blank(), f); });
  Object.values(g).forEach(x => { fin(x.tot); Object.values(x.portals).forEach(fin); });
  return Object.values(g).sort((a, b) => b.tot.ns - a.tot.ns);
}

// ── UI building blocks ────────────────────────────────
function sidebar() {
  const nv = (v, ic, lb) => '<div class="nav-item' + (ST.view === v ? ' active' : '') + '" onclick="go(\'' + v + '\')" title="' + lb + '"><span class="nav-icon">' + ic + '</span><span class="sb-lbl">' + lb + '</span></div>';
  return '<div class="sidebar' + (ST.sideCollapsed ? ' collapsed' : '') + '"><div class="sb-logo"><div class="sb-lbl"><div class="logo-brand">Snackible</div><div class="logo-sub">QCom City Sales</div></div>'
    + '<button class="sb-toggle" onclick="ST.sideCollapsed=!ST.sideCollapsed;render()">' + (ST.sideCollapsed ? '»' : '«') + '</button></div>'
    + '<div class="sec-label">Views</div>' + nv('overview', '🏙️', 'City Overview') + nv('city', '📍', 'City Detail') + nv('matrix', '🧩', 'SKU × City') + nv('health', '🩺', 'Data Health')
    + '<div class="sec-label">Links</div><a class="nav-item" href="' + CM2_URL + '" title="CM2 Dashboard"><span class="nav-icon">📊</span><span class="sb-lbl">CM2 Dashboard ↗</span></a>'
    + (DEMO ? '<div class="sec-label">Mode</div><div class="nav-item" style="cursor:default;color:var(--yellow)"><span class="nav-icon">🧪</span><span class="sb-lbl">Demo data</span></div>' : '')
    + '</div>';
}
function filters(showPortal) {
  const seg = (cur, opts, fn) => '<div class="seg">' + opts.map(([v, l]) => '<button class="' + (String(cur) === String(v) ? 'on' : '') + '" onclick="' + fn + '(\'' + v + '\')">' + l + '</button>').join('') + '</div>';
  return '<div class="ph-right">'
    + (showPortal === false ? '' : seg(ST.portal, [['all', 'All'], ['blinkit', 'Blinkit'], ['zepto', 'Zepto'], ['instamart', 'Instamart']], 'setPortal'))
    + '<select class="msel" onchange="setPeriod(this.value)">' + Object.entries(PERIODS).map(([v, l]) => '<option value="' + v + '"' + (String(ST.period) === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>'
    + '<select class="msel" onchange="setMonth(this.value)">' + MONTHS_AVAIL.map(m => '<option value="' + m + '"' + (m === ST.ym ? ' selected' : '') + '>' + ymLabel(m) + '</option>').join('') + '</select>'
    + '<span class="lbl-sm">Ads split</span>' + seg(ST.split, [['netSales', 'Net Sales'], ['qty', 'Qty']], 'setSplit')
    + '<button class="btn" onclick="exportWorking()" title="Excel with live formulas for the whole month">📥 Export working</button>'
    + '<button class="btn" onclick="refresh()" title="Reload data from sheets">↻</button></div>';
}
function scope() { return (ST.portal === 'all' ? 'All portals' : pLabel(ST.portal)) + ' · ' + (ST.ym ? ymLabel(ST.ym) : '') + ' · ' + PERIODS[ST.period]; }
function kpi(lbl, val, sub, cls) { return '<div class="card stat"><div class="lbl">' + lbl + '</div><div class="val ' + (cls || '') + '">' + val + '</div><div class="sub">' + (sub || '') + '</div></div>'; }
function kpiRow(t, extraSub) {
  return '<div class="g4 mb20">'
    + kpi('GMV', '₹' + fmt(t.gmv), fmt(t.qty) + ' units')
    + kpi('Net Sales', '₹' + fmt(t.ns), fmtPct(pct(t.ns, t.gmv)) + ' of GMV' + (extraSub || ''))
    + kpi('CM1', '₹' + fmt(t.cm1), fmtPct(pct(t.cm1, t.ns)) + ' of NS · ' + fmtPct(pct(t.cm1, t.gmv)) + ' of GMV', pc(t.cm1))
    + kpi('CM2', '₹' + fmt(t.cm2), fmtPct(pct(t.cm2, t.ns)) + ' of NS · ' + fmtPct(pct(t.cm2, t.gmv)) + ' of GMV', pc(t.cm2))
    + '</div>';
}
function fsStrip(t, title) {
  const c = (l, v, cls) => '<div class="fs-chip"><span>' + l + '</span><b class="' + (cls || '') + '">' + v + '</b></div>';
  return '<div class="fs-strip"><div class="fs-chip"><span>View</span><b style="font-size:13px">' + esc(title) + '</b></div>'
    + c('GMV', fmtL(t.gmv)) + c('Net Sales', fmtL(t.ns)) + c('CM1', fmtPct(pct(t.cm1, t.ns)), pc(t.cm1)) + c('CM2', fmtPct(pct(t.cm2, t.ns)), pc(t.cm2)) + '</div>';
}

// P&L row cells shared by city and SKU tables
const PL_HEAD = '<th>Qty</th><th>GMV</th><th>Net Sales</th><th>Share</th><th>Gross Margin</th><th>CM1</th><th>CM1%</th><th>Promos</th><th>Promo % GMV</th><th>Ads + Vis</th><th>CM2</th><th>CM2%</th>';
function plCells(a, base) {
  return '<td>' + fmt(a.qty) + '</td><td>₹' + fmt(a.gmv) + '</td><td><b>₹' + fmt(a.ns) + '</b></td><td class="muted">' + fmtPct(pct(a.ns, base)) + '</td>'
    + '<td>₹' + fmt(a.gm) + '</td><td>₹' + fmt(a.cm1) + '</td><td><span class="pill ' + pc(a.cm1) + '">' + fmtPct(pct(a.cm1, a.ns)) + '</span></td>'
    + '<td>₹' + fmt(a.promos) + '</td><td class="muted">' + fmtPct(pct(a.promos, a.gmv)) + '</td><td>₹' + fmt(a.adsvis) + '</td>'
    + '<td class="' + pc(a.cm2) + '"><b>₹' + fmt(a.cm2) + '</b></td><td><span class="pill ' + pc(a.cm2) + '">' + fmtPct(pct(a.cm2, a.ns)) + '</span></td>';
}
function plTable(id, groups, grand, firstCol, extraLabel) {
  const body = groups.map((g, i) => {
    const k = id + i, open = !!ST.open[k], ps = PORTALS.filter(p => g.portals[p]);
    let h = '<tr class="main" data-s="' + esc(g.label.toLowerCase()) + '" onclick="tog(\'' + k + '\')"><td title="' + esc(g.label) + '"><span class="car" id="car-' + k + '">' + (open ? '▾' : '▸') + '</span>' + (extraLabel ? extraLabel(g) : '') + esc(g.label) + '</td>' + plCells(g.tot, grand.ns) + '</tr>';
    ps.forEach(p => { h += '<tr class="sub sub-' + k + '" style="display:' + (open ? 'table-row' : 'none') + '"><td><span class="dot" style="background:' + pColor(p) + '"></span>' + pLabel(p) + '</td>' + plCells(g.portals[p], grand.ns) + '</tr>'; });
    return h;
  }).join('');
  return '<div class="twrap"><table class="tbl"><thead><tr><th>' + firstCol + '</th>' + PL_HEAD + '</tr></thead><tbody>'
    + (body || '<tr><td colspan="13" class="empty">No data for this selection</td></tr>')
    + '<tr class="gt"><td>Total</td>' + plCells(grand, grand.ns) + '</tr></tbody></table></div>';
}
function tableTools(cardId, searchPh) {
  return '<div class="flex" style="display:flex;gap:8px;align-items:center">'
    + (searchPh ? '<input class="search hide-fs" placeholder="' + searchPh + '" oninput="filterRows(this,\'' + cardId + '\')">' : '')
    + '<button class="btn" onclick="togAll(\'' + cardId + '\',true)">▾ Expand all</button><button class="btn" onclick="togAll(\'' + cardId + '\',false)">▴ Collapse all</button>'
    + '<button class="btn primary" id="fs-' + cardId + '" onclick="toggleFs(\'' + cardId + '\')">⛶ Expand</button></div>';
}

// ── Views ─────────────────────────────────────────────
function geoSeg() {
  return '<div class="seg">' + [['city', 'City'], ['state', 'State']].map(([v, l]) => '<button class="' + (ST.geo === v ? 'on' : '') + '" onclick="ST.geo=\'' + v + '\';ST.open={};render()">' + l + '</button>').join('') + '</div>';
}
const geoKey = f => ST.geo === 'state' ? f.state : f.city;
const geoWord = (pl, cap) => { const w = ST.geo === 'state' ? (pl ? 'states' : 'state') : (pl ? 'cities' : 'city'); return cap ? w[0].toUpperCase() + w.slice(1) : w; };
function vOverview() {
  const list = view(), grand = fin(list.reduce(add, blank()));
  const cities = groupBy(list.filter(f => f.ns || f.qty || f.promos), geoKey);
  const top5 = cities.slice(0, 5).reduce((a, c) => a + c.tot.ns, 0);
  const promoPct = pct(grand.promos, grand.gmv);
  return '<div class="ph"><div><div class="ph-title">City Overview</div><div class="ph-sub">' + scope() + '</div></div>' + filters() + '</div>'
    + kpiRow(grand)
    + '<div class="g4 mb20">'
    + kpi(geoWord(true, true), cities.length, ST.portal === 'all' ? 'with sales on any portal' : 'on ' + pLabel(ST.portal))
    + kpi('Top ' + geoWord(false, true), cities[0] ? esc(cities[0].label) : '—', cities[0] ? fmtPct(pct(cities[0].tot.ns, grand.ns)) + ' of net sales' : '')
    + kpi('Top 5 Share', fmtPct(pct(top5, grand.ns)), 'of net sales')
    + kpi('Promos', '₹' + fmt(grand.promos), fmtPct(promoPct) + ' of GMV · Ads + Vis ₹' + fmt(grand.adsvis) + adsNote())
    + '</div>'
    + '<div class="card mb20"><div class="thead-row"><div class="thead-title">Top 15 ' + geoWord(true, true) + ' by Net Sales</div><div style="display:flex;gap:10px;align-items:center"><span class="lbl-sm">Stacked by portal · hover for CM2%</span>' + geoSeg() + '</div></div><div class="chart-box"><canvas id="ch-cities"></canvas></div></div>'
    + '<div class="card" id="card-cities"><div class="thead-row"><div class="thead-title">' + geoWord(false, true) + ' P&amp;L · ' + esc(scope()) + '</div>' + tableTools('card-cities', 'Search ' + geoWord(false)) + '</div>'
    + fsStrip(grand, scope())
    + '<div class="note hide-fs">Net Sales: Blinkit & Zepto = GMV less commission less GST · Instamart NLC SKUs = Qty × NLC price less GST. Ads + Vis = CM2 portal total spread by ' + (ST.split === 'qty' ? 'qty' : 'net sales') + '. Click a row to see each portal.</div>'
    + plTable('c', cities, grand, geoWord(false, true)) + '</div>';
}
function drawOverviewChart() {
  const el = document.getElementById('ch-cities'); if (!el || !window.Chart) return;
  const cities = groupBy(view().filter(f => f.ns), geoKey).slice(0, 15);
  const ps = ST.portal === 'all' ? PORTALS : [ST.portal];
  CHARTS.push(new Chart(el, {
    type: 'bar',
    data: { labels: cities.map(c => c.label), datasets: ps.map(p => ({ label: pLabel(p), data: cities.map(c => Math.round((c.portals[p] || {}).ns || 0)), backgroundColor: pColor(p), borderRadius: 4, stack: 's' })) },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { family: 'Poppins' } } },
      tooltip: { callbacks: { label: c => c.dataset.label + ': ₹' + fmt(c.raw), afterBody: items => { const c = cities[items[0].dataIndex]; return 'CM2: ' + fmtPct(pct(c.tot.cm2, c.tot.ns)) + ' of NS'; } } } },
      scales: { x: { stacked: true, ticks: { callback: v => fmtL(v), font: { family: 'Poppins', size: 11 } }, grid: { color: '#EEF2F1' } },
                y: { stacked: true, ticks: { font: { family: 'Poppins', size: 11 } }, grid: { display: false } } } }
  }));
}

function vCity() {
  const all = groupBy(view().filter(f => f.ns || f.qty), f => f.city);
  if (!ST.city || !all.find(c => c.key === ST.city)) ST.city = all[0] ? all[0].key : null;
  const sel = '<select class="msel" onchange="ST.city=this.value;render()">' + all.map(c => '<option value="' + esc(c.key) + '"' + (c.key === ST.city ? ' selected' : '') + '>' + esc(c.label) + ' · ' + fmtL(c.tot.ns) + '</option>').join('') + '</select>';
  if (!ST.city) return '<div class="ph"><div class="ph-title">City Detail</div>' + filters() + '</div><div class="card empty">No data</div>';
  const list = view(f => f.city === ST.city), t = fin(list.reduce(add, blank()));
  const allNs = view().reduce((a, f) => a + f.ns, 0);
  const skus = groupBy(list, f => f.key, f => f.label);
  // Period split for the selected city (ignores the period filter)
  const per = [1, 2, 3].map(b => fin(FACTS.filter(f => f.city === ST.city && f.b === b && (ST.portal === 'all' || f.p === ST.portal)).reduce(add, blank())));
  const perRows = per.map((a, i) => '<tr><td>' + PERIODS[i + 1] + '</td><td>₹' + fmt(a.gmv) + '</td><td><b>₹' + fmt(a.ns) + '</b></td><td>₹' + fmt(a.promos) + '</td><td class="muted">' + fmtPct(pct(a.promos, a.gmv)) + '</td><td class="' + pc(a.cm2) + '">₹' + fmt(a.cm2) + '</td><td><span class="pill ' + pc(a.cm2) + '">' + fmtPct(pct(a.cm2, a.ns)) + '</span></td></tr>').join('');
  return '<div class="ph"><div><div class="ph-title">City Detail</div><div class="ph-sub">' + scope() + '</div></div><div class="ph-right">' + sel + '</div>' + filters() + '</div>'
    + kpiRow(t, ' · ' + fmtPct(pct(t.ns, allNs)) + ' of all cities')
    + '<div class="g2 mb20"><div class="card"><div class="thead-row"><div class="thead-title">' + esc(ST.city) + ' by Period</div><div class="lbl-sm">Matches Zepto promo ranges</div></div>'
    + '<div class="twrap" style="max-height:none"><table class="tbl"><thead><tr><th>Period</th><th>GMV</th><th>Net Sales</th><th>Promos</th><th>Promo % GMV</th><th>CM2</th><th>CM2%</th></tr></thead><tbody>' + perRows + '</tbody></table></div></div>'
    + '<div class="card"><div class="thead-row"><div class="thead-title">Net Sales by Period</div></div><div class="chart-box" style="height:230px"><canvas id="ch-period"></canvas></div></div></div>'
    + '<div class="card" id="card-skus"><div class="thead-row"><div class="thead-title">SKUs in ' + esc(ST.city) + '</div>' + tableTools('card-skus', 'Search SKU') + '</div>'
    + fsStrip(t, ST.city + ' · ' + scope())
    + plTable('s', skus, t, 'SKU', g => g.key.startsWith('A|') ? '<span class="tag warn" title="Not in SKU_Map">Unmapped</span>' : '') + '</div>';
}
function drawCityChart() {
  const el = document.getElementById('ch-period'); if (!el || !window.Chart) return;
  const ps = ST.portal === 'all' ? PORTALS : [ST.portal];
  CHARTS.push(new Chart(el, {
    type: 'bar',
    data: { labels: ['1–10', '11–20', '21–end'], datasets: ps.map(p => ({ label: pLabel(p), backgroundColor: pColor(p), borderRadius: 4, stack: 's',
      data: [1, 2, 3].map(b => Math.round(FACTS.filter(f => f.city === ST.city && f.p === p && f.b === b).reduce((a, f) => a + f.ns, 0))) })) },
    options: { maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ₹' + fmt(c.raw) } } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: v => fmtL(v) } } } }
  }));
}

function vMatrix() {
  const list = view(f => f.ns || f.qty);
  const cities = groupBy(list, geoKey), top = cities.slice(0, 12).map(c => c.key);
  const skus = groupBy(list, f => f.key, f => f.label);
  const M = { ns:['Net Sales', a => a.ns, 'amt'], qty:['Qty', a => a.qty, 'num'], cm2:['CM2 ₹', a => a.cm2, 'amt'], cm2p:['CM2 % of NS', a => pct(a.cm2, a.ns), 'pct'], promo:['Promo % of GMV', a => pct(a.promos, a.gmv), 'pct'] };
  const [mName, mFn, mType] = M[ST.metric];
  const cell = {}; list.forEach(f => { const c = top.includes(geoKey(f)) ? geoKey(f) : '__others'; const k = f.key + '||' + c; add(cell[k] = cell[k] || blank(), f); });
  const show = (a, max) => {
    if (!a) return '<td class="muted">—</td>'; fin(a); const v = mFn(a);
    if (mType === 'pct') return '<td><span class="pill ' + pc(v) + '">' + fmtPct(v) + '</span></td>';
    const al = max > 0 ? Math.max(0, Math.min(1, v / max)) : 0;
    return '<td class="heat" style="background:rgba(2,81,79,' + (0.04 + al * 0.28).toFixed(2) + ')">' + (mType === 'amt' ? fmtL(v) : fmt(v)) + '</td>';
  };
  const cols = [...top, '__others'];
  const rows = skus.map(s => {
    const max = Math.max(...cols.map(c => { const a = cell[s.key + '||' + c]; return a ? mFn(fin(a)) : 0; }));
    return '<tr><td title="' + esc(s.label) + '">' + (s.key.startsWith('A|') ? '<span class="tag warn" title="Not in SKU_Map">Unmapped</span>' : '') + esc(s.label) + '</td>' + cols.map(c => show(cell[s.key + '||' + c], max)).join('') + show(Object.assign({}, s.tot), Math.max(max, mFn(s.tot))) + '</tr>';
  }).join('');
  const sel = '<div class="seg">' + Object.entries(M).map(([k, v]) => '<button class="' + (ST.metric === k ? 'on' : '') + '" onclick="ST.metric=\'' + k + '\';render()">' + v[0] + '</button>').join('') + '</div>';
  const grand = fin(list.reduce(add, blank()));
  return '<div class="ph"><div><div class="ph-title">SKU × ' + geoWord(false, true) + '</div><div class="ph-sub">' + scope() + ' · top 12 ' + geoWord(true) + ' by net sales</div></div>' + filters() + '</div>'
    + '<div class="card" id="card-matrix"><div class="thead-row"><div class="thead-title">' + mName + ' by SKU and ' + geoWord(false, true) + '</div><div style="display:flex;gap:8px">' + sel + '' + geoSeg() + '<button class="btn primary" id="fs-card-matrix" onclick="toggleFs(\'card-matrix\')">⛶ Expand</button></div></div>'
    + fsStrip(grand, mName + ' · ' + scope())
    + '<div class="twrap"><table class="tbl"><thead><tr><th>SKU</th>' + top.map(c => '<th>' + esc(c) + '</th>').join('') + '<th>Other ' + geoWord(true) + '</th><th>Total</th></tr></thead><tbody>' + (rows || '<tr><td class="empty" colspan="15">No data</td></tr>') + '</tbody></table></div></div>';
}

function vHealth() {
  const label = ymLabel(ST.ym);
  const recon = PORTALS.map(p => {
    const city = fin(FACTS.filter(f => f.p === p).reduce(add, blank())), I = INFO.portals[p] || {}, t = I.cm2;
    const diff = (a, b) => b ? '<td class="' + (Math.abs(pct(a - b, b)) <= 1 ? 'pos' : 'neg') + '">' + fmtPct(pct(a - b, b)) + '</td>' : '<td class="muted">—</td>';
    return '<tr><td><span class="dot" style="background:' + pColor(p) + '"></span>' + pLabel(p) + '</td>'
      + '<td>₹' + fmt(city.gmv) + '</td><td>' + (t ? '₹' + fmt(t.gmv) : '—') + '</td>' + diff(city.gmv, t && t.gmv)
      + '<td>₹' + fmt(city.ns) + '</td><td>' + (t ? '₹' + fmt(t.netSales) : '—') + '</td>' + diff(city.ns, t && t.netSales)
      + '<td>₹' + fmt(city.promos) + '</td><td>' + (t ? '₹' + fmt(t.promos) : '—') + '</td>' + diff(city.promos, t && t.promos)
      + '<td>₹' + fmt(city.adsvis) + (I.est ? '<div class="lbl-sm" style="color:#9A5B00">est. ' + fmtPct(I.est.pct) + ' of NS from ' + I.est.from + '</div>' : '') + '</td></tr>';
  }).join('');
  const rates = PORTALS.map(p => { const I = INFO.portals[p] || {}, c = I.cfg || {}; return '<tr><td>' + pLabel(p) + '</td><td>' + c.commission + '%</td><td>' + c.tax + '%</td><td>' + c.directExp + '%</td><td>' + c.labour + '%</td><td>' + c.logistics + '%</td><td class="l muted">' + (I.rateSrc || '') + '</td></tr>'; }).join('');
  const unm = Object.values(INFO.unmapped).filter(u => u.sku && u.sku !== '(Promos with no sales)');
  window.UNMAPPED_TSV = unm.map(u => [u.p === 'instamart' ? 'Instamart' : pLabel(u.p), u.sku, '', ''].join('\t')).join('\n');
  const miss = Object.values(INFO.missingCost);
  const nlc = Object.entries(INFO.nlc);
  const cityRows = Object.entries(INFO.cities).sort((a, b) => a[0].localeCompare(b[0]));
  window.CITY_TSV = cityRows.filter(([c]) => stateOf(c) === 'Unmapped state').map(([c]) => c + '\t' + c + '\t').join('\n');
  const noState = cityRows.filter(([c]) => stateOf(c) === 'Unmapped state').length;
  const bar = (ok, okMsg, warnMsg, btn) => ok ? '<div class="ok-bar">' + okMsg + '</div>' : '<div class="warn-bar">' + warnMsg + (btn || '') + '</div>';
  return '<div class="ph"><div><div class="ph-title">Data Health</div><div class="ph-sub">' + label + ' · checks against the CM2 dashboard</div></div>' + filters(false) + '</div>'
    + '<div class="card mb20"><div class="thead-row"><div class="thead-title">Reconciliation vs CM2 · ' + label + '</div><div class="lbl-sm">Within ±1% shows green</div></div>'
    + (CM2_OK ? '' : '<div class="warn-bar">CM2 backend could not be loaded, so rates are defaults and ads/vis are zero.</div>')
    + '<div class="twrap" style="max-height:none"><table class="tbl hgrid"><thead><tr><th>Portal</th><th>GMV · City files</th><th>GMV · CM2</th><th>Diff</th><th>Net Sales · City</th><th>Net Sales · CM2</th><th>Diff</th><th>Promos · City</th><th>Promos · CM2</th><th>Diff</th><th>Ads + Vis spread</th></tr></thead><tbody>' + recon + '</tbody></table></div></div>'
    + '<div class="g2 mb20"><div class="card"><div class="thead-row"><div class="thead-title">Rates used</div></div><div class="twrap" style="max-height:none"><table class="tbl hgrid"><thead><tr><th>Portal</th><th>Comm.</th><th>GST</th><th>Direct Exp</th><th>Labour</th><th>Logistics</th><th class="l">Source</th></tr></thead><tbody>' + rates + '</tbody></table></div></div>'
    + '<div class="card"><div class="thead-row"><div class="thead-title">Instamart NLC SKUs (' + Object.keys(INFO.nlcSplit || {}).length + ')</div></div><div class="twrap" style="max-height:260px"><table class="tbl hgrid"><thead><tr><th>SKU</th><th>NLC Price</th><th>NLC share</th><th class="l">Share from</th></tr></thead><tbody>'
    + (Object.entries(INFO.nlcSplit || {}).map(([n, v]) => '<tr><td title="' + esc(n) + '">' + esc(n) + '</td><td>' + (v.price ? '₹' + v.price : '—') + '</td><td>' + fmtPct(v.share * 100) + '</td><td class="l muted">' + esc(v.src) + '</td></tr>').join('')
    + Object.keys(INFO.nlcNoPrice || {}).map(n => '<tr><td>' + esc(n) + '</td><td class="neg">missing</td><td class="neg">treated regular</td><td class="l neg">Add to Swiggy_NLC_Prices</td></tr>').join('') || '<tr><td colspan="3" class="empty">No Instamart SKU matched the NLC price sheet</td></tr>') + '</tbody></table></div></div></div>'
    + '<div class="card mb20"><div class="thead-row"><div class="thead-title">SKU mapping</div><button class="btn" onclick="reloadMap()">↻ Reload SKU_Map</button></div>'
    + (MAP_INFO.n ? '<div class="ok-bar">SKU_Map loaded from CM2: ' + MAP_INFO.n + ' rows.</div>' : '<div class="warn-bar">SKU_Map not loaded from CM2' + (MAP_INFO.err ? ': ' + esc(MAP_INFO.err) : '') + '. Every SKU is being auto matched. Click Reload SKU_Map.</div>')
    + bar(!unm.length, 'All city file SKU names are in SKU_Map (shared with CM2).', unm.length + ' SKU names not in SKU_Map, matched automatically. Add them to the CM2 SKU_Map tab. ', '<button class="btn" onclick="copyTSV(\'UNMAPPED_TSV\')">📋 Copy unmapped</button>')
    + (unm.length ? '<div class="twrap" style="max-height:260px"><table class="tbl hgrid"><thead><tr><th>Portal SKU name</th><th class="l">Portal</th><th class="l">Matched as</th></tr></thead><tbody>' + unm.map(u => '<tr><td title="' + esc(u.sku) + '">' + esc(u.sku) + '</td><td class="l">' + pLabel(u.p) + '</td><td class="l muted">' + esc(u.label) + '</td></tr>').join('') + '</tbody></table></div>' : '') + '</div>'
    + '<div class="card mb20"><div class="thead-row"><div class="thead-title">Cost per unit</div></div>'
    + bar(!miss.length, 'Every SKU found a cost per unit in CM2.', miss.length + ' SKUs have no cost in CM2 for this or earlier months, so COGS is zero for them.')
    + (miss.length ? '<div class="twrap" style="max-height:220px"><table class="tbl hgrid"><thead><tr><th>SKU</th><th class="l">Portal</th><th>Qty</th></tr></thead><tbody>' + miss.map(m => '<tr><td>' + esc(m.label) + '</td><td class="l">' + pLabel(m.p) + '</td><td>' + fmt(m.qty) + '</td></tr>').join('') + '</tbody></table></div>' : '') + '</div>'
    + '<div class="card mb20"><div class="thead-row"><div class="thead-title">City names (' + cityRows.length + ')</div><button class="btn" onclick="copyTSV(\'CITY_TSV\')">📋 Copy cities without state</button></div>'
    + (noState ? '<div class="warn-bar">' + noState + ' cities have no state. Paste them into City_Map and fill the State column.</div>' : '<div class="ok-bar">Every city has a state.</div>')
    + '<div class="note">Same city spelt two ways (one per portal)? Add a City_Map row: Portal City → Standard City → State.</div>'
    + '<div class="twrap" style="max-height:300px"><table class="tbl hgrid"><thead><tr><th>City</th><th class="l">State</th>' + PORTALS.map(p => '<th>' + pLabel(p) + '</th>').join('') + '</tr></thead><tbody>'
    + cityRows.map(([c, ps]) => '<tr><td>' + esc(c) + '</td><td class="l ' + (stateOf(c) === 'Unmapped state' ? 'neg' : 'muted') + '">' + esc(stateOf(c)) + '</td>' + PORTALS.map(p => '<td>' + (ps[p] ? '✓' : '<span class="muted">—</span>') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div></div>'
    + ((INFO.backendWarnings || []).length || ((DATA[ST.ym] || {}).warnings || []).length ? '<div class="card"><div class="thead-row"><div class="thead-title">Sheet warnings</div></div><div class="warn-bar">' + [...(INFO.backendWarnings || []), ...((DATA[ST.ym] || {}).warnings || [])].map(esc).join('<br>') + '</div></div>' : '');
}

// ── Excel export with live formulas (whole month, all portals) ──
function exportWorking() {
  if (!FACTS.length) { toast('Nothing to export', 'err'); return; }
  const run = () => {
    const f = x => ({ t:'n', f:x });
    const label = ymLabel(ST.ym), byQty = ST.split === 'qty';
    // 1. Aggregate facts to portal · city · SKU · period
    const agg = {};
    FACTS.forEach(x => {
      const k = [x.p, x.city, x.key, x.b].join('¦');
      const a = agg[k] = agg[k] || { p:x.p, city:x.city, state:x.state, label:x.label, b:x.b, qty:0, gmv:0, promos:0, nlcQty:0, cogs:0, price:0 };
      a.qty += x.qty || 0; a.gmv += x.gmv || 0; a.promos += x.promos || 0; a.cogs += x.cogs || 0;
      a.nlcQty += (x.qty || 0) * (x.sh || 0); if (x.nlcPrice) a.price = x.nlcPrice;
    });
    const rows = Object.values(agg).sort((a, b) => a.p.localeCompare(b.p) || a.city.localeCompare(b.city) || a.label.localeCompare(b.label) || a.b - b.b);
    const n = rows.length, L = n + 1;
    const H = ['Portal','City','State','Period','SKU','Qty','GMV','Cost / Unit','NLC Share','NLC Price','Commission %','GST %','Direct Exp %','Labour %','Logistics %',
      'Gross Sales','Commission','Net Sales','GST','COGS','Direct Exp','Gross Margin','Labour','Logistics','CM1','Promos',
      'Split Basis (' + (byQty ? 'Qty' : 'Net Sales') + ')','Portal Basis Total','Share of Portal','Ads + Vis Pool','Ads + Vis','CM2','CM1 % NS','CM2 % NS'];
    const W = [H];
    rows.forEach((a, i) => {
      const r = i + 2, cfg = (INFO.portals[a.p] || {}).cfg || DEFAULT_CFG;
      W.push([pLabel(a.p), a.city, a.state, PERIODS[a.b], a.label, a.qty, a.gmv, a.qty ? a.cogs / a.qty : 0, a.qty ? a.nlcQty / a.qty : 0, a.price || 0,
        (+cfg.commission || 0) / 100, (+cfg.tax || 0) / 100, (+cfg.directExp || 0) / 100, (+cfg.labour || 0) / 100, (+cfg.logistics || 0) / 100,
        f('F'+r+'*I'+r+'*J'+r+'+G'+r+'*(1-I'+r+')*(1-K'+r+')'),
        f('G'+r+'*(1-I'+r+')*K'+r),
        f('P'+r+'/(1+L'+r+')'),
        f('P'+r+'-R'+r),
        f('F'+r+'*H'+r),
        f('R'+r+'*M'+r),
        f('R'+r+'-T'+r+'-U'+r),
        f('R'+r+'*N'+r),
        f('R'+r+'*O'+r),
        f('V'+r+'-W'+r+'-X'+r),
        a.promos,
        f(byQty ? 'F'+r : 'R'+r),
        f('SUMIFS($AA$2:$AA$'+L+',$A$2:$A$'+L+',A'+r+')'),
        f('IF(AB'+r+'=0,0,AA'+r+'/AB'+r+')'),
        f('SUMIFS(Pools!$D:$D,Pools!$A:$A,A'+r+')'),
        f('AD'+r+'*AC'+r),
        f('Y'+r+'-Z'+r+'-AE'+r),
        f('IF(R'+r+'=0,0,Y'+r+'/R'+r+')'),
        f('IF(R'+r+'=0,0,AF'+r+'/R'+r+')')]);
    });
    const ws = XLSX.utils.aoa_to_sheet(W);
    const money = ['G','H','J','P','Q','R','S','T','U','V','W','X','Y','Z','AA','AB','AD','AE','AF'], pcts = ['I','K','L','M','N','O','AC','AG','AH'];
    for (let r = 2; r <= L; r++) { money.forEach(c => { if (ws[c+r]) ws[c+r].z = '#,##0.00'; }); pcts.forEach(c => { if (ws[c+r]) ws[c+r].z = '0.00%'; }); }
    ws['!cols'] = H.map((h, i) => ({ wch: i === 4 ? 42 : i === 1 ? 18 : Math.max(11, h.length + 2) }));
    ws['!autofilter'] = { ref: 'A1:AH' + L };

    // 2. Pools: CM2 ads + visibility per portal for the month
    const P = [['Portal','CM2 Ads','CM2 Visibility','Ads + Vis Pool','CM2 Net Sales','City files Net Sales','Diff %','Estimate % of NS','Basis']];
    PORTALS.forEach((p, i) => {
      const I = INFO.portals[p] || {}, t = I.cm2, r = i + 2;
      if (I.est) P.push([pLabel(p), 0, 0, f('F'+r+'*H'+r), 0, f('SUMIFS(Working!$R:$R,Working!$A:$A,A'+r+')'), '', I.est.pct / 100, 'Estimated: ' + I.est.from + ' Ads + Vis as % of Net Sales × this month\'s Net Sales']);
      else P.push([pLabel(p), t ? t.ads : 0, t ? t.vis : 0, f('B'+r+'+C'+r), t ? t.netSales : 0,
        f('SUMIFS(Working!$R:$R,Working!$A:$A,A'+r+')'), f('IF(E'+r+'=0,0,F'+r+'/E'+r+'-1)'), '', t ? 'CM2 ' + label + ' actual' : 'No CM2 data']);
    });
    const wp = XLSX.utils.aoa_to_sheet(P);
    for (let r = 2; r <= 4; r++) { ['B','C','D','E','F'].forEach(c => { if (wp[c+r]) wp[c+r].z = '#,##0.00'; }); ['G','H'].forEach(c => { if (wp[c+r]) wp[c+r].z = '0.00%'; }); }
    wp['!cols'] = P[0].map(h => ({ wch: Math.max(14, h.length + 2) }));

    // 3. Summaries by City and State (SUMIFS on Working)
    const summary = (col, name) => {
      const keys = [...new Set(rows.map(a => name === 'City' ? a.city : a.state))].sort();
      const SH = [name,'Qty','GMV','Net Sales','Gross Margin','CM1','Promos','Ads + Vis','CM2','Share of NS','CM1 % NS','Promo % GMV','CM2 % NS'];
      const out = [SH], last = keys.length + 1, tr = last + 1;
      const sm = (c, r) => f('SUMIFS(Working!$' + c + '$2:$' + c + '$' + L + ',Working!$' + col + '$2:$' + col + '$' + L + ',$A' + r + ')');
      keys.forEach((k, i) => { const r = i + 2;
        out.push([k, sm('F', r), sm('G', r), sm('R', r), sm('V', r), sm('Y', r), sm('Z', r), sm('AE', r), sm('AF', r),
          f('IF($D$'+tr+'=0,0,D'+r+'/$D$'+tr+')'), f('IF(D'+r+'=0,0,F'+r+'/D'+r+')'), f('IF(C'+r+'=0,0,G'+r+'/C'+r+')'), f('IF(D'+r+'=0,0,I'+r+'/D'+r+')')]); });
      out.push(['Total', ...['B','C','D','E','F','G','H','I'].map(c => f('SUM(' + c + '2:' + c + last + ')')),
        f('IF(D'+tr+'=0,0,D'+tr+'/D'+tr+')'), f('IF(D'+tr+'=0,0,F'+tr+'/D'+tr+')'), f('IF(C'+tr+'=0,0,G'+tr+'/C'+tr+')'), f('IF(D'+tr+'=0,0,I'+tr+'/D'+tr+')')]);
      const w = XLSX.utils.aoa_to_sheet(out);
      for (let r = 2; r <= tr; r++) { ['B','C','D','E','F','G','H','I'].forEach(c => { if (w[c+r]) w[c+r].z = '#,##0'; }); ['J','K','L','M'].forEach(c => { if (w[c+r]) w[c+r].z = '0.00%'; }); }
      w['!cols'] = SH.map((h, i) => ({ wch: i === 0 ? 22 : 14 }));
      return w;
    };

    // 4. Notes
    const notes = [['How this file works · ' + label],
      ['Working: one row per Portal · City · SKU · Period. Inputs: Qty, GMV, Cost/Unit, NLC Share, NLC Price, rates, Promos. Everything else is a live formula.'],
      ['Gross Sales = Qty × NLC Share × NLC Price  +  GMV × (1 − NLC Share) × (1 − Commission %). Blinkit and Zepto have NLC Share 0.'],
      ['NLC Share (Instamart): NLC qty ÷ total qty for that product in the CM2 dashboard this month. 100% if listed in Swiggy_NLC_Prices but not in CM2.'],
      ['Net Sales = Gross Sales ÷ (1 + GST %). Direct Exp, Labour, Logistics = % × Net Sales. Gross Margin = Net Sales − COGS − Direct Exp. CM1 = Gross Margin − Labour − Logistics.'],
      ['Cost / Unit: from the CM2 dashboard for the same month (latest earlier month if missing).'],
      ['Promos: straight from the city promo files. Promo rows without a SKU are spread over that city\'s SKUs in the same period by Net Sales.'],
      ['Ads + Vis: CM2 portal total for the month (Pools sheet) × the row\'s share of that portal\'s ' + (byQty ? 'Qty' : 'Net Sales') + '. CM2 = CM1 − Promos − Ads + Vis.'],
      ['Periods: 1st–10th, 11th–20th, 21st–month end, matching Zepto promo windows. Filter Working by Period to see one window.'],
      ['City / State sheets: SUMIFS on Working. Pools also compares city-file Net Sales with CM2 Net Sales per portal.']];
    const wn = XLSX.utils.aoa_to_sheet(notes); wn['!cols'] = [{ wch: 150 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summary('B', 'City'), 'By City');
    XLSX.utils.book_append_sheet(wb, summary('C', 'State'), 'By State');
    XLSX.utils.book_append_sheet(wb, ws, 'Working');
    XLSX.utils.book_append_sheet(wb, wp, 'Pools');
    XLSX.utils.book_append_sheet(wb, wn, 'Notes');
    XLSX.writeFile(wb, 'Snackible_City_Sales_' + label.replace(/ /g, '_') + '.xlsx');
    toast('Exported ' + n + ' rows');
  };
  if (typeof XLSX !== 'undefined') run();
  else { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; sc.onload = run; sc.onerror = () => toast('Could not load Excel library', 'err'); document.head.appendChild(sc); }
}

// ── Render & events ───────────────────────────────────
function render() {
  CHARTS.forEach(c => c.destroy()); CHARTS = [];
  let body;
  if (!ST.ym) body = '<div class="card empty">No months found in the City Sales sheet yet. Paste your first pivot and click ↻.</div>';
  else body = ({ overview: vOverview, city: vCity, matrix: vMatrix, health: vHealth }[ST.view] || vOverview)();
  const err = LOAD_ERR ? '<div class="warn-bar" style="margin:0 0 16px">Something failed while loading: ' + esc(LOAD_ERR) + '</div>' : '';
  document.getElementById('app').innerHTML = '<div class="shell">' + sidebar() + '<main class="main">' + err + body + '</main></div>';
  if (ST.view === 'overview') drawOverviewChart();
  if (ST.view === 'city') drawCityChart();
}
async function reloadMap() {
  showLoading('Reloading SKU_Map…'); await loadMap(); buildFacts(); render();
  toast(MAP_INFO.n ? 'SKU_Map loaded · ' + MAP_INFO.n + ' rows' : 'SKU_Map failed: ' + MAP_INFO.err, MAP_INFO.n ? '' : 'err');
}
function go(v) { ST.view = v; ST.open = {}; render(); }
function setPortal(p) { ST.portal = p; render(); }
function setPeriod(p) { ST.period = p === 'all' ? 'all' : +p; render(); }
function setSplit(s) { ST.split = s; buildFacts(); render(); }
async function setMonth(ym) {
  ST.ym = ym; showLoading('Loading ' + ymLabel(ym) + '…');
  try { await loadMonth(ym); buildFacts(); LOAD_ERR = ''; } catch (e) { LOAD_ERR = String(e && e.stack || e).split('\n').slice(0, 3).join(' | '); toast('Could not load ' + ymLabel(ym) + ': ' + e.message, 'err'); }
  render();
}
async function refresh() {
  showLoading('Refreshing from sheets…');
  try {
    await Promise.all([loadCM2(), loadMap(), loadMonths()]);
    if (!MONTHS_AVAIL.includes(ST.ym)) ST.ym = MONTHS_AVAIL[MONTHS_AVAIL.length - 1] || null;
    if (ST.ym) await loadMonth(ST.ym, true);
    buildFacts(); LOAD_ERR = ''; toast('Data refreshed');
  } catch (e) { LOAD_ERR = String(e && e.stack || e).split('\n').slice(0, 3).join(' | '); toast('Refresh failed: ' + e.message, 'err'); }
  render();
}
function showLoading(msg) { const m = document.querySelector('.main'); if (m) m.innerHTML = '<div class="loading"><div class="spin"></div><div>' + msg + '</div></div>'; }
function tog(k) {
  ST.open[k] = !ST.open[k];
  document.querySelectorAll('.sub-' + k).forEach(r => r.style.display = ST.open[k] ? 'table-row' : 'none');
  const c = document.getElementById('car-' + k); if (c) c.textContent = ST.open[k] ? '▾' : '▸';
}
function togAll(cardId, open) {
  document.querySelectorAll('#' + cardId + ' tr.main').forEach(tr => { if (tr.style.display === 'none') return; const k = tr.getAttribute('onclick').match(/'(.+)'/)[1]; if (!!ST.open[k] !== open) tog(k); });
}
function filterRows(inp, cardId) {
  const q = inp.value.trim().toLowerCase();
  document.querySelectorAll('#' + cardId + ' tr.main').forEach(tr => {
    const hit = !q || (tr.dataset.s || '').includes(q); tr.style.display = hit ? '' : 'none';
    const k = tr.getAttribute('onclick').match(/'(.+)'/)[1];
    document.querySelectorAll('.sub-' + k).forEach(r => r.style.display = hit && ST.open[k] ? 'table-row' : 'none');
  });
}
function copyTSV(v) {
  const t = window[v] || ''; if (!t) { toast('Nothing to copy'); return; }
  const done = () => toast('Copied ' + t.split('\n').length + ' rows');
  navigator.clipboard ? navigator.clipboard.writeText(t).then(done).catch(() => prompt('Copy:', t)) : prompt('Copy:', t);
}
function toggleFs(id) {
  const el = document.getElementById(id); if (!el) return;
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
  if (el.classList.contains('is-fs')) { setFs(el, false); return; }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) { try { const pr = req.call(el); if (pr && pr.catch) pr.catch(() => setFs(el, true)); } catch (e) { setFs(el, true); } } else setFs(el, true);
}
function setFs(el, on) {
  el.classList.toggle('is-fs', on); document.body.style.overflow = on ? 'hidden' : '';
  const b = document.getElementById('fs-' + el.id); if (b) b.textContent = on ? '✕ Exit' : '⛶ Expand';
}
['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  document.querySelectorAll('.is-fs').forEach(x => { if (x !== fsEl) setFs(x, false); });
  if (fsEl) setFs(fsEl, true);
}));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.fullscreenElement) document.querySelectorAll('.is-fs').forEach(x => setFs(x, false)); });

async function init() {
  try {
    await Promise.all([loadCM2(), loadMap(), loadMonths()]);
    ST.ym = MONTHS_AVAIL[MONTHS_AVAIL.length - 1] || null;
    if (ST.ym) { await loadMonth(ST.ym); buildFacts(); }
    LOAD_ERR = '';
  } catch (e) { LOAD_ERR = (e && e.stack) ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e); console.error(e); toast('Load failed: ' + e.message, 'err'); }
  render();
}

// ── Demo data (used until CITY_API is set, or with ?demo=1) ──
function rng(seed) { let s = seed; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }
const DEMO_SKUS = {
  blinkit: [['Snackible Peri Peri Ragi Chips 57 g', 50, 14.7], ['Snackible Cheese Dosa Khakhra 100 g', 120, 39], ['Snackible Desi Masala Ragi Chips 57 g', 50, 13.5], ['Snackible Nacho Cheese Jowar Puffs 35 g', 40, 8.7], ['Snackible Biscuit Sticks with Chocolatey Dip 34 g', 35, 10.8]],
  zepto: [['Snackible Peri Peri Ragi Chips - High Fibre, No Palm Oil 57.0 GRAM', 50, 14.7], ['Snackible Cheese Dosa Khakhra | Millet Snack 100.0 GRAM', 120, 39], ['Snackible Desi Masala Ragi Chips | High Fibre 57.0 GRAM', 50, 13.5], ['Snackible Nacho Cheese Jowar Puffs | Millet Snack 35.0 GRAM', 40, 8.7]],
  instamart: [['Snackible Peri Peri Ragi Chips - High Fibre', 50, 14.7], ['Snackible Cheese Dosa Khakra - Roasted, No Palm Oil', 120, 39], ['Snackible Peri Peri Ragi Chips 165 g', 145, 41.3], ['Snackible Nacho Cheese Jowar Puffs - Millet Snack', 40, 8.7]],
};
const DEMO_CITIES = [['Mumbai', 1], ['Bengaluru', .9], ['Delhi', .7], ['Pune', .45], ['Hyderabad', .4], ['Gurugram', .35], ['Chennai', .3], ['Kolkata', .2], ['Ahmedabad', .15], ['Noida', .15], ['Jaipur', .08], ['Lucknow', .06]];
function demoMonth(ym) {
  const r = rng(ym === '2026-09' ? 7 : 3), n = daysIn(ym), out = { blinkit: [], zepto: { sales: [], promos: [] }, swiggy: { sales: [], promos: [] }, nlc: [['Snackible Peri Peri Ragi Chips - High Fibre', 26], ['Snackible Cheese Dosa Khakra - Roasted, No Palm Oil', 62]], cityMap: [['Bangalore', 'Bengaluru', 'Karnataka']], warnings: [] };
  const scale = { blinkit: 60, zepto: 28, instamart: 22 };
  PORTALS.forEach(p => DEMO_CITIES.forEach(([city, w]) => DEMO_SKUS[p].forEach(([sku, mrp]) => {
    for (let d = 1; d <= n; d += 3) {
      const q = Math.round(scale[p] * w * (0.5 + r()) * (mrp > 100 ? 0.3 : 1)); if (!q) continue;
      const date = ym + '-' + ('0' + d).slice(-2), gmv = q * mrp * (0.97 + r() * 0.03), cName = p === 'zepto' && city === 'Bengaluru' ? 'Bangalore' : city;
      if (p === 'blinkit') out.blinkit.push([date, cName, sku, q, gmv, gmv * (0.05 + r() * 0.06)]);
      else if (p === 'zepto') out.zepto.sales.push([date, cName, sku, q, gmv]);
      else { out.swiggy.sales.push([date, cName, sku, q, gmv]); out.swiggy.promos.push([date, cName, sku, gmv * (0.02 + r() * 0.04)]); }
    }
  })));
  DEMO_CITIES.forEach(([city, w]) => [6, 16, 26].forEach(d => DEMO_SKUS.zepto.forEach(([sku]) => out.zepto.promos.push([ym + '-' + d, city, sku.split(/ \d/)[0], 2200 * w * (0.6 + r())]))));
  return out;
}
function demoCM2() {
  const data = {};
  ['August 2026', 'September 2026'].forEach(l => PORTALS.forEach(p => {
    data[p + '_' + l] = { config: { commission: p === 'instamart' ? 32 : 35, tax: 5, directExp: 2.3, labour: 2.12, logistics: 11.25 },
      skus: DEMO_SKUS[p].map(([n, mrp, cost]) => ({ name: n, gmv: mrp * 4000, qty: 4000, cost })), nlcSkus: [],
      portalTotals: { ads: p === 'blinkit' ? 900000 : 250000, vis: p === 'blinkit' ? 120000 : 40000, promos: 300000 }, nlcTotals: {} };
  }));
  return { config: {}, data };
}

init();

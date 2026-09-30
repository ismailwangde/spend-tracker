/**
 * Spend Tracker v1: bank SMS on your iPhone -> this Sheet.
 *
 * Your data stays in this Sheet, in your own Google account. The shortcut on your phone sends bank SMS
 * only to this script. This script can open only this one spreadsheet (@OnlyCurrentDoc below): it has no
 * access to your Gmail, Drive or any other file, and it sends nothing anywhere.
 *
 * @OnlyCurrentDoc
 */

const VERSION = '1.0';
const T = { setup: 'Setup', tx: 'Transactions', sum: 'Summary', stats: 'Analytics', rules: 'Rules',
  payees: 'Payees', cats: 'Categories', skipped: 'Skipped' };
const TX_HEADERS = ['Date', 'Amount', 'Paid to', 'Category', 'Note', 'Payee ID', 'Bank', 'Account', 'Mode', 'Ref',
  'Logged at', 'Source', 'Key', 'SMS'];
const C = { date: 1, amount: 2, paidTo: 3, category: 4, note: 5, payee: 6, bank: 7, account: 8, mode: 9, ref: 10,
  loggedAt: 11, source: 12, key: 13, sms: 14 };
const RULE_HEADERS = ['Category', 'Amount from', 'Amount to', 'Time from', 'Time to', 'Days', 'Payee contains',
  'Status', 'Note'];
const SETUP_CELLS = { status: 'B3', last: 'B4', code: 'B5', reconnect: 'B6' };
const NOT_SPENDING = 'Not spending';

const DEFAULT_CATEGORIES = ['Food & Dining', 'Groceries', 'Transport', 'Shopping', 'Bills & Subscriptions',
  'Going Out', 'Health', 'Home', 'Family & Friends', 'Other', NOT_SPENDING];

// Preset words for well-known brands. A word matches a payee that has it at the start of a word.
const BRANDS = [
  ['swiggy', 'Food & Dining'], ['zomato', 'Food & Dining'], ['eatclub', 'Food & Dining'], ['dominos', 'Food & Dining'],
  ['mcdonald', 'Food & Dining'], ['starbucks', 'Food & Dining'], ['kfc', 'Food & Dining'], ['burger king', 'Food & Dining'],
  ['blinkit', 'Groceries'], ['zepto', 'Groceries'], ['bigbasket', 'Groceries'], ['instamart', 'Groceries'],
  ['dmart', 'Groceries'], ['jiomart', 'Groceries'], ['metro cash', 'Groceries'],
  ['uber', 'Transport'], ['olacabs', 'Transport'], ['ola cabs', 'Transport'], ['rapido', 'Transport'],
  ['irctc', 'Transport'], ['fastag', 'Transport'], ['indigo', 'Transport'], ['makemytrip', 'Transport'],
  ['amazon', 'Shopping'], ['flipkart', 'Shopping'], ['myntra', 'Shopping'], ['ajio', 'Shopping'],
  ['meesho', 'Shopping'], ['nykaa', 'Shopping'],
  ['netflix', 'Bills & Subscriptions'], ['spotify', 'Bills & Subscriptions'], ['hotstar', 'Bills & Subscriptions'],
  ['youtube', 'Bills & Subscriptions'], ['jio', 'Bills & Subscriptions'], ['airtel', 'Bills & Subscriptions'],
  ['electricity', 'Bills & Subscriptions'], ['bescom', 'Bills & Subscriptions'],
  ['bookmyshow', 'Going Out'], ['district', 'Going Out'], ['pvr', 'Going Out'],
  ['apollo', 'Health'], ['pharmeasy', 'Health'], ['netmeds', 'Health'], ['tata 1mg', 'Health'], ['practo', 'Health'],
];

// ---------- Web app: the shortcut and the widget talk to these ----------

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.claim) return json_(claim_());
  if (p.k) {
    if (!validToken_(p.k)) return json_({ ok: false, error: 'bad code' });
    return json_(Object.assign({ ok: true }, summary_(new Date())));
  }
  return ContentService.createTextOutput('Spend Tracker is running.');
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (_) { /* fall through to the code check */ }
  const p = (e && e.parameter) || {};
  if (!validToken_(p.k || body.token)) return json_({ ok: false, error: 'bad code' });
  if (body.rows) return json_(Object.assign({ ok: true }, importRows_(body.rows)));
  if (body.amount) return json_(Object.assign({ ok: true }, addCash_(body.amount, body.note)));
  if (body.text) return json_(Object.assign({ ok: true }, logSms_(String(body.text))));
  return json_({ ok: false, error: 'nothing to log' });
}

// First run of the shortcut: hands out the connection code once. After that, only the Setup tab shows it.
function claim_() {
  return withLock_(() => {
    if (validToken_(props_().getProperty('TOKEN'))) {
      return { ok: false, error: 'This Sheet is already connected to a phone.' };
    }
    const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
    const code = ScriptApp.getService().getUrl() + '?k=' + token;
    props_().setProperties({ TOKEN: token, TOKEN_SCRIPT: scriptId_() });
    const s = sheet_(T.setup);
    s.getRange(SETUP_CELLS.status).setValue('Connected ✅ ' + fmt_(new Date(), 'd MMM yyyy, h:mm a'));
    s.getRange(SETUP_CELLS.code).setValue(code);
    return { ok: true, code };
  });
}

// A copy of someone else's Sheet carries their script properties; the script ID check makes it start unconnected.
function validToken_(k) {
  const pr = props_();
  const token = pr.getProperty('TOKEN');
  return !!token && !!k && String(k) === token && pr.getProperty('TOKEN_SCRIPT') === scriptId_();
}

// ---------- Logging ----------

function logSms_(text) {
  const now = new Date();
  const p = parseSms_(text, now);
  if (p.drop) return { result: 'dropped' };
  if (p.skip) {
    if (p.log) withLock_(() => skipped_(now, p.skip, text));
    return { result: 'skipped', why: p.skip };
  }
  return withLock_(() => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(T.tx);
    const tx = Object.assign(p.tx, { source: 'SMS', loggedAt: now, sms: text, note: '' });
    tx.key = tx.ref ? `${tx.bank}|${tx.ref}` : 'h:' + hash_(text);
    if (keys_(sh).has(tx.key)) return { result: 'duplicate' };
    const ctx = context_(ss);
    decorate_(tx);
    tx.category = categorize_(tx, ctx);
    insertTx_(ss, [tx]);
    setupLast_(ss, tx);
    const out = { result: 'added', amount: tx.amount, paidTo: tx.merchant, category: tx.category };
    const notify = tx.category ? '' : ask_(ss, tx, now);
    if (notify) out.notify = notify;
    return out;
  });
}

// Run the shortcut by hand (no SMS) -> it asks for a cash amount.
function addCash_(amount, note) {
  const n = Number(String(amount).replace(/[^\d.]/g, ''));
  if (!(n > 0)) return { result: 'bad amount', message: 'That amount did not look right.' };
  return withLock_(() => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const now = new Date();
    const tx = { date: now, amount: n, merchant: String(note || '').trim().slice(0, 60) || 'Cash', payee: '',
      bank: 'Cash', account: '', mode: 'Cash', ref: '', loggedAt: now, source: 'Cash', sms: '', note: '',
      key: 'cash:' + now.getTime() + ':' + Math.random().toString(36).slice(2, 6) };
    decorate_(tx);
    tx.category = categorize_(tx, context_(ss));
    insertTx_(ss, [tx]);
    setupLast_(ss, tx);
    return { result: 'added', message: `Added ${inr_(n)} · ${tx.merchant}${tx.category ? ' → ' + tx.category : ''}` };
  });
}

// Past months from bank statements (optional, any time):
// [{date: 'YYYY-MM-DD', amount, merchant, payee, bank, account, mode, ref, note}]
function importRows_(rows) {
  return withLock_(() => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(T.tx);
    const keys = keys_(sh);
    const ctx = context_(ss);
    const seen = {};
    const now = new Date();
    const add = [];
    (rows || []).forEach(r => {
      const [y, m, d] = String(r.date).split('-').map(Number);
      const amount = Number(r.amount);
      if (!y || !m || !d || !(amount > 0)) return;
      const tx = { date: new Date(y, m - 1, d), amount, merchant: String(r.merchant || '').slice(0, 80),
        payee: String(r.payee || ''), bank: String(r.bank || ''), account: String(r.account || ''),
        mode: String(r.mode || ''), ref: String(r.ref || ''), note: String(r.note || ''), loggedAt: now,
        source: 'Statement', sms: '' };
      let key = tx.ref ? `${tx.bank}|${tx.ref}` : ['s', tx.bank, r.date, amount, norm_(tx.merchant)].join('|');
      if (!tx.ref) { seen[key] = (seen[key] || 0) + 1; key += '|' + seen[key]; } // two same-day identical spends stay two
      if (keys.has(key)) return;
      keys.add(key);
      tx.key = key;
      decorate_(tx);
      tx.category = categorize_(tx, ctx);
      add.push(tx);
    });
    if (add.length) {
      insertTx_(ss, add);
      const n = sh.getLastRow() - 1;
      sh.getRange(2, 1, n, TX_HEADERS.length)
        .sort([{ column: C.date, ascending: false }, { column: C.loggedAt, ascending: false }]);
    }
    return { added: add.length, skipped: (rows || []).length - add.length };
  });
}

// Newest payment goes on top, so on a phone you see it without scrolling.
function insertTx_(ss, txs) {
  const sh = ss.getSheetByName(T.tx);
  const rows = txs.map(t => [t.date, t.amount, safe_(t.merchant), t.category || '', safe_(t.note || ''),
    safe_(t.payee || ''), t.bank || '', t.account || '', t.mode || '', t.ref || '', t.loggedAt, t.source, t.key,
    safe_(t.sms || '')]);
  sh.insertRowsBefore(2, rows.length);
  sh.getRange(2, 1, rows.length, TX_HEADERS.length).setFontWeight('normal').setBackground(null).setFontColor(null);
  formatTxRows_(ss, sh, 2, rows.length);
  sh.getRange(2, 1, rows.length, TX_HEADERS.length).setValues(rows);
}

function formatTxRows_(ss, sh, top, n) {
  sh.getRange(top, C.date, n, 1).setNumberFormat('d mmm yyyy');
  sh.getRange(top, C.amount, n, 1).setNumberFormat('#,##0');
  sh.getRange(top, C.account, n, 3).setNumberFormat('@');
  sh.getRange(top, C.loggedAt, n, 1).setNumberFormat('d mmm, h:mm am/pm');
  sh.getRange(top, C.key, n, 1).setNumberFormat('@');
  sh.getRange(top, C.sms, n, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sh.getRange(top, C.category, n, 1).setDataValidation(categoryRule_(ss));
}

function skipped_(now, why, text) {
  const sh = sheet_(T.skipped);
  sh.insertRowsBefore(2, 1);
  const r = sh.getRange(2, 1, 1, 3);
  r.setFontWeight('normal').setBackground(null);
  r.setValues([[now, why, safe_(text)]]);
  sh.getRange(2, 1).setNumberFormat('d mmm, h:mm am/pm');
  const last = sh.getLastRow();
  if (last > 301) sh.deleteRows(302, last - 301);
}

function setupLast_(ss, tx) {
  ss.getSheetByName(T.setup).getRange(SETUP_CELLS.last)
    .setValue(safe_(`${inr_(tx.amount)} · ${tx.merchant || tx.bank} · ${fmt_(tx.loggedAt, 'd MMM, h:mm a')}`));
}

// ---------- Reading bank SMS ----------

const NUM = String.raw`([\d,]+(?:\.\d{1,2})?)`;
const CUR = String.raw`(?:\brs\.?|\binr|₹)\s*:?\s*`;
const AMOUNT_RES = [
  new RegExp(String.raw`\bdebited\s+(?:by|for|with|of)?\s*(?:${CUR})?${NUM}`, 'i'),
  new RegExp(String.raw`${CUR}${NUM}\s*(?:has been |was |is )?(?:debited|spent|sent|paid|withdrawn|transferred|deducted)`, 'i'),
  new RegExp(String.raw`\b(?:sent|spent|paid|withdrawn|debit|txn of|transaction of|purchase of|payment of)\s*(?:of\s*)?${CUR}${NUM}`, 'i'),
];
const OTP = /\b(?:otp|one[- ]?time password|verification code)\b\s*(?:is|:|-)?\s*\d{4,8}\b|\b\d{4,8}\s+is\s+(?:your|the)\s+(?:otp|one[- ]?time password|verification code)\b|\botp\b.{0,100}?\bis\s*:?\s*\d{4,8}(?![\d,]|\.\d)/i;
const SKIP = /\b(?:will|to|shall|would|may|is going to)\s+be\s+(?:debited|deducted|charged|paid)\b|\bscheduled\b|\bupcoming\b|\breminder\b|\bis due\b|\bdue (?:on|by|date)\b|\bpre-?debit\b|\brequested\b|\bcollect request\b|\brequest(?:ing)? (?:money|payment)\b|\bfailed\b|\bdeclined\b|\bunsuccessful\b|\binsufficient\b|\brevers(?:ed|al)\b|\brefund(?:ed)?\b|\bcashback\b|\bnot been debited\b|\bhas not been\b/i;
const STRONG_DEBIT = /\b(?:debited|spent|sent|paid|withdrawn|deducted)\b/i;
const WEAK_DEBIT = /\b(?:debit(?!\s*card)|txn|transaction|purchase|transferred|withdrawal)\b/i;
const CREDIT = /\b(?:credited|received|deposited|added to your|transferred to your)\b/i;
const BANKISH = /\b(?:a\/c|acct|avl|avbl|avail|bal|balance|card|upi|imps|neft)\b/i;
const TAIL = /\b(?:not you|not u\b|if not (?:you|u|done)|to block|sms block|call \d|call us|report|fraud|dispute)\b.*$/i;
const BANKS = [
  ['Union', /union bank/i], ['HDFC', /\bhdfc/i], ['ICICI', /\bicici/i], ['SBI', /\bsbi\b|state bank/i],
  ['Axis', /\baxis\b/i], ['Kotak', /\bkotak/i], ['PNB', /\bpnb\b|punjab national/i],
  ['Bank of Baroda', /bank of baroda|\bbob\b/i], ['Canara', /canara/i], ['IDFC', /\bidfc/i], ['Yes Bank', /\byes bank/i],
  ['IndusInd', /indusind/i], ['Federal', /federal bank/i], ['AU', /\bau (?:small finance )?bank/i], ['RBL', /\brbl\b/i],
  ['IDBI', /\bidbi/i], ['IOB', /indian overseas|\biob\b/i], ['Indian Bank', /indian bank/i],
  ['Central Bank', /central bank of india/i], ['Bank of India', /bank of india|\bboi\b/i], ['UCO', /\buco bank/i],
  ['HSBC', /\bhsbc/i], ['Standard Chartered', /standard chartered/i], ['City Union', /city union bank/i],
  ['Citi', /\bciti/i], ['DBS', /\bdbs\b/i], ['AmEx', /american express|\bamex\b/i], ['OneCard', /onecard/i],
  ['Jupiter', /\bjupiter\b/i], ['Paytm', /paytm payments bank/i], ['Airtel Payments', /airtel payments bank/i],
  ['Equitas', /equitas/i], ['Ujjivan', /ujjivan/i], ['Bandhan', /bandhan/i], ['South Indian', /south indian bank/i],
  ['Karnataka', /karnataka bank/i], ['KVB', /karur vysya|\bkvb\b/i], ['DCB', /\bdcb bank/i], ['Slice', /\bslice\b/i],
];
const MERCHANT_RES = [
  /\bFvg:\s*(.+?)(?=\s+Avl\b|$)/i,                                               // Union
  /\bTo\s+(.+?)\s+On\s+\d/i,                                                      // HDFC and Kotak UPI
  /;\s*([^;]+?)\s+credited\b/i,                                                   // ICICI UPI
  /\bUPI\/(?:P2[AM]|DR|CR)\/\d+\/([^\/]+?)(?=\/|$)/i,                             // Axis
  /\bUPI\/\d{6,}\/([^\/.]+?)(?=[\/.]|$)/i,                                        // Bank of Baroda, Canara
  /\bIST\s+(.+?)(?=\s+Avl\b|$)/,                                                  // Axis card
  /\b(?:at|@)\s+(?!\d)(.+?)(?=\s+on\b|\s+(?:avl|avbl|bal|ref|txn|via|using|by|for|from|dt|date)\b|[;(]|\.\s|\.$|$)/i, // cards
  /\d{2,4}\s+on\s+(?!\d)(.+?)(?=\.\s|\.$|;|$)/i,                                  // ICICI card: "...-26 on AMAZON."
  /\b(?:trf to|transferred to|paid to|sent to|payment to|towards|in favou?r of|to vpa|to)\s+(.+?)(?=\s+(?:on|ref|refno|upi|via|using|avl|avbl|bal|from|at|dt|thru|with|for|by)\b|[;,(]|\.\s|\.$|$)/i,
  /\bInfo:?\s*(.+?)(?=[.;]|$)/i,
];
const NOT_A_NAME = /^(?:your|you|a\/?c|ac|acct|account|card|self|the bank|bank)\b|^[\d\s:\/.,-]+$/i;
const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// -> {drop} for OTPs (never stored), {skip, log} for non-spends, or {tx}.
function parseSms_(text, now) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (OTP.test(t)) return { drop: 'otp' };
  const bank = bank_(t), account = account_(t), ref = ref_(t);
  const bankish = !!(bank || account || ref || BANKISH.test(t));
  const amount = amount_(t);
  if (!amount) return { skip: 'no amount' };
  if (SKIP.test(t)) return { skip: 'not a finished payment (due, request, failed or refund)', log: bankish };
  const dir = direction_(t);
  if (dir === 'credit') return { skip: 'money received' };
  if (dir !== 'debit') return { skip: 'not a payment', log: bankish };
  if (!bankish) return { skip: 'not from a bank' };
  const m = merchant_(t);
  return { tx: { date: smsDate_(t, now), amount, merchant: m.merchant, payee: m.payee, bank, account,
    mode: mode_(t), ref } };
}

function amount_(t) {
  for (const re of AMOUNT_RES) {
    const m = t.match(re);
    if (m && num_(m[1]) > 0) return num_(m[1]);
  }
  const all = new RegExp(CUR + NUM, 'gi');
  let m;
  while ((m = all.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 20), m.index);
    if (!/\b(?:bal|balance|limit|lmt|avl|avail|available|outstanding|due)\b/i.test(before) && num_(m[1]) > 0) {
      return num_(m[1]);
    }
  }
  return 0;
}

function direction_(t) {
  const c = t.search(CREDIT), s = t.search(STRONG_DEBIT);
  if (c >= 0) return s >= 0 && s < c ? 'debit' : 'credit';
  return s >= 0 || WEAK_DEBIT.test(t) ? 'debit' : '';
}

function bank_(t) {
  let best = '', at = Infinity;
  BANKS.forEach(([name, re]) => {
    const i = t.search(re);
    if (i >= 0 && i < at) { best = name; at = i; }
  });
  return best;
}

function account_(t) {
  const m = t.match(/(?:[xX*]{2,}|\*|\.{2,}|\b[xX])(\d{3,6})\b/) ||
    t.match(/\b(?:card|a\/c|acct|ac)\s*(?:no\.?\s*)?(?:ending\s*(?:with\s*)?)?(\d{4})\b/i);
  return m ? m[1].slice(-4) : '';
}

function ref_(t) {
  const m = t.match(/\bUPI\/(?:P2[AM]\/|DR\/|CR\/)?(\d{9,})/i) ||
    t.match(/\b(?:upi\s*ref(?:erence)?|ref(?:erence)?|refno|rrn|utr|txn\s*(?:id|no)|transaction\s*(?:id|no)|upi)\s*(?:no\.?|number|id)?\s*[:#.\-]?\s*(\d{9,})/i);
  return m ? m[1] : '';
}

function merchant_(t) {
  const body = t.replace(TAIL, '').trim();
  const vpa = (body.match(/\b[\w.\-]{2,}@[a-z][a-z0-9]+\b/i) || [''])[0];
  let merchant = '';
  for (const re of MERCHANT_RES) {
    const m = body.match(re);
    if (!m) continue;
    const name = m[1].replace(/^vpa\s+/i, '').replace(/^UPI\/\d+\//i, '').replace(/[\s.\-]+$/, '').trim();
    if (name.length < 2 || NOT_A_NAME.test(name)) continue;
    merchant = name.slice(0, 60);
    break;
  }
  return { merchant: merchant || vpa, payee: vpa };
}

function mode_(t) {
  if (/\bcredit card\b/i.test(t)) return 'Credit card';
  if (/\bcard\b/i.test(t)) return 'Card';
  if (/\bupi\b|\bvpa\b|@[a-z]{2,}|\bsent rs/i.test(t)) return 'UPI';
  if (/\batm\b|withdrawn|withdrawal/i.test(t)) return 'ATM';
  const m = t.match(/\b(neft|imps|rtgs)\b/i);
  if (m) return m[1].toUpperCase();
  if (/\b(?:nach|ecs|autopay|auto-debit|mandate|standing instruction)\b/i.test(t)) return 'Auto-debit';
  return '';
}

// Dates in Indian bank SMS are day-first. Anything implausible falls back to today.
function smsDate_(t, now) {
  let m, d = null;
  if ((m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) d = date_(m[1], m[2], m[3]);
  else if ((m = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/))) d = date_(m[3], m[2], m[1]);
  else if ((m = t.match(/\b(\d{1,2})[\s\-\/]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-\/,]*(\d{2,4})\b/i))) {
    d = date_(m[3], MONTH[m[2].toLowerCase()], m[1]);
  }
  const day = 86400000;
  if (!d || d - now > day || now - d > 400 * day) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d;
}

function date_(y, mo, d) {
  y = Number(y); mo = Number(mo); d = Number(d);
  if (y < 100) y += 2000;
  const out = new Date(y, mo - 1, d);
  return out.getMonth() === mo - 1 && out.getDate() === d ? out : null;
}

// ---------- Categories: your choice per payee > your rules > brand words > blank ----------

function context_(ss) {
  const exact = {}, words = [];
  rows_(ss, T.payees, 2).forEach(([k, c]) => {
    k = norm_(k);
    c = String(c).trim();
    if (!k || !c) return;
    exact[k] = c;
    words.push([k, c, new RegExp('[^a-z0-9]' + escRe_(k))]);
  });
  words.sort((a, b) => b[0].length - a[0].length);
  const rules = rows_(ss, T.rules, RULE_HEADERS.length, true).map(parseRule_).filter(r => r.active);
  return { exact, words, rules };
}

function categorize_(tx, ctx) {
  const key = payeeKey_(tx);
  if (key && ctx.exact[key]) return ctx.exact[key];
  const rule = ctx.rules.find(r => ruleMatches_(r, tx));
  if (rule) return rule.category;
  const hay = ' ' + norm_(tx.merchant + ' ' + String(tx.payee || '').split('@')[0]);
  const w = ctx.words.find(([, , re]) => re.test(hay));
  return w ? w[1] : '';
}

function payeeKey_(tx) {
  return norm_(tx.payee || tx.merchant);
}

// Time rules use the time the SMS arrived, so they only apply to live payments (not statements).
function decorate_(tx) {
  const at = tx.loggedAt instanceof Date ? tx.loggedAt : null;
  const day0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  tx.live = (tx.source === 'SMS' || tx.source === 'Cash') && !!at && tx.date instanceof Date &&
    Math.abs(day0(at) - day0(tx.date)) <= 86400000;
  tx.minutes = tx.live ? at.getHours() * 60 + at.getMinutes() : null;
  const d = tx.live ? at : tx.date;
  tx.day = d instanceof Date ? d.getDay() : null;
  return tx;
}

function parseRule_(r) {
  const [cat, min, max, from, to, days, payee, status, note] = r.map(v => String(v).trim());
  const rule = { category: cat, min: amt_(min), max: amt_(max), from: clockMins_(from), to: clockMins_(to),
    days: days_(days), payee: norm_(payee), status: status.toLowerCase(), example: /^example\b/i.test(note || '') };
  rule.hasCondition = rule.min !== null || rule.max !== null || rule.from !== null || rule.to !== null ||
    !!rule.payee || !!rule.days;
  rule.active = !!cat && rule.hasCondition && rule.status !== 'off' && rule.status !== 'suggested';
  return rule;
}

function ruleMatches_(r, tx) {
  if (!r.active || !covers_(r, tx)) return false;
  if (r.days && (tx.day === null || r.days.indexOf(tx.day) < 0)) return false;
  if (r.payee && (' ' + norm_(tx.merchant + ' ' + tx.payee)).indexOf(r.payee) < 0) return false;
  return true;
}

// Amount and time part of a rule (also used to avoid asking about payments a rule already covers).
function covers_(r, tx) {
  if (r.min !== null && tx.amount < r.min) return false;
  if (r.max !== null && tx.amount > r.max) return false;
  if (r.from !== null || r.to !== null) {
    if (tx.minutes === null) return false;
    const f = r.from === null ? 0 : r.from, t = r.to === null ? 1439 : r.to;
    const inside = f <= t ? tx.minutes >= f && tx.minutes <= t : tx.minutes >= f || tx.minutes <= t;
    if (!inside) return false;
  }
  return true;
}

// "Ask once": 3+ similar payments (±₹5, ±1 h, 2+ payees) in 2 weeks, with no category and no rule yet,
// become a suggested rule. At most one question a day.
function ask_(ss, tx, now) {
  const today = fmt_(now, 'yyyy-MM-dd');
  if (props_().getProperty('LAST_ASK') === today) return '';
  const sh = ss.getSheetByName(T.tx);
  const n = Math.min(sh.getLastRow() - 1, 1000);
  if (n < 3) return '';
  const since = now.getTime() - 14 * 86400000;
  const recent = sh.getRange(2, 1, n, TX_HEADERS.length).getValues().map(txFromRow_)
    .filter(r => r.loggedAt instanceof Date && r.loggedAt.getTime() >= since);
  const allRules = rows_(ss, T.rules, RULE_HEADERS.length, true).map(parseRule_)
    .filter(r => r.hasCondition && !(r.example && r.status === 'off')); // the switched-off example never blocks a question
  const s = suggestion_(recent, tx, allRules);
  if (!s) return '';
  ss.getSheetByName(T.rules).appendRow(s.row);
  props_().setProperty('LAST_ASK', today);
  return s.notify;
}

function suggestion_(recent, tx, rules) {
  if (!tx.live || tx.category) return null;
  const near = recent.filter(r => r.live && !r.category && Math.abs(r.amount - tx.amount) <= 5 &&
    Math.abs(r.minutes - tx.minutes) <= 60);
  if (near.length < 3 || new Set(near.map(payeeKey_)).size < 2) return null;
  if (rules.some(r => !r.payee && (r.min !== null || r.max !== null || r.from !== null) && covers_(r, tx))) return null;
  const amts = near.map(r => r.amount), mins = near.map(r => r.minutes);
  const from = Math.max(1, Math.floor(Math.min(...amts)) - 5), to = Math.ceil(Math.max(...amts)) + 5;
  const t0 = Math.max(0, Math.floor((Math.min(...mins) - 30) / 15) * 15);
  const t1 = Math.min(1425, Math.ceil((Math.max(...mins) + 30) / 15) * 15);
  const days = near.every(r => r.day >= 1 && r.day <= 5) ? 'Weekdays'
    : near.every(r => r.day === 0 || r.day === 6) ? 'Weekends' : 'Any';
  const amt = inr_(median_(amts)), around = clock_(Math.round(median_(mins) / 5) * 5);
  return {
    row: ['', from, to, clock_(t0), clock_(t1), days, '', 'Suggested',
      `${near.length} payments of about ${amt} around ${around}, to different people. Pick a category to use this rule, or set Status to Off.`],
    notify: `${near.length} payments of about ${amt} around ${around}. What are they? Pick a category in the Rules tab of your Sheet.`,
  };
}

// ---------- Edits in the Sheet (runs without any permission) ----------

function onEdit(e) {
  if (!e || !e.range) return;
  const ss = e.source || SpreadsheetApp.getActiveSpreadsheet();
  const name = e.range.getSheet().getName();
  if (name === T.setup) return onSetupEdit_(e);
  if (name !== T.tx && name !== T.rules && name !== T.payees) return;
  withLock_(() => {
    if (name === T.tx && !rememberChoices_(ss, e.range)) return;
    if (name === T.rules) activateRules_(ss, e.range);
    fillBlanks_(ss);
  }, true);
}

// Picking a category for a payment remembers it for that payee.
function rememberChoices_(ss, range) {
  if (range.getLastRow() < 2 || range.getColumn() > C.category || range.getLastColumn() < C.category) return false;
  const top = Math.max(2, range.getRow());
  const rows = range.getSheet().getRange(top, 1, range.getLastRow() - top + 1, TX_HEADERS.length).getValues();
  const choices = {};
  rows.forEach(r => {
    const tx = txFromRow_(r);
    const key = payeeKey_(tx);
    if (tx.category && key) choices[key] = { label: String(tx.payee || tx.merchant).trim(), category: tx.category };
  });
  const list = Object.keys(choices).map(k => choices[k]);
  if (!list.length) return false;
  addCategories_(ss, list.map(c => c.category));
  savePayees_(ss, choices);
  return true;
}

function savePayees_(ss, choices) {
  const sh = ss.getSheetByName(T.payees);
  const n = sh.getLastRow() - 1;
  const vals = n > 0 ? sh.getRange(2, 1, n, 3).getValues() : [];
  const at = {};
  vals.forEach((r, i) => { at[norm_(r[0])] = i; });
  const add = [];
  Object.keys(choices).forEach(k => {
    if (k in at) { vals[at[k]][1] = choices[k].category; vals[at[k]][2] = 'You'; }
    else add.push([safe_(choices[k].label), choices[k].category, 'You']);
  });
  if (n > 0) sh.getRange(2, 2, n, 2).setValues(vals.map(r => [r[1], r[2]]));
  if (add.length) sh.getRange(n + 2, 1, add.length, 3).setValues(add);
}

function addCategories_(ss, cats) {
  const sh = ss.getSheetByName(T.cats);
  const have = new Set(rows_(ss, T.cats, 1).map(r => norm_(r[0])));
  const add = [];
  cats.forEach(c => { if (c && !have.has(norm_(c))) { have.add(norm_(c)); add.push([safe_(c)]); } });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 1).setValues(add);
}

// Answering a suggested rule (picking its category) switches it on.
function activateRules_(ss, range) {
  const sh = range.getSheet();
  const top = Math.max(2, range.getRow()), n = range.getLastRow() - top + 1;
  if (n < 1) return;
  const vals = sh.getRange(top, 1, n, RULE_HEADERS.length).getDisplayValues();
  vals.forEach((r, i) => {
    if (r[0].trim() && r[7].trim().toLowerCase() === 'suggested') sh.getRange(top + i, 8).setValue('On');
  });
  addCategories_(ss, vals.map(r => r[0].trim()).filter(Boolean));
}

// After any choice or rule change, fill in payments that still have no category. Never changes a filled one.
function fillBlanks_(ss) {
  const sh = ss.getSheetByName(T.tx);
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const vals = sh.getRange(2, 1, n, TX_HEADERS.length).getValues();
  const ctx = context_(ss);
  const cats = vals.map(r => [r[C.category - 1]]);
  let changed = 0;
  vals.forEach((r, i) => {
    if (String(r[C.category - 1]).trim()) return;
    const cat = categorize_(txFromRow_(r), ctx);
    if (cat) { cats[i][0] = cat; changed++; }
  });
  if (changed) sh.getRange(2, C.category, n, 1).setValues(cats);
  return changed;
}

// Setup tab: typing "yes" next to "New phone?" lets the shortcut connect again.
function onSetupEdit_(e) {
  if (e.range.getA1Notation() !== SETUP_CELLS.reconnect) return;
  if (!/^\s*y(es)?\s*$/i.test(String(e.range.getValue()))) return;
  props_().deleteProperty('TOKEN');
  props_().deleteProperty('TOKEN_SCRIPT');
  const s = e.range.getSheet();
  s.getRange(SETUP_CELLS.status).setValue('Waiting for your phone: run the Spend Tracker shortcut once.');
  s.getRange(SETUP_CELLS.code).setValue('');
  e.range.setValue('');
}

function txFromRow_(r) {
  return decorate_({ date: r[C.date - 1], amount: Number(r[C.amount - 1]) || 0, merchant: String(r[C.paidTo - 1]),
    category: String(r[C.category - 1]).trim(), payee: String(r[C.payee - 1]), source: String(r[C.source - 1]),
    loggedAt: r[C.loggedAt - 1] });
}

// ---------- Widget data ----------

function summary_(now) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(T.tx);
  const n = sh.getLastRow() - 1;
  const rows = n > 0 ? sh.getRange(2, 1, n, C.loggedAt).getValues() : [];
  const budgets = {};
  rows_(ss, T.cats, 2).forEach(([c, b]) => { if (String(c).trim() && Number(b) > 0) budgets[String(c).trim()] = Number(b); });
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daily = new Array(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).fill(0);
  const spent = {};
  let total = 0, todayTotal = 0, latest = null, blank = 0;
  rows.forEach(r => {
    const d = r[C.date - 1];
    const cat = String(r[C.category - 1]).trim();
    if (!(d instanceof Date) || d < start || d >= end || cat === NOT_SPENDING) return;
    const amt = Number(r[C.amount - 1]) || 0;
    if (!cat) blank++;
    total += amt;
    daily[d.getDate() - 1] += amt;
    if (d >= today) todayTotal += amt;
    spent[cat || 'Uncategorized'] = (spent[cat || 'Uncategorized'] || 0) + amt;
    const at = r[C.loggedAt - 1];
    if (at instanceof Date && (!latest || at > latest.at)) latest = { at, amount: amt, merchant: r[C.paidTo - 1], bank: r[C.bank - 1] };
  });
  const categories = Object.keys(spent).map(name => ({ name, spent: spent[name], budget: budgets[name] || 0 }))
    .sort((a, b) => b.spent - a.spent);
  const ask = rows_(ss, T.rules, RULE_HEADERS.length, true)
    .filter(r => !r[0].trim() && r[7].trim().toLowerCase() === 'suggested').length;
  return {
    month: fmt_(start, 'MMMM'),
    total,
    budget: Object.keys(budgets).reduce((a, k) => a + budgets[k], 0),
    today: todayTotal,
    day: now.getDate(),
    daily,
    categories,
    last: latest && { amount: latest.amount, merchant: latest.merchant, bank: latest.bank },
    uncategorized: blank,
    ask,
  };
}

// ---------- Builder only: turns an empty Sheet into the template ----------

// Run once from the editor in a new, empty Sheet. Users copy the result and never run this.
function buildTemplate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const old = ss.getSheetByName(T.tx);
  if (old && old.getLastRow() > 1) throw new Error('This Sheet already has payments. Run this only in a new, empty Sheet.');
  ss.setSpreadsheetTimeZone('Asia/Kolkata');
  props_().deleteAllProperties();
  // Keep the first tab (a spreadsheet can never have zero) and rebuild everything else. Safe to re-run.
  const keep = ss.getSheets()[0];
  ss.setActiveSheet(keep);
  ss.getSheets().slice(1).forEach(s => ss.deleteSheet(s));
  keep.getCharts().forEach(c => keep.removeChart(c));
  keep.clear();
  keep.getRange(1, 1, keep.getMaxRows(), keep.getMaxColumns()).clearDataValidations();
  keep.setName(T.setup);
  SpreadsheetApp.flush();
  [T.tx, T.sum, T.stats, T.rules, T.payees, T.cats, T.skipped].forEach(name => ss.insertSheet(name, ss.getNumSheets()));
  SpreadsheetApp.flush();
  buildCategories_(ss.getSheetByName(T.cats));
  buildPayees_(ss.getSheetByName(T.payees));
  buildRules_(ss, ss.getSheetByName(T.rules));
  buildTransactions_(ss, ss.getSheetByName(T.tx));
  buildSummary_(ss.getSheetByName(T.sum));
  buildAnalytics_(ss.getSheetByName(T.stats));
  buildSkipped_(ss.getSheetByName(T.skipped));
  buildSetup_(ss.getSheetByName(T.setup));
  ss.setActiveSheet(ss.getSheetByName(T.setup));
}

function header_(sh, headers, note) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f1f3f4');
  sh.setFrozenRows(1);
  if (note) sh.getRange(1, headers.length + 2).setValue(note).setFontColor('#666666').setFontStyle('italic');
}

function buildCategories_(sh) {
  header_(sh, ['Category', 'Monthly budget (optional)'],
    `Add or rename categories here. Payments in "${NOT_SPENDING}" (own transfers, money you got back) are not counted.`);
  sh.getRange(2, 1, DEFAULT_CATEGORIES.length, 1).setValues(DEFAULT_CATEGORIES.map(c => [c]));
  sh.getRange('B:B').setNumberFormat('#,##0');
  sh.setColumnWidth(1, 200);
  sh.setColumnWidth(2, 180);
}

function buildPayees_(sh) {
  header_(sh, ['Payee or word', 'Category', 'Set by'],
    'Your category choices are remembered here. A word like "swiggy" matches any payee that contains it.');
  sh.getRange(2, 1, BRANDS.length, 3).setValues(BRANDS.map(([w, c]) => [w, c, 'Preset']));
  sh.getRange(2, 2, sh.getMaxRows() - 1, 1).setDataValidation(categoryRule_(sh.getParent()));
  sh.setColumnWidth(1, 240);
  sh.setColumnWidth(2, 180);
}

function buildRules_(ss, sh) {
  header_(sh, RULE_HEADERS, 'Time rules use the time the SMS arrived, so they apply to new payments only.');
  sh.getRange(2, 1, 1, RULE_HEADERS.length).setValues([['Transport', 20, 30, '7:00 AM', '11:00 AM', 'Weekdays', '',
    'Off', 'Example: ₹20–30 on weekday mornings = auto fare. Set Status to On to use it.']]);
  const rows = sh.getMaxRows() - 1;
  sh.getRange(2, 1, rows, 1).setDataValidation(categoryRule_(ss));
  sh.getRange(2, 4, rows, 2).setNumberFormat('h:mm am/pm');
  sh.getRange(2, 6, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Any', 'Weekdays', 'Weekends'], true).setAllowInvalid(true).build());
  sh.getRange(2, 8, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['On', 'Off', 'Suggested'], true).setAllowInvalid(false).build());
  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(9, 420);
}

function buildTransactions_(ss, sh) {
  header_(sh, TX_HEADERS);
  sh.getRange(1, C.category).setNote('Pick a category: it is remembered for this payee from now on.');
  formatTxRows_(ss, sh, 2, sh.getMaxRows() - 1);
  [[C.date, 95], [C.amount, 80], [C.paidTo, 200], [C.category, 150], [C.note, 140], [C.payee, 170], [C.sms, 300]]
    .forEach(([c, w]) => sh.setColumnWidth(c, w));
  sh.hideColumns(C.key);
}

function buildSummary_(s) {
  const inMonth = 'Transactions!A:A,">="&$B$1,Transactions!A:A,"<"&EDATE($B$1,1)';
  s.getRange('A1:C5').setValues([
    ['Month', '=DATE(YEAR(TODAY()),MONTH(TODAY()),1)', 'Type any date in B1 to see that month'],
    ['Spent', `=SUMIFS(Transactions!B:B,${inMonth},Transactions!D:D,"<>${NOT_SPENDING}")`, ''],
    ['Budget', '=IF(SUM(Categories!B:B)=0,"—",SUM(Categories!B:B))', ''],
    ['Left', '=IF(ISNUMBER(B3),B3-B2,"—")', ''],
    ['Payments without a category', `=COUNTIFS(${inMonth},Transactions!D:D,"")`, ''],
  ]);
  s.getRange('A7:F7').setValues([['Category', 'Spent', 'Payments', 'Budget', 'Left', '% used']]);
  const cat = 'ARRAYFORMULA(IF(Transactions!D:D="","Uncategorized",Transactions!D:D))';
  s.getRange('A8').setFormula(`=IFERROR(QUERY({Transactions!A:A,Transactions!B:B,${cat}},` +
    `"select Col3, sum(Col2), count(Col2) where Col2 > 0 and Col1 >= date '"&TEXT(B1,"yyyy-mm-dd")&"' ` +
    `and Col1 < date '"&TEXT(EDATE(B1,1),"yyyy-mm-dd")&"' and Col3 <> '${NOT_SPENDING}' group by Col3 ` +
    `order by sum(Col2) desc label Col3 '', sum(Col2) '', count(Col2) ''",0),"No payments this month")`);
  s.getRange('D8').setFormula('=MAP(A8:A,LAMBDA(c,IF(c="",,IFERROR(1/(1/VLOOKUP(c,Categories!A:B,2,FALSE)),))))');
  s.getRange('E8').setFormula('=MAP(B8:B,D8:D,LAMBDA(x,b,IF(b="",,b-x)))');
  s.getRange('F8').setFormula('=MAP(B8:B,D8:D,LAMBDA(x,b,IF(b="",,x/b)))');
  s.getRange('B2:B5').setNumberFormat('#,##0');
  s.getRange('B8:E').setNumberFormat('#,##0');
  s.getRange('F8:F').setNumberFormat('0%');
  s.getRange('B1').setNumberFormat('mmmm yyyy');
  s.getRange('C1').setFontColor('#666666').setFontStyle('italic');
  s.getRange('A1:A5').setFontWeight('bold');
  s.getRange('A7:F7').setFontWeight('bold').setBackground('#f1f3f4');
  const pct = s.getRange('F8:F');
  s.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(1).setBackground('#f4c7c3').setRanges([pct]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(0.8).setBackground('#fce8b2').setRanges([pct]).build(),
  ]);
  s.setColumnWidth(1, 210);
  s.setFrozenRows(7);
}

function buildAnalytics_(s) {
  const cat = 'ARRAYFORMULA(IF(Transactions!D:D="","Uncategorized",Transactions!D:D))';
  const month = 'ARRAYFORMULA(IF(ISNUMBER(Transactions!A:A),EOMONTH(Transactions!A:A,-1)+1,))';
  s.getRange('A19').setValue('Spent per month');
  s.getRange('A20').setFormula(`=IFERROR(QUERY({${month},Transactions!B:B,${cat}},` +
    `"select Col1, sum(Col2), count(Col2) where Col2 > 0 and Col1 is not null and Col3 <> '${NOT_SPENDING}' ` +
    `group by Col1 order by Col1 label Col1 'Month', sum(Col2) 'Spent', count(Col2) 'Payments'",0),"No data yet")`);
  s.getRange('E19').setValue('Top payees (all time)');
  s.getRange('E20').setFormula(`=IFERROR(QUERY({Transactions!C:C,Transactions!B:B,${cat}},` +
    `"select Col1, sum(Col2), count(Col2) where Col2 > 0 and Col1 <> '' and Col3 <> '${NOT_SPENDING}' ` +
    `group by Col1 order by sum(Col2) desc limit 15 label Col1 'Paid to', sum(Col2) 'Spent', count(Col2) 'Payments'",0),"No data yet")`);
  s.getRange('I19').setValue('Category by month');
  s.getRange('I20').setFormula(`=IFERROR(QUERY({${month},Transactions!B:B,${cat}},` +
    `"select Col1, sum(Col2) where Col2 > 0 and Col1 is not null and Col3 <> '${NOT_SPENDING}' ` +
    `group by Col1 pivot Col3 order by Col1 label Col1 'Month'",0),"No data yet")`);
  s.getRange('A:A').setNumberFormat('mmm yyyy');
  s.getRange('I:I').setNumberFormat('mmm yyyy');
  s.getRange('B:B').setNumberFormat('#,##0');
  s.getRange('F:F').setNumberFormat('#,##0');
  s.getRange('J:Z').setNumberFormat('#,##0');
  s.getRange('A19:Z20').setFontWeight('bold');
  s.setColumnWidth(5, 200);
  s.insertChart(s.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(s.getRange('A20:B80')).setNumHeaders(1).setPosition(1, 1, 0, 0)
    .setOption('title', 'Spent per month').setOption('legend', { position: 'none' })
    .setOption('width', 620).setOption('height', 340).build());
}

function buildSkipped_(sh) {
  header_(sh, ['Logged at', 'Why', 'SMS'], 'Bank messages that were not counted as spending (last 300).');
  sh.setColumnWidth(2, 260);
  sh.setColumnWidth(3, 480);
}

function buildSetup_(s) {
  s.getRange('A1').setValue('Spend Tracker').setFontSize(18).setFontWeight('bold');
  s.getRange('A3:B6').setValues([
    ['Phone', 'Not connected yet. Run the Spend Tracker shortcut once.'],
    ['Last payment logged', '—'],
    ['Connection code (for the widget)', ''],
    ['New phone? Type yes here to connect again', ''],
  ]);
  s.getRange('A8:A14').setValues([
    ['How it works'],
    ['• Your bank SMS go from your iPhone straight to this Sheet, in your own Google account. Nobody else gets them.'],
    ['• This script can open only this spreadsheet. It has no access to your Gmail, Drive or any other file.'],
    ['• OTP messages are dropped on your phone and never sent.'],
    ['• Pick a category in Transactions and it is remembered for that payee.'],
    ['• Same amount at the same time, to different people (like ₹26 auto fares)? Add a rule in Rules, or answer the question the Sheet asks.'],
    ['• Skipped shows bank messages that were not counted, and why.'],
  ]);
  s.getRange('A16:B16').setValues([['Version', VERSION]]);
  s.getRange('A3:A6').setFontWeight('bold');
  s.getRange('A8').setFontWeight('bold');
  s.getRange('B6').setBackground('#fff8e1');
  s.setColumnWidth(1, 300);
  s.setColumnWidth(2, 460);
  s.getRange('B3:B5').setWrap(true);
}

// ---------- Helpers ----------

function categoryRule_(ss) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName(T.cats).getRange('A2:A'), true).setAllowInvalid(true).build();
}

function rows_(ss, name, width, display) {
  const sh = ss.getSheetByName(name);
  const n = sh ? sh.getLastRow() - 1 : 0;
  if (n < 1) return [];
  const r = sh.getRange(2, 1, n, width);
  return display ? r.getDisplayValues() : r.getValues();
}

function keys_(sh) {
  const n = sh.getLastRow() - 1;
  return new Set(n > 0 ? sh.getRange(2, C.key, n, 1).getValues().map(r => String(r[0])) : []);
}

function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function props_() {
  return PropertiesService.getScriptProperties();
}

function scriptId_() {
  try { return ScriptApp.getScriptId(); } catch (_) { return ''; }
}

// `soft`: run anyway if the lock is unavailable (edit handlers must never fail silently).
function withLock_(fn, soft) {
  let lock = null;
  try { lock = LockService.getScriptLock(); lock.waitLock(20000); } catch (err) { lock = null; if (!soft) throw err; }
  try { return fn(); } finally { if (lock) lock.releaseLock(); }
}

// Stops SMS text like "=IMPORTXML(...)" from being read as a formula.
function safe_(s) {
  s = String(s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function norm_(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function num_(s) {
  return Number(String(s).replace(/,/g, '')) || 0;
}

function amt_(s) {
  if (!s) return null;
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  return isNaN(n) || String(s).replace(/[^\d.]/g, '') === '' ? null : n;
}

// "9", "9:30", "9:30 AM", "21:15" -> minutes after midnight.
function clockMins_(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])?\.?\s*m?\.?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return h < 24 && min < 60 ? h * 60 + min : null;
}

function clock_(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// "Weekdays", "Weekends", "Mon-Fri", "Sat, Sun" -> [day numbers], or null for any day.
function days_(s) {
  s = norm_(s);
  if (!s || /^(any|all|every ?day|daily)$/.test(s)) return null;
  if (/^week ?days?$/.test(s)) return [1, 2, 3, 4, 5];
  if (/^week ?ends?$/.test(s)) return [0, 6];
  const out = new Set();
  s.split(/\s*(?:,|\/|&|\band\b)\s*|\s+/).forEach(part => {
    const [a, b] = part.split('-').map(x => DAY_NAMES.indexOf(x.slice(0, 3)));
    if (a < 0) return;
    if (b === undefined || b < 0) { out.add(a); return; }
    for (let d = a; ; d = (d + 1) % 7) { out.add(d); if (d === b) break; }
  });
  return out.size ? Array.from(out) : null;
}

function median_(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// Two 32-bit FNV-1a hashes: a stable key for SMS that have no reference number.
function hash_(s) {
  const str = norm_(s);
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
  }
  return a.toString(16) + b.toString(16);
}

function escRe_(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inr_(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function fmt_(d, pattern) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), pattern);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Spend Tracker core: reads bank SMS, stores payments, sorts them into categories.
// Shared by the shortcut (inline script) and the Spend Tracker app in Scriptable.
// Everything is stored in iCloud Drive › Scriptable › Spend Tracker. Nothing is sent anywhere.
const ST = (() => {
  const VERSION = '2.0';
  const NOT_SPENDING = 'Not spending';
  const DEFAULT_CATEGORIES = ['Food & Dining', 'Groceries', 'Transport', 'Shopping', 'Bills & Subscriptions',
    'Going Out', 'Health', 'Home', 'Family & Friends', 'Other', NOT_SPENDING].map(name => ({ name, budget: 0 }));

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
  function parseSms(text, now) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (OTP.test(t)) return { drop: 'otp' };
    const bank = bankOf(t), account = accountOf(t), ref = refOf(t);
    const bankish = !!(bank || account || ref || BANKISH.test(t));
    const amount = amountOf(t);
    if (!amount) return { skip: 'no amount' };
    if (SKIP.test(t)) return { skip: 'not a finished payment (due, request, failed or refund)', log: bankish };
    const dir = direction(t);
    if (dir === 'credit') return { skip: 'money received' };
    if (dir !== 'debit') return { skip: 'not a payment', log: bankish };
    if (!bankish) return { skip: 'not from a bank' };
    const m = merchantOf(t);
    return { tx: { date: ymd(smsDate(t, now)), amount, merchant: m.merchant, payee: m.payee, bank, account,
      mode: modeOf(t), ref } };
  }

  function amountOf(t) {
    for (const re of AMOUNT_RES) {
      const m = t.match(re);
      if (m && num(m[1]) > 0) return num(m[1]);
    }
    const all = new RegExp(CUR + NUM, 'gi');
    let m;
    while ((m = all.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 20), m.index);
      if (!/\b(?:bal|balance|limit|lmt|avl|avail|available|outstanding|due)\b/i.test(before) && num(m[1]) > 0) {
        return num(m[1]);
      }
    }
    return 0;
  }

  function direction(t) {
    const c = t.search(CREDIT), s = t.search(STRONG_DEBIT);
    if (c >= 0) return s >= 0 && s < c ? 'debit' : 'credit';
    return s >= 0 || WEAK_DEBIT.test(t) ? 'debit' : '';
  }

  function bankOf(t) {
    let best = '', at = Infinity;
    BANKS.forEach(([name, re]) => {
      const i = t.search(re);
      if (i >= 0 && i < at) { best = name; at = i; }
    });
    return best;
  }

  function accountOf(t) {
    const m = t.match(/(?:[xX*]{2,}|\*|\.{2,}|\b[xX])(\d{3,6})\b/) ||
      t.match(/\b(?:card|a\/c|acct|ac)\s*(?:no\.?\s*)?(?:ending\s*(?:with\s*)?)?(\d{4})\b/i);
    return m ? m[1].slice(-4) : '';
  }

  function refOf(t) {
    const m = t.match(/\bUPI\/(?:P2[AM]\/|DR\/|CR\/)?(\d{9,})/i) ||
      t.match(/\b(?:upi\s*ref(?:erence)?|ref(?:erence)?|refno|rrn|utr|txn\s*(?:id|no)|transaction\s*(?:id|no)|upi)\s*(?:no\.?|number|id)?\s*[:#.\-]?\s*(\d{9,})/i);
    return m ? m[1] : '';
  }

  function merchantOf(t) {
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

  function modeOf(t) {
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
  function smsDate(t, now) {
    let m, d = null;
    if ((m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) d = mkDate(m[1], m[2], m[3]);
    else if ((m = t.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/))) d = mkDate(m[3], m[2], m[1]);
    else if ((m = t.match(/\b(\d{1,2})[\s\-\/]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-\/,]*(\d{2,4})\b/i))) {
      d = mkDate(m[3], MONTH[m[2].toLowerCase()], m[1]);
    }
    const day = 86400000;
    if (!d || d - now > day || now - d > 400 * day) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return d;
  }

  function mkDate(y, mo, d) {
    y = Number(y); mo = Number(mo); d = Number(d);
    if (y < 100) y += 2000;
    const out = new Date(y, mo - 1, d);
    return out.getMonth() === mo - 1 && out.getDate() === d ? out : null;
  }

  // ---------- Categories: your choice per payee > your rules > brand words > blank ----------

  function context(db) {
    const exact = {}, words = [];
    Object.keys(db.payees).forEach(k => {
      const c = db.payees[k].category;
      if (!k || !c) return;
      exact[k] = c;
      words.push([k, c]);
    });
    BRANDS.forEach(([k, c]) => words.push([k, c]));
    words.sort((a, b) => b[0].length - a[0].length);
    return { exact, words: words.map(([k, c]) => [k, c, new RegExp('[^a-z0-9]' + escRe(k))]),
      rules: db.rules.map(parseRule).filter(r => r.active) };
  }

  function categorize(tx, ctx) {
    const key = payeeKey(tx);
    if (key && ctx.exact[key]) return ctx.exact[key];
    const rule = ctx.rules.find(r => ruleMatches(r, tx));
    if (rule) return rule.category;
    const hay = ' ' + norm(tx.merchant + ' ' + String(tx.payee || '').split('@')[0]);
    const w = ctx.words.find(([, , re]) => re.test(hay));
    return w ? w[1] : '';
  }

  function payeeKey(tx) {
    return norm(tx.payee || tx.merchant);
  }

  // Time rules use the time the SMS arrived, so they only apply to live payments (not imported ones).
  function decorate(tx) {
    const at = tx.at ? new Date(tx.at) : null;
    const date = parseYmd(tx.date);
    tx.live = (tx.source === 'SMS' || tx.source === 'Cash') && !!at && !!date &&
      Math.abs(dayStart(at) - dayStart(date)) <= 86400000;
    tx.minutes = tx.live ? at.getHours() * 60 + at.getMinutes() : null;
    const d = tx.live ? at : date;
    tx.day = d ? d.getDay() : null;
    return tx;
  }

  // Stored rule: {id, category, min, max, from, to (minutes after midnight), days ('Weekdays' etc.), payee, status, note}
  function parseRule(r) {
    const rule = Object.assign({}, r, { min: numOrNull(r.min), max: numOrNull(r.max), from: numOrNull(r.from),
      to: numOrNull(r.to), dayList: daysOf(r.days), payee: norm(r.payee), status: String(r.status || 'on').toLowerCase() });
    rule.hasCondition = rule.min !== null || rule.max !== null || rule.from !== null || rule.to !== null ||
      !!rule.payee || !!rule.dayList;
    rule.active = !!rule.category && rule.hasCondition && rule.status === 'on';
    return rule;
  }

  function ruleMatches(r, tx) {
    if (!r.active || !covers(r, tx)) return false;
    if (r.dayList && (tx.day === null || r.dayList.indexOf(tx.day) < 0)) return false;
    if (r.payee && (' ' + norm(tx.merchant + ' ' + (tx.payee || ''))).indexOf(r.payee) < 0) return false;
    return true;
  }

  // Amount and time part of a rule (also used to avoid asking about payments a rule already covers).
  function covers(r, tx) {
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
  function suggestion(recent, tx, rules) {
    if (!tx.live || tx.category) return null;
    const near = recent.filter(r => r.live && !r.category && Math.abs(r.amount - tx.amount) <= 5 &&
      Math.abs(r.minutes - tx.minutes) <= 60);
    if (near.length < 3 || new Set(near.map(payeeKey)).size < 2) return null;
    if (rules.some(r => !r.payee && (r.min !== null || r.max !== null || r.from !== null) && covers(r, tx))) return null;
    const amts = near.map(r => r.amount), mins = near.map(r => r.minutes);
    const amt = inr(median(amts)), around = clock(Math.round(median(mins) / 5) * 5);
    return {
      rule: { id: 'r' + Date.now(), category: '', min: Math.max(1, Math.floor(Math.min(...amts)) - 5),
        max: Math.ceil(Math.max(...amts)) + 5, from: Math.max(0, Math.floor((Math.min(...mins) - 30) / 15) * 15),
        to: Math.min(1425, Math.ceil((Math.max(...mins) + 30) / 15) * 15),
        days: near.every(r => r.day >= 1 && r.day <= 5) ? 'Weekdays'
          : near.every(r => r.day === 0 || r.day === 6) ? 'Weekends' : 'Any',
        payee: '', status: 'suggested',
        note: `${near.length} payments of about ${amt} around ${around}, to different people.` },
      notify: `${near.length} payments of about ${amt} around ${around}. What are they? Open Spend Tracker to answer.`,
    };
  }

  // ---------- Storage (iCloud Drive › Scriptable › Spend Tracker) ----------

  const FILES = { txs: 'transactions.json', payees: 'payees.json', rules: 'rules.json', cats: 'categories.json',
    skipped: 'skipped.json', state: 'state.json' };
  const DEFAULTS = { txs: [], payees: {}, rules: [], cats: DEFAULT_CATEGORIES, skipped: [], state: {} };

  function files() {
    let fm;
    try { fm = FileManager.iCloud(); fm.documentsDirectory(); } catch (_) { fm = FileManager.local(); }
    const dir = fm.joinPath(fm.documentsDirectory(), 'Spend Tracker');
    const inbox = fm.joinPath(dir, 'inbox');
    if (!fm.fileExists(inbox)) fm.createDirectory(inbox, true);
    return { fm, dir, inbox };
  }

  async function readJSON(f, path, fallback) {
    if (!f.fm.fileExists(path)) return fallback;
    try {
      if (f.fm.isFileStoredIniCloud(path) && !f.fm.isFileDownloaded(path)) await f.fm.downloadFileFromiCloud(path);
      return JSON.parse(f.fm.readString(path));
    } catch (_) { return fallback; }
  }

  // New SMS go into inbox/ as one small file each, so two SMS at the same moment can't overwrite each other.
  // The app and the widget move them into transactions.json.
  async function open(f) {
    f = f || files();
    const db = { f };
    for (const k of Object.keys(FILES)) {
      db[k] = await readJSON(f, f.fm.joinPath(f.dir, FILES[k]), JSON.parse(JSON.stringify(DEFAULTS[k])));
    }
    const keys = new Set(db.txs.map(t => t.key));
    const inboxFiles = f.fm.listContents(f.inbox).filter(n => n.endsWith('.json'));
    let moved = 0;
    for (const n of inboxFiles) {
      const t = await readJSON(f, f.fm.joinPath(f.inbox, n), null);
      if (t && t.key && !keys.has(t.key)) { db.txs.push(t); keys.add(t.key); moved++; }
    }
    if (moved) sortTxs(db.txs);
    db.save = (...names) => names.forEach(k => f.fm.writeString(f.fm.joinPath(f.dir, FILES[k]), JSON.stringify(db[k])));
    if (inboxFiles.length) {
      db.save('txs'); // written before the inbox files are removed, so nothing is lost
      inboxFiles.forEach(n => { try { f.fm.remove(f.fm.joinPath(f.inbox, n)); } catch (_) {} });
    }
    return db;
  }

  function sortTxs(txs) {
    txs.sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
  }

  // From the shortcut: one bank SMS. Returns {result, notify}.
  async function logSms(text, now) {
    now = now || new Date();
    const p = parseSms(text, now);
    if (p.drop) return { result: 'dropped' };
    const f = files();
    if (p.skip) {
      if (p.log) {
        const path = f.fm.joinPath(f.dir, FILES.skipped);
        const list = await readJSON(f, path, []);
        list.unshift({ at: now.toISOString(), why: p.skip, sms: String(text).slice(0, 1000) });
        f.fm.writeString(path, JSON.stringify(list.slice(0, 300)));
      }
      return { result: 'skipped', why: p.skip };
    }
    const db = await readOnly(f);
    const tx = Object.assign(p.tx, { at: now.toISOString(), source: 'SMS', note: '', sms: String(text).slice(0, 1000) });
    tx.key = tx.ref ? `${tx.bank}|${tx.ref}` : 'h:' + hash(text);
    if (db.txs.some(t => t.key === tx.key)) return { result: 'duplicate' };
    tx.category = categorize(decorate(Object.assign({}, tx)), context(db));
    f.fm.writeString(f.fm.joinPath(f.inbox, hash(tx.key) + '.json'), JSON.stringify(tx));
    const out = { result: 'added', amount: tx.amount, merchant: tx.merchant, category: tx.category };
    if (!tx.category) out.notify = await ask(f, db, tx, now);
    return out;
  }

  // Everything stored, including SMS still waiting in the inbox, without changing any file.
  async function readOnly(f) {
    const db = { f };
    for (const k of ['txs', 'payees', 'rules', 'state']) {
      db[k] = await readJSON(f, f.fm.joinPath(f.dir, FILES[k]), JSON.parse(JSON.stringify(DEFAULTS[k])));
    }
    for (const n of f.fm.listContents(f.inbox).filter(x => x.endsWith('.json'))) {
      const t = await readJSON(f, f.fm.joinPath(f.inbox, n), null);
      if (t) db.txs.push(t);
    }
    return db;
  }

  async function ask(f, db, tx, now) {
    const today = ymd(now);
    if (db.state.lastAsk === today) return '';
    const since = now.getTime() - 14 * 86400000;
    const recent = db.txs.concat([tx]).filter(t => t.at && new Date(t.at).getTime() >= since)
      .map(t => decorate(Object.assign({}, t)));
    const s = suggestion(recent, decorate(Object.assign({}, tx)), db.rules.map(parseRule)
      .filter(r => r.hasCondition && !(r.example && r.status === 'off')));
    if (!s) return '';
    db.rules.push(s.rule);
    db.state.lastAsk = today;
    f.fm.writeString(f.fm.joinPath(f.dir, FILES.rules), JSON.stringify(db.rules));
    f.fm.writeString(f.fm.joinPath(f.dir, FILES.state), JSON.stringify(db.state));
    return s.notify;
  }

  function addCash(db, amount, note, now) {
    now = now || new Date();
    const n = Number(String(amount).replace(/[^\d.]/g, ''));
    if (!(n > 0)) return null;
    const tx = { date: ymd(now), amount: n, merchant: String(note || '').trim().slice(0, 60) || 'Cash', payee: '',
      bank: 'Cash', account: '', mode: 'Cash', ref: '', at: now.toISOString(), source: 'Cash', note: '', sms: '',
      key: 'cash:' + now.getTime() + ':' + Math.random().toString(36).slice(2, 6) };
    tx.category = categorize(decorate(Object.assign({}, tx)), context(db));
    db.txs.unshift(tx);
    sortTxs(db.txs);
    db.save('txs');
    return tx;
  }

  // Picking a category remembers it for that payee and fills that payee's other blank payments.
  function setCategory(db, tx, category) {
    tx.category = category;
    const key = payeeKey(tx);
    if (key && category) {
      db.payees[key] = { label: String(tx.payee || tx.merchant).trim(), category };
      db.txs.forEach(t => { if (!t.category && payeeKey(t) === key) t.category = category; });
      db.save('payees');
    }
    db.save('txs');
  }

  // After a rule or category change: fill payments that still have no category. Never changes a filled one.
  function fillBlanks(db) {
    const ctx = context(db);
    let n = 0;
    db.txs.forEach(t => {
      if (t.category) return;
      const c = categorize(decorate(Object.assign({}, t)), ctx);
      if (c) { t.category = c; n++; }
    });
    if (n) db.save('txs');
    return n;
  }

  // ---------- Month totals for the widget and the app ----------

  function summary(db, monthStart, now) {
    now = now || new Date();
    monthStart = monthStart || new Date(now.getFullYear(), now.getMonth(), 1);
    const key = ymd(monthStart).slice(0, 7);
    const days = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const isNow = key === ymd(now).slice(0, 7);
    const budgets = {};
    db.cats.forEach(c => { if (Number(c.budget) > 0) budgets[c.name] = Number(c.budget); });
    const daily = new Array(days).fill(0);
    const spent = {};
    let total = 0, today = 0, blank = 0, count = 0;
    const todayKey = ymd(now);
    db.txs.forEach(t => {
      if (!t.date || t.date.slice(0, 7) !== key || t.category === NOT_SPENDING) return;
      const amt = Number(t.amount) || 0;
      if (!t.category) blank++;
      count++;
      total += amt;
      daily[Number(t.date.slice(8, 10)) - 1] += amt;
      if (t.date === todayKey) today += amt;
      const c = t.category || 'Uncategorized';
      spent[c] = (spent[c] || 0) + amt;
    });
    const categories = Object.keys(spent).map(name => ({ name, spent: spent[name], budget: budgets[name] || 0 }))
      .sort((a, b) => b.spent - a.spent);
    return {
      key, month: monthName(monthStart), total, count,
      budget: Object.keys(budgets).reduce((a, k) => a + budgets[k], 0),
      today, day: isNow ? now.getDate() : days, daily, categories, uncategorized: blank,
      ask: db.rules.filter(r => r.status === 'suggested' && !r.category).length,
    };
  }

  function toCsv(db) {
    const cols = ['date', 'amount', 'merchant', 'category', 'note', 'payee', 'bank', 'account', 'mode', 'ref', 'at', 'source', 'sms'];
    const cell = v => {
      const s = String(v === undefined || v === null ? '' : v);
      const safe = /^[=+\-@]/.test(s) ? "'" + s : s; // so spreadsheet apps don't run it as a formula
      return /[",\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
    };
    return [cols.join(',')].concat(db.txs.map(t => cols.map(c => cell(t[c])).join(','))).join('\n');
  }

  // ---------- Helpers ----------

  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function parseYmd(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function monthName(d) {
    return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
      'November', 'December'][d.getMonth()] + ' ' + d.getFullYear();
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function num(s) { return Number(String(s).replace(/,/g, '')) || 0; }
  function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  function clock(mins) {
    const h = Math.floor(mins / 60), m = mins % 60;
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
  // "9", "9:30", "9:30 AM", "21:15" -> minutes after midnight.
  function clockMins(s) {
    const m = String(s || '').trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])?\.?\s*m?\.?$/i);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2] || 0);
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    return h < 24 && min < 60 ? h * 60 + min : null;
  }
  const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  // "Weekdays", "Weekends", "Mon-Fri", "Sat, Sun" -> [day numbers], or null for any day.
  function daysOf(s) {
    s = norm(s);
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
  function median(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  }
  // Two 32-bit FNV-1a hashes: a stable key for SMS that have no reference number.
  function hash(s) {
    const str = norm(s);
    let a = 0x811c9dc5, b = 0x01000193;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
    }
    return a.toString(16) + b.toString(16);
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function inr(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }

  return { VERSION, NOT_SPENDING, BRANDS, files, open, logSms, addCash, setCategory, fillBlanks, summary, toCsv,
    parseSms, categorize, context, decorate, parseRule, ruleMatches, covers, suggestion, payeeKey, sortTxs,
    clock, clockMins, daysOf, hash, inr, ymd, parseYmd, monthName };
})();

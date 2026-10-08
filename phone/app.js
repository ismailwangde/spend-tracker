// Spend Tracker app: dashboard (run it) and home-screen widget (add it as a Scriptable widget).
// Installed and updated by the Spend Tracker shortcut. Uses ST from core.js, which is placed above this.

// ---------- Widget ----------

const W = {
  bg: new Color('#1a1a19'), ink: new Color('#ffffff'), ink2: new Color('#c3c2b7'), axis: new Color('#c3c2b7', 0.35),
  bar: new Color('#3987e5'), today: new Color('#86b6ef'), track: new Color('#ffffff', 0.1),
  good: new Color('#0ca30c'), warn: new Color('#fab219'), over: new Color('#d03b3b'),
};
// The same chart drawn inside the app follows light or dark mode.
const APP_INK2 = () => (Device.isUsingDarkAppearance() ? new Color('#c3c2b7') : new Color('#5c5b55'));

const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const num = n => Math.round(n).toLocaleString('en-IN');
const short = n => (n >= 1000 ? '₹' + (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : inr(n));
const thousands = n => (n >= 10000 ? String(Math.round(n / 1000)) : (n / 1000).toFixed(1)); // bar labels: 14 = ₹14k
const budgetColor = frac => (frac > 1 ? W.over : frac >= 0.8 ? W.warn : W.good);

function canvas(width, height) {
  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.respectScreenScale = true;
  return dc;
}

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
}

// One bar per day of the month. Today is the lighter bar. With `labels`, days above the median of spending
// days get their value (in thousands) on top; a label that would collide with a bigger one is skipped.
function dailyChart(daily, day, width, height, gap, labels, ink2) {
  ink2 = ink2 || W.ink2;
  const dc = canvas(width, height);
  const labelH = labels ? 11 : 0, axisH = 12;
  const base = height - axisH, plotH = base - labelH;
  const n = daily.length;
  const bw = (width - (n - 1) * gap) / n;
  const max = Math.max(...daily, 1);
  const med = median(daily.slice(0, day).filter(v => v > 0));
  dc.setFillColor(new Color(ink2.hex, 0.35));
  dc.fillRect(new Rect(0, base, width, 1));
  const tags = [];
  daily.forEach((v, i) => {
    if (i >= day || v <= 0) return;
    const h = Math.max(2, (v / max) * plotH);
    const x = i * (bw + gap), y = base - h;
    const r = Math.min(2, bw / 2, h / 2);
    const p = new Path();
    p.addRoundedRect(new Rect(x, y, bw, h), r, r);
    dc.setFillColor(i === day - 1 ? W.today : W.bar);
    dc.addPath(p);
    dc.fillPath();
    dc.fillRect(new Rect(x, y + h - r, bw, r)); // square end on the baseline
    if (labels && v > med) tags.push({ x: x + bw / 2, y, v });
  });
  if (tags.length) {
    dc.setFont(Font.mediumSystemFont(8));
    dc.setTextColor(ink2);
    dc.setTextAlignedCenter();
    const placed = [];
    tags.sort((a, b) => b.v - a.v).forEach(t => {
      const label = thousands(t.v);
      const tw = label.length * 4.4 + 2;
      const left = Math.min(Math.max(t.x - tw / 2, 0), width - tw);
      if (placed.some(([l, r]) => left < r + 1 && left + tw > l - 1)) return;
      placed.push([left, left + tw]);
      dc.drawTextInRect(label, new Rect(left - 4, t.y - labelH, tw + 8, labelH));
    });
  }
  dc.setTextColor(ink2);
  dc.setFont(Font.systemFont(9));
  dc.setTextAlignedLeft();
  dc.drawTextInRect('1', new Rect(0, base + 2, 24, axisH));
  dc.setTextAlignedRight();
  dc.drawTextInRect(String(n), new Rect(width - 24, base + 2, 24, axisH));
  return dc.getImage();
}

function categoryBar(c, max, width, height) {
  const dc = canvas(width, height);
  const r = height / 2;
  if (c.budget) {
    const t = new Path();
    t.addRoundedRect(new Rect(0, 0, Math.max(height, Math.min(1, c.budget / max) * width), height), r, r);
    dc.setFillColor(W.track);
    dc.addPath(t);
    dc.fillPath();
  }
  const p = new Path();
  p.addRoundedRect(new Rect(0, 0, Math.max(height, (c.spent / max) * width), height), r, r);
  dc.setFillColor(c.budget && c.spent / c.budget >= 0.8 ? budgetColor(c.spent / c.budget) : W.bar);
  dc.addPath(p);
  dc.fillPath();
  dc.fillRect(new Rect(0, 0, r, height));
  return dc.getImage();
}

function meter(frac, width, height) {
  const dc = canvas(width, height);
  const r = height / 2;
  const t = new Path();
  t.addRoundedRect(new Rect(0, 0, width, height), r, r);
  dc.setFillColor(W.track);
  dc.addPath(t);
  dc.fillPath();
  if (frac > 0) {
    const p = new Path();
    p.addRoundedRect(new Rect(0, 0, Math.max(height, Math.min(1, frac) * width), height), r, r);
    dc.setFillColor(budgetColor(frac));
    dc.addPath(p);
    dc.fillPath();
  }
  return dc.getImage();
}

function text(stack, s, size, { color = W.ink, weight = 'regular' } = {}) {
  const t = stack.addText(s);
  t.font = weight === 'bold' ? Font.boldSystemFont(size) : weight === 'medium' ? Font.mediumSystemFont(size) : Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  return t;
}

function image(stack, img, width, height) {
  stack.addImage(img).imageSize = new Size(width, height);
}

function headline(stack, d) {
  text(stack, d.month.split(' ')[0], 12, { color: W.ink2 });
  stack.addSpacer(1);
  text(stack, inr(d.total), 26, { weight: 'bold' });
}

function budgetLine(stack, d, width) {
  if (!d.budget) return;
  const frac = d.total / d.budget;
  stack.addSpacer(6);
  image(stack, meter(frac, width, 5), width, 5);
  stack.addSpacer(3);
  text(stack, `${Math.round(frac * 100)}% of ${short(d.budget)}`, 11, { color: W.ink2 });
}

// Top n-1 categories plus "Other" for the rest, so the grid never overflows as categories grow.
function fit(cats, n) {
  if (cats.length <= n) return cats;
  const rest = cats.slice(n - 1);
  return cats.slice(0, n - 1).concat({ name: 'Other', spent: rest.reduce((a, c) => a + c.spent, 0), budget: 0 });
}

function categoryCell(stack, c, max, width) {
  const cell = stack.addStack();
  cell.layoutVertically();
  const line = cell.addStack();
  line.size = new Size(width, 0);
  text(line, c.name, 11, { color: W.ink2 });
  line.addSpacer(4);
  text(line, num(c.spent), 11, { weight: 'medium' });
  cell.addSpacer(3);
  image(cell, categoryBar(c, max, width, 4), width, 4);
}

function categoryGrid(w, cats, width, rows) {
  const list = fit(cats, rows * 2);
  const max = Math.max(1, ...list.map(c => c.spent));
  const colW = (width - 16) / 2;
  for (let i = 0; i < list.length; i += 2) {
    if (i) w.addSpacer(6);
    const row = w.addStack();
    categoryCell(row, list[i], max, colW);
    row.addSpacer(16);
    if (list[i + 1]) categoryCell(row, list[i + 1], max, colW);
    else row.addSpacer(colW);
  }
}

function buildWidget(d, family) {
  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  w.url = 'scriptable:///run/' + encodeURIComponent(Script.name());
  const frac = d.budget ? d.total / d.budget : 0;
  const month = d.month.split(' ')[0];

  if (family === 'accessoryInline') {
    w.addText(`${inr(d.total)} spent in ${month}`);
    return w;
  }
  if (family === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const t = w.addText(d.budget ? `${Math.round(frac * 100)}%` : short(d.total));
    t.font = Font.boldSystemFont(16);
    t.centerAlignText();
    const s = w.addText('spent');
    s.font = Font.systemFont(9);
    s.centerAlignText();
    return w;
  }
  if (family === 'accessoryRectangular') {
    const h = w.addText(`${month} spent`);
    h.font = Font.systemFont(11);
    const t = w.addText(inr(d.total) + (d.budget ? ` / ${short(d.budget)}` : ''));
    t.font = Font.boldSystemFont(15);
    t.minimumScaleFactor = 0.6;
    const s = w.addText(`Today ${inr(d.today)}`);
    s.font = Font.systemFont(11);
    return w;
  }

  w.backgroundColor = W.bg;
  w.setPadding(14, 14, 14, 14);
  if (family === 'small') {
    headline(w, d);
    w.addSpacer();
    image(w, dailyChart(d.daily, d.day, 128, 54, 1, false), 128, 54);
    w.addSpacer(4);
    text(w, `Today ${inr(d.today)}`, 11, { color: W.ink2 });
    return w;
  }
  if (family === 'large') {
    const top = w.addStack();
    top.bottomAlignContent();
    const left = top.addStack();
    left.layoutVertically();
    headline(left, d);
    top.addSpacer();
    const right = top.addStack();
    right.layoutVertically();
    if (d.budget) text(right, `${Math.round(frac * 100)}% of ${short(d.budget)}`, 11, { color: budgetColor(frac) });
    text(right, 'Today', 11, { color: W.ink2 });
    text(right, inr(d.today), 15, { weight: 'medium' });
    if (d.ask) text(right, `${d.ask} question waiting`, 10, { color: W.warn });
    w.addSpacer(10);
    image(w, dailyChart(d.daily, d.day, 310, 96, 3, true), 310, 96);
    w.addSpacer(10);
    text(w, 'By category', 11, { color: W.ink2 });
    w.addSpacer(6);
    if (d.categories.length) categoryGrid(w, d.categories, 310, 5);
    else text(w, 'No spends yet', 12, { color: W.ink2 });
    w.addSpacer();
    return w;
  }
  // Medium
  const top = w.addStack();
  const left = top.addStack();
  left.layoutVertically();
  left.size = new Size(112, 0);
  headline(left, d);
  budgetLine(left, d, 100);
  left.addSpacer();
  text(left, 'Today', 11, { color: W.ink2 });
  text(left, inr(d.today), 15, { weight: 'medium' });
  top.addSpacer(12);
  const right = top.addStack();
  right.layoutVertically();
  text(right, 'Daily spend', 11, { color: W.ink2 });
  right.addSpacer(4);
  image(right, dailyChart(d.daily, d.day, 184, 104, 2, true), 184, 104);
  return w;
}

// ---------- App ----------

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = ymd => `${Number(ymd.slice(8, 10))} ${MONTHS_SHORT[Number(ymd.slice(5, 7)) - 1]}`;
const gray = () => APP_INK2();

function header(table, title) {
  const r = new UITableRow();
  r.isHeader = true;
  r.addText(title).titleFont = Font.semiboldSystemFont(15);
  table.addRow(r);
}

function actionRow(table, title, subtitle, onSelect) {
  const r = new UITableRow();
  r.height = subtitle ? 58 : 46;
  const c = r.addText(title, subtitle || null);
  c.titleFont = Font.systemFont(16);
  if (subtitle) { c.subtitleFont = Font.systemFont(13); c.subtitleColor = gray(); }
  r.dismissOnSelect = false;
  r.onSelect = onSelect;
  table.addRow(r);
  return r;
}

function paymentRow(table, db, tx, refresh) {
  const r = new UITableRow();
  r.height = 58;
  const left = r.addText(tx.merchant || tx.bank || 'Payment',
    [dayLabel(tx.date), tx.bank, tx.category || 'No category'].filter(Boolean).join(' · '));
  left.widthWeight = 72;
  left.titleFont = Font.systemFont(16);
  left.subtitleFont = Font.systemFont(13);
  left.subtitleColor = tx.category ? gray() : W.warn;
  const right = r.addText(inr(tx.amount));
  right.widthWeight = 28;
  right.rightAligned();
  right.titleFont = Font.mediumSystemFont(16);
  r.dismissOnSelect = false;
  r.onSelect = async () => { await paymentMenu(db, tx); refresh(); };
  table.addRow(r);
}

async function pickCategory(db, current, title) {
  const a = new Alert();
  a.title = title || 'Category';
  const names = db.cats.map(c => c.name);
  names.forEach(n => a.addAction(n === current ? n + '  ✓' : n));
  a.addAction('New category…');
  a.addCancelAction('Cancel');
  const i = await a.presentSheet();
  if (i < 0) return null;
  if (i < names.length) return names[i];
  const b = new Alert();
  b.title = 'New category';
  b.addTextField('Name', '');
  b.addAction('Add');
  b.addCancelAction('Cancel');
  if ((await b.presentAlert()) < 0) return null;
  const name = b.textFieldValue(0).trim();
  if (!name) return null;
  if (!names.some(n => n.toLowerCase() === name.toLowerCase())) {
    db.cats.splice(Math.max(0, db.cats.length - 1), 0, { name, budget: 0 }); // before "Not spending"
    db.save('cats');
  }
  return name;
}

async function paymentMenu(db, tx) {
  const a = new Alert();
  a.title = `${inr(tx.amount)} · ${tx.merchant || tx.bank}`;
  a.message = [dayLabel(tx.date), tx.bank, tx.mode, tx.note].filter(Boolean).join(' · ');
  a.addAction(tx.category ? `Category: ${tx.category}` : 'Choose a category');
  a.addAction(tx.note ? 'Edit note' : 'Add a note');
  if (tx.sms) a.addAction('Show the SMS');
  a.addDestructiveAction('Delete this payment');
  a.addCancelAction('Close');
  const i = await a.presentSheet();
  if (i < 0) return;
  if (i === 0) {
    const cat = await pickCategory(db, tx.category, `Category for ${tx.merchant || 'this payment'}`);
    if (cat) ST.setCategory(db, tx, cat);
  } else if (i === 1) {
    const b = new Alert();
    b.title = 'Note';
    b.addTextField('e.g. dinner with Riya', tx.note || '');
    b.addAction('Save');
    b.addCancelAction('Cancel');
    if ((await b.presentAlert()) === 0) { tx.note = b.textFieldValue(0).trim(); db.save('txs'); }
  } else if (tx.sms && i === 2) {
    const b = new Alert();
    b.title = 'SMS';
    b.message = tx.sms;
    b.addAction('OK');
    await b.presentAlert();
  } else {
    const b = new Alert();
    b.title = 'Delete this payment?';
    b.addDestructiveAction('Delete');
    b.addCancelAction('Cancel');
    if ((await b.presentAlert()) === 0) { db.txs.splice(db.txs.indexOf(tx), 1); db.save('txs'); }
  }
}

async function listScreen(db, title, filter) {
  const table = new UITable();
  table.showSeparators = true;
  const render = () => {
    table.removeAllRows();
    header(table, title);
    const list = db.txs.filter(filter);
    if (!list.length) actionRow(table, 'Nothing here', null, () => {});
    list.slice(0, 300).forEach(tx => paymentRow(table, db, tx, render));
    table.reload();
  };
  render();
  await table.present(false);
}

async function answerRule(db, rule) {
  const a = new Alert();
  a.title = 'What are these?';
  a.message = rule.note + '\n\nPick a category and future ones like these are sorted automatically.';
  a.addAction('Pick a category');
  a.addAction("They're different, don't ask again");
  a.addCancelAction('Later');
  const i = await a.presentAlert();
  if (i === 0) {
    const cat = await pickCategory(db, '', 'These payments are…');
    if (!cat) return;
    rule.category = cat;
    rule.status = 'on';
  } else if (i === 1) {
    rule.status = 'off';
  } else return;
  db.save('rules');
  ST.fillBlanks(db);
}

async function addCash(db) {
  const a = new Alert();
  a.title = 'Cash spent';
  a.addTextField('Amount in ₹', '').setDecimalPadKeyboard();
  a.addTextField('What was it for?', '');
  a.addAction('Add');
  a.addCancelAction('Cancel');
  if ((await a.presentAlert()) < 0) return;
  const tx = ST.addCash(db, a.textFieldValue(0), a.textFieldValue(1));
  if (!tx) {
    const b = new Alert();
    b.title = "That amount didn't look right";
    b.addAction('OK');
    await b.presentAlert();
  }
}

async function categoriesScreen(db) {
  const table = new UITable();
  table.showSeparators = true;
  const render = () => {
    table.removeAllRows();
    header(table, 'Categories & monthly budgets');
    db.cats.forEach(c => {
      const sub = c.name === ST.NOT_SPENDING ? 'Not counted in totals (own transfers, money you got back)'
        : c.budget ? `Budget ${inr(c.budget)} a month` : 'No budget';
      actionRow(table, c.name, sub, async () => { await editCategory(db, c); render(); });
    });
    actionRow(table, '＋ New category', null, async () => { await pickCategoryNew(db); render(); });
    table.reload();
  };
  render();
  await table.present(false);
}

async function pickCategoryNew(db) {
  const b = new Alert();
  b.title = 'New category';
  b.addTextField('Name', '');
  b.addAction('Add');
  b.addCancelAction('Cancel');
  if ((await b.presentAlert()) < 0) return;
  const name = b.textFieldValue(0).trim();
  if (name && !db.cats.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    db.cats.splice(Math.max(0, db.cats.length - 1), 0, { name, budget: 0 });
    db.save('cats');
  }
}

async function editCategory(db, c) {
  const fixed = c.name === ST.NOT_SPENDING;
  const a = new Alert();
  a.title = c.name;
  a.addAction(c.budget ? 'Change monthly budget' : 'Set a monthly budget');
  if (!fixed) a.addAction('Rename');
  if (!fixed) a.addDestructiveAction('Delete');
  a.addCancelAction('Close');
  const i = await a.presentSheet();
  if (i < 0) return;
  if (i === 0) {
    const b = new Alert();
    b.title = `Monthly budget for ${c.name}`;
    b.addTextField('₹ (leave empty for none)', c.budget ? String(c.budget) : '').setNumberPadKeyboard();
    b.addAction('Save');
    b.addCancelAction('Cancel');
    if ((await b.presentAlert()) === 0) { c.budget = Number(b.textFieldValue(0).replace(/[^\d]/g, '')) || 0; db.save('cats'); }
  } else if (i === 1) {
    const b = new Alert();
    b.title = 'Rename';
    b.addTextField('Name', c.name);
    b.addAction('Save');
    b.addCancelAction('Cancel');
    if ((await b.presentAlert()) !== 0) return;
    const name = b.textFieldValue(0).trim();
    if (!name || name === c.name) return;
    if (db.cats.some(x => x !== c && x.name.toLowerCase() === name.toLowerCase())) {
      const e = new Alert();
      e.title = `There's already a category called ${name}`;
      e.message = `To move ${c.name}'s payments there, delete ${c.name} and pick ${name} for them.`;
      e.addAction('OK');
      await e.presentAlert();
      return;
    }
    const old = c.name;
    c.name = name;
    db.txs.forEach(t => { if (t.category === old) t.category = name; });
    Object.values(db.payees).forEach(p => { if (p.category === old) p.category = name; });
    db.rules.forEach(r => { if (r.category === old) r.category = name; });
    db.save('cats', 'txs', 'payees', 'rules');
  } else {
    const used = db.txs.filter(t => t.category === c.name).length;
    const b = new Alert();
    b.title = `Delete ${c.name}?`;
    b.message = used ? `${used} payments will have no category.` : '';
    b.addDestructiveAction('Delete');
    b.addCancelAction('Cancel');
    if ((await b.presentAlert()) !== 0) return;
    db.cats.splice(db.cats.indexOf(c), 1);
    db.txs.forEach(t => { if (t.category === c.name) t.category = ''; });
    Object.keys(db.payees).forEach(k => { if (db.payees[k].category === c.name) delete db.payees[k]; });
    db.rules.forEach(r => { if (r.category === c.name) r.status = 'off'; });
    db.save('cats', 'txs', 'payees', 'rules');
  }
}

function describeRule(r) {
  const parts = [];
  if (r.min !== '' && r.min !== null && r.min !== undefined) parts.push(`₹${r.min}${r.max ? '–' + r.max : '+'}`);
  else if (r.max) parts.push(`up to ₹${r.max}`);
  if (r.from !== null && r.from !== undefined && r.from !== '') parts.push(`${ST.clock(r.from)}–${ST.clock(r.to === null || r.to === undefined || r.to === '' ? 1439 : r.to)}`);
  if (r.days && r.days !== 'Any') parts.push(r.days);
  if (r.payee) parts.push(`payee has “${r.payee}”`);
  return parts.join(' · ') || 'no conditions';
}

async function rulesScreen(db) {
  const table = new UITable();
  table.showSeparators = true;
  const render = () => {
    table.removeAllRows();
    header(table, 'Rules: sort payments by amount, time and day');
    db.rules.forEach(r => {
      const status = r.status === 'suggested' ? 'Question waiting' : r.status === 'off' ? 'Off' : 'On';
      actionRow(table, `${r.category || '?'} · ${describeRule(r)}`, status, async () => { await editRule(db, r); render(); });
    });
    actionRow(table, '＋ New rule', 'For example ₹20–30 on weekday mornings = Transport', async () => {
      const r = { id: 'r' + Date.now(), category: '', min: '', max: '', from: null, to: null, days: 'Any', payee: '', status: 'on', note: '' };
      if (await ruleForm(db, r)) { db.rules.push(r); db.save('rules'); ST.fillBlanks(db); }
      render();
    });
    table.reload();
  };
  render();
  await table.present(false);
}

// What's wrong with the rule form's boxes, or '' if nothing. Typos are caught here, not silently ignored.
function ruleProblem([min, max, from, to, days, payee]) {
  const amount = s => s === '' || /^\d+(\.\d+)?$/.test(s);
  if (!amount(min) || !amount(max)) return 'Amounts should be numbers, like 20.';
  if (min !== '' && max !== '' && Number(min) > Number(max)) return '“Amount from” is bigger than “Amount to”.';
  for (const t of [from, to]) if (t !== '' && ST.clockMins(t) === null) return `I couldn't read the time “${t}”. Write it like 8:30 AM.`;
  if (!ST.daysOk(days)) return `I couldn't read the days “${days}”. Use Any, Weekdays, Weekends, or days like Mon-Fri or Sat, Sun.`;
  if (min === '' && max === '' && from === '' && to === '' && !ST.daysOf(days) && payee === '') {
    return 'Fill in at least one box: an amount, a time, the days or the payee.';
  }
  return '';
}

async function ruleForm(db, r) {
  const blank = v => v === null || v === undefined || v === '';
  let v = [blank(r.min) ? '' : String(r.min), blank(r.max) ? '' : String(r.max), blank(r.from) ? '' : ST.clock(r.from),
    blank(r.to) ? '' : ST.clock(r.to), r.days || 'Any', r.payee || ''];
  for (;;) {
    const a = new Alert();
    a.title = 'Rule';
    a.message = 'Leave a box empty if it doesn\'t matter. Times like 8:00 AM. Days: Any, Weekdays, Weekends or Mon-Fri.';
    a.addTextField('Amount from (₹)', v[0]).setNumberPadKeyboard();
    a.addTextField('Amount to (₹)', v[1]).setNumberPadKeyboard();
    a.addTextField('Time from', v[2]);
    a.addTextField('Time to', v[3]);
    a.addTextField('Days', v[4]);
    a.addTextField('Payee contains', v[5]);
    a.addAction('Next: pick category');
    a.addCancelAction('Cancel');
    if ((await a.presentAlert()) < 0) return false;
    v = v.map((_, i) => a.textFieldValue(i).trim());
    v[0] = v[0].replace(/[₹,\s]/g, '');
    v[1] = v[1].replace(/[₹,\s]/g, '');
    const problem = ruleProblem(v);
    if (!problem) break;
    const b = new Alert();
    b.title = 'Check the rule';
    b.message = problem;
    b.addAction('Fix it');
    b.addCancelAction('Cancel');
    if ((await b.presentAlert()) < 0) return false;
  }
  const cat = await pickCategory(db, r.category, 'Payments matching this rule are…');
  if (!cat) return false;
  Object.assign(r, { min: v[0] ? Number(v[0]) : '', max: v[1] ? Number(v[1]) : '', from: ST.clockMins(v[2]),
    to: ST.clockMins(v[3]), days: v[4] || 'Any', payee: v[5], category: cat, status: 'on' });
  return true;
}

async function editRule(db, r) {
  if (r.status === 'suggested') return answerRule(db, r);
  const a = new Alert();
  a.title = `${r.category || '?'} · ${describeRule(r)}`;
  a.addAction('Edit');
  a.addAction(r.status === 'off' ? 'Turn on' : 'Turn off');
  a.addDestructiveAction('Delete');
  a.addCancelAction('Close');
  const i = await a.presentSheet();
  if (i === 0) { if (await ruleForm(db, r)) { db.save('rules'); ST.fillBlanks(db); } }
  else if (i === 1) { r.status = r.status === 'off' ? 'on' : 'off'; db.save('rules'); ST.fillBlanks(db); }
  else if (i === 2) { db.rules.splice(db.rules.indexOf(r), 1); db.save('rules'); }
}

async function skippedScreen(db) {
  const table = new UITable();
  table.showSeparators = true;
  header(table, 'Bank messages that were not counted');
  if (!db.skipped.length) actionRow(table, 'Nothing skipped yet', null, () => {});
  db.skipped.forEach(s => {
    const d = new Date(s.at);
    actionRow(table, s.why, `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} · ${s.sms.slice(0, 60)}…`, async () => {
      const b = new Alert();
      b.title = s.why;
      b.message = s.sms;
      b.addAction('OK');
      await b.presentAlert();
    });
  });
  await table.present(false);
}

async function about(db) {
  const a = new Alert();
  a.title = 'Spend Tracker ' + ST.VERSION;
  a.message = 'Your payments are stored only on your iPhone and in your iCloud Drive (Files › iCloud Drive › Scriptable › Spend Tracker). Nothing is sent anywhere.\n\nOTP messages are dropped before anything is stored.';
  a.addAction('OK');
  await a.presentAlert();
}

async function home(db) {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  let month = thisMonth;
  const table = new UITable();
  table.showSeparators = true;

  const render = () => {
    table.removeAllRows();
    const s = ST.summary(db, month, now);
    const isNow = s.key === ST.ymd(now).slice(0, 7);

    const top = new UITableRow();
    top.height = 86;
    const sub = [s.month, s.budget ? `${Math.round((s.total / s.budget) * 100)}% of ${inr(s.budget)}` : '',
      isNow ? `Today ${inr(s.today)}` : ''].filter(Boolean).join(' · ');
    const t = top.addText(inr(s.total), sub);
    t.titleFont = Font.boldSystemFont(32);
    t.subtitleFont = Font.systemFont(14);
    t.subtitleColor = gray();
    table.addRow(top);

    const nav = new UITableRow();
    nav.height = 40;
    const prev = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const b1 = nav.addButton('‹ ' + MONTHS_SHORT[prev.getMonth()]);
    b1.leftAligned();
    b1.onTap = () => { month = prev; render(); };
    if (!isNow) {
      const b2 = nav.addButton(MONTHS_SHORT[next.getMonth()] + ' ›');
      b2.rightAligned();
      b2.onTap = () => { month = next; render(); };
    }
    table.addRow(nav);

    if (s.count) {
      const chart = new UITableRow();
      chart.height = 130;
      chart.addImage(dailyChart(s.daily, s.day, 340, 116, 3, true, gray())).centerAligned();
      table.addRow(chart);
    }

    db.rules.filter(r => r.status === 'suggested' && !r.category).forEach(r => {
      actionRow(table, '❓ ' + r.note, 'Tap to tell me what these are', async () => { await answerRule(db, r); render(); });
    });
    if (s.uncategorized) {
      actionRow(table, `🏷 ${s.uncategorized} payment${s.uncategorized > 1 ? 's need' : ' needs'} a category`, 'Tap to sort them',
        async () => { await listScreen(db, 'No category yet', t => t.date.slice(0, 7) === s.key && !t.category); render(); });
    }

    header(table, 'By category');
    if (!s.categories.length) {
      actionRow(table, 'No payments yet', 'Your next bank SMS will show up here.', () => {});
    }
    s.categories.forEach(c => {
      const r = new UITableRow();
      r.height = 46;
      const l = r.addText(c.name);
      l.widthWeight = 60;
      const right = r.addText(inr(c.spent) + (c.budget ? ` / ${short(c.budget)}` : ''));
      right.widthWeight = 40;
      right.rightAligned();
      if (c.budget && c.spent > c.budget) right.titleColor = W.over;
      r.dismissOnSelect = false;
      r.onSelect = async () => {
        const name = c.name === 'Uncategorized' ? '' : c.name;
        await listScreen(db, `${c.name} · ${s.month}`, t => t.date.slice(0, 7) === s.key && (t.category || '') === name);
        render();
      };
      table.addRow(r);
    });

    header(table, 'Payments');
    db.txs.filter(t => t.date && t.date.slice(0, 7) === s.key).slice(0, 40).forEach(tx => paymentRow(table, db, tx, render));

    header(table, 'More');
    actionRow(table, '＋ Add cash', null, async () => { await addCash(db); render(); });
    actionRow(table, 'Categories & budgets', null, async () => { await categoriesScreen(db); render(); });
    actionRow(table, 'Rules', 'Sort repeated payments by amount, time and day', async () => { await rulesScreen(db); render(); });
    actionRow(table, `Skipped messages (${db.skipped.length})`, 'Bank SMS that were not counted, and why', async () => { await skippedScreen(db); });
    actionRow(table, 'Export as CSV', 'Open it in Numbers, Excel or Google Sheets', async () => {
      await DocumentPicker.exportString(ST.toCsv(db), 'Spend Tracker.csv');
    });
    actionRow(table, 'Where my data is', null, async () => { await about(db); });
    table.reload();
  };

  render();
  await table.present(true);
}

const READY_PAGE = 'https://ismailwangde.github.io/spend-tracker/ready.html';

async function main() {
  // Opened by the shortcut right after a first install: show the widget steps on the setup site.
  if (!config.runsInWidget && !config.runsInAccessoryWidget && (args.queryParameters || {}).setup) {
    Safari.open(READY_PAGE);
    return;
  }
  const db = await ST.open();
  if (config.runsInWidget || config.runsInAccessoryWidget) {
    Script.setWidget(buildWidget(ST.summary(db), config.widgetFamily || 'large'));
    return;
  }
  await home(db);
}

await main();
Script.complete();

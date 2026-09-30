// Spend Tracker widget for the Scriptable app (iOS).
// Large: month total, daily bars (days above the month's median are labelled), categories in two columns.
// Medium: total + daily bars. Small: total + mini bars. Lock screen: rectangular/circular/inline.
// First run inside Scriptable asks for your connection code (Setup tab of your Sheet) and keeps it in the
// iPhone Keychain. Nothing is sent anywhere except your own Sheet.

const KEY = 'spend-tracker-code';
const SHEET_URL = ''; // optional: your Google Sheet link, opened when you tap the widget

const C = {
  bg: new Color('#1a1a19'),
  ink: new Color('#ffffff'),
  ink2: new Color('#c3c2b7'),
  axis: new Color('#c3c2b7', 0.35),
  bar: new Color('#3987e5'),
  today: new Color('#86b6ef'),
  track: new Color('#ffffff', 0.1),
  good: new Color('#0ca30c'),
  warn: new Color('#fab219'),
  over: new Color('#d03b3b'),
};

const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
const num = n => Math.round(n).toLocaleString('en-IN');
const short = n => (n >= 1000 ? '₹' + (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : inr(n));
const thousands = n => (n >= 10000 ? String(Math.round(n / 1000)) : (n / 1000).toFixed(1)); // bar labels: 14 = ₹14k
const budgetColor = frac => (frac > 1 ? C.over : frac >= 0.8 ? C.warn : C.good);

// The connection code looks like https://script.google.com/macros/s/.../exec?k=...
async function code() {
  if (Keychain.contains(KEY)) return Keychain.get(KEY);
  if (config.runsInWidget || config.runsInAccessoryWidget) return null;
  let pasted = '';
  try { pasted = Pasteboard.paste() || ''; } catch (_) {}
  if (!/^https:\/\/script\.google\.com\/.+\?k=\w+/.test(pasted.trim())) {
    const a = new Alert();
    a.title = 'Connect your Sheet';
    a.message = 'Paste the connection code from the Setup tab of your Spend Tracker Sheet.';
    a.addTextField('https://script.google.com/…', '');
    a.addAction('Connect');
    a.addCancelAction('Cancel');
    if ((await a.presentAlert()) < 0) return null;
    pasted = a.textFieldValue(0);
  }
  pasted = pasted.trim();
  if (!/^https:\/\/script\.google\.com\/.+\?k=\w+/.test(pasted)) return null;
  Keychain.set(KEY, pasted);
  return pasted;
}

async function load() {
  const fm = FileManager.local();
  const cache = fm.joinPath(fm.cacheDirectory(), 'spend-widget.json');
  const url = await code();
  if (!url) throw new Error('Open Scriptable and run this script once to connect your Sheet.');
  try {
    const data = await new Request(url).loadJSON();
    if (!data.ok) {
      if (data.error === 'bad code' && !config.runsInWidget) Keychain.remove(KEY); // asks again next run
      throw new Error(data.error === 'bad code' ? 'Connection code changed. Run this script in Scriptable to paste the new one.' : data.error);
    }
    fm.writeString(cache, JSON.stringify(data));
    return data;
  } catch (e) {
    if (fm.fileExists(cache)) return Object.assign(JSON.parse(fm.readString(cache)), { stale: true });
    throw e;
  }
}

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
// days get their value (in thousands) on top; a label that would collide with the previous one is skipped.
function dailyChart(daily, day, width, height, gap, labels) {
  const dc = canvas(width, height);
  const labelH = labels ? 11 : 0, axisH = 12;
  const base = height - axisH, plotH = base - labelH;
  const n = daily.length;
  const bw = (width - (n - 1) * gap) / n;
  const max = Math.max(...daily, 1);
  const med = median(daily.slice(0, day).filter(v => v > 0));

  dc.setFillColor(C.axis);
  dc.fillRect(new Rect(0, base, width, 1));

  const tags = [];
  daily.forEach((v, i) => {
    if (i >= day || v <= 0) return;
    const h = Math.max(2, (v / max) * plotH);
    const x = i * (bw + gap), y = base - h;
    const r = Math.min(2, bw / 2, h / 2);
    const p = new Path();
    p.addRoundedRect(new Rect(x, y, bw, h), r, r);
    dc.setFillColor(i === day - 1 ? C.today : C.bar);
    dc.addPath(p);
    dc.fillPath();
    dc.fillRect(new Rect(x, y + h - r, bw, r)); // square end on the baseline
    if (labels && v > med) tags.push({ x: x + bw / 2, y, v });
  });

  if (tags.length) {
    dc.setFont(Font.mediumSystemFont(8));
    dc.setTextColor(C.ink2);
    dc.setTextAlignedCenter();
    const placed = []; // biggest days get their label first; a label that would overlap one already placed is skipped
    tags.sort((a, b) => b.v - a.v).forEach(t => {
      const label = thousands(t.v);
      const tw = label.length * 4.4 + 2; // approx. width of 8pt digits
      const left = Math.min(Math.max(t.x - tw / 2, 0), width - tw);
      if (placed.some(([l, r]) => left < r + 1 && left + tw > l - 1)) return;
      placed.push([left, left + tw]);
      dc.drawTextInRect(label, new Rect(left - 4, t.y - labelH, tw + 8, labelH));
    });
  }

  dc.setTextColor(C.ink2);
  dc.setFont(Font.systemFont(9));
  dc.setTextAlignedLeft();
  dc.drawTextInRect('1', new Rect(0, base + 2, 24, axisH));
  dc.setTextAlignedRight();
  dc.drawTextInRect(String(n), new Rect(width - 24, base + 2, 24, axisH));
  return dc.getImage();
}

// Category bar: scaled to the largest category; the faint track shows the budget when one is set.
function categoryBar(c, max, width, height) {
  const dc = canvas(width, height);
  const r = height / 2;
  if (c.budget) {
    const t = new Path();
    t.addRoundedRect(new Rect(0, 0, Math.max(height, Math.min(1, c.budget / max) * width), height), r, r);
    dc.setFillColor(C.track);
    dc.addPath(t);
    dc.fillPath();
  }
  const p = new Path();
  p.addRoundedRect(new Rect(0, 0, Math.max(height, (c.spent / max) * width), height), r, r);
  dc.setFillColor(c.budget && c.spent / c.budget >= 0.8 ? budgetColor(c.spent / c.budget) : C.bar);
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
  dc.setFillColor(C.track);
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

function text(stack, s, size, { color = C.ink, weight = 'regular' } = {}) {
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
  text(stack, `${d.month}${d.stale ? ' · offline' : ''}`, 12, { color: C.ink2 });
  stack.addSpacer(1);
  text(stack, inr(d.total), 26, { weight: 'bold' });
}

function budgetLine(stack, d, width) {
  if (!d.budget) return;
  const frac = d.total / d.budget;
  stack.addSpacer(6);
  image(stack, meter(frac, width, 5), width, 5);
  stack.addSpacer(3);
  text(stack, `${Math.round(frac * 100)}% of ${short(d.budget)}`, 11, { color: C.ink2 });
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
  text(line, c.name, 11, { color: C.ink2 });
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

function build(d, family) {
  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  if (SHEET_URL) w.url = SHEET_URL;
  const frac = d.budget ? d.total / d.budget : 0;
  const daily = d.daily || [];
  const day = d.day || daily.length;
  const cats = d.categories || [];

  if (family === 'accessoryInline') {
    w.addText(`${inr(d.total)} spent in ${d.month}`);
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
    const h = w.addText(`${d.month} spent`);
    h.font = Font.systemFont(11);
    const t = w.addText(inr(d.total) + (d.budget ? ` / ${short(d.budget)}` : ''));
    t.font = Font.boldSystemFont(15);
    t.minimumScaleFactor = 0.6;
    const s = w.addText(`Today ${inr(d.today)}`);
    s.font = Font.systemFont(11);
    return w;
  }

  // Home screen
  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 14, 14);

  if (family === 'small') {
    headline(w, d);
    w.addSpacer();
    if (daily.length) image(w, dailyChart(daily, day, 128, 54, 1, false), 128, 54);
    w.addSpacer(4);
    text(w, `Today ${inr(d.today)}`, 11, { color: C.ink2 });
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
    text(right, 'Today', 11, { color: C.ink2 });
    text(right, inr(d.today), 15, { weight: 'medium' });
    if (d.ask) text(right, `${d.ask} question in your Sheet`, 10, { color: C.warn });
    w.addSpacer(10);
    if (daily.length) image(w, dailyChart(daily, day, 310, 96, 3, true), 310, 96);
    w.addSpacer(10);
    text(w, 'By category', 11, { color: C.ink2 });
    w.addSpacer(6);
    if (cats.length) categoryGrid(w, cats, 310, 5);
    else text(w, 'No spends yet', 12, { color: C.ink2 });
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
  text(left, 'Today', 11, { color: C.ink2 });
  text(left, inr(d.today), 15, { weight: 'medium' });
  top.addSpacer(12);
  const right = top.addStack();
  right.layoutVertically();
  text(right, 'Daily spend', 11, { color: C.ink2 });
  right.addSpacer(4);
  if (daily.length) image(right, dailyChart(daily, day, 184, 104, 2, true), 184, 104);
  return w;
}

function errorWidget(msg) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  text(w, 'Spend widget', 12, { color: C.ink2 });
  text(w, msg, 11, { color: C.over }).lineLimit = 3;
  return w;
}

const family = config.widgetFamily || 'large';
let widget;
try {
  widget = build(await load(), family);
} catch (e) {
  widget = errorWidget(String(e.message || e));
}
if (config.runsInWidget || config.runsInAccessoryWidget) Script.setWidget(widget);
else if (family === 'medium') await widget.presentMedium();
else if (family === 'small') await widget.presentSmall();
else await widget.presentLarge();
Script.complete();

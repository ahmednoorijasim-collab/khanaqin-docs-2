(() => {
'use strict';
const $ = (s) => document.querySelector(s);
const { PDFDocument } = PDFLib;

const MODES = {
  scan:   { title: 'مسح مستند',            input: '#inCam',  add: '+ صفحة جديدة بالكاميرا', empty: 'اضغط «صفحة جديدة بالكاميرا» لتصوير أول صفحة.\nيمكنك إضافة عدة صفحات ثم إنشاء ملف PDF واحد.', prefix: 'scan',   img: true  },
  images: { title: 'دمج صور في PDF واحد',   input: '#inImgs', add: '+ إضافة صور',            empty: 'اختر الصور من المعرض.\nكل صورة ستكون صفحة في الملف، ويمكنك ترتيبها.',     prefix: 'images', img: true  },
  merge:  { title: 'دمج ملفات PDF',        input: '#inPdfs', add: '+ إضافة ملفات PDF',      empty: 'اختر ملفين PDF أو أكثر.\nستُدمج بالترتيب الظاهر في القائمة.',               prefix: 'merged', img: false },
  split:  { title: 'تقسيم PDF',            input: '#inPdf1', add: 'اختيار ملف PDF',          empty: '',                                                                          prefix: 'split',  img: false },
};

let mode = null;
let items = [];
let splitDoc = null;   // { name, pages, buf }
let last = null;       // { blob, name, url }

/* ---------- أدوات مساعدة ---------- */
const show = (el, on = true) => { el.hidden = !on; };
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; show(t);
  clearTimeout(toast._t); toast._t = setTimeout(() => show(t, false), 3500);
}
function busy(on, text) { $('#busyText').textContent = text || 'جارٍ التنفيذ…'; show($('#busy'), on); }
const nextFrame = () => new Promise((r) => setTimeout(r, 30));
function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' ميغابايت' : Math.max(1, Math.round(n / 1024)) + ' كيلوبايت'; }
function stamp() { const d = new Date(), p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
const toLatinDigits = (s) => s.replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x0660).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x06F0);

/* ---------- التنقل ---------- */
function openMode(m) {
  mode = m; items = []; splitDoc = null;
  $('#workTitle').textContent = MODES[m].title;
  $('#addBtn').textContent = MODES[m].add;
  $('#range').value = '';
  show($('#bwRow'), MODES[m].img);
  show($('#listArea'), m !== 'split');
  show($('#splitArea'), false);
  $('#home').classList.remove('active');
  $('#work').classList.add('active');
  window.scrollTo(0, 0);
  render();
  // نفتح الكاميرا/الاختيار فوراً لأننا داخل ضغطة المستخدم
  $(MODES[m].input).click();
}
function goHome() {
  items.forEach((i) => i.url && URL.revokeObjectURL(i.url));
  items = []; splitDoc = null; mode = null;
  $('#work').classList.remove('active');
  $('#home').classList.add('active');
}

/* ---------- العرض ---------- */
function render() {
  const ul = $('#items'); ul.innerHTML = '';
  const cfg = MODES[mode];
  $('#empty').textContent = cfg.empty;
  $('#empty').style.whiteSpace = 'pre-line';
  show($('#empty'), mode !== 'split' && items.length === 0);

  items.forEach((it, idx) => {
    const li = document.createElement('li'); li.className = 'item';
    const thumb = it.url ? Object.assign(document.createElement('img'), { src: it.url, alt: '' })
                         : Object.assign(document.createElement('div'), { className: 'pdfico', textContent: 'PDF' });
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.innerHTML = '<b></b><small></small>';
    meta.querySelector('b').textContent = it.name;
    meta.querySelector('small').textContent = (cfg.img ? 'صفحة ' + (idx + 1) : 'ملف ' + (idx + 1)) + ' • ' + fmtSize(it.file.size);
    const ctl = document.createElement('div'); ctl.className = 'ctl';
    const mk = (txt, cls, fn, dis) => { const b = document.createElement('button'); b.textContent = txt; if (cls) b.className = cls; b.disabled = !!dis; b.onclick = fn; return b; };
    ctl.append(
      mk('↑', '', () => move(idx, -1), idx === 0),
      mk('↓', '', () => move(idx, 1), idx === items.length - 1),
      mk('✕', 'del', () => remove(idx))
    );
    li.append(thumb, meta, ctl); ul.append(li);
  });

  if (mode === 'split') {
    show($('#splitArea'), true);
    $('#splitInfo').textContent = splitDoc ? `الملف: ${splitDoc.name} — عدد الصفحات: ${splitDoc.pages}` : 'لم تختر ملفاً بعد.';
    $('#range').disabled = !splitDoc;
  }
  updateMake();
}
function updateMake() {
  const b = $('#makeBtn');
  if (mode === 'split') { b.textContent = 'استخراج الصفحات'; b.disabled = !(splitDoc && $('#range').value.trim()); }
  else if (mode === 'merge') { b.textContent = 'دمج الملفات'; b.disabled = items.length < 2; }
  else { b.textContent = 'إنشاء PDF'; b.disabled = items.length < 1; }
}
function move(i, d) { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; render(); }
function remove(i) { const [r] = items.splice(i, 1); if (r.url) URL.revokeObjectURL(r.url); render(); }

/* ---------- اختيار الملفات ---------- */
function onPick(e) {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length || !mode) return;
  if (mode === 'split') return loadSplit(files[0]);
  files.forEach((f) => items.push({ file: f, name: f.name || ('image_' + (items.length + 1)), url: MODES[mode].img ? URL.createObjectURL(f) : null }));
  render();
}
async function loadSplit(file) {
  try {
    busy(true, 'جارٍ قراءة الملف…'); await nextFrame();
    const buf = await file.arrayBuffer();
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    splitDoc = { name: file.name, pages: doc.getPageCount(), buf };
    items = [{ file, name: file.name, url: null }];
    if (!$('#range').value) $('#range').value = '1';
  } catch (err) { console.error(err); toast('تعذر قراءة هذا الملف. تأكد أنه PDF سليم.'); }
  finally { busy(false); render(); }
}

/* ---------- الصور ---------- */
async function toJpeg(file, bw) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await createImageBitmap(file); }
  const MAX = 2200, k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: bw });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h); bmp.close && bmp.close();
  if (bw) {
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      g = (g - 128) * 1.7 + 128 + 12; g = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
  }
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
  c.width = c.height = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}

/* ---------- إنشاء الملفات ---------- */
async function makeFromImages() {
  const out = await PDFDocument.create(), bw = $('#bw').checked;
  for (let i = 0; i < items.length; i++) {
    busy(true, `جارٍ معالجة الصفحة ${i + 1} من ${items.length}…`); await nextFrame();
    const { bytes, w, h } = await toJpeg(items[i].file, bw);
    const img = await out.embedJpg(bytes);
    const pw = 595, ph = Math.round(595 * h / w);
    out.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph });
  }
  return out;
}
async function makeMerge() {
  const out = await PDFDocument.create();
  for (let i = 0; i < items.length; i++) {
    busy(true, `جارٍ دمج الملف ${i + 1} من ${items.length}…`); await nextFrame();
    const src = await PDFDocument.load(await items[i].file.arrayBuffer(), { ignoreEncryption: true });
    (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
  }
  return out;
}
function parseRange(str, n) {
  const parts = toLatinDigits(str).split(/[,،؛;\s]+/).filter(Boolean), idx = [];
  if (!parts.length) throw new Error('اكتب أرقام الصفحات.');
  for (const p of parts) {
    const m = p.match(/^(\d+)(?:[-–—](\d+))?$/);
    if (!m) throw new Error(`«${p}» غير مفهوم. اكتب مثلاً 2-4 أو 1,3`);
    let a = +m[1], b = m[2] ? +m[2] : a;
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > n) throw new Error(`رقم الصفحة يجب أن يكون بين 1 و ${n}.`);
    for (let k = a; k <= b; k++) idx.push(k - 1);
  }
  return idx;
}
async function makeSplit() {
  const idx = parseRange($('#range').value, splitDoc.pages);
  busy(true, 'جارٍ استخراج الصفحات…'); await nextFrame();
  const src = await PDFDocument.load(splitDoc.buf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
  return out;
}

async function make() {
  try {
    busy(true); await nextFrame();
    const doc = mode === 'merge' ? await makeMerge() : mode === 'split' ? await makeSplit() : await makeFromImages();
    const bytes = await doc.save();
    const name = `${MODES[mode].prefix}_${stamp()}.pdf`;
    const blob = new Blob([bytes], { type: 'application/pdf' });
    if (last) URL.revokeObjectURL(last.url);
    last = { blob, name, url: URL.createObjectURL(blob), pages: doc.getPageCount() };
    window.__last = last;
    $('#resName').textContent = name;
    $('#resInfo').textContent = `${last.pages} صفحة • ${fmtSize(blob.size)}`;
    show($('#result'), true);
  } catch (err) {
    console.error(err); toast(err && err.message ? err.message : 'حدث خطأ أثناء إنشاء الملف.');
  } finally { busy(false); }
}

/* ---------- النتيجة ---------- */
async function share() {
  if (!last) return;
  const file = new File([last.blob], last.name, { type: 'application/pdf' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: last.name }); }
    else download();
  } catch (e) { if (e.name !== 'AbortError') download(); }
}
function download() {
  const a = document.createElement('a'); a.href = last.url; a.download = last.name;
  document.body.append(a); a.click(); a.remove();
}

/* ---------- الربط ---------- */
document.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => openMode(c.dataset.mode)));
$('#back').onclick = () => { if (!$('#result').hidden) show($('#result'), false); goHome(); };
$('#addBtn').onclick = () => $(MODES[mode].input).click();
$('#makeBtn').onclick = make;
$('#range').addEventListener('input', updateMake);
['#inCam', '#inImgs', '#inPdfs', '#inPdf1'].forEach((s) => $(s).addEventListener('change', onPick));
$('#shareBtn').onclick = share;
$('#dlBtn').onclick = () => last && download();
$('#viewBtn').onclick = () => last && window.open(last.url, '_blank');
$('#closeRes').onclick = () => show($('#result'), false);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
})();

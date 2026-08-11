// ============================================================================
// Corectare Folder pentru Teams — Web API (Webhook)
// Logica IDENTICA celor doua noduri Code din workflow-ul original
// ("Citeste Structura Arhivei & Genereaza Sugestii" + "Construieste Arhiva Corectata"),
// unite intr-un singur pas ca sa poata fi apelate printr-un singur request webhook.
// Nu se schimba nicio regula de corectare fata de workflow-ul original cu Form.
// ============================================================================

try {

// ============================================================================
// NOD 1 - "Citeste Structura Arhivei & Genereaza Sugestii"
// Mod: Run Once for All Items | Limbaj: JavaScript
// ----------------------------------------------------------------------------
// Verifica numele din arhiva .zip fata de regulile Teams/SharePoint + Windows,
// construieste PLANUL de corectare (redenumiri + eliminari) si raportul care
// se arata utilizatorului pentru aprobare. Nu modifica nimic aici.
// ============================================================================

// ---------------------------------------------------------------- CONSTANTE
var MAX_NAME = 100;        // nume mai lungi se scurteaza la exact atat
var MAX_NAME_HARD = 255;   // limita reala Windows / SharePoint pentru un nume
var PATH_WARN_WIN = 180;   // cale relativa: risc de depasire a limitei 260 Windows
var PATH_WARN_SPO = 220;   // cale relativa: risc de depasire a limitei 400 SharePoint
var LONG_SEG = 60;         // segment de cale considerat "lung"
var DEEP_LEVELS = 8;       // niveluri de imbricare peste care avertizam
// arhiva ajunge in memoria n8n si ca text base64 (cca +33%), de aceea limita
var MAX_ZIP_BYTES = 150 * 1024 * 1024;
var MAX_HTML_ITEMS = 400;  // cate corectii se listeaza pe ecran (restul in raportul .txt)

var BS = String.fromCharCode(92);
var SEP = String.fromCharCode(0);   // separator intern, nu poate aparea intr-o cale

// caractere interzise in Teams/SharePoint SI in Windows
var INVALID_CHARS = ['"', '*', ':', '<', '>', '?', '/', BS, '|'];

// caractere albe conform trim() din JavaScript (include spatiul insecabil U+00A0)
var WS_CHARS = '\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001'
             + '\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028'
             + '\u2029\u202F\u205F\u3000\uFEFF';
// caractere invizibile sau de control al directiei textului: se elimina oriunde apar
var ZERO_WIDTH = '\u200B\u200C\u200D\u200E\u200F\u202A\u202B\u202C\u202D'
               + '\u202E\u2060\u00AD\uFEFF';

var RESERVED = {};
['CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$'].forEach(function (n) { RESERVED[n] = true; });
for (var _r = 0; _r <= 9; _r++) { RESERVED['COM' + _r] = true; RESERVED['LPT' + _r] = true; }

// nume complete blocate de SharePoint - se REDENUMESC (nu se sterg, vezi mai jos)
var BLOCKED_NAME = {};
['.lock', 'desktop.ini', 'thumbs.db', 'ehthumbs.db', '.ds_store', '.dropbox']
  .forEach(function (n) { BLOCKED_NAME[n] = true; });

// extensii pe care SharePoint refuza sa le primeasca - se adauga .txt, fisierul nu se sterge
var BLOCKED_EXT = {};
['.aspx', '.asmx', '.ascx', '.master', '.xap', '.swf', '.ashx', '.asax',
 '.asp', '.cshtml', '.svc', '.xamlx', '.soap', '.lock'].forEach(function (e) { BLOCKED_EXT[e] = true; });

// tabel CP852 (pagina de cod OEM folosita de arhivarea din Windows in RO)
var CP852 = 'ÇüéâäůćçłëŐő' +
            'îŹÄĆÉĹĺôöĽľŚ' +
            'śÖÜŤťŁ×čáíóú' +
            'ĄąŽžĘę¬źČş«»' +
            '░▒▓│┤ÁÂĚŞ╣║╗' +
            '╝Żż┐└┴┬├─┼Ăă' +
            '╚╔╩╦╠═╬¤đĐĎË' +
            'ďŇÍÎě┘┌█▄ŢŮ▀' +
            'ÓßÔŃńňŠšŔÚŕŰ' +
            'ýÝţ´\u00AD˝˛ˇ˘§÷¸' +
            '°¨˙űŘř■\u00A0';

// ---------------------------------------------------------------- utilitare
function esc(s) {
  return String(s).split('&').join('&amp;').split('<').join('&lt;')
    .split('>').join('&gt;').split('"').join('&quot;');
}
function hex4(n) { var h = n.toString(16).toUpperCase(); while (h.length < 4) { h = '0' + h; } return h; }
function isWs(ch) { return WS_CHARS.indexOf(ch) !== -1; }
function trimWs(s) {
  var a = 0, b = s.length;
  while (a < b && isWs(s.charAt(a))) { a++; }
  while (b > a && isWs(s.charAt(b - 1))) { b--; }
  return s.slice(a, b);
}
function extOf(n) { var i = n.lastIndexOf('.'); return i > 0 ? n.slice(i) : ''; }
function baseOf(n) { var i = n.lastIndexOf('.'); return i > 0 ? n.slice(0, i) : n; }
function toBackSlash(p) { return p.split('/').join(BS); }

// face vizibile caracterele invizibile, ca omul sa inteleaga de ce se schimba numele
function visualize(s) {
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i), c = s.charCodeAt(i);
    if (c < 32 || c === 127) { out += '[U+' + hex4(c) + ']'; }
    else if (ZERO_WIDTH.indexOf(ch) !== -1) { out += '[invizibil U+' + hex4(c) + ']'; }
    else if (ch === ' ' && (i === 0 || i === s.length - 1)) { out += '[spatiu]'; }
    else if (isWs(ch) && ch !== ' ') { out += '[spatiu U+' + hex4(c) + ']'; }
    else { out += ch; }
  }
  return out;
}

function decodeName(nameBuf, isUtf8Flag) {
  if (isUtf8Flag) { return nameBuf.toString('utf-8'); }
  var ascii = true;
  for (var i = 0; i < nameBuf.length; i++) { if (nameBuf[i] > 0x7F) { ascii = false; break; } }
  if (ascii) { return nameBuf.toString('latin1'); }
  // multe arhivatoare scriu UTF-8 fara sa ridice steagul: verificam prin dus-intors
  var asUtf8 = nameBuf.toString('utf-8');
  if (Buffer.from(asUtf8, 'utf-8').equals(nameBuf)) { return { text: asUtf8, guessed: 'UTF-8' }; }
  // altfel: pagina de cod OEM (CP852 = Windows RO / Europa Centrala)
  var out = '';
  for (var j = 0; j < nameBuf.length; j++) {
    var b = nameBuf[j];
    out += (b < 0x80) ? String.fromCharCode(b) : CP852.charAt(b - 0x80);
  }
  return { text: out, guessed: 'CP852' };
}

function errorOut(msg, hint) {
  var html = '<p><b>' + esc(msg) + '</b></p>';
  if (hint) { html += '<p>' + esc(hint) + '</p>'; }
  return [{
    json: {
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        eroare: true, mesaj_eroare: msg + (hint ? ' ' + hint : ''),
        total_elemente: 0, nr_redenumiri: 0, nr_eliminari: 0, nr_avertismente: 0,
        propuneri_redenumire: [], eliminari: [], avertismente: [],
        raport_html: html
      })
    }
  }];
}

// ------------------------------------------------ regulile de corectare a unui nume
function truncateTo(s, max) {
  var b = baseOf(s), e = extOf(s);
  if (e.length > max - 10) { b = s; e = ''; }
  var keep = max - e.length - 1;
  if (keep < 1) { keep = 1; }
  var nb = trimWs(b.slice(0, keep));
  while (nb.length > 0 && nb.charAt(nb.length - 1) === '.') { nb = trimWs(nb.slice(0, -1)); }
  if (nb.length === 0) { nb = 'x'; }
  return nb + '~' + e;
}

function fixSegment(name, isDir, isRootLevel) {
  var motive = [];
  var s = name;
  var sufix = isDir ? '_folder' : '_fisier';

  if (s === '.') { s = '_punct'; motive.push('segment de cale nevalid (".")'); }
  else if (s === '..') { s = '_punct-punct'; motive.push('segment de cale nevalid ("..")'); }

  // caractere de control si invizibile
  var t = '', hadCtl = false;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i), ch = s.charAt(i);
    if (c < 32 || c === 127 || ZERO_WIDTH.indexOf(ch) !== -1) { hadCtl = true; continue; }
    t += ch;
  }
  if (hadCtl) { motive.push('caractere de control sau invizibile'); s = t; }

  // caractere interzise
  var u = '', hadInv = false;
  for (var j = 0; j < s.length; j++) {
    var cj = s.charAt(j);
    if (INVALID_CHARS.indexOf(cj) !== -1) { hadInv = true; u += '-'; } else { u += cj; }
  }
  if (hadInv) { motive.push('caractere interzise (" * : < > ? / ' + BS + ' |)'); s = u; }

  // spatii la capete (inclusiv spatiu insecabil)
  var tr = trimWs(s);
  if (tr !== s) { motive.push('spatii la inceput sau la sfarsit'); s = tr; }

  // punct la sfarsit
  if (s.length > 0 && s.charAt(s.length - 1) === '.') {
    motive.push('se termina cu punct');
    while (s.length > 0 && s.charAt(s.length - 1) === '.') { s = s.slice(0, -1); }
    s = trimWs(s);
  }

  if (s.length === 0) { s = isDir ? 'folder-fara-nume' : 'fisier-fara-nume'; motive.push('nume gol dupa curatare'); }

  // prefixul "~$" e refuzat de SharePoint (fisier temporar Office) - se scoate prefixul, fisierul nu se sterge
  while (s.indexOf('~$') === 0) {
    if (motive.indexOf('incepe cu "~$" (fisier temporar Office), prefix refuzat de SharePoint - redenumit, nu sters') === -1) {
      motive.push('incepe cu "~$" (fisier temporar Office), prefix refuzat de SharePoint - redenumit, nu sters');
    }
    s = trimWs(s.slice(2));
  }
  if (s.length === 0) { s = isDir ? 'folder-fara-nume' : 'fisier-fara-nume'; }

  // fisier de blocare LibreOffice ".~lock.NUME#" - se scoate invelisul (nu fisierul); daca numele ramas
  // coincide cu un fisier real din acelasi folder, se dedupleaza automat mai jos (claimName)
  if (!isDir && s.toLowerCase().indexOf('.~lock.') === 0) {
    motive.push('fisier de blocare LibreOffice - redenumit, nu sters');
    s = s.slice(7);
    if (s.charAt(s.length - 1) === '#') { s = s.slice(0, -1); }
    s = trimWs(s);
    if (s.length === 0) { s = 'lock-libreoffice' + sufix; }
  }

  // "_vti_" este rezervat de SharePoint
  if (s.toLowerCase().indexOf('_vti_') !== -1) {
    motive.push('contine "_vti_", rezervat de SharePoint');
    var rebuilt = '', k = 0;
    while (k < s.length) {
      if (s.substr(k, 5).toLowerCase() === '_vti_') { rebuilt += s.substr(k, 4) + '-'; k += 5; }
      else { rebuilt += s.charAt(k); k++; }
    }
    s = rebuilt;
  }

  // nume rezervat de Windows (CON, NUL, COM1... cu sau fara extensie)
  var b = baseOf(s), e = extOf(s);
  if (RESERVED[b.toUpperCase()]) { motive.push('nume rezervat de Windows'); s = b + sufix + e; }

  // nume complet blocat de SharePoint (fisier de sistem/cache) - redenumit, nu sters
  if (BLOCKED_NAME[s.toLowerCase()]) {
    motive.push('nume blocat de SharePoint (fisier de sistem/cache) - redenumit, nu sters');
    var bnB = baseOf(s), bnE = extOf(s);
    s = (bnB || s) + sufix + (bnE || '');
  }

  // "forms" este rezervat la radacina unei biblioteci de documente
  if (isDir && isRootLevel && s.toLowerCase() === 'forms') {
    motive.push('"forms" este rezervat la radacina bibliotecii'); s = 'forms' + sufix;
  }

  // extensie refuzata de SharePoint
  if (!isDir && BLOCKED_EXT[extOf(s).toLowerCase()]) {
    motive.push('extensie blocata de SharePoint (se adauga .txt)'); s = s + '.txt';
  }

  // lungime
  if (s.length > MAX_NAME_HARD) {
    motive.push('nume peste limita Windows/SharePoint (' + s.length + ' caractere)');
    s = truncateTo(s, MAX_NAME);
  } else if (s.length > MAX_NAME) {
    motive.push('nume lung (' + s.length + ' caractere), contribuie la depasirea limitei de cale');
    s = truncateTo(s, MAX_NAME);
  }

  // curatare finala dupa trunchiere
  s = trimWs(s);
  while (s.length > 1 && s.charAt(s.length - 1) === '.') { s = trimWs(s.slice(0, -1)); }
  if (s.length === 0) { s = isDir ? 'folder-fara-nume' : 'fisier-fara-nume'; }

  return { name: s, motive: motive };
}

// ============================================================ CITIRE ARHIVA
var uploadItem = $input.first();
var bin = uploadItem.binary || {};
var binKeys = Object.keys(bin);
if (binKeys.length === 0) { return errorOut('Nu a fost gasita nicio arhiva incarcata.', 'Reincearca incarcarea.'); }

var binKey = binKeys[0];
var fileBinary = bin[binKey];

var buf;
try {
  buf = await this.helpers.getBinaryDataBuffer(0, binKey);
} catch (e) {
  buf = Buffer.from(fileBinary.data, 'base64');
}

if (!buf || buf.length === 0) { return errorOut('Arhiva incarcata este goala.'); }
if (buf.length > MAX_ZIP_BYTES) {
  return errorOut('Arhiva este prea mare (' + Math.round(buf.length / 1048576) + ' MB).',
    'Limita acestui workflow este ' + Math.round(MAX_ZIP_BYTES / 1048576) + ' MB. Imparte folderul in mai multe arhive.');
}

function findEOCD(b) {
  var minPos = Math.max(0, b.length - 65557);
  for (var i = b.length - 22; i >= minPos; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4B && b[i + 2] === 0x05 && b[i + 3] === 0x06) {
      // confirmam candidatul: lungimea comentariului trebuie sa acopere exact restul
      // fisierului (altfel am gasit semnatura din intamplare, in interiorul datelor)
      if (b.readUInt16LE(i + 20) === b.length - i - 22) { return i; }
    }
  }
  return -1;
}

var eocdPos = findEOCD(buf);
if (eocdPos === -1) {
  return errorOut('Fisierul incarcat nu este o arhiva .zip valida.',
    'Foloseste click-dreapta pe folder, Trimite catre, Folder comprimat (zip). Fisierele .rar sau .7z nu sunt acceptate.');
}

var diskNum = buf.readUInt16LE(eocdPos + 4);
var cdDisk = buf.readUInt16LE(eocdPos + 6);
var entriesOnDisk = buf.readUInt16LE(eocdPos + 8);
var totalEntries = buf.readUInt16LE(eocdPos + 10);
var centralDirSize = buf.readUInt32LE(eocdPos + 12);
var centralDirOffset = buf.readUInt32LE(eocdPos + 16);

if (diskNum !== 0 || cdDisk !== 0 || entriesOnDisk !== totalEntries) {
  return errorOut('Arhiva este impartita pe mai multe volume.', 'Rearhiveaza folderul intr-un singur fisier .zip.');
}
if (totalEntries === 0xFFFF || centralDirOffset === 0xFFFFFFFF || centralDirSize === 0xFFFFFFFF) {
  return errorOut('Arhiva foloseste formatul ZIP64 (peste 65.535 fisiere sau peste 4 GB).',
    'Imparte folderul in mai multe arhive mai mici si incarca-le pe rand.');
}
if (totalEntries === 0) { return errorOut('Arhiva incarcata nu contine niciun fisier.'); }
if (centralDirOffset + centralDirSize > buf.length) {
  return errorOut('Arhiva pare deteriorata (director central in afara fisierului).', 'Rearhiveaza folderul.');
}

// ------------------------------------------------- parcurgere director central
var entries = [];
var pos = centralDirOffset;
var decodeFallback = {};
var oddMethods = {};

for (var e = 0; e < totalEntries; e++) {
  if (pos + 46 > buf.length) { return errorOut('Arhiva pare deteriorata (director central incomplet).', 'Rearhiveaza folderul.'); }
  if (buf.readUInt32LE(pos) !== 0x02014b50) {
    return errorOut('Arhiva pare deteriorata (semnatura nevalida in directorul central).', 'Rearhiveaza folderul.');
  }
  var flags = buf.readUInt16LE(pos + 8);
  var compressionMethod = buf.readUInt16LE(pos + 10);
  var modTime = buf.readUInt16LE(pos + 12);
  var modDate = buf.readUInt16LE(pos + 14);
  var crc32v = buf.readUInt32LE(pos + 16);
  var compressedSize = buf.readUInt32LE(pos + 20);
  var uncompressedSize = buf.readUInt32LE(pos + 24);
  var fileNameLen = buf.readUInt16LE(pos + 28);
  var extraLen = buf.readUInt16LE(pos + 30);
  var commentLen = buf.readUInt16LE(pos + 32);
  var externalAttr = buf.readUInt32LE(pos + 38);
  var localHeaderOffset = buf.readUInt32LE(pos + 42);

  if (flags & 0x0001) {
    return errorOut('Arhiva este protejata cu parola.', 'Rearhiveaza folderul fara parola.');
  }
  if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF || localHeaderOffset === 0xFFFFFFFF) {
    return errorOut('Arhiva foloseste formatul ZIP64.', 'Imparte folderul in mai multe arhive mai mici.');
  }
  if (compressionMethod !== 0 && compressionMethod !== 8) { oddMethods[compressionMethod] = true; }

  var nameBuf = buf.slice(pos + 46, pos + 46 + fileNameLen);
  var dec = decodeName(nameBuf, (flags & 0x0800) !== 0);
  var fileName;
  if (typeof dec === 'string') { fileName = dec; }
  else { fileName = dec.text; decodeFallback[dec.guessed] = (decodeFallback[dec.guessed] || 0) + 1; }

  // unele arhivatoare nu pun "/" la finalul numelui de folder, dar ridica
  // bitul de director (0x10) in atributele MS-DOS
  var looksDir = fileName.length > 0 && fileName.charAt(fileName.length - 1) === '/';
  if (!looksDir && uncompressedSize === 0 && compressedSize === 0 && (externalAttr & 0x10)) {
    looksDir = true;
    fileName = fileName + '/';
  }

  entries.push({
    fileName: fileName,
    isDirectory: looksDir,
    flags: flags, compressionMethod: compressionMethod, modTime: modTime, modDate: modDate,
    crc32: crc32v, compressedSize: compressedSize, uncompressedSize: uncompressedSize,
    localHeaderOffset: localHeaderOffset
  });

  pos = pos + 46 + fileNameLen + extraLen + commentLen;
}

// verificare antete locale (ca nodul urmator sa nu produca o arhiva stricata)
for (var v = 0; v < entries.length; v++) {
  var lo = entries[v].localHeaderOffset;
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) {
    return errorOut('Arhiva pare deteriorata (antet local nevalid pentru "' + entries[v].fileName + '").', 'Rearhiveaza folderul.');
  }
  var lnl = buf.readUInt16LE(lo + 26), lel = buf.readUInt16LE(lo + 28);
  if (lo + 30 + lnl + lel + entries[v].compressedSize > buf.length) {
    return errorOut('Arhiva pare trunchiata (lipsesc date pentru "' + entries[v].fileName + '").', 'Rearhiveaza folderul.');
  }
}

// ================================================ construirea planului de corectare
function normalizePath(raw) {
  var isDir = raw.length > 0 && raw.charAt(raw.length - 1) === '/';
  var parts = raw.split('/');
  var keep = [];
  for (var i = 0; i < parts.length; i++) { if (parts[i].length > 0) { keep.push(parts[i]); } }
  return { path: keep.join('/'), isDir: isDir, segs: keep };
}

var entryNorm = [];
var dirSet = {}, dirOrder = [];

function noteDir(p) {
  if (p.length > 0 && !dirSet[p]) { dirSet[p] = true; dirOrder.push(p); }
}

for (var q = 0; q < entries.length; q++) {
  var nz = normalizePath(entries[q].fileName);
  entryNorm.push(nz);
  if (nz.path.length === 0) { continue; }
  // toti parintii unei cai sunt foldere, chiar daca arhiva nu are intrare pentru ei
  for (var d = 1; d < nz.segs.length; d++) { noteDir(nz.segs.slice(0, d).join('/')); }
  if (nz.isDir) { noteDir(nz.path); }
}

// radacina: un singur folder de nivel 1 (cazul normal la arhivarea din Windows)
var firstSegSet = {}, distinctPaths = 0;
for (var f = 0; f < entryNorm.length; f++) {
  if (entryNorm[f].path.length === 0) { continue; }
  firstSegSet[entryNorm[f].segs[0]] = true;
  distinctPaths++;
}
var hasSingleRoot = Object.keys(firstSegSet).length === 1 && distinctPaths > 1;

var newDirPath = {}, usedNames = {}, fixes = [], excluded = [];

function uniquify(name, parentNew) {
  var b = baseOf(name), e = extOf(name), n = 1, cand = name;
  while (usedNames[parentNew + SEP + cand.toLowerCase()]) {
    var sfx = '_' + n;
    cand = b + sfx + e;
    if (cand.length > MAX_NAME) { cand = truncateTo(b, MAX_NAME - sfx.length - e.length) + sfx + e; }
    n++;
    if (n > 99999) { cand = b + SEP + e; break; }
  }
  return cand;
}

// numele final al unui segment, cu rezolvarea duplicatelor din acelasi folder
function claimName(rawName, parentNew, isDir, isRootLevel) {
  var res = fixSegment(rawName, isDir, isRootLevel);
  var finalName = res.name;
  if (usedNames[parentNew + SEP + finalName.toLowerCase()]) {
    finalName = uniquify(finalName, parentNew);
    res.motive.push('nume folosit deja in acelasi folder (SharePoint nu face diferenta intre majuscule si minuscule)');
  }
  usedNames[parentNew + SEP + finalName.toLowerCase()] = true;
  return { name: finalName, motive: res.motive };
}

// ---- PASUL 1: folderele, de la radacina in jos (de ele depinde propagarea) ----
var dirsByDepth = dirOrder.slice().sort(function (a, b) {
  var da = a.split('/').length, db = b.split('/').length;
  if (da !== db) { return da - db; }
  return a < b ? -1 : (a > b ? 1 : 0);
});

for (var p2 = 0; p2 < dirsByDepth.length; p2++) {
  var op = dirsByDepth[p2];
  var segs = op.split('/');
  var parentOld = segs.slice(0, -1).join('/');
  var parentNew = parentOld ? (newDirPath[parentOld] || parentOld) : '';
  var isRootLevel = hasSingleRoot ? (segs.length === 2) : (segs.length === 1);

  var cl = claimName(segs[segs.length - 1], parentNew, true, isRootLevel);
  var np = parentNew ? (parentNew + '/' + cl.name) : cl.name;
  newDirPath[op] = np;

  if (np !== op) {
    fixes.push({
      cale_veche: op, cale_noua: np, nume_vechi: segs[segs.length - 1],
      nume_nou: cl.name, este_folder: true, motive: cl.motive
    });
  }
}

// ---- PASUL 2: fisierele, in ordinea din arhiva ----
var newFileDst = {};   // index intrare -> cale noua
for (var w = 0; w < entries.length; w++) {
  var nz2 = entryNorm[w];
  if (nz2.path.length === 0 || nz2.isDir) { continue; }

  var fsegs = nz2.segs;
  var fname = fsegs[fsegs.length - 1];
  var fParentOld = fsegs.slice(0, -1).join('/');
  var fParentNew = fParentOld ? (newDirPath[fParentOld] || fParentOld) : '';

  var fRootLevel = hasSingleRoot ? (fsegs.length === 2) : (fsegs.length === 1);
  var fcl = claimName(fname, fParentNew, false, fRootLevel);
  var fnp = fParentNew ? (fParentNew + '/' + fcl.name) : fcl.name;
  newFileDst[w] = fnp;

  if (fnp !== nz2.path) {
    fixes.push({
      cale_veche: nz2.path, cale_noua: fnp, nume_vechi: fname,
      nume_nou: fcl.name, este_folder: false, motive: fcl.motive
    });
  }
}

// ==================================================================================
// PASUL 3: reducerea nivelurilor de imbricare - foldere cu UN SINGUR subfolder si
// FARA fisiere proprii se unesc intr-un singur nume de folder (nu se pierde niciun
// fisier, doar se scad nivelurile). Radacina arhivei nu se toaca niciodata.
// ==================================================================================
var preFlattenNewDirPath = {};
for (var kpf in newDirPath) { preFlattenNewDirPath[kpf] = newDirPath[kpf]; }

var parentOfNew = {};
var childFoldersOfNew = {};
var fileCountOfNew = {};
var isProtectedRootNew = {};

for (var pf3 = 0; pf3 < dirsByDepth.length; pf3++) {
  var op3 = dirsByDepth[pf3];
  var segs3 = op3.split('/');
  var parentOld3 = segs3.slice(0, -1).join('/');
  var newPath3 = preFlattenNewDirPath[op3];
  var parentNewPath3 = parentOld3 ? preFlattenNewDirPath[parentOld3] : '';
  parentOfNew[newPath3] = parentNewPath3;
  var isRootLevel3 = hasSingleRoot ? (segs3.length === 2) : (segs3.length === 1);
  if (isRootLevel3) { isProtectedRootNew[newPath3] = true; }
  // folderul-container de la radacina arhivei (numele arhivei/proiectului) nu se
  // consuma NICIODATA intr-o unire, indiferent de nivelul de mai sus
  if (segs3.length === 1) { isProtectedRootNew[newPath3] = true; }
  if (parentNewPath3) {
    if (!childFoldersOfNew[parentNewPath3]) { childFoldersOfNew[parentNewPath3] = []; }
    childFoldersOfNew[parentNewPath3].push(newPath3);
  }
}
for (var wf3 in newFileDst) {
  var fp3 = newFileDst[wf3];
  var slash3 = fp3.lastIndexOf('/');
  if (slash3 >= 0) {
    var parentOfFile3 = fp3.slice(0, slash3);
    fileCountOfNew[parentOfFile3] = (fileCountOfNew[parentOfFile3] || 0) + 1;
  }
}

function lastSegOfNew(p) { var i = p.lastIndexOf('/'); return i >= 0 ? p.slice(i + 1) : p; }

var isSingleChildNoFile = {};
var allNewFolderPaths = [];
var seenNewFolderPaths = {};
for (var kpf2 in preFlattenNewDirPath) {
  var vpf2 = preFlattenNewDirPath[kpf2];
  if (!seenNewFolderPaths[vpf2]) { seenNewFolderPaths[vpf2] = true; allNewFolderPaths.push(vpf2); }
}
for (var afIsc = 0; afIsc < allNewFolderPaths.length; afIsc++) {
  var pIsc = allNewFolderPaths[afIsc];
  var kidsCount = (childFoldersOfNew[pIsc] || []).length;
  var filesCount = fileCountOfNew[pIsc] || 0;
  isSingleChildNoFile[pIsc] = (kidsCount === 1 && filesCount === 0 && !isProtectedRootNew[pIsc]);
}

function junctionOf(p) {
  var cur = p, guard = 0;
  while (isSingleChildNoFile[cur] && guard < 10000) { cur = childFoldersOfNew[cur][0]; guard++; }
  return cur;
}

var flattenResCache = {};
function resolveFinalUpward(p) {
  if (flattenResCache[p]) { return flattenResCache[p]; }
  var parentP = parentOfNew[p] || '';
  var nameSeg = lastSegOfNew(p);
  var res;
  if (!parentP || !isSingleChildNoFile[parentP]) {
    res = { parentPath: parentP, nameChain: [nameSeg] };
  } else {
    var parentRes = resolveFinalUpward(parentP);
    res = { parentPath: parentRes.parentPath, nameChain: parentRes.nameChain.concat([nameSeg]) };
  }
  flattenResCache[p] = res;
  return res;
}

var flattenStringCache = {};
var flattenUsedSiblingNames = {};
function buildFinalString(junction) {
  if (flattenStringCache[junction]) { return flattenStringCache[junction]; }
  var res = resolveFinalUpward(junction);
  var combinedName = res.nameChain.join(' - ');
  if (combinedName.length > MAX_NAME) { combinedName = truncateTo(combinedName, MAX_NAME); }
  var dedupKey = res.parentPath + SEP + combinedName.toLowerCase();
  var suffixN = 1;
  while (flattenUsedSiblingNames[dedupKey]) {
    var sfx = '_' + suffixN;
    var base0 = (combinedName.length + sfx.length > MAX_NAME) ? truncateTo(combinedName, MAX_NAME - sfx.length) : combinedName;
    var tryName = base0 + sfx;
    dedupKey = res.parentPath + SEP + tryName.toLowerCase();
    combinedName = tryName;
    suffixN++;
  }
  flattenUsedSiblingNames[dedupKey] = true;
  var finalPath = res.parentPath ? (res.parentPath + '/' + combinedName) : combinedName;
  flattenStringCache[junction] = finalPath;
  return finalPath;
}

// preinregistram numele folderelor NEschimbate (fara unire), ca sa nu coincida din intamplare
// cu un nume rezultat prin unirea altui lant de foldere
for (var afSeed = 0; afSeed < allNewFolderPaths.length; afSeed++) {
  var pSeed = allNewFolderPaths[afSeed];
  if (!isSingleChildNoFile[pSeed] && junctionOf(pSeed) === pSeed) {
    var resSeed = resolveFinalUpward(pSeed);
    if (resSeed.nameChain.length === 1) {
      flattenUsedSiblingNames[resSeed.parentPath + SEP + resSeed.nameChain[0].toLowerCase()] = true;
    }
  }
}

// foloseste calea deja rezultata (fara unire) daca nu s-a unit nimic, ca sa nu deranjeze
// verificarea de coliziuni cu propriul ei nume neschimbat
function getFinalFolderPath(preFlattenPath) {
  var j = junctionOf(preFlattenPath);
  var res = resolveFinalUpward(j);
  if (res.nameChain.length === 1) { return j; }
  return buildFinalString(j);
}

var reportedJunctions = {};
for (var afRep = 0; afRep < allNewFolderPaths.length; afRep++) {
  var pRep = allNewFolderPaths[afRep];
  var jRep = junctionOf(pRep);
  if (reportedJunctions[jRep]) { continue; }
  reportedJunctions[jRep] = true;
  var resRep = resolveFinalUpward(jRep);
  if (resRep.nameChain.length > 1) {
    var finalStrRep = buildFinalString(jRep);
    fixes.push({
      cale_veche: jRep, cale_noua: finalStrRep,
      nume_vechi: resRep.nameChain.join('/'), nume_nou: lastSegOfNew(finalStrRep),
      este_folder: true,
      motive: ['s-au unit ' + resRep.nameChain.length + ' niveluri de foldere ca sa scada numarul de niveluri (niciun fisier nu s-a pierdut)']
    });
  }
}

for (var opApply in newDirPath) { newDirPath[opApply] = getFinalFolderPath(newDirPath[opApply]); }
for (var wfApply in newFileDst) {
  var oldFileNew = newFileDst[wfApply];
  var slashApply = oldFileNew.lastIndexOf('/');
  if (slashApply < 0) { continue; }
  var leafApply = oldFileNew.slice(slashApply + 1);
  var parentApply = oldFileNew.slice(0, slashApply);
  newFileDst[wfApply] = getFinalFolderPath(parentApply) + '/' + leafApply;
}

// ==================================================================================
// PASUL 4: garantam ca nicio cale ramasa nu mai trece de limita Windows/SharePoint -
// se scurteaza segmentul cel mai lung (pastrand extensia fisierelor), niciodata nu
// se sterge continut. Se repeta pana cand toate caile incap in limita.
// ==================================================================================
function relOf4(np) {
  if (!hasSingleRoot) { return np; }
  var s4 = np.split('/');
  return s4.slice(1).join('/');
}

function collectOffending4() {
  var offending = [];
  var seenP = {};
  var k4;
  for (k4 in newDirPath) {
    var vkd = newDirPath[k4];
    if (seenP[vkd]) { continue; }
    seenP[vkd] = true;
    if (relOf4(vkd).length > PATH_WARN_WIN) { offending.push(vkd); }
  }
  for (k4 in newFileDst) {
    var vkf = newFileDst[k4];
    if (seenP[vkf]) { continue; }
    seenP[vkf] = true;
    if (relOf4(vkf).length > PATH_WARN_WIN) { offending.push(vkf); }
  }
  return offending;
}

var shortenIter = 0;
while (shortenIter < 300) {
  var offendingPaths = collectOffending4();
  if (offendingPaths.length === 0) { break; }

  var bestLen = -1, bestFullAncestor = null, bestSegText = '';
  for (var oi4 = 0; oi4 < offendingPaths.length; oi4++) {
    var fullSegs4 = offendingPaths[oi4].split('/');
    var startIdx4 = hasSingleRoot ? 1 : 0;   // nu scurtam niciodata numele proiectului (radacina)
    var acc4 = fullSegs4.slice(0, startIdx4).join('/');
    for (var si4 = startIdx4; si4 < fullSegs4.length; si4++) {
      acc4 = acc4 ? (acc4 + '/' + fullSegs4[si4]) : fullSegs4[si4];
      if (fullSegs4[si4].length > bestLen) {
        bestLen = fullSegs4[si4].length; bestFullAncestor = acc4; bestSegText = fullSegs4[si4];
      }
    }
  }
  if (!bestFullAncestor || bestLen <= 8) { break; }   // nimic rezonabil ramas de scurtat

  var newSegLen = Math.max(8, Math.min(bestLen - 15, 40));
  var newSegText = truncateTo(bestSegText, newSegLen);

  var ancestorParent = (bestFullAncestor.length === bestSegText.length)
    ? '' : bestFullAncestor.slice(0, bestFullAncestor.length - bestSegText.length - 1);

  var dedupKey4 = ancestorParent + SEP + newSegText.toLowerCase();
  var suf4 = 1;
  while (flattenUsedSiblingNames[dedupKey4]) {
    var sfx4 = '_' + suf4;
    var cand4 = truncateTo(newSegText, Math.max(4, newSegLen - sfx4.length)) + sfx4;
    dedupKey4 = ancestorParent + SEP + cand4.toLowerCase();
    newSegText = cand4;
    suf4++;
  }
  flattenUsedSiblingNames[dedupKey4] = true;

  var newFullAncestor = ancestorParent ? (ancestorParent + '/' + newSegText) : newSegText;
  if (newFullAncestor === bestFullAncestor) { break; }   // fara progres real, evitam bucla infinita

  var oldPrefixSlash4 = bestFullAncestor + '/';
  var kk4;
  for (kk4 in newDirPath) {
    if (newDirPath[kk4] === bestFullAncestor) { newDirPath[kk4] = newFullAncestor; }
    else if (newDirPath[kk4].indexOf(oldPrefixSlash4) === 0) { newDirPath[kk4] = newFullAncestor + '/' + newDirPath[kk4].slice(oldPrefixSlash4.length); }
  }
  for (kk4 in newFileDst) {
    if (newFileDst[kk4] === bestFullAncestor) { newFileDst[kk4] = newFullAncestor; }
    else if (newFileDst[kk4].indexOf(oldPrefixSlash4) === 0) { newFileDst[kk4] = newFullAncestor + '/' + newFileDst[kk4].slice(oldPrefixSlash4.length); }
  }

  fixes.push({
    cale_veche: bestFullAncestor, cale_noua: newFullAncestor,
    nume_vechi: bestSegText, nume_nou: newSegText, este_folder: true,
    motive: ['nume scurtat ca sa incapa calea completa in limita Windows/SharePoint (nu s-a sters nimic)']
  });

  shortenIter++;
}

// ------------------------------------------------- plan pentru nodul de reconstructie
var plan = [];
var dstSeen = {};
for (var w2 = 0; w2 < entries.length; w2++) {
  var en = entries[w2];
  var nz3 = entryNorm[w2];
  if (nz3.path.length === 0) { continue; }

  var dst;
  if (nz3.isDir) {
    dst = newDirPath[nz3.path] + '/';
    if (dstSeen[dst]) { continue; }   // intrare de folder duplicata in arhiva sursa
  } else {
    if (newFileDst[w2] === undefined) { continue; }   // fisier eliminat
    dst = newFileDst[w2];
  }
  dstSeen[dst] = true;

  plan.push({
    src: en.fileName, dst: dst, este_folder: nz3.isDir,
    flags: en.flags, compressionMethod: en.compressionMethod,
    modTime: en.modTime, modDate: en.modDate, crc32: en.crc32,
    compressedSize: en.compressedSize, uncompressedSize: en.uncompressedSize,
    localHeaderOffset: en.localHeaderOffset
  });
}

// ------------------------------------- avertismente de cale (nu se pot corecta automat)
function relOf(np) {
  if (!hasSingleRoot) { return np; }
  var s = np.split('/');
  return s.slice(1).join('/');
}

var overSpo = [], overWin = [], longSegAgg = {}, deepCount = 0, genericCount = 0;
for (var y = 0; y < plan.length; y++) {
  var dp2 = plan[y].este_folder ? plan[y].dst.slice(0, -1) : plan[y].dst;
  var rp = relOf(dp2);
  if (rp.length <= PATH_WARN_WIN) { continue; }
  var rs = rp.split('/');
  var longest = '';
  for (var z = 0; z < rs.length; z++) { if (rs[z].length > longest.length) { longest = rs[z]; } }
  if (longest.length > LONG_SEG) { longSegAgg[longest] = (longSegAgg[longest] || 0) + 1; }
  else if (rs.length > DEEP_LEVELS) { deepCount++; }
  else { genericCount++; }
  if (rp.length > PATH_WARN_SPO) { overSpo.push({ cale: rp, lungime: rp.length }); }
  else { overWin.push({ cale: rp, lungime: rp.length }); }
}

var avertismente = [];
if (overSpo.length > 0) {
  avertismente.push(overSpo.length + ' element(e) au calea peste ' + PATH_WARN_SPO +
    ' caractere - Teams/SharePoint refuza incarcarea (limita este 400 de caractere pentru adresa completa). Trebuie scurtate manual.');
}
if (overWin.length > 0) {
  avertismente.push(overWin.length + ' element(e) au calea peste ' + PATH_WARN_WIN +
    ' caractere - risc de eroare la dezarhivare pe Windows (limita 260 de caractere pentru calea completa).');
}
var lsKeys = Object.keys(longSegAgg);
for (var ls = 0; ls < lsKeys.length; ls++) {
  avertismente.push('Folderul "' + lsKeys[ls] + '" (' + lsKeys[ls].length +
    ' caractere) apare in calea a ' + longSegAgg[lsKeys[ls]] +
    ' element(e) cu cale prea lunga - scurteaza-i numele si rezolvi toate deodata.');
}
if (deepCount > 0) {
  avertismente.push(deepCount + ' element(e) sunt imbricate pe peste ' + DEEP_LEVELS +
    ' niveluri - muta-le mai aproape de radacina folderului.');
}
if (genericCount > 0) {
  avertismente.push(genericCount + ' element(e) au calea peste prag fara o cauza clara de scurtat - verifica manual.');
}
var nrFisierePlan = 0;
for (var pf = 0; pf < plan.length; pf++) { if (!plan[pf].este_folder) { nrFisierePlan++; } }
if (nrFisierePlan === 0 && excluded.length > 0) {
  avertismente.push('Toate fisierele din arhiva sunt temporare sau de sistem si au fost eliminate - ' +
    'arhiva corectata va contine doar structura de foldere. Verifica daca ai arhivat folderul corect.');
}
var dfKeys = Object.keys(decodeFallback);
for (var df = 0; df < dfKeys.length; df++) {
  avertismente.push('Numele a ' + decodeFallback[dfKeys[df]] + ' element(e) au fost citite folosind codificarea ' +
    dfKeys[df] + ' (arhiva nu declara UTF-8). Verifica diacriticele in lista de mai jos - daca arata greșit, rearhiveaza folderul cu 7-Zip.');
}
var omKeys = Object.keys(oddMethods);
if (omKeys.length > 0) {
  avertismente.push('Arhiva foloseste o metoda de compresie neobisnuita (' + omKeys.join(', ') +
    '). Arhiva corectata s-ar putea sa nu se deschida cu dezarhivatorul din Windows - foloseste 7-Zip.');
}


// ------------------------------------------------------------------- raport HTML
var byRule = {};
for (var r2 = 0; r2 < fixes.length; r2++) {
  for (var m = 0; m < fixes[r2].motive.length; m++) {
    var lbl = fixes[r2].motive[m].replace(/\s*\(\d+[^)]*\)/g, '');
    byRule[lbl] = (byRule[lbl] || 0) + 1;
  }
}

var html = '';
html += '<p><b>Elemente in arhiva:</b> ' + entries.length +
        ' &nbsp;|&nbsp; <b>Redenumiri:</b> ' + fixes.length +
        ' &nbsp;|&nbsp; <b>Eliminari:</b> ' + excluded.length +
        ' &nbsp;|&nbsp; <b>Avertismente:</b> ' + avertismente.length + '</p>';

if (fixes.length === 0 && excluded.length === 0 && avertismente.length === 0) {
  html += '<p><b>Nicio problema gasita.</b> Folderul poate fi tras in Teams asa cum este.</p>';
} else {
  var brKeys = Object.keys(byRule);
  if (brKeys.length > 0) {
    html += '<p><b>Probleme gasite, pe tip:</b></p><ul>';
    brKeys.sort(function (a, b) { return byRule[b] - byRule[a]; });
    for (var bk = 0; bk < brKeys.length; bk++) {
      html += '<li>' + esc(brKeys[bk]) + ': <b>' + byRule[brKeys[bk]] + '</b></li>';
    }
    html += '</ul>';
  }

  if (excluded.length > 0) {
    html += '<p><b>Fisiere care se SCOT din arhiva (' + excluded.length + '):</b></p><ul>';
    for (var ex = 0; ex < excluded.length && ex < MAX_HTML_ITEMS; ex++) {
      html += '<li>' + esc(visualize(excluded[ex].nume)) + ' &mdash; <small>' + esc(excluded[ex].motiv) +
              '</small><br><small>' + esc(toBackSlash(excluded[ex].cale)) + '</small></li>';
    }
    html += '</ul>';
    if (excluded.length > MAX_HTML_ITEMS) { html += '<p><i>... si inca ' + (excluded.length - MAX_HTML_ITEMS) + '. Lista completa este in _RAPORT_CORECTII.txt din arhiva.</i></p>'; }
  }

  if (fixes.length > 0) {
    html += '<p><b>Redenumiri propuse (' + fixes.length + '):</b></p><ul>';
    for (var fx = 0; fx < fixes.length && fx < MAX_HTML_ITEMS; fx++) {
      var fi = fixes[fx];
      html += '<li>' + (fi.este_folder ? '[folder] ' : '') +
              '"' + esc(visualize(fi.nume_vechi)) + '" devine "' + esc(visualize(fi.nume_nou)) + '"' +
              '<br><small>' + esc(toBackSlash(fi.cale_veche)) + '</small>' +
              '<br><small>Motiv: ' + esc(fi.motive.join('; ')) + '</small></li>';
    }
    html += '</ul>';
    if (fixes.length > MAX_HTML_ITEMS) { html += '<p><i>... si inca ' + (fixes.length - MAX_HTML_ITEMS) + '. Lista completa este in _RAPORT_CORECTII.txt din arhiva.</i></p>'; }
  }

  if (avertismente.length > 0) {
    html += '<p><b>Avertismente care NU se pot corecta automat:</b></p><ul>';
    for (var av = 0; av < avertismente.length; av++) { html += '<li>' + esc(avertismente[av]) + '</li>'; }
    html += '</ul>';
    var showPaths = overSpo.concat(overWin).sort(function (a, b) { return b.lungime - a.lungime; });
    if (showPaths.length > 0) {
      html += '<p><small>Cele mai lungi cai:</small></p><ul>';
      for (var sp = 0; sp < showPaths.length && sp < 10; sp++) {
        html += '<li><small>' + showPaths[sp].lungime + ' caractere: ' + esc(toBackSlash(showPaths[sp].cale)) + '</small></li>';
      }
      html += '</ul>';
    }
  }
}

html += '<p><i>Daca alegi "Da", primesti o arhiva .zip cu toate corectiile de mai sus aplicate, ' +
        'plus un fisier _RAPORT_CORECTII.txt cu lista completa. Arhiva pe care ai incarcat-o nu se modifica.</i></p>';


// ------------------------------------------------------- utilitare reconstructie arhiva (din Nodul 2)
function crc32(buf) {
  if (!crc32.table) {
    var table = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }
  var crc = 0 ^ (-1);
  for (var i = 0; i < buf.length; i++) { crc = (crc >>> 8) ^ crc32.table[(crc ^ buf[i]) & 0xFF]; }
  return (crc ^ (-1)) >>> 0;
}

function u16(n) { var b = Buffer.alloc(2); b.writeUInt16LE(n & 0xFFFF, 0); return b; }
function u32(n) { var b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }


// ------------------------------------------------------------- raportul de corectii
var stamp;
try { stamp = $now.toFormat('dd.MM.yyyy HH:mm'); } catch (e) { stamp = new Date().toISOString(); }

var CRLF = String.fromCharCode(13) + String.fromCharCode(10);
var L = [];
L.push('RAPORT CORECTII - Verificare Folder pentru Teams');
L.push('===============================================');
L.push('');
L.push('Generat: ' + stamp);
L.push('Arhiva incarcata: ' + (fileBinary.fileName || 'arhiva.zip'));
L.push('');
L.push('Elemente verificate : ' + entries.length);
L.push('Redenumiri aplicate : ' + fixes.length);
L.push('Fisiere eliminate   : ' + excluded.length);
L.push('Avertismente        : ' + avertismente.length);
L.push('');

if (fixes.length > 0) {
  L.push('--- REDENUMIRI APLICATE ---');
  for (var ri = 0; ri < fixes.length; ri++) {
    var fx = fixes[ri];
    L.push('');
    L.push((fx.este_folder ? '[FOLDER] ' : '[FISIER] ') + fx.nume_vechi + '  ->  ' + fx.nume_nou);
    L.push('  cale veche: ' + toBackSlash(fx.cale_veche));
    L.push('  cale noua : ' + toBackSlash(fx.cale_noua));
    L.push('  motiv     : ' + (fx.motive || []).join('; '));
  }
  L.push('');
} else {
  L.push('Nicio redenumire nu a fost necesara.');
  L.push('');
}

if (excluded.length > 0) {
  L.push('--- FISIERE SCOASE DIN ARHIVA ---');
  L.push('(fisiere temporare sau de sistem, pe care SharePoint le refuza;');
  L.push(' nu au fost sterse din folderul tau, doar din arhiva corectata)');
  for (var xi = 0; xi < excluded.length; xi++) {
    L.push('');
    L.push('  ' + toBackSlash(excluded[xi].cale));
    L.push('  motiv: ' + excluded[xi].motiv);
  }
  L.push('');
}

if (avertismente.length > 0) {
  L.push('--- AVERTISMENTE (NU se pot corecta automat) ---');
  for (var ai = 0; ai < avertismente.length; ai++) { L.push('- ' + avertismente[ai]); }
  L.push('');
}

L.push('Acest fisier este generat automat si poate fi sters dupa citire.');

var reportBytes = Buffer.from(L.join(CRLF), 'utf-8');
var reportCrc = crc32(reportBytes);

// numele raportului nu trebuie sa se bata cap in cap cu un fisier existent
var reportName = '_RAPORT_CORECTII.txt';
var taken = {};
for (var t = 0; t < plan.length; t++) { taken[plan[t].dst.toLowerCase()] = true; }
var rn = 1;
while (taken[reportName.toLowerCase()]) { reportName = '_RAPORT_CORECTII_' + rn + '.txt'; rn++; }

// ------------------------------------------------------------ scrierea arhivei
var refModTime = plan.length > 0 ? (plan[0].modTime || 0) : 0;
var refModDate = plan.length > 0 ? (plan[0].modDate || 0) : 0;

var localChunks = [], centralChunks = [], offset = 0, written = 0;

function writeEntry(nameStr, flagsIn, method, mt, md, crcVal, csize, usize, dataBytes, isDir) {
  var nameBytes = Buffer.from(nameStr, 'utf-8');
  // 0x0800 = numele sunt UTF-8 | se STINGE 0x0008 pentru ca scriem dimensiunile
  // reale in antetul local (altfel dezarhivatoarele cauta un data descriptor inexistent)
  var f = (flagsIn | 0x0800) & ~0x0008;
  var attr = isDir ? 0x10 : 0x20;

  var localHeader = Buffer.concat([
    u32(0x04034b50), u16(20), u16(f), u16(method), u16(mt), u16(md),
    u32(crcVal), u32(csize), u32(usize), u16(nameBytes.length), u16(0), nameBytes
  ]);
  var thisOffset = offset;
  localChunks.push(localHeader, dataBytes);
  offset += localHeader.length + dataBytes.length;

  centralChunks.push(Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(f), u16(method), u16(mt), u16(md),
    u32(crcVal), u32(csize), u32(usize), u16(nameBytes.length), u16(0), u16(0),
    u16(0), u16(0), u32(attr), u32(thisOffset), nameBytes
  ]));
  written++;
}

writeEntry(reportName, 0, 0, refModTime, refModDate, reportCrc,
           reportBytes.length, reportBytes.length, reportBytes, false);

for (var i = 0; i < plan.length; i++) {
  var en = plan[i];
  var lho = en.localHeaderOffset;

  if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) {
    throw new Error('Arhiva originala nu mai corespunde planului (antet local nevalid pentru "' + en.src + '"). Reia procesul.');
  }
  var lnl = buf.readUInt16LE(lho + 26);
  var lel = buf.readUInt16LE(lho + 28);
  var dataStart = lho + 30 + lnl + lel;
  var dataEnd = dataStart + en.compressedSize;
  if (dataEnd > buf.length) {
    throw new Error('Arhiva originala pare trunchiata (lipsesc date pentru "' + en.src + '"). Reia procesul.');
  }

  writeEntry(en.dst, en.flags, en.compressionMethod, en.modTime, en.modDate,
             en.crc32, en.compressedSize, en.uncompressedSize,
             buf.slice(dataStart, dataEnd), en.este_folder);
}

if (written > 65535) {
  throw new Error('Arhiva corectata ar avea peste 65.535 de intrari. Imparte folderul in mai multe arhive.');
}

var localSection = Buffer.concat(localChunks);
var centralSection = Buffer.concat(centralChunks);
var eocd = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(written), u16(written),
  u32(centralSection.length), u32(localSection.length), u16(0)
]);
var finalZip = Buffer.concat([localSection, centralSection, eocd]);

var srcName = (fileBinary.fileName || 'folder.zip').replace(/\.zip$/i, '');
var outName = srcName + '_corectat.zip';



// ------------------------------------------------------------- raspuns final (JSON pentru webhook)
return [{
  json: {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      eroare: false,
      total_elemente: entries.length,
      nr_redenumiri: fixes.length,
      nr_eliminari: excluded.length,
      nr_avertismente: avertismente.length,
      are_modificari: (fixes.length + excluded.length) > 0,
      propuneri_redenumire: fixes,
      eliminari: excluded,
      avertismente: avertismente,
      raport_html: html,
      raport_txt: L.join(CRLF),
      nume_fisier: outName,
      zip_base64: finalZip.toString('base64')
    })
  }
}];

} catch (eGlobal) {
  return [{
    json: {
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        eroare: true,
        mesaj_eroare: 'Eroare neasteptata la procesare: ' + (eGlobal && eGlobal.message ? eGlobal.message : String(eGlobal)),
        total_elemente: 0, nr_redenumiri: 0, nr_eliminari: 0, nr_avertismente: 0,
        propuneri_redenumire: [], eliminari: [], avertismente: [],
        raport_html: '<p><b>Eroare neasteptata la procesare.</b></p>'
      })
    }
  }];
}

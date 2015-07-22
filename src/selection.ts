/**
 * Take an unsorted, potentially overlapping set of ranges, and
 * build a selection out of it. 'Consumes' ranges array (modifying
 * it).
 */
function normalizeSelection(ranges: EditorRange[], primIndex: number) {
  var prim = ranges[primIndex];
  ranges.sort((a, b) => cmp(a.from(), b.from()));
  primIndex = indexOf(ranges, prim);
  for (var i = 1; i < ranges.length; i++) {
    var cur = ranges[i], prev = ranges[i - 1];
    if (cmp(prev.to(), cur.from()) >= 0) {
      var from = minPos(prev.from(), cur.from()), to = maxPos(prev.to(), cur.to());
      var inv = prev.empty() ? cur.from() == cur.head : prev.from() == prev.head;
      if (i <= primIndex) --primIndex;
      ranges.splice(--i, 2, new EditorRange(inv ? to : from, inv ? from : to));
    }
  }
  return new EditorSelection(ranges, primIndex);
}

function simpleSelection(anchor, head) {
  return new EditorSelection([new EditorRange(anchor, head || anchor)], 0);
}

/**
 * Most of the external API clips given positions to make sure they
 * actually exist within the document.
 */
function clipLine(doc: Doc, n: number) { return Math.max(doc.first, Math.min(n, doc.first + doc.size - 1)); }

function clipPos(doc: Doc, pos: Pos) {
  if (pos.line < doc.first) return new Pos(doc.first, 0);
  var last = doc.first + doc.size - 1;
  if (pos.line > last) return new Pos(last, getLine(doc, last).contentLength());
  return clipToLen(pos, getLine(doc, pos.line).contentLength());
}

function clipToLen(pos: Pos, linelen: number) {
  var ch = pos.ch;
  if (ch == null || ch > linelen) return new Pos(pos.line, linelen);
  else if (ch < 0) return new Pos(pos.line, 0);
  else return pos;
}

function isLine(doc: Doc, l: number) { return l >= doc.first && l < doc.first + doc.size; }

function clipPosArray(doc: Doc, array: Pos[]) {
  for (var out = [], i = 0; i < array.length; i++) out[i] = clipPos(doc, array[i]);
  return out;
}
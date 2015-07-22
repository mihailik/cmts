/** Create a range of LineView objects for the given lines. */
function buildViewArray(cm: CodeMirror, from: number, to: number) {
  var array: LineView[] = [], nextPos: number;
  for (var pos = from; pos < to; pos = nextPos) {
    var view = new LineView(cm.doc, getLine(cm.doc, pos), pos);
    nextPos = pos + view.size;
    array.push(view);
  }
  return array;
}

/**
 * Updates the display.view data structure for a given change to the
 * document. From and to are in pre-change coordinates. Lendiff is
 * the amount of lines added or subtracted by the change. This is
 * used for changes that span multiple lines, or change the way
 * lines are divided into visual lines. regLineChange (below)
 * registers single-line changes.
 */
function regChange(cm: CodeMirror, from: number, to: number, lendiff: number) {
  if (from == null) from = cm.doc.first;
  if (to == null) to = cm.doc.first + cm.doc.size;
  if (!lendiff) lendiff = 0;

  var display = cm.display;
  if (lendiff && to < display.viewTo &&
      (display.updateLineNumbers == null || display.updateLineNumbers > from))
    display.updateLineNumbers = from;

  cm.curOp.viewChanged = true;

  if (from >= display.viewTo) { // Change after
    if (sawCollapsedSpans && visualLineNo(cm.doc, from) < display.viewTo)
      resetView(cm);
  } else if (to <= display.viewFrom) { // Change before
    if (sawCollapsedSpans && visualLineEndNo(cm.doc, to + lendiff) > display.viewFrom) {
      resetView(cm);
    } else {
      display.viewFrom += lendiff;
      display.viewTo += lendiff;
    }
  } else if (from <= display.viewFrom && to >= display.viewTo) { // Full overlap
    resetView(cm);
  } else if (from <= display.viewFrom) { // Top overlap
    var cut = viewCuttingPoint(cm, to, to + lendiff, 1);
    if (cut) {
      display.view = display.view.slice(cut.index);
      display.viewFrom = cut.lineN;
      display.viewTo += lendiff;
    } else {
      resetView(cm);
    }
  } else if (to >= display.viewTo) { // Bottom overlap
    var cut = viewCuttingPoint(cm, from, from, -1);
    if (cut) {
      display.view = display.view.slice(0, cut.index);
      display.viewTo = cut.lineN;
    } else {
      resetView(cm);
    }
  } else { // Gap in the middle
    var cutTop = viewCuttingPoint(cm, from, from, -1);
    var cutBot = viewCuttingPoint(cm, to, to + lendiff, 1);
    if (cutTop && cutBot) {
      display.view = display.view.slice(0, cutTop.index)
        .concat(buildViewArray(cm, cutTop.lineN, cutBot.lineN))
        .concat(display.view.slice(cutBot.index));
      display.viewTo += lendiff;
    } else {
      resetView(cm);
    }
  }

  var ext = display.externalMeasured;
  if (ext) {
    if (to < ext.lineN)
      ext.lineN += lendiff;
    else if (from < ext.lineN + ext.size)
      display.externalMeasured = null;
  }
}

/**
 * Register a change to a single line. Type must be one of "text",
 * "gutter", "class", "widget"
 */
function regLineChange(cm: CodeMirror, line: number, type: string) {
  cm.curOp.viewChanged = true;
  var display = cm.display, ext = cm.display.externalMeasured;
  if (ext && line >= ext.lineN && line < ext.lineN + ext.size)
    display.externalMeasured = null;

  if (line < display.viewFrom || line >= display.viewTo) return;
  var lineView = display.view[findViewIndex(cm, line)];
  if (lineView.node == null) return;
  var arr = lineView.changes || (lineView.changes = []);
  if (indexOf(arr, type) == -1) arr.push(type);
}

/** Clear the view. */
function resetView(cm: CodeMirror) {
  cm.display.viewFrom = cm.display.viewTo = cm.doc.first;
  cm.display.view = [];
  cm.display.viewOffset = 0;
}

/**
 * Find the view element corresponding to a given line. Return null
 * when the line isn't visible.
 */
function findViewIndex(cm: CodeMirror, n: number) {
  if (n >= cm.display.viewTo) return null;
  n -= cm.display.viewFrom;
  if (n < 0) return null;
  var view = cm.display.view;
  for (var i = 0; i < view.length; i++) {
    n -= view[i].size;
    if (n < 0) return i;
  }
}

function viewCuttingPoint(cm: CodeMirror, oldN: number, newN: number, dir: number) {
  var index = findViewIndex(cm, oldN), diff, view = cm.display.view;
  if (!sniff.sawCollapsedSpans || newN == cm.doc.first + cm.doc.size)
    return {index: index, lineN: newN};
  for (var i = 0, n = cm.display.viewFrom; i < index; i++)
    n += view[i].size;
  if (n != oldN) {
    if (dir > 0) {
      if (index == view.length - 1) return null;
      diff = (n + view[index].size) - oldN;
      index++;
    } else {
      diff = n - oldN;
    }
    oldN += diff; newN += diff;
  }
  while (visualLineNo(cm.doc, newN) != newN) {
    if (index == (dir < 0 ? 0 : view.length - 1)) return null;
    newN += dir * view[index - (dir < 0 ? 1 : 0)].size;
    index += dir;
  }
  return {index: index, lineN: newN};
}

/**
 * Force the view to cover a given range, adding empty view element
 * or clipping off existing ones as needed.
 */
function adjustView(cm: CodeMirror, from: number, to: number) {
  var display = cm.display, view = display.view;
  if (view.length == 0 || from >= display.viewTo || to <= display.viewFrom) {
    display.view = buildViewArray(cm, from, to);
    display.viewFrom = from;
  } else {
    if (display.viewFrom > from)
      display.view = buildViewArray(cm, from, display.viewFrom).concat(display.view);
    else if (display.viewFrom < from)
      display.view = display.view.slice(findViewIndex(cm, from));
    display.viewFrom = from;
    if (display.viewTo < to)
      display.view = display.view.concat(buildViewArray(cm, display.viewTo, to));
    else if (display.viewTo > to)
      display.view = display.view.slice(0, findViewIndex(cm, to));
  }
  display.viewTo = to;
}

/**
 * Count the number of lines in the view whose DOM representation is
 * out of date (or nonexistent).
 */
function countDirtyView(cm: CodeMirror) {
  var view = cm.display.view, dirty = 0;
  for (var i = 0; i < view.length; i++) {
    var lineView = view[i];
    if (!lineView.hidden && (!lineView.node || lineView.changes)) ++dirty;
  }
  return dirty;
}

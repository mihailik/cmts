// HIGHLIGHT WORKER

function startWorker(cm: CodeMirror, time: number) {
  if (cm.doc.mode.startState && cm.doc.frontier < cm.display.viewTo)
    cm.state.highlight.set(time, bind(highlightWorker, cm));
}

function highlightWorker(cm: CodeMirror) {
  var doc = cm.doc;
  if (doc.frontier < doc.first) doc.frontier = doc.first;
  if (doc.frontier >= cm.display.viewTo) return;
  var end = +new Date + cm.options.workTime;
  var state = copyState(doc.mode, getStateBefore(cm, doc.frontier));
  var changedLines = [];

  doc.iter(doc.frontier, Math.min(doc.first + doc.size, cm.display.viewTo + 500), function(line) {
    if (doc.frontier >= cm.display.viewFrom) { // Visible
      var oldStyles = line.styles;
      var highlighted = highlightLine(cm, line, state, true);
      line.styles = highlighted.styles;
      var oldCls = line.styleClasses, newCls = highlighted.classes;
      if (newCls) line.styleClasses = newCls;
      else if (oldCls) line.styleClasses = null;
      var ischange = !oldStyles || oldStyles.length != line.styles.length ||
          oldCls != newCls && (!oldCls || !newCls || oldCls.bgClass != newCls.bgClass || oldCls.textClass != newCls.textClass);
      for (var i = 0; !ischange && i < oldStyles.length; ++i) ischange = oldStyles[i] != line.styles[i];
      if (ischange) changedLines.push(doc.frontier);
      line.stateAfter = copyState(doc.mode, state);
    } else {
      processLine(cm, line.text, state);
      line.stateAfter = doc.frontier % 5 == 0 ? copyState(doc.mode, state) : null;
    }
    ++doc.frontier;
    if (+new Date > end) {
      startWorker(cm, cm.options.workDelay);
      return true;
    }
  });
  if (changedLines.length) runInOp(cm, function() {
    for (var i = 0; i < changedLines.length; i++)
      regLineChange(cm, changedLines[i], "text");
  });
}

/**
 * Finds the line to start with when starting a parse. Tries to
 * find a line with a stateAfter, so that it can start with a
 * valid state. If that fails, it returns the line with the
 * smallest indentation, which tends to need the least context to
 * parse correctly.
 */
function findStartLine(cm: CodeMirror, n: number, precise: boolean) {
  var minindent, minline, doc = cm.doc;
  var lim = precise ? -1 : n - (cm.doc.mode.innerMode ? 1000 : 100);
  for (var search = n; search > lim; --search) {
    if (search <= doc.first) return doc.first;
    var line = getLine(doc, search - 1);
    if (line.stateAfter && (!precise || search <= doc.frontier)) return search;
    var indented = countColumn(line.text, null, cm.options.tabSize);
    if (minline == null || minindent > indented) {
      minline = search - 1;
      minindent = indented;
    }
  }
  return minline;
}

function getStateBefore(cm: CodeMirror, n: number, precise: boolean) {
  var doc = cm.doc, display = cm.display;
  if (!doc.mode.startState) return true;
  var pos = findStartLine(cm, n, precise), state = pos > doc.first && getLine(doc, pos-1).stateAfter;
  if (!state) state = startState(doc.mode);
  else state = copyState(doc.mode, state);
  doc.iter(pos, n, function(line) {
    processLine(cm, line.text, state);
    var save = pos == n - 1 || pos % 5 == 0 || pos >= display.viewFrom && pos < display.viewTo;
    line.stateAfter = save ? copyState(doc.mode, state) : null;
    ++pos;
  });
  if (precise) doc.frontier = pos;
  return state;
}

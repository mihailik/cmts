// UPDATING

/**
 * Adjust a position to refer to the post-change position of the
 * same text, or the end of the change if the change covers it.
 */
function adjustForChange(pos: Pos, change: Change) {
  if (cmp(pos, change.from) < 0) return pos;
  if (cmp(pos, change.to) <= 0) return changeEnd(change);

  var line = pos.line + change.text.length - (change.to.line - change.from.line) - 1, ch = pos.ch;
  if (pos.line == change.to.line) ch += changeEnd(change).ch - change.to.ch;
  return new Pos(line, ch);
}

function computeSelAfterChange(doc: Doc, change: Change) {
  var out: EditorRange[] = [];
  for (var i = 0; i < doc.sel.ranges.length; i++) {
    var range = doc.sel.ranges[i];
    out.push(new EditorRange(
      adjustForChange(range.anchor, change),
      adjustForChange(range.head, change)));
  }
  return normalizeSelection(out, doc.sel.primIndex);
}

function offsetPos(pos: Pos, old: Pos, nw: Pos) {
  if (pos.line == old.line)
    return new Pos(nw.line, pos.ch - old.ch + nw.ch);
  else
    return new Pos(nw.line + (pos.line - old.line), pos.ch);
}

/**
 * Used by replaceSelections to allow moving the selection to the
 * start or around the replaced test. Hint may be "start" or "around".
 */
function computeReplacedSel(doc: Doc, changes: Change[], hint: string) {
  var out = [];
  var oldPrev = new Pos(doc.first, 0), newPrev = oldPrev;
  for (var i = 0; i < changes.length; i++) {
    var change = changes[i];
    var from = offsetPos(change.from, oldPrev, newPrev);
    var to = offsetPos(changeEnd(change), oldPrev, newPrev);
    oldPrev = change.to;
    newPrev = to;
    if (hint == "around") {
      var range = doc.sel.ranges[i], inv = cmp(range.head, range.anchor) < 0;
      out[i] = new EditorRange(inv ? to : from, inv ? from : to);
    } else {
      out[i] = new EditorRange(from, from);
    }
  }
  return new EditorSelection(out, doc.sel.primIndex);
}

/** Allow "beforeChange" event handlers to influence a change */
function filterChange(doc: Doc, change: Change, update: boolean) {
  var obj: Change = {
    canceled: false,
    from: change.from,
    to: change.to,
    text: change.text,
    origin: change.origin,
    cancel: function() { this.canceled = true; }
  };
  if (update) obj.update = function(from, to, text, origin) {
    if (from) this.from = clipPos(doc, from);
    if (to) this.to = clipPos(doc, to);
    if (text) this.text = text;
    if (origin !== undefined) this.origin = origin;
  };
  signal(doc, "beforeChange", doc, obj);
  if (doc.cm) signal(doc.cm, "beforeChange", doc.cm, obj);

  if (obj.canceled) return null;
  return {from: obj.from, to: obj.to, text: obj.text, origin: obj.origin};
}

/**
 * Apply a change to a document, and add it to the document's
 * history, and propagating it to all linked documents.
 */
function makeChange(doc: Doc, change: Change, ignoreReadOnly: boolean) {
  if (doc.cm) {
    if (!doc.cm.curOp) return operation(doc.cm, makeChange)(doc, change, ignoreReadOnly);
    if (doc.cm.state.suppressEdits) return;
  }

  if (hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange")) {
    change = filterChange(doc, change, true);
    if (!change) return;
  }

  // Possibly split or suppress the update based on the presence
  // of read-only spans in its range.
  var split = sniff.sawReadOnlySpans && !ignoreReadOnly && removeReadOnlyRanges(doc, change.from, change.to);
  if (split) {
    for (var i = split.length - 1; i >= 0; --i)
      makeChangeInner(doc, {from: split[i].from, to: split[i].to, text: i ? [""] : change.text});
  } else {
    makeChangeInner(doc, change);
  }
}

function makeChangeInner(doc, change) {
  if (change.text.length == 1 && change.text[0] == "" && cmp(change.from, change.to) == 0) return;
  var selAfter = computeSelAfterChange(doc, change);
  addChangeToHistory(doc, change, selAfter, doc.cm ? doc.cm.curOp.id : NaN);

  makeChangeSingleDoc(doc, change, selAfter, stretchSpansOverChange(doc, change));
  var rebased = [];

  linkedDocs(doc, function(doc, sharedHist) {
    if (!sharedHist && indexOf(rebased, doc.history) == -1) {
      rebaseHist(doc.history, change);
      rebased.push(doc.history);
    }
    makeChangeSingleDoc(doc, change, null, stretchSpansOverChange(doc, change));
  });
}

/** Revert a change stored in a document's history. */
function makeChangeFromHistory(doc: Doc, type: string, allowSelectionOnly: boolean) {
  if (doc.cm && doc.cm.state.suppressEdits) return;

  var hist = doc.history, event, selAfter = doc.sel;
  var source = type == "undo" ? hist.done : hist.undone, dest = type == "undo" ? hist.undone : hist.done;

  // Verify that there is a useable event (so that ctrl-z won't
  // needlessly clear selection events)
  for (var i = 0; i < source.length; i++) {
    event = source[i];
    if (allowSelectionOnly ? event.ranges && !event.equals(doc.sel) : !event.ranges)
      break;
  }
  if (i == source.length) return;
  hist.lastOrigin = hist.lastSelOrigin = null;

  for (;;) {
    event = source.pop();
    if (event.ranges) {
      pushSelectionToHistory(event, dest);
      if (allowSelectionOnly && !event.equals(doc.sel)) {
        setSelection(doc, event, {clearRedo: false});
        return;
      }
      selAfter = event;
    }
    else break;
  }

  // Build up a reverse change object to add to the opposite history
  // stack (redo when undoing, and vice versa).
  var antiChanges: Change[] = [];
  pushSelectionToHistory(selAfter, dest);
  dest.push({changes: antiChanges, generation: hist.generation});
  hist.generation = event.generation || ++hist.maxGeneration;

  var filter = hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange");

  for (var i = event.changes.length - 1; i >= 0; --i) {
    var change = event.changes[i];
    change.origin = type;
    if (filter && !filterChange(doc, change, false)) {
      source.length = 0;
      return;
    }

    antiChanges.push(historyChangeFromChange(doc, change));

    var after = i ? computeSelAfterChange(doc, change) : lst(source);
    makeChangeSingleDoc(doc, change, after, mergeOldSpans(doc, change));
    if (!i && doc.cm) doc.cm.scrollIntoView({from: change.from, to: changeEnd(change)});
    var rebased = [];

    // Propagate to the linked documents
    linkedDocs(doc, function(doc, sharedHist) {
      if (!sharedHist && indexOf(rebased, doc.history) == -1) {
        rebaseHist(doc.history, change);
        rebased.push(doc.history);
      }
      makeChangeSingleDoc(doc, change, null, mergeOldSpans(doc, change));
    });
  }
}

/**
 * Sub-views need their line numbers shifted when text is added
 * above or below them in the parent document.
 */
function shiftDoc(doc: Doc, distance: number) {
  if (distance == 0) return;
  doc.first += distance;

  doc.sel = new EditorSelection(
    map(
      doc.sel.ranges,
      (range) => new EditorRange(
      	new Pos(range.anchor.line + distance, range.anchor.ch),
        new Pos(range.head.line + distance, range.head.ch))),
    doc.sel.primIndex);

  if (doc.cm) {
    regChange(doc.cm, doc.first, doc.first - distance, distance);
    for (var d = doc.cm.display, l = d.viewFrom; l < d.viewTo; l++)
      regLineChange(doc.cm, l, "gutter");
  }
}

/**
 * More lower-level change function, handling only a single document
 * (not linked ones).
 */
function makeChangeSingleDoc(doc: Doc, change: Change, selAfter, spans) {
  if (doc.cm && !doc.cm.curOp)
    return operation(doc.cm, makeChangeSingleDoc)(doc, change, selAfter, spans);

  if (change.to.line < doc.first) {
    shiftDoc(doc, change.text.length - 1 - (change.to.line - change.from.line));
    return;
  }
  if (change.from.line > doc.lastLine()) return;

  // Clip the change to the size of this doc
  if (change.from.line < doc.first) {
    var shift = change.text.length - 1 - (doc.first - change.from.line);
    shiftDoc(doc, shift);
    change = {from: Pos(doc.first, 0), to: Pos(change.to.line + shift, change.to.ch),
              text: [lst(change.text)], origin: change.origin};
  }
  var last = doc.lastLine();
  if (change.to.line > last) {
    change = {from: change.from, to: Pos(last, getLine(doc, last).text.length),
              text: [change.text[0]], origin: change.origin};
  }

  change.removed = getBetween(doc, change.from, change.to);

  if (!selAfter) selAfter = computeSelAfterChange(doc, change);
  if (doc.cm) makeChangeSingleDocInEditor(doc.cm, change, spans);
  else updateDoc(doc, change, spans);
  setSelectionNoUndo(doc, selAfter, sel_dontScroll);
}

/**
 * Handle the interaction of a change to a document with the editor
 * that this document is part of.
 */
function makeChangeSingleDocInEditor(cm: CodeMirror, change: Change, spans) {
  var doc = cm.doc, display = cm.display, from = change.from, to = change.to;

  var recomputeMaxLength = false, checkWidthStart = from.line;
  if (!cm.options.lineWrapping) {
    checkWidthStart = lineNo(visualLine(getLine(doc, from.line)));
    doc.iter(checkWidthStart, to.line + 1, function(line) {
      if (line == display.maxLine) {
        recomputeMaxLength = true;
        return true;
      }
    });
  }

  if (doc.sel.contains(change.from, change.to) > -1)
    signalCursorActivity(cm);

  updateDoc(doc, change, spans, estimateHeight(cm));

  if (!cm.options.lineWrapping) {
    doc.iter(checkWidthStart, from.line + change.text.length, function(line) {
      var len = lineLength(line);
      if (len > display.maxLineLength) {
        display.maxLine = line;
        display.maxLineLength = len;
        display.maxLineChanged = true;
        recomputeMaxLength = false;
      }
    });
    if (recomputeMaxLength) cm.curOp.updateMaxLine = true;
  }

  // Adjust frontier, schedule worker
  doc.frontier = Math.min(doc.frontier, from.line);
  startWorker(cm, 400);

  var lendiff = change.text.length - (to.line - from.line) - 1;
  // Remember that these lines changed, for updating the display
  if (change.full)
    regChange(cm);
  else if (from.line == to.line && change.text.length == 1 && !isWholeLineUpdate(cm.doc, change))
    regLineChange(cm, from.line, "text");
  else
    regChange(cm, from.line, to.line + 1, lendiff);

  var changesHandler = hasHandler(cm, "changes"), changeHandler = hasHandler(cm, "change");
  if (changeHandler || changesHandler) {
    var obj = {
      from: from, to: to,
      text: change.text,
      removed: change.removed,
      origin: change.origin
    };
    if (changeHandler) signalLater(cm, "change", cm, obj);
    if (changesHandler) (cm.curOp.changeObjs || (cm.curOp.changeObjs = [])).push(obj);
  }
  cm.display.selForContextMenu = null;
}

function replaceRange(doc: Doc, code: string | string[], from: Pos, to: Pos, origin) {
  if (!to) to = from;
  if (cmp(to, from) < 0) { var tmp = to; to = from; from = tmp; }
  if (typeof code == "string") code = splitLines(code);
  makeChange(doc, {from: from, to: to, text: code, origin: origin});
}

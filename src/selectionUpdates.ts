// SELECTION UPDATES

// The 'scroll' parameter given to many of these indicated whether
// the new cursor position should be scrolled into view after
// modifying the selection.

/**
 * If shift is held or the extend flag is set, extends a range to
 * include a given position (and optionally a second position).
 * Otherwise, simply returns the range between the given positions.
 * Used for cursor motion and such.
 */
function extendRange(doc: Doc, range: EditorRange, head: Pos, other: Pos) {
  if (doc.cm && doc.cm.display.shift || doc.extend) {
    var anchor = range.anchor;
    if (other) {
      var posBefore = cmp(head, anchor) < 0;
      if (posBefore != (cmp(other, anchor) < 0)) {
        anchor = head;
        head = other;
      } else if (posBefore != (cmp(head, other) < 0)) {
        head = other;
      }
    }
    return new EditorRange(anchor, head);
  } else {
    return new EditorRange(other || head, head);
  }
}

/** Extend the primary selection range, discard the rest. */
function extendSelection(doc: Doc, head: Pos, other: Pos, options?: Options) {
  setSelection(doc, new EditorSelection([extendRange(doc, doc.sel.primary(), head, other)], 0), options);
}

/**
 * Extend all selections (pos is an array of selections with length
 * equal the number of selections)
 */
function extendSelections(doc: Doc, heads: Pos[], options: Options) {
  for (var out = [], i = 0; i < doc.sel.ranges.length; i++)
    out[i] = extendRange(doc, doc.sel.ranges[i], heads[i], null);
  var newSel = normalizeSelection(out, doc.sel.primIndex);
  setSelection(doc, newSel, options);
}

/** Updates a single range in the selection. */
function replaceOneSelection(doc: Doc, i: number, range: Range, options: Options) {
  var ranges = doc.sel.ranges.slice(0);
  ranges[i] = range;
  setSelection(doc, normalizeSelection(ranges, doc.sel.primIndex), options);
}

/** Reset the selection to a single range. */
function setSimpleSelection(doc: Doc, anchor: Pos, head: Pos, options: Options) {
  setSelection(doc, simpleSelection(anchor, head), options);
}

/**
 * Give beforeSelectionChange handlers a change to influence a
 * selection update.
 */
function filterSelectionChange(doc: Doc, sel: EditorSelection) {
  var obj = {
    ranges: sel.ranges,
    update: function(ranges) {
      this.ranges = [];
      for (var i = 0; i < ranges.length; i++)
        this.ranges[i] = new EditorRange(clipPos(doc, ranges[i].anchor),
                                   clipPos(doc, ranges[i].head));
    }
  };
  signal(doc, "beforeSelectionChange", doc, obj);
  if (doc.cm) signal(doc.cm, "beforeSelectionChange", doc.cm, obj);
  if (obj.ranges != sel.ranges) return normalizeSelection(obj.ranges, obj.ranges.length - 1);
  else return sel;
}

function setSelectionReplaceHistory(doc: Doc, sel: EditorSelection, options: Options) {
  var done = doc.history.done, last = lst(done);
  if (last && last.ranges) {
    done[done.length - 1] = sel;
    setSelectionNoUndo(doc, sel, options);
  } else {
    setSelection(doc, sel, options);
  }
}

/** Set a new selection. */
function setSelection(doc: Doc, sel: EditorSelection, options: Options) {
  setSelectionNoUndo(doc, sel, options);
  addSelectionToHistory(doc, doc.sel, doc.cm ? doc.cm.curOp.id : NaN, options);
}

function setSelectionNoUndo(doc: Doc, sel: EditorSelection, options: Options) {
  if (hasHandler(doc, "beforeSelectionChange") || doc.cm && hasHandler(doc.cm, "beforeSelectionChange"))
    sel = filterSelectionChange(doc, sel);

  var bias = options && options.bias ||
      (cmp(sel.primary().head, doc.sel.primary().head) < 0 ? -1 : 1);
  setSelectionInner(doc, skipAtomicInSelection(doc, sel, bias, true));

  if (!(options && options.scroll === false) && doc.cm)
    ensureCursorVisible(doc.cm);
}

function setSelectionInner(doc: Doc, sel: EditorSelection) {
  if (sel.equals(doc.sel)) return;

  doc.sel = sel;

  if (doc.cm) {
    doc.cm.curOp.updateInput = doc.cm.curOp.selectionChanged = true;
    signalCursorActivity(doc.cm);
  }
  signalLater(doc, "cursorActivity", doc);
}

/**
 * Verify that the selection does not partially select any atomic
 * marked ranges.
 */
function reCheckSelection(doc: Doc) {
  setSelectionInner(doc, skipAtomicInSelection(doc, doc.sel, null, false), sel_dontScroll);
}

/**
 * Return a selection that does not partially select any atomic
 * ranges.
 */
function skipAtomicInSelection(doc: Doc, sel: EditorSelection, bias: string, mayClear: boolean) {
  var out;
  for (var i = 0; i < sel.ranges.length; i++) {
    var range = sel.ranges[i];
    var newAnchor = skipAtomic(doc, range.anchor, bias, mayClear);
    var newHead = skipAtomic(doc, range.head, bias, mayClear);
    if (out || newAnchor != range.anchor || newHead != range.head) {
      if (!out) out = sel.ranges.slice(0, i);
      out[i] = new Range(newAnchor, newHead);
    }
  }
  return out ? normalizeSelection(out, sel.primIndex) : sel;
}

/** Ensure a given position is not inside an atomic range. */
function skipAtomic(doc: Doc, pos: Pos, bias: string, mayClear: boolean) {
  var flipped = false, curPos = pos;
  var dir = bias || 1;
  doc.cantEdit = false;
  search: for (;;) {
    var line = getLine(doc, curPos.line);
    if (line.markedSpans) {
      for (var i = 0; i < line.markedSpans.length; ++i) {
        var sp = line.markedSpans[i], m = sp.marker;
        if ((sp.from == null || (m.inclusiveLeft ? sp.from <= curPos.ch : sp.from < curPos.ch)) &&
            (sp.to == null || (m.inclusiveRight ? sp.to >= curPos.ch : sp.to > curPos.ch))) {
          if (mayClear) {
            signal(m, "beforeCursorEnter");
            if (m.explicitlyCleared) {
              if (!line.markedSpans) break;
              else {--i; continue;}
            }
          }
          if (!m.atomic) continue;
          var newPos = m.find(dir < 0 ? -1 : 1);
          if (cmp(newPos, curPos) == 0) {
            newPos.ch += dir;
            if (newPos.ch < 0) {
              if (newPos.line > doc.first) newPos = clipPos(doc, Pos(newPos.line - 1));
              else newPos = null;
            } else if (newPos.ch > line.contentLength()) {
              if (newPos.line < doc.first + doc.size - 1) newPos = Pos(newPos.line + 1, 0);
              else newPos = null;
            }
            if (!newPos) {
              if (flipped) {
                // Driven in a corner -- no valid cursor position found at all
                // -- try again *with* clearing, if we didn't already
                if (!mayClear) return skipAtomic(doc, pos, bias, true);
                // Otherwise, turn off editing until further notice, and return the start of the doc
                doc.cantEdit = true;
                return new Pos(doc.first, 0);
              }
              flipped = true; newPos = pos; dir = -dir;
            }
          }
          curPos = newPos;
          continue search;
        }
      }
    }
    return curPos;
  }
}

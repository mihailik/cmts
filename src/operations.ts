// OPERATIONS

// Operations are used to wrap a series of changes to the editor
// state in such a way that each change won't have to update the
// cursor and display (which would be awkward, slow, and
// error-prone). Instead, display updates are batched and then all
// combined and executed at once.

var operationGroup = null;

var nextOpId = 0;
// Start a new operation.
function startOperation(cm: CodeMirror) {
  cm.curOp = {
    cm: cm,
    viewChanged: false,      // Flag that indicates that lines might need to be redrawn
    startHeight: cm.doc.height, // Used to detect need to update scrollbar
    forceUpdate: false,      // Used to force a redraw
    updateInput: null,       // Whether to reset the input textarea
    typing: false,           // Whether this reset should be careful to leave existing text (for compositing)
    changeObjs: null,        // Accumulated changes, for firing change events
    cursorActivityHandlers: null, // Set of handlers to fire cursorActivity on
    cursorActivityCalled: 0, // Tracks which cursorActivity handlers have been called already
    selectionChanged: false, // Whether the selection needs to be redrawn
    updateMaxLine: false,    // Set when the widest line needs to be determined anew
    scrollLeft: null, scrollTop: null, // Intermediate scroll position, not pushed to DOM yet
    scrollToPos: null,       // Used to scroll to a specific position
    focus: false,
    id: ++nextOpId           // Unique ID
  };
  if (operationGroup) {
    operationGroup.ops.push(cm.curOp);
  } else {
    cm.curOp.ownsGroup = operationGroup = {
      ops: [cm.curOp],
      delayedCallbacks: []
    };
  }
}

function fireCallbacksForOps(group: OperationGroup) {
  // Calls delayed callbacks and cursorActivity handlers until no
  // new ones appear
  var callbacks = group.delayedCallbacks, i = 0;
  do {
    for (; i < callbacks.length; i++) {
      var c = callbacks[i];
      c();
    }
    for (var j = 0; j < group.ops.length; j++) {
      var op = group.ops[j];
      if (op.cursorActivityHandlers)
        while (op.cursorActivityCalled < op.cursorActivityHandlers.length)
          op.cursorActivityHandlers[op.cursorActivityCalled++](op.cm);
    }
  } while (i < callbacks.length);
}

/** Finish an operation, updating the display and signalling delayed events */
function endOperation(cm: CodeMirror) {
  var op = cm.curOp, group = op.ownsGroup;
  if (!group) return;

  try { fireCallbacksForOps(group); }
  finally {
    operationGroup = null;
    for (var i = 0; i < group.ops.length; i++)
      group.ops[i].cm.curOp = null;
    endOperations(group);
  }
}

/**
 * The DOM updates done when an operation finishes are batched so
 * that the minimum number of relayouts are required.
 */
function endOperations(group: OperationGroup) {
  var ops = group.ops;
  for (var i = 0; i < ops.length; i++) // Read DOM
    endOperation_R1(ops[i]);
  for (var i = 0; i < ops.length; i++) // Write DOM (maybe)
    endOperation_W1(ops[i]);
  for (var i = 0; i < ops.length; i++) // Read DOM
    endOperation_R2(ops[i]);
  for (var i = 0; i < ops.length; i++) // Write DOM (maybe)
    endOperation_W2(ops[i]);
  for (var i = 0; i < ops.length; i++) // Read DOM
    endOperation_finish(ops[i]);
}

function endOperation_R1(op: OperationState) {
  var cm = op.cm, display = cm.display;
  maybeClipScrollbars(cm);
  if (op.updateMaxLine) findMaxLine(cm);

  op.mustUpdate =
  	op.viewChanged || op.forceUpdate || op.scrollTop != null ||
    op.scrollToPos && (op.scrollToPos.from.line < display.viewFrom || op.scrollToPos.to.line >= display.viewTo) ||
    display.maxLineChanged && cm.options.lineWrapping;

  op.update = op.mustUpdate &&
    new DisplayUpdate(cm, op.mustUpdate && {top: op.scrollTop, ensure: op.scrollToPos}, op.forceUpdate);
}

function endOperation_W1(op: OperationState) {
  op.updatedDisplay = op.mustUpdate && updateDisplayIfNeeded(op.cm, op.update);
}

function endOperation_R2(op: OperationState) {
  var cm = op.cm, display = cm.display;
  if (op.updatedDisplay) updateHeightsInViewport(cm);

  op.barMeasure = measureForScrollbars(cm);

  // If the max line changed since it was last measured, measure it,
  // and ensure the document's width matches it.
  // updateDisplay_W2 will use these properties to do the actual resizing
  if (display.maxLineChanged && !cm.options.lineWrapping) {
    op.adjustWidthTo = measureChar(cm, display.maxLine, display.maxLine.text.length).left + 3;
    cm.display.sizerWidth = op.adjustWidthTo;
    op.barMeasure.scrollWidth =
      Math.max(display.scroller.clientWidth, display.sizer.offsetLeft + op.adjustWidthTo + scrollGap(cm) + cm.display.barWidth);
    op.maxScrollLeft = Math.max(0, display.sizer.offsetLeft + op.adjustWidthTo - displayWidth(cm));
  }

  if (op.updatedDisplay || op.selectionChanged)
    op.preparedSelection = display.input.prepareSelection();
}

function endOperation_W2(op: OperationState) {
  var cm = op.cm;

  if (op.adjustWidthTo != null) {
    cm.display.sizer.style.minWidth = op.adjustWidthTo + "px";
    if (op.maxScrollLeft < cm.doc.scrollLeft)
      setScrollLeft(cm, Math.min(cm.display.scroller.scrollLeft, op.maxScrollLeft), true);
    cm.display.maxLineChanged = false;
  }

  if (op.preparedSelection)
    cm.display.input.showSelection(op.preparedSelection);
  if (op.updatedDisplay)
    setDocumentHeight(cm, op.barMeasure);
  if (op.updatedDisplay || op.startHeight != cm.doc.height)
    updateScrollbars(cm, op.barMeasure);

  if (op.selectionChanged) restartBlink(cm);

  if (cm.state.focused && op.updateInput)
    cm.display.input.reset(op.typing);
  if (op.focus && op.focus == activeElt()) ensureFocus(op.cm);
}

function endOperation_finish(op: OperationState) {
  var cm = op.cm, display = cm.display, doc = cm.doc;

  if (op.updatedDisplay) postUpdateDisplay(cm, op.update);

  // Abort mouse wheel delta measurement, when scrolling explicitly
  if (display.wheelStartX != null && (op.scrollTop != null || op.scrollLeft != null || op.scrollToPos))
    display.wheelStartX = display.wheelStartY = null;

  // Propagate the scroll position to the actual DOM scroller
  if (op.scrollTop != null && (display.scroller.scrollTop != op.scrollTop || op.forceScroll)) {
    doc.scrollTop = Math.max(0, Math.min(display.scroller.scrollHeight - display.scroller.clientHeight, op.scrollTop));
    display.scrollbars.setScrollTop(doc.scrollTop);
    display.scroller.scrollTop = doc.scrollTop;
  }
  if (op.scrollLeft != null && (display.scroller.scrollLeft != op.scrollLeft || op.forceScroll)) {
    doc.scrollLeft = Math.max(0, Math.min(display.scroller.scrollWidth - displayWidth(cm), op.scrollLeft));
    display.scrollbars.setScrollLeft(doc.scrollLeft);
    display.scroller.scrollLeft = doc.scrollLeft;
    alignHorizontally(cm);
  }
  // If we need to scroll a specific position into view, do so.
  if (op.scrollToPos) {
    var coords = scrollPosIntoView(cm, clipPos(doc, op.scrollToPos.from),
                                   clipPos(doc, op.scrollToPos.to), op.scrollToPos.margin);
    if (op.scrollToPos.isCursor && cm.state.focused) maybeScrollWindow(cm, coords);
  }

  // Fire events for markers that are hidden/unidden by editing or
  // undoing
  var hidden = op.maybeHiddenMarkers, unhidden = op.maybeUnhiddenMarkers;
  if (hidden) for (var i = 0; i < hidden.length; ++i)
    if (!hidden[i].lines.length) signal(hidden[i], "hide");
  if (unhidden) for (var i = 0; i < unhidden.length; ++i)
    if (unhidden[i].lines.length) signal(unhidden[i], "unhide");

  if (display.wrapper.offsetHeight)
    doc.scrollTop = cm.display.scroller.scrollTop;

  // Fire change events, and delayed event handlers
  if (op.changeObjs)
    signal(cm, "changes", cm, op.changeObjs);
  if (op.update)
    op.update.finish();
}

/** Run the given function in an operation */
function runInOp<T>(cm: CodeMirror, f: () => T) {
  if (cm.curOp) return f();
  startOperation(cm);
  try { return f(); }
  finally { endOperation(cm); }
}

/** Wraps a function in an operation. Returns the wrapped function. */
function operation(cm: CodeMirror, f: Function) {
  return function() {
    if (cm.curOp) return f.apply(cm, arguments);
    startOperation(cm);
    try { return f.apply(cm, arguments); }
    finally { endOperation(cm); }
  };
}

/**
 * Used to add methods to editor and doc instances, wrapping them in
 * operations.
 */
function methodOp(f: Function) {
  return function() {
    if (this.curOp) return f.apply(this, arguments);
    startOperation(this);
    try { return f.apply(this, arguments); }
    finally { endOperation(this); }
  };
}

function docMethodOp(f: Function) {
  return function() {
    var cm = this.cm;
    if (!cm || cm.curOp) return f.apply(this, arguments);
    startOperation(cm);
    try { return f.apply(this, arguments); }
    finally { endOperation(cm); }
  };
}

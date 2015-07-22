// MOUSE EVENTS

/** Return true when the given mouse event happened in a widget */
function eventInWidget(display: Display, e: MouseEvent) {
  for (var n = e_target(e); n != display.wrapper; n = n.parentNode) {
    if (!n || (n.nodeType == 1 && n.getAttribute("cm-ignore-events") == "true") ||
        (n.parentNode == display.sizer && n != display.mover))
      return true;
  }
}

/**
 * Given a mouse event, find the corresponding position. If liberal
 * is false, it checks whether a gutter or scrollbar was clicked,
 * and returns null if it was. forRect is used by rectangular
 * selections, and tries to estimate a character position even for
 * coordinates beyond the right of the text.
 */
function posFromMouse(cm: CodeMirror, e: MouseEvent, liberal?: boolean, forRect?: boolean) {
  var display = cm.display;
  if (!liberal && e_target(e).getAttribute("cm-not-content") == "true") return null;

  var x, y, space = display.lineSpace.getBoundingClientRect();
  // Fails unpredictably on IE[67] when mouse is dragged around quickly.
  try { x = e.clientX - space.left; y = e.clientY - space.top; }
  catch (e) { return null; }
  var coords = coordsChar(cm, x, y), line;
  if (forRect && coords.xRel == 1 && (line = getLine(cm.doc, coords.line).text).length == coords.ch) {
    var colDiff = countColumn(line, line.length, cm.options.tabSize) - line.length;
    coords = Pos(coords.line, Math.max(0, Math.round((x - paddingH(cm.display).left) / charWidth(cm.display)) - colDiff));
  }
  return coords;
}

/**
 * A mouse down can be a single click, double click, triple click,
 * start of selection drag, start of text drag, new cursor
 * (ctrl-click), rectangle drag (alt-drag), or xwin
 * middle-click-paste. Or it might be a click on something we should
 * not interfere with, such as a scrollbar or widget.
 */
function onMouseDown(e: MouseEvent) {
  var cm = this, display = cm.display;
  if (display.activeTouch && display.input.supportsTouch() || signalDOMEvent(cm, e)) return;
  display.shift = e.shiftKey;

  if (eventInWidget(display, e)) {
    if (!sniff.webkit) {
      // Briefly turn off draggability, to allow widgets to do
      // normal dragging things.
      display.scroller.draggable = false;
      setTimeout(function(){display.scroller.draggable = true;}, 100);
    }
    return;
  }
  if (clickInGutter(cm, e)) return;
  var start = posFromMouse(cm, e);
  window.focus();

  switch (e_button(e)) {
    case 1:
      if (start)
        leftButtonDown(cm, e, start);
      else if (e_target(e) == display.scroller)
        e_preventDefault(e);
      break;
    case 2:
      if (sniff.webkit) cm.state.lastMiddleDown = +new Date;
      if (start) extendSelection(cm.doc, start);
      setTimeout(function() {display.input.focus();}, 20);
      e_preventDefault(e);
      break;
    case 3:
      if (captureRightClick) onContextMenu(cm, e);
      else delayBlurEvent(cm);
      break;
  }
}

var lastClick, lastDoubleClick;
function leftButtonDown(cm, e, start) {
  if (sniff.ie) setTimeout(bind(ensureFocus, cm), 0);
  else cm.curOp.focus = activeElt();

  var now = +new Date, type;
  if (lastDoubleClick && lastDoubleClick.time > now - 400 && cmp(lastDoubleClick.pos, start) == 0) {
    type = "triple";
  } else if (lastClick && lastClick.time > now - 400 && cmp(lastClick.pos, start) == 0) {
    type = "double";
    lastDoubleClick = {time: now, pos: start};
  } else {
    type = "single";
    lastClick = {time: now, pos: start};
  }

  var sel = cm.doc.sel, modifier = mac ? e.metaKey : e.ctrlKey, contained;
  if (cm.options.dragDrop && dragAndDrop && !isReadOnly(cm) &&
      type == "single" && (contained = sel.contains(start)) > -1 &&
      (cmp((contained = sel.ranges[contained]).from(), start) < 0 || start.xRel > 0) &&
      (cmp(contained.to(), start) > 0 || start.xRel < 0))
    leftButtonStartDrag(cm, e, start, modifier);
  else
    leftButtonSelect(cm, e, start, type, modifier);
}

/**
 * Start a text drag. When it ends, see if any dragging actually
 * happen, and treat as a click if it didn't.
 */
function leftButtonStartDrag(cm: CodeMirror, e: MouseEvent, start: Pos, modifier) {
  var display = cm.display, startTime = +new Date;
  var dragEnd = operation(cm, function(e2) {
    if (webkit) display.scroller.draggable = false;
    cm.state.draggingText = false;
    off(document, "mouseup", dragEnd);
    off(display.scroller, "drop", dragEnd);
    if (Math.abs(e.clientX - e2.clientX) + Math.abs(e.clientY - e2.clientY) < 10) {
      e_preventDefault(e2);
      if (!modifier && +new Date - 200 < startTime)
        extendSelection(cm.doc, start);
      // Work around unexplainable focus problem in IE9 (#2127) and Chrome (#3081)
      if (sniff.webkit || sniff.ie && sniff.ie_version == 9)
        setTimeout(function() {document.body.focus(); display.input.focus();}, 20);
      else
        display.input.focus();
    }
  });
  // Let the drag handler handle this.
  if (sniff.webkit) display.scroller.draggable = true;
  cm.state.draggingText = dragEnd;
  // IE's approach to draggable
  if (display.scroller.dragDrop) display.scroller.dragDrop();
  on(document, "mouseup", dragEnd);
  on(display.scroller, "drop", dragEnd);
}

/** Normal selection, as opposed to text dragging. */
function leftButtonSelect(cm: CodeMirror, e: MouseEvent, start: Pos, type: string, addNew: boolean) {
  var display = cm.display, doc = cm.doc;
  e_preventDefault(e);

  var ourRange, ourIndex, startSel = doc.sel, ranges = startSel.ranges;
  if (addNew && !e.shiftKey) {
    ourIndex = doc.sel.contains(start);
    if (ourIndex > -1)
      ourRange = ranges[ourIndex];
    else
      ourRange = new EditorRange(start, start);
  } else {
    ourRange = doc.sel.primary();
    ourIndex = doc.sel.primIndex;
  }

  if (e.altKey) {
    type = "rect";
    if (!addNew) ourRange = new EditorRange(start, start);
    start = posFromMouse(cm, e, true, true);
    ourIndex = -1;
  } else if (type == "double") {
    var word = cm.findWordAt(start);
    if (cm.display.shift || doc.extend)
      ourRange = extendRange(doc, ourRange, word.anchor, word.head);
    else
      ourRange = word;
  } else if (type == "triple") {
    var line = new EditorRange(new Pos(start.line, 0), clipPos(doc, new Pos(start.line + 1, 0)));
    if (cm.display.shift || doc.extend)
      ourRange = extendRange(doc, ourRange, line.anchor, line.head);
    else
      ourRange = line;
  } else {
    ourRange = extendRange(doc, ourRange, start);
  }

  if (!addNew) {
    ourIndex = 0;
    setSelection(doc, new EditorSelection([ourRange], 0), sel_mouse);
    startSel = doc.sel;
  } else if (ourIndex == -1) {
    ourIndex = ranges.length;
    setSelection(doc, normalizeSelection(ranges.concat([ourRange]), ourIndex),
                 {scroll: false, origin: "*mouse"});
  } else if (ranges.length > 1 && ranges[ourIndex].empty() && type == "single" && !e.shiftKey) {
    setSelection(doc, normalizeSelection(ranges.slice(0, ourIndex).concat(ranges.slice(ourIndex + 1)), 0));
    startSel = doc.sel;
  } else {
    replaceOneSelection(doc, ourIndex, ourRange, sel_mouse);
  }

  var lastPos = start;
  function extendTo(pos) {
    if (cmp(lastPos, pos) == 0) return;
    lastPos = pos;

    if (type == "rect") {
      var ranges = [], tabSize = cm.options.tabSize;
      var startCol = countColumn(getLine(doc, start.line).text, start.ch, tabSize);
      var posCol = countColumn(getLine(doc, pos.line).text, pos.ch, tabSize);
      var left = Math.min(startCol, posCol), right = Math.max(startCol, posCol);
      for (var line = Math.min(start.line, pos.line), end = Math.min(cm.lastLine(), Math.max(start.line, pos.line));
           line <= end; line++) {
        var text = getLine(doc, line).text, leftPos = findColumn(text, left, tabSize);
        if (left == right)
          ranges.push(new Range(Pos(line, leftPos), Pos(line, leftPos)));
        else if (text.length > leftPos)
          ranges.push(new Range(Pos(line, leftPos), Pos(line, findColumn(text, right, tabSize))));
      }
      if (!ranges.length) ranges.push(new Range(start, start));
      setSelection(doc, normalizeSelection(startSel.ranges.slice(0, ourIndex).concat(ranges), ourIndex),
                   {origin: "*mouse", scroll: false});
      cm.scrollIntoView(pos);
    } else {
      var oldRange = ourRange;
      var anchor = oldRange.anchor, head = pos;
      if (type != "single") {
        if (type == "double")
          var range = cm.findWordAt(pos);
        else
          var range = new Range(Pos(pos.line, 0), clipPos(doc, Pos(pos.line + 1, 0)));
        if (cmp(range.anchor, anchor) > 0) {
          head = range.head;
          anchor = minPos(oldRange.from(), range.anchor);
        } else {
          head = range.anchor;
          anchor = maxPos(oldRange.to(), range.head);
        }
      }
      var ranges = startSel.ranges.slice(0);
      ranges[ourIndex] = new Range(clipPos(doc, anchor), head);
      setSelection(doc, normalizeSelection(ranges, ourIndex), sel_mouse);
    }
  }

  var editorSize = display.wrapper.getBoundingClientRect();
  // Used to ensure timeout re-tries don't fire when another extend
  // happened in the meantime (clearTimeout isn't reliable -- at
  // least on Chrome, the timeouts still happen even when cleared,
  // if the clear happens after their scheduled firing time).
  var counter = 0;

  function extend(e: MouseEvent) {
    var curCount = ++counter;
    var cur = posFromMouse(cm, e, true, type == "rect");
    if (!cur) return;
    if (cmp(cur, lastPos) != 0) {
      cm.curOp.focus = activeElt();
      extendTo(cur);
      var visible = visibleLines(display, doc);
      if (cur.line >= visible.to || cur.line < visible.from)
        setTimeout(operation(cm, function(){if (counter == curCount) extend(e);}), 150);
    } else {
      var outside = e.clientY < editorSize.top ? -20 : e.clientY > editorSize.bottom ? 20 : 0;
      if (outside) setTimeout(operation(cm, function() {
        if (counter != curCount) return;
        display.scroller.scrollTop += outside;
        extend(e);
      }), 50);
    }
  }

  function done(e: MouseEvent) {
    counter = Infinity;
    e_preventDefault(e);
    display.input.focus();
    off(document, "mousemove", move);
    off(document, "mouseup", up);
    doc.history.lastSelOrigin = null;
  }

  var move = operation(cm, function(e: MouseEvent) {
    if (!e_button(e)) done(e);
    else extend(e);
  });
  var up = operation(cm, done);
  on(document, "mousemove", move);
  on(document, "mouseup", up);
}

/**
 * Determines whether an event happened in the gutter, and fires the
 * handlers for the corresponding event.
 */
function gutterEvent(cm: CodeMirror, e: MouseEvent, type: string, prevent: boolean, signalfn: Function) {
  try { var mX = e.clientX, mY = e.clientY; }
  catch(e) { return false; }
  if (mX >= Math.floor(cm.display.gutters.getBoundingClientRect().right)) return false;
  if (prevent) e_preventDefault(e);

  var display = cm.display;
  var lineBox = display.lineDiv.getBoundingClientRect();

  if (mY > lineBox.bottom || !hasHandler(cm, type)) return e_defaultPrevented(e);
  mY -= lineBox.top - display.viewOffset;

  for (var i = 0; i < cm.options.gutters.length; ++i) {
    var g = display.gutters.childNodes[i];
    if (g && g.getBoundingClientRect().right >= mX) {
      var line = lineAtHeight(cm.doc, mY);
      var gutter = cm.options.gutters[i];
      signalfn(cm, type, cm, line, gutter, e);
      return e_defaultPrevented(e);
    }
  }
}

function clickInGutter(cm: CodeMirror, e: MouseEvent) {
  return gutterEvent(cm, e, "gutterClick", true, signalLater);
}

/**
 * Kludge to work around strange IE behavior where it'll sometimes
 * re-fire a series of drag-related events right after the drop (#1551)
 */
var lastDrop = 0;

function onDrop(e: DragEvent) {
  var cm = this;
  if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e))
    return;
  e_preventDefault(e);
  if (sniff.ie) lastDrop = +new Date;
  var pos = posFromMouse(cm, e, true), files = e.dataTransfer.files;
  if (!pos || isReadOnly(cm)) return;
  // Might be a file drop, in which case we simply extract the text
  // and insert it.
  if (files && files.length && (<any>window).FileReader && (<any>window).File) {
    var n = files.length, text = Array(n), read = 0;
    var loadFile = function(file, i) {
      var reader = new FileReader;
      reader.onload = operation(cm, function() {
        text[i] = reader.result;
        if (++read == n) {
          pos = clipPos(cm.doc, pos);
          // TODO: support CR/CRLF too
          var change = {from: pos, to: pos, text: splitLines(text.join("\n")), origin: "paste"};
          makeChange(cm.doc, change);
          setSelectionReplaceHistory(cm.doc, simpleSelection(pos, changeEnd(change)));
        }
      });
      reader.readAsText(file);
    };
    for (var i = 0; i < n; ++i) loadFile(files[i], i);
  } else { // Normal drop
    // Don't do a replace if the drop happened inside of the selected text.
    if (cm.state.draggingText && cm.doc.sel.contains(pos) > -1) {
      cm.state.draggingText(e);
      // Ensure the editor is re-focused
      setTimeout(function() {cm.display.input.focus();}, 20);
      return;
    }
    try {
      var text = e.dataTransfer.getData("Text");
      if (text) {
        if (cm.state.draggingText && !(mac ? e.altKey : e.ctrlKey))
          var selected = cm.listSelections();
        setSelectionNoUndo(cm.doc, simpleSelection(pos, pos));
        if (selected) for (var i = 0; i < selected.length; ++i)
          replaceRange(cm.doc, "", selected[i].anchor, selected[i].head, "drag");
        cm.replaceSelection(text, "around", "paste");
        cm.display.input.focus();
      }
    }
    catch(e){}
  }
}

function onDragStart(cm: CodeMirror, e: DragEvent) {
  if (sniff.ie && (!cm.state.draggingText || +new Date - lastDrop < 100)) { e_stop(e); return; }
  if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e)) return;

  e.dataTransfer.setData("Text", cm.getSelection());

  // Use dummy image instead of default browsers image.
  // Recent Safari (~6.0.2) have a tendency to segfault when this happens, so we don't do it there.
  if (e.dataTransfer.setDragImage && !sniff.safari) {
    var img = elt("img", null, null, "position: fixed; left: 0; top: 0;");
    img.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
    if (sniff.presto) {
      img.width = img.height = 1;
      cm.display.wrapper.appendChild(img);
      // Force a relayout, or Opera won't use our image for some obscure reason
      img._top = img.offsetTop;
    }
    (<any>e.dataTransfer).setDragImage(img, 0, 0);
    if (sniff.presto) img.parentNode.removeChild(img);
  }
}

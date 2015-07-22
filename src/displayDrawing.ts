function maybeClipScrollbars(cm: CodeMirror) {
  var display = cm.display;
  if (!display.scrollbarsClipped && display.scroller.offsetWidth) {
    display.nativeBarWidth = display.scroller.offsetWidth - display.scroller.clientWidth;
    display.heightForcer.style.height = scrollGap(cm) + "px";
    display.sizer.style.marginBottom = -display.nativeBarWidth + "px";
    display.sizer.style.borderRightWidth = scrollGap(cm) + "px";
    display.scrollbarsClipped = true;
  }
}

/**
 * Does the actual updating of the line display. Bails out
 * (returning false) when there is nothing to be done and forced is
 * false.
 */
function updateDisplayIfNeeded(cm: CodeMirror, update: DisplayUpdate) {
  var display = cm.display, doc = cm.doc;

  if (update.editorIsHidden) {
    resetView(cm);
    return false;
  }

  // Bail out if the visible area is already rendered and nothing changed.
  if (!update.force &&
      update.visible.from >= display.viewFrom && update.visible.to <= display.viewTo &&
      (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo) &&
      display.renderedView == display.view && countDirtyView(cm) == 0)
    return false;

  if (maybeUpdateLineNumberWidth(cm)) {
    resetView(cm);
    update.dims = getDimensions(cm);
  }

  // Compute a suitable new viewport (from & to)
  var end = doc.first + doc.size;
  var from = Math.max(update.visible.from - cm.options.viewportMargin, doc.first);
  var to = Math.min(end, update.visible.to + cm.options.viewportMargin);
  if (display.viewFrom < from && from - display.viewFrom < 20) from = Math.max(doc.first, display.viewFrom);
  if (display.viewTo > to && display.viewTo - to < 20) to = Math.min(end, display.viewTo);
  if (sawCollapsedSpans) {
    from = visualLineNo(cm.doc, from);
    to = visualLineEndNo(cm.doc, to);
  }

  var different = from != display.viewFrom || to != display.viewTo ||
      display.lastWrapHeight != update.wrapperHeight || display.lastWrapWidth != update.wrapperWidth;
  adjustView(cm, from, to);

  display.viewOffset = heightAtLine(getLine(cm.doc, display.viewFrom));
  // Position the mover div to align with the current scroll position
  cm.display.mover.style.top = display.viewOffset + "px";

  var toUpdate = countDirtyView(cm);
  if (!different && toUpdate == 0 && !update.force && display.renderedView == display.view &&
      (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo))
    return false;

  // For big changes, we hide the enclosing element during the
  // update, since that speeds up the operations on most browsers.
  var focused = activeElt();
  if (toUpdate > 4) display.lineDiv.style.display = "none";
  patchDisplay(cm, display.updateLineNumbers, update.dims);
  if (toUpdate > 4) display.lineDiv.style.display = "";
  display.renderedView = display.view;
  // There might have been a widget with a focused element that got
  // hidden or updated, if so re-focus it.
  if (focused && activeElt() != focused && focused.offsetHeight) focused.focus();

  // Prevent selection and cursors from interfering with the scroll
  // width and height.
  removeChildren(display.cursorDiv);
  removeChildren(display.selectionDiv);
  display.gutters.style.height = display.sizer.style.minHeight = 0;

  if (different) {
    display.lastWrapHeight = update.wrapperHeight;
    display.lastWrapWidth = update.wrapperWidth;
    startWorker(cm, 400);
  }

  display.updateLineNumbers = null;

  return true;
}

function postUpdateDisplay(cm: CodeMirror, update: DisplayUpdate) {
  var viewport = update.viewport;
  for (var first = true;; first = false) {
    if (!first || !cm.options.lineWrapping || update.oldDisplayWidth == displayWidth(cm)) {
      // Clip forced viewport to actual scrollable area.
      if (viewport && viewport.top != null)
        viewport = {top: Math.min(cm.doc.height + paddingVert(cm.display) - displayHeight(cm), viewport.top)};
      // Updated line heights might result in the drawn area not
      // actually covering the viewport. Keep looping until it does.
      update.visible = visibleLines(cm.display, cm.doc, viewport);
      if (update.visible.from >= cm.display.viewFrom && update.visible.to <= cm.display.viewTo)
        break;
    }
    if (!updateDisplayIfNeeded(cm, update)) break;
    updateHeightsInViewport(cm);
    var barMeasure = measureForScrollbars(cm);
    updateSelection(cm);
    setDocumentHeight(cm, barMeasure);
    updateScrollbars(cm, barMeasure);
  }

  update.signal(cm, "update", cm);
  if (cm.display.viewFrom != cm.display.reportedViewFrom || cm.display.viewTo != cm.display.reportedViewTo) {
    update.signal(cm, "viewportChange", cm, cm.display.viewFrom, cm.display.viewTo);
    cm.display.reportedViewFrom = cm.display.viewFrom; cm.display.reportedViewTo = cm.display.viewTo;
  }
}

function updateDisplaySimple(cm: CodeMirror, viewport: Viewport) {
  var update = new DisplayUpdate(cm, viewport);
  if (updateDisplayIfNeeded(cm, update)) {
    updateHeightsInViewport(cm);
    postUpdateDisplay(cm, update);
    var barMeasure = measureForScrollbars(cm);
    updateSelection(cm);
    setDocumentHeight(cm, barMeasure);
    updateScrollbars(cm, barMeasure);
    update.finish();
  }
}

function setDocumentHeight(cm: CodeMirror, measure) {
  cm.display.sizer.style.minHeight = measure.docHeight + "px";
  var total = measure.docHeight + cm.display.barHeight;
  cm.display.heightForcer.style.top = total + "px";
  cm.display.gutters.style.height = Math.max(total + scrollGap(cm), measure.clientHeight) + "px";
}

/**
 * Read the actual heights of the rendered lines, and update their
 * stored heights to match.
 */
function updateHeightsInViewport(cm: CodeMirror) {
  var display = cm.display;
  var prevBottom = display.lineDiv.offsetTop;
  for (var i = 0; i < display.view.length; i++) {
    var cur = display.view[i], height;
    if (cur.hidden) continue;
    if (sniff.ie && sniff.ie_version < 8) {
      var bot = cur.node.offsetTop + cur.node.offsetHeight;
      height = bot - prevBottom;
      prevBottom = bot;
    } else {
      var box = cur.node.getBoundingClientRect();
      height = box.bottom - box.top;
    }
    var diff = cur.line.height - height;
    if (height < 2) height = textHeight(display);
    if (diff > .001 || diff < -.001) {
      updateLineHeight(cur.line, height);
      updateWidgetHeight(cur.line);
      if (cur.rest) for (var j = 0; j < cur.rest.length; j++)
        updateWidgetHeight(cur.rest[j]);
    }
  }
}

// Read and store the height of line widgets associated with the
// given line.
function updateWidgetHeight(line) {
  if (line.widgets) for (var i = 0; i < line.widgets.length; ++i)
    line.widgets[i].height = line.widgets[i].node.offsetHeight;
}

// Do a bulk-read of the DOM positions and sizes needed to draw the
// view, so that we don't interleave reading and writing to the DOM.
function getDimensions(cm: CodeMirror): Dimensions {
  var d = cm.display, left = {}, width = {};
  var gutterLeft = d.gutters.clientLeft;
  for (var n = d.gutters.firstChild, i = 0; n; n = n.nextSibling, ++i) {
    left[cm.options.gutters[i]] = n.offsetLeft + n.clientLeft + gutterLeft;
    width[cm.options.gutters[i]] = n.clientWidth;
  }
  return {fixedPos: compensateForHScroll(d),
          gutterTotalWidth: d.gutters.offsetWidth,
          gutterLeft: left,
          gutterWidth: width,
          wrapperWidth: d.wrapper.clientWidth};
}

/**
 * Sync the actual display DOM structure with display.view, removing
 * nodes for lines that are no longer in view, and creating the ones
 * that are not there yet, and updating the ones that are out of
 * date.
 */
function patchDisplay(cm: CodeMirror, updateNumbersFrom: number, dims: Dimensions) {
  var display = cm.display, lineNumbers = cm.options.lineNumbers;
  var container = display.lineDiv, cur = container.firstChild;

  function rm(node) {
    var next = node.nextSibling;
    // Works around a throw-scroll bug in OS X Webkit
    if (webkit && mac && cm.display.currentWheelTarget == node)
      node.style.display = "none";
    else
      node.parentNode.removeChild(node);
    return next;
  }

  var view = display.view, lineN = display.viewFrom;
  // Loop over the elements in the view, syncing cur (the DOM nodes
  // in display.lineDiv) with the view as we go.
  for (var i = 0; i < view.length; i++) {
    var lineView = view[i];
    if (lineView.hidden) {
    } else if (!lineView.node || lineView.node.parentNode != container) { // Not drawn yet
      var node = buildLineElement(cm, lineView, lineN, dims);
      container.insertBefore(node, cur);
    } else { // Already drawn
      while (cur != lineView.node) cur = rm(cur);
      var updateNumber = lineNumbers && updateNumbersFrom != null &&
          updateNumbersFrom <= lineN && lineView.lineNumber;
      if (lineView.changes) {
        if (indexOf(lineView.changes, "gutter") > -1) updateNumber = false;
        updateLineForChanges(cm, lineView, lineN, dims);
      }
      if (updateNumber) {
        removeChildren(lineView.lineNumber);
        lineView.lineNumber.appendChild(document.createTextNode(lineNumberFor(cm.options, lineN)));
      }
      cur = lineView.node.nextSibling;
    }
    lineN += lineView.size;
  }
  while (cur) cur = rm(cur);
}

/**
 * When an aspect of a line changes, a string is added to
 * lineView.changes. This updates the relevant part of the line's
 * DOM structure.
 */
function updateLineForChanges(cm: CodeMirror, lineView: LineView, lineN: number, dims: Dimensions) {
  for (var j = 0; j < lineView.changes.length; j++) {
    var type = lineView.changes[j];
    if (type == "text") updateLineText(cm, lineView);
    else if (type == "gutter") updateLineGutter(cm, lineView, lineN, dims);
    else if (type == "class") updateLineClasses(lineView);
    else if (type == "widget") updateLineWidgets(cm, lineView, dims);
  }
  lineView.changes = null;
}

/**
 * Lines with gutter elements, widgets or a background class need to
 * be wrapped, and have the extra elements added to the wrapper div
 */
function ensureLineWrapped(lineView: LineView) {
  if (lineView.node == lineView.text) {
    lineView.node = elt("div", null, null, "position: relative");
    if (lineView.text.parentNode)
      lineView.text.parentNode.replaceChild(lineView.node, lineView.text);
    lineView.node.appendChild(lineView.text);
    if (ie && ie_version < 8) lineView.node.style.zIndex = 2;
  }
  return lineView.node;
}

function updateLineBackground(lineView: LineView) {
  var cls = lineView.bgClass ? lineView.bgClass + " " + (lineView.line.bgClass || "") : lineView.line.bgClass;
  if (cls) cls += " CodeMirror-linebackground";
  if (lineView.background) {
    if (cls) lineView.background.className = cls;
    else { lineView.background.parentNode.removeChild(lineView.background); lineView.background = null; }
  } else if (cls) {
    var wrap = ensureLineWrapped(lineView);
    lineView.background = wrap.insertBefore(elt("div", null, cls), wrap.firstChild);
  }
}

/**
 * Wrapper around buildLineContent which will reuse the structure
 * in display.externalMeasured when possible.
 */
function getLineContent(cm: CodeMirror, lineView: LineView) {
  var ext = cm.display.externalMeasured;
  if (ext && ext.line == lineView.line) {
    cm.display.externalMeasured = null;
    lineView.measure = ext.measure;
    return ext.built;
  }
  return buildLineContent(cm, lineView);
}

/**
 * Redraw the line's text. Interacts with the background and text
 * classes because the mode may output tokens that influence these
 * classes.
 */
function updateLineText(cm: CodeMirror, lineView: LineView) {
  var cls = lineView.text.className;
  var built = getLineContent(cm, lineView);
  if (lineView.text == lineView.node) lineView.node = built.pre;
  lineView.text.parentNode.replaceChild(built.pre, lineView.text);
  lineView.text = built.pre;
  if (built.bgClass != lineView.bgClass || built.textClass != lineView.textClass) {
    lineView.bgClass = built.bgClass;
    lineView.textClass = built.textClass;
    updateLineClasses(lineView);
  } else if (cls) {
    lineView.text.className = cls;
  }
}

function updateLineClasses(lineView: LineView) {
  updateLineBackground(lineView);
  if (lineView.line.wrapClass)
    ensureLineWrapped(lineView).className = lineView.line.wrapClass;
  else if (lineView.node != lineView.text)
    lineView.node.className = "";
  var textClass = lineView.textClass ? lineView.textClass + " " + (lineView.line.textClass || "") : lineView.line.textClass;
  lineView.text.className = textClass || "";
}

function updateLineGutter(cm: CodeMirror, lineView: LineView, lineN: number, dims: Dimensions) {
  if (lineView.gutter) {
    lineView.node.removeChild(lineView.gutter);
    lineView.gutter = null;
  }
  if (lineView.gutterBackground) {
    lineView.node.removeChild(lineView.gutterBackground);
    lineView.gutterBackground = null;
  }
  if (lineView.line.gutterClass) {
    var wrap = ensureLineWrapped(lineView);
    lineView.gutterBackground = elt("div", null, "CodeMirror-gutter-background " + lineView.line.gutterClass,
                                    "left: " + (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) +
                                    "px; width: " + dims.gutterTotalWidth + "px");
    wrap.insertBefore(lineView.gutterBackground, lineView.text);
  }
  var markers = lineView.line.gutterMarkers;
  if (cm.options.lineNumbers || markers) {
    var wrap = ensureLineWrapped(lineView);
    var gutterWrap = lineView.gutter = elt("div", null, "CodeMirror-gutter-wrapper", "left: " +
                                           (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) + "px");
    cm.display.input.setUneditable(gutterWrap);
    wrap.insertBefore(gutterWrap, lineView.text);
    if (lineView.line.gutterClass)
      gutterWrap.className += " " + lineView.line.gutterClass;
    if (cm.options.lineNumbers && (!markers || !markers["CodeMirror-linenumbers"]))
      lineView.lineNumber = gutterWrap.appendChild(
        elt("div", lineNumberFor(cm.options, lineN),
            "CodeMirror-linenumber CodeMirror-gutter-elt",
            "left: " + dims.gutterLeft["CodeMirror-linenumbers"] + "px; width: "
            + cm.display.lineNumInnerWidth + "px"));
    if (markers) for (var k = 0; k < cm.options.gutters.length; ++k) {
      var id = cm.options.gutters[k], found = markers.hasOwnProperty(id) && markers[id];
      if (found)
        gutterWrap.appendChild(elt("div", [found], "CodeMirror-gutter-elt", "left: " +
                                   dims.gutterLeft[id] + "px; width: " + dims.gutterWidth[id] + "px"));
    }
  }
}

function updateLineWidgets(cm: CodeMirror, lineView: LineView, dims: Dimensions) {
  if (lineView.alignable) lineView.alignable = null;
  for (var node = lineView.node.firstChild, next; node; node = next) {
    var next = node.nextSibling;
    if (node.className == "CodeMirror-linewidget")
      lineView.node.removeChild(node);
  }
  insertLineWidgets(cm, lineView, dims);
}

/** Build a line's DOM representation from scratch */
function buildLineElement(cm: CodeMirror, lineView: LineView, lineN: number, dims: Dimensions) {
  var built = getLineContent(cm, lineView);
  lineView.text = lineView.node = built.pre;
  if (built.bgClass) lineView.bgClass = built.bgClass;
  if (built.textClass) lineView.textClass = built.textClass;

  updateLineClasses(lineView);
  updateLineGutter(cm, lineView, lineN, dims);
  insertLineWidgets(cm, lineView, dims);
  return lineView.node;
}

/**
 * A lineView may contain multiple logical lines (when merged by
 * collapsed spans). The widgets for all of them need to be drawn.
 */
function insertLineWidgets(cm: CodeMirror, lineView: LineView, dims: Dimensions) {
  insertLineWidgetsFor(cm, lineView.line, lineView, dims, true);
  if (lineView.rest) for (var i = 0; i < lineView.rest.length; i++)
    insertLineWidgetsFor(cm, lineView.rest[i], lineView, dims, false);
}

function insertLineWidgetsFor(cm: CodeMirror, line: Line, lineView: LineView, dims: Dimensions, allowAbove: boolean) {
  if (!line.widgets) return;
  var wrap = ensureLineWrapped(lineView);
  for (var i = 0, ws = line.widgets; i < ws.length; ++i) {
    var widget = ws[i], node = elt("div", [widget.node], "CodeMirror-linewidget");
    if (!widget.handleMouseEvents) node.setAttribute("cm-ignore-events", "true");
    positionLineWidget(widget, node, lineView, dims);
    cm.display.input.setUneditable(node);
    if (allowAbove && widget.above)
      wrap.insertBefore(node, lineView.gutter || lineView.text);
    else
      wrap.appendChild(node);
    signalLater(widget, "redraw");
  }
}

function positionLineWidget(widget, node, lineView: LineView, dims: Dimensions) {
  if (widget.noHScroll) {
    (lineView.alignable || (lineView.alignable = [])).push(node);
    var width = dims.wrapperWidth;
    node.style.left = dims.fixedPos + "px";
    if (!widget.coverGutter) {
      width -= dims.gutterTotalWidth;
      node.style.paddingLeft = dims.gutterTotalWidth + "px";
    }
    node.style.width = width + "px";
  }
  if (widget.coverGutter) {
    node.style.zIndex = 5;
    node.style.position = "relative";
    if (!widget.noHScroll) node.style.marginLeft = -dims.gutterTotalWidth + "px";
  }
}

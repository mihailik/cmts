// POSITION MEASUREMENT

function paddingTop(display: Display) {return display.lineSpace.offsetTop;}
function paddingVert(display: Display) {return display.mover.offsetHeight - display.lineSpace.offsetHeight;}
function paddingH(display: Display) {
  if (display.cachedPaddingH) return display.cachedPaddingH;
  var e = removeChildrenAndAdd(display.measure, elt("pre", "x"));
  var style = window.getComputedStyle ? window.getComputedStyle(e) : e.currentStyle;
  var data = {left: parseInt(style.paddingLeft), right: parseInt(style.paddingRight)};
  if (!isNaN(data.left) && !isNaN(data.right)) display.cachedPaddingH = data;
  return data;
}

function scrollGap(cm: CodeMirror) { return scrollerGap - cm.display.nativeBarWidth; }
function displayWidth(cm: CodeMirror) {
  return cm.display.scroller.clientWidth - scrollGap(cm) - cm.display.barWidth;
}
function displayHeight(cm: CodeMirror) {
  return cm.display.scroller.clientHeight - scrollGap(cm) - cm.display.barHeight;
}

/**
 * Ensure the lineView.wrapping.heights array is populated. This is
 * an array of bottom offsets for the lines that make up a drawn
 * line. When lineWrapping is on, there might be more than one
 * height.
 */
function ensureLineHeights(cm: CodeMirror, lineView: LineView, rect: Rect) {
  var wrapping = cm.options.lineWrapping;
  var curWidth = wrapping && displayWidth(cm);
  if (!lineView.measure.heights || wrapping && lineView.measure.width != curWidth) {
    var heights = lineView.measure.heights = [];
    if (wrapping) {
      lineView.measure.width = curWidth;
      var rects = lineView.text.firstChild.getClientRects();
      for (var i = 0; i < rects.length - 1; i++) {
        var cur = rects[i], next = rects[i + 1];
        if (Math.abs(cur.bottom - next.bottom) > 2)
          heights.push((cur.bottom + next.top) / 2 - rect.top);
      }
    }
    heights.push(rect.bottom - rect.top);
  }
}

/**
 * Find a line map (mapping character offsets to text nodes) and a
 * measurement cache for the given line number. (A line view might
 * contain multiple lines when collapsed ranges are present.)
 */
function mapFromLineView(lineView: LineView, line: Line, lineN: number) {
  if (lineView.line == line)
    return {map: lineView.measure.map, cache: lineView.measure.cache};
  for (var i = 0; i < lineView.rest.length; i++)
    if (lineView.rest[i] == line)
      return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i]};
  for (var i = 0; i < lineView.rest.length; i++)
    if (lineNo(lineView.rest[i]) > lineN)
      return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i], before: true};
}

/**
 * Render a line into the hidden node display.externalMeasured. Used
 * when measurement is needed for a line that's not in the viewport.
 */
function updateExternalMeasurement(cm: CodeMirror, line: Line) {
  line = visualLine(line);
  var lineN = lineNo(line);
  var view = cm.display.externalMeasured = new LineView(cm.doc, line, lineN);
  view.lineN = lineN;
  var built = view.built = buildLineContent(cm, view);
  view.text = built.pre;
  removeChildrenAndAdd(cm.display.lineMeasure, built.pre);
  return view;
}

/**
 * Get a {top, bottom, left, right} box (in line-local coordinates)
 * for a given character.
 */
function measureChar(cm: CodeMirror, line: number, ch: number, bias) {
  return measureCharPrepared(cm, prepareMeasureForLine(cm, line), ch, bias);
}

/** Find a line view that corresponds to the given line number. */
function findViewForLine(cm: CodeMirror, lineN: number) {
  if (lineN >= cm.display.viewFrom && lineN < cm.display.viewTo)
    return cm.display.view[findViewIndex(cm, lineN)];
  var ext = cm.display.externalMeasured;
  if (ext && lineN >= ext.lineN && lineN < ext.lineN + ext.size)
    return ext;
}

/**
 * Measurement can be split in two steps, the set-up work that
 * applies to the whole line, and the measurement of the actual
 * character. Functions like coordsChar, that need to do a lot of
 * measurements in a row, can thus ensure that the set-up work is
 * only done once.
 */
function prepareMeasureForLine(cm: CodeMirror, line: Line) {
  var lineN = lineNo(line);
  var view = findViewForLine(cm, lineN);
  if (view && !view.text) {
    view = null;
  } else if (view && view.changes) {
    updateLineForChanges(cm, view, lineN, getDimensions(cm));
    cm.curOp.forceUpdate = true;
  }
  if (!view)
    view = updateExternalMeasurement(cm, line);

  var info = mapFromLineView(view, line, lineN);
  return {
    line: line, view: view, rect: null,
    map: info.map, cache: info.cache, before: info.before,
    hasHeights: false
  };
}

/**
 * Given a prepared measurement object, measures the position of an
 * actual character (or fetches it from the cache).
 */
function measureCharPrepared(cm: CodeMirror, prepared, ch: number, bias, varHeight: boolean) {
  if (prepared.before) ch = -1;
  var key = ch + (bias || ""), found;
  if (prepared.cache.hasOwnProperty(key)) {
    found = prepared.cache[key];
  } else {
    if (!prepared.rect)
      prepared.rect = prepared.view.text.getBoundingClientRect();
    if (!prepared.hasHeights) {
      ensureLineHeights(cm, prepared.view, prepared.rect);
      prepared.hasHeights = true;
    }
    found = measureCharInner(cm, prepared, ch, bias);
    if (!found.bogus) prepared.cache[key] = found;
  }
  return {left: found.left, right: found.right,
          top: varHeight ? found.rtop : found.top,
          bottom: varHeight ? found.rbottom : found.bottom};
}

var nullRect = {left: 0, right: 0, top: 0, bottom: 0};

function nodeAndOffsetInLineMap(map, ch: number, bias) {
  var node, start: number, end: number, collapse: string;
  // First, search the line map for the text node corresponding to,
  // or closest to, the target character.
  for (var i = 0; i < map.length; i += 3) {
    var mStart = map[i], mEnd = map[i + 1];
    if (ch < mStart) {
      start = 0; end = 1;
      collapse = "left";
    } else if (ch < mEnd) {
      start = ch - mStart;
      end = start + 1;
    } else if (i == map.length - 3 || ch == mEnd && map[i + 3] > ch) {
      end = mEnd - mStart;
      start = end - 1;
      if (ch >= mEnd) collapse = "right";
    }
    if (start != null) {
      node = map[i + 2];
      if (mStart == mEnd && bias == (node.insertLeft ? "left" : "right"))
        collapse = bias;
      if (bias == "left" && start == 0)
        while (i && map[i - 2] == map[i - 3] && map[i - 1].insertLeft) {
          node = map[(i -= 3) + 2];
          collapse = "left";
        }
      if (bias == "right" && start == mEnd - mStart)
        while (i < map.length - 3 && map[i + 3] == map[i + 4] && !map[i + 5].insertLeft) {
          node = map[(i += 3) + 2];
          collapse = "right";
        }
      break;
    }
  }
  return {node: node, start: start, end: end, collapse: collapse, coverStart: mStart, coverEnd: mEnd};
}

function measureCharInner(cm: CodeMirror, prepared, ch: number, bias) {
  var place = nodeAndOffsetInLineMap(prepared.map, ch, bias);
  var node = place.node, start = place.start, end = place.end, collapse = place.collapse;

  var rect: Rect;
  if (node.nodeType == 3) { // If it is a text node, use a range to retrieve the coordinates.
    for (var i = 0; i < 4; i++) { // Retry a maximum of 4 times when nonsense rectangles are returned
      while (start && isExtendingChar(prepared.line.text.charAt(place.coverStart + start))) --start;
      while (place.coverStart + end < place.coverEnd && isExtendingChar(prepared.line.text.charAt(place.coverStart + end))) ++end;
      if (sniff.ie && sniff.ie_version < 9 && start == 0 && end == place.coverEnd - place.coverStart) {
        rect = node.parentNode.getBoundingClientRect();
      } else if (sniff.ie && cm.options.lineWrapping) {
        var rects = range(node, start, end).getClientRects();
        if (rects.length)
          rect = rects[bias == "right" ? rects.length - 1 : 0];
        else
          rect = nullRect;
      } else {
        rect = range(node, start, end).getBoundingClientRect() || nullRect;
      }
      if (rect.left || rect.right || start == 0) break;
      end = start;
      start = start - 1;
      collapse = "right";
    }
    if (sniff.ie && sniff.ie_version < 11) rect = maybeUpdateRectForZooming(cm.display.measure, rect);
  } else { // If it is a widget, simply get the box for the whole widget.
    if (start > 0) collapse = bias = "right";
    var rects;
    if (cm.options.lineWrapping && (rects = node.getClientRects()).length > 1)
      rect = rects[bias == "right" ? rects.length - 1 : 0];
    else
      rect = node.getBoundingClientRect();
  }
  if (sniff.ie && sniff.ie_version < 9 && !start && (!rect || !rect.left && !rect.right)) {
    var rSpan = node.parentNode.getClientRects()[0];
    if (rSpan)
      rect = {left: rSpan.left, right: rSpan.left + charWidth(cm.display), top: rSpan.top, bottom: rSpan.bottom};
    else
      rect = nullRect;
  }

  var rtop = rect.top - prepared.rect.top, rbot = rect.bottom - prepared.rect.top;
  var mid = (rtop + rbot) / 2;
  var heights = prepared.view.measure.heights;
  for (var i = 0; i < heights.length - 1; i++)
    if (mid < heights[i]) break;
  var top = i ? heights[i - 1] : 0, bot = heights[i];
  var result = {left: (collapse == "right" ? rect.right : rect.left) - prepared.rect.left,
                right: (collapse == "left" ? rect.left : rect.right) - prepared.rect.left,
                top: top, bottom: bot};
  if (!rect.left && !rect.right) result.bogus = true;
  if (!cm.options.singleCursorHeightPerLine) { result.rtop = rtop; result.rbottom = rbot; }

  return result;
}

/**
 * Work around problem with bounding client rects on ranges being
 * returned incorrectly when zoomed on IE10 and below.
 */
function maybeUpdateRectForZooming(measure, rect: Rect) {
  if (!window.screen || screen.logicalXDPI == null ||
      screen.logicalXDPI == screen.deviceXDPI || !hasBadZoomedRects(measure))
    return rect;
  var scaleX = screen.logicalXDPI / screen.deviceXDPI;
  var scaleY = screen.logicalYDPI / screen.deviceYDPI;
  return {left: rect.left * scaleX, right: rect.right * scaleX,
          top: rect.top * scaleY, bottom: rect.bottom * scaleY};
}

function clearLineMeasurementCacheFor(lineView: Lineiew) {
  if (lineView.measure) {
    lineView.measure.cache = {};
    lineView.measure.heights = null;
    if (lineView.rest) for (var i = 0; i < lineView.rest.length; i++)
      lineView.measure.caches[i] = {};
  }
}

function clearLineMeasurementCache(cm: CodeMirror) {
  cm.display.externalMeasure = null;
  removeChildren(cm.display.lineMeasure);
  for (var i = 0; i < cm.display.view.length; i++)
    clearLineMeasurementCacheFor(cm.display.view[i]);
}

function clearCaches(cm: CodeMirror) {
  clearLineMeasurementCache(cm);
  cm.display.cachedCharWidth = cm.display.cachedTextHeight = cm.display.cachedPaddingH = null;
  if (!cm.options.lineWrapping) cm.display.maxLineChanged = true;
  cm.display.lineNumChars = null;
}

function pageScrollX() { return window.pageXOffset || (document.documentElement || document.body).scrollLeft; }
function pageScrollY() { return window.pageYOffset || (document.documentElement || document.body).scrollTop; }

/**
 * Converts a {top, bottom, left, right} box from line-local
 * coordinates into another coordinate system. Context may be one of
 * "line", "div" (display.lineDiv), "local"/null (editor), "window",
 * or "page".
 */
function intoCoordSystem(cm: CodeMirror, lineObj: Line, rect: Rect, context) {
  if (lineObj.widgets) for (var i = 0; i < lineObj.widgets.length; ++i) if (lineObj.widgets[i].above) {
    var size = widgetHeight(lineObj.widgets[i]);
    rect.top += size; rect.bottom += size;
  }
  if (context == "line") return rect;
  if (!context) context = "local";
  var yOff = heightAtLine(lineObj);
  if (context == "local") yOff += paddingTop(cm.display);
  else yOff -= cm.display.viewOffset;
  if (context == "page" || context == "window") {
    var lOff = cm.display.lineSpace.getBoundingClientRect();
    yOff += lOff.top + (context == "window" ? 0 : pageScrollY());
    var xOff = lOff.left + (context == "window" ? 0 : pageScrollX());
    rect.left += xOff; rect.right += xOff;
  }
  rect.top += yOff; rect.bottom += yOff;
  return rect;
}

/**
 * Coverts a box from "div" coords to another coordinate system.
 * Context may be "window", "page", "div", or "local"/null.
 */
function fromCoordSystem(cm: CodeMirror, coords: { left: number; top: number; }, context) {
  if (context == "div") return coords;
  var left = coords.left, top = coords.top;
  // First move into "page" coordinate system
  if (context == "page") {
    left -= pageScrollX();
    top -= pageScrollY();
  } else if (context == "local" || !context) {
    var localBox = cm.display.sizer.getBoundingClientRect();
    left += localBox.left;
    top += localBox.top;
  }

  var lineSpaceBox = cm.display.lineSpace.getBoundingClientRect();
  return {left: left - lineSpaceBox.left, top: top - lineSpaceBox.top};
}

function charCoords(cm: CodeMirror, pos: Pos, context, lineObj: Line, bias) {
  if (!lineObj) lineObj = getLine(cm.doc, pos.line);
  return intoCoordSystem(cm, lineObj, measureChar(cm, lineObj, pos.ch, bias), context);
}

// Returns a box for a given cursor position, which may have an
// 'other' property containing the position of the secondary cursor
// on a bidi boundary.
function cursorCoords(cm: CodeMirror, pos: Pos, context, lineObj: Line, preparedMeasure, varHeight: boolean) {
  lineObj = lineObj || getLine(cm.doc, pos.line);
  if (!preparedMeasure) preparedMeasure = prepareMeasureForLine(cm, lineObj);
  function get(ch, right) {
    var m = measureCharPrepared(cm, preparedMeasure, ch, right ? "right" : "left", varHeight);
    if (right) m.left = m.right; else m.right = m.left;
    return intoCoordSystem(cm, lineObj, m, context);
  }
  function getBidi(ch: number, partPos: number) {
    var part = order[partPos], right = part.level % 2;
    if (ch == bidiLeft(part) && partPos && part.level < order[partPos - 1].level) {
      part = order[--partPos];
      ch = bidiRight(part) - (part.level % 2 ? 0 : 1);
      right = true;
    } else if (ch == bidiRight(part) && partPos < order.length - 1 && part.level < order[partPos + 1].level) {
      part = order[++partPos];
      ch = bidiLeft(part) - part.level % 2;
      right = false;
    }
    if (right && ch == part.to && ch > part.from) return get(ch - 1);
    return get(ch, right);
  }
  var order = getOrder(lineObj), ch = pos.ch;
  if (!order) return get(ch);
  var partPos = getBidiPartAt(order, ch);
  var val = getBidi(ch, partPos);
  if (bidiOther != null) val.other = getBidi(ch, bidiOther);
  return val;
}

/**
 * Used to cheaply estimate the coordinates for a position. Used for
 * intermediate scroll updates.
 */
function estimateCoords(cm: CodeMirror, pos: Pos) {
  var left = 0, pos = clipPos(cm.doc, pos);
  if (!cm.options.lineWrapping) left = charWidth(cm.display) * pos.ch;
  var lineObj = getLine(cm.doc, pos.line);
  var top = heightAtLine(lineObj) + paddingTop(cm.display);
  return {left: left, right: left, top: top, bottom: top + lineObj.height};
}

/**
 * Positions returned by coordsChar contain some extra information.
 * xRel is the relative x position of the input coordinates compared
 * to the found position (so xRel > 0 means the coordinates are to
 * the right of the character position, for example). When outside
 * is true, that means the coordinates lie outside the line's
 * vertical range.
 */
function PosWithInfo(line: number, ch: number, outside, xRel) {
  return {
    line, ch,
    xRel,
    outside
  };
}

/**
 * Compute the character position closest to the given coordinates.
 * Input must be lineSpace-local ("div" coordinate system).
 */
function coordsChar(cm: CodeMirror, x: number, y: number) {
  var doc = cm.doc;
  y += cm.display.viewOffset;
  if (y < 0) return PosWithInfo(doc.first, 0, true, -1);
  var lineN = lineAtHeight(doc, y), last = doc.first + doc.size - 1;
  if (lineN > last)
    return PosWithInfo(doc.first + doc.size - 1, getLine(doc, last).contentLength(), true, 1);
  if (x < 0) x = 0;

  var lineObj = getLine(doc, lineN);
  for (;;) {
    var found = coordsCharInner(cm, lineObj, lineN, x, y);
    var merged = collapsedSpanAtEnd(lineObj);
    var mergedPos = merged && merged.find(0, true);
    if (merged && (found.ch > mergedPos.from.ch || found.ch == mergedPos.from.ch && found.xRel > 0))
      lineN = lineNo(lineObj = mergedPos.to.line);
    else
      return found;
  }
}

function coordsCharInner(cm: CodeMirror, lineObj: Line, lineNo: number, x: number, y: number) {
  var innerOff = y - heightAtLine(lineObj);
  var wrongLine = false, adjust = 2 * cm.display.wrapper.clientWidth;
  var preparedMeasure = prepareMeasureForLine(cm, lineObj);

  function getX(ch: number) {
    var sp = cursorCoords(cm, Pos(lineNo, ch), "line", lineObj, preparedMeasure);
    wrongLine = true;
    if (innerOff > sp.bottom) return sp.left - adjust;
    else if (innerOff < sp.top) return sp.left + adjust;
    else wrongLine = false;
    return sp.left;
  }

  var bidi = getOrder(lineObj), dist = lineObj.contentLength();
  var from = lineLeft(lineObj), to = lineRight(lineObj);
  var fromX = getX(from), fromOutside = wrongLine, toX = getX(to), toOutside = wrongLine;

  if (x > toX) return PosWithInfo(lineNo, to, toOutside, 1);
  // Do a binary search between these bounds.
  for (;;) {
    if (bidi ? to == from || to == moveVisually(lineObj, from, 1) : to - from <= 1) {
      var ch = x < fromX || x - fromX <= toX - x ? from : to;
      var xDiff = x - (ch == from ? fromX : toX);
      while (isExtendingChar(lineObj.text.charAt(ch))) ++ch;
      var pos = PosWithInfo(lineNo, ch, ch == from ? fromOutside : toOutside,
                            xDiff < -1 ? -1 : xDiff > 1 ? 1 : 0);
      return pos;
    }
    var step = Math.ceil(dist / 2), middle = from + step;
    if (bidi) {
      middle = from;
      for (var i = 0; i < step; ++i) middle = moveVisually(lineObj, middle, 1);
    }
    var middleX = getX(middle);
    if (middleX > x) {to = middle; toX = middleX; if (toOutside = wrongLine) toX += 1000; dist = step;}
    else {from = middle; fromX = middleX; fromOutside = wrongLine; dist -= step;}
  }
}

var measureText;
/** Compute the default text height. */
function textHeight(display: Display) {
  if (display.cachedTextHeight != null) return display.cachedTextHeight;
  if (measureText == null) {
    measureText = elt("pre");
    // Measure a bunch of lines, for browsers that compute
    // fractional heights.
    for (var i = 0; i < 49; ++i) {
      measureText.appendChild(document.createTextNode("x"));
      measureText.appendChild(elt("br"));
    }
    measureText.appendChild(document.createTextNode("x"));
  }
  removeChildrenAndAdd(display.measure, measureText);
  var height = measureText.offsetHeight / 50;
  if (height > 3) display.cachedTextHeight = height;
  removeChildren(display.measure);
  return height || 1;
}

/** Compute the default character width. */
function charWidth(display: Display) {
  if (display.cachedCharWidth != null) return display.cachedCharWidth;
  var anchor = elt("span", "xxxxxxxxxx");
  var pre = elt("pre", [anchor]);
  removeChildrenAndAdd(display.measure, pre);
  var rect = anchor.getBoundingClientRect(), width = (rect.right - rect.left) / 10;
  if (width > 2) display.cachedCharWidth = width;
  return width || 10;
}

// SCROLL EVENTS

/**
 * Sync the scrollable area and scrollbars, ensure the viewport
 * covers the visible area.
 */
function setScrollTop(cm: CodeMirror, val: number) {
  if (Math.abs(cm.doc.scrollTop - val) < 2) return;
  cm.doc.scrollTop = val;
  if (!gecko) updateDisplaySimple(cm, {top: val});
  if (cm.display.scroller.scrollTop != val) cm.display.scroller.scrollTop = val;
  cm.display.scrollbars.setScrollTop(val);
  if (gecko) updateDisplaySimple(cm);
  startWorker(cm, 100);
}

/**
 * Sync scroller and scrollbar, ensure the gutter elements are
 * aligned.
 */
function setScrollLeft(cm: CodeMirror, val: number, isScroller?: boolean) {
  if (isScroller ? val == cm.doc.scrollLeft : Math.abs(cm.doc.scrollLeft - val) < 2) return;
  val = Math.min(val, cm.display.scroller.scrollWidth - cm.display.scroller.clientWidth);
  cm.doc.scrollLeft = val;
  alignHorizontally(cm);
  if (cm.display.scroller.scrollLeft != val) cm.display.scroller.scrollLeft = val;
  cm.display.scrollbars.setScrollLeft(val);
}

// Since the delta values reported on mouse wheel events are
// unstandardized between browsers and even browser versions, and
// generally horribly unpredictable, this code starts by measuring
// the scroll effect that the first few mouse wheel events have,
// and, from that, detects the way it can convert deltas to pixel
// offsets afterwards.
//
// The reason we want to know the amount a wheel event will scroll
// is that it gives us a chance to update the display before the
// actual scrolling happens, reducing flickering.

var wheelSamples = 0, wheelPixelsPerUnit: number = null;
// Fill in a browser-detected starting value on browsers where we
// know one. These don't have to be accurate -- the result of them
// being wrong would just be a slight flicker on the first wheel
// scroll (if it is large enough).
if (sniff.ie) wheelPixelsPerUnit = -.53;
else if (sniff.gecko) wheelPixelsPerUnit = 15;
else if (sniff.chrome) wheelPixelsPerUnit = -.7;
else if (sniff.safari) wheelPixelsPerUnit = -1/3;

var wheelEventDelta = function(e: MouseWheelEvent) {
  var dx = e.wheelDeltaX, dy = e.wheelDeltaY;
  if (dx == null && e.detail && e.axis == e.HORIZONTAL_AXIS) dx = e.detail;
  if (dy == null && e.detail && e.axis == e.VERTICAL_AXIS) dy = e.detail;
  else if (dy == null) dy = e.wheelDelta;
  return {x: dx, y: dy};
};


function onScrollWheel(cm: CodeMirror, e: MouseWheelEvent) {
  var delta = wheelEventDelta(e), dx = delta.x, dy = delta.y;

  var display = cm.display, scroll = display.scroller;
  // Quit if there's nothing to scroll here
  if (!(dx && scroll.scrollWidth > scroll.clientWidth ||
        dy && scroll.scrollHeight > scroll.clientHeight)) return;

  // Webkit browsers on OS X abort momentum scrolls when the target
  // of the scroll event is removed from the scrollable element.
  // This hack (see related code in patchDisplay) makes sure the
  // element is kept around.
  if (dy && sniff.mac && sniff.webkit) {
    outer: for (var cur = <HTMLElement>e.target, view = display.view; cur != scroll; cur = <HTMLElement>cur.parentNode) {
      for (var i = 0; i < view.length; i++) {
        if (view[i].node == cur) {
          cm.display.currentWheelTarget = cur;
          break outer;
        }
      }
    }
  }

  // On some browsers, horizontal scrolling will cause redraws to
  // happen before the gutter has been realigned, causing it to
  // wriggle around in a most unseemly way. When we have an
  // estimated pixels/delta value, we just handle horizontal
  // scrolling entirely here. It'll be slightly off from native, but
  // better than glitching out.
  if (dx && !sniff.gecko && !sniff.presto && wheelPixelsPerUnit != null) {
    if (dy)
      setScrollTop(cm, Math.max(0, Math.min(scroll.scrollTop + dy * wheelPixelsPerUnit, scroll.scrollHeight - scroll.clientHeight)));
    setScrollLeft(cm, Math.max(0, Math.min(scroll.scrollLeft + dx * wheelPixelsPerUnit, scroll.scrollWidth - scroll.clientWidth)));
    e_preventDefault(e);
    display.wheelStartX = null; // Abort measurement, if in progress
    return;
  }

  // 'Project' the visible viewport to cover the area that is being
  // scrolled into view (if we know enough to estimate it).
  if (dy && wheelPixelsPerUnit != null) {
    var pixels = dy * wheelPixelsPerUnit;
    var top = cm.doc.scrollTop, bot = top + display.wrapper.clientHeight;
    if (pixels < 0) top = Math.max(0, top + pixels - 50);
    else bot = Math.min(cm.doc.height, bot + pixels + 50);
    updateDisplaySimple(cm, {top: top, bottom: bot});
  }

  if (wheelSamples < 20) {
    if (display.wheelStartX == null) {
      display.wheelStartX = scroll.scrollLeft; display.wheelStartY = scroll.scrollTop;
      display.wheelDX = dx; display.wheelDY = dy;
      setTimeout(function() {
        if (display.wheelStartX == null) return;
        var movedX = scroll.scrollLeft - display.wheelStartX;
        var movedY = scroll.scrollTop - display.wheelStartY;
        var sample = (movedY && display.wheelDY && movedY / display.wheelDY) ||
            (movedX && display.wheelDX && movedX / display.wheelDX);
        display.wheelStartX = display.wheelStartY = null;
        if (!sample) return;
        wheelPixelsPerUnit = (wheelPixelsPerUnit * wheelSamples + sample) / (wheelSamples + 1);
        ++wheelSamples;
      }, 200);
    } else {
      display.wheelDX += dx; display.wheelDY += dy;
    }
  }
}

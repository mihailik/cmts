// EVENT HANDLERS

/** Attach the necessary event handlers when initializing the editor */
function registerEventHandlers(cm: CodeMirror) {
  var d = cm.display;
  on(d.scroller, "mousedown", operation(cm, onMouseDown));
  // Older IE's will not fire a second mousedown for a double click
  if (sniff.ie && sniff.ie_version < 11)
    on(d.scroller, "dblclick", operation(cm, function(e) {
      if (signalDOMEvent(cm, e)) return;
      var pos = posFromMouse(cm, e);
      if (!pos || clickInGutter(cm, e) || eventInWidget(cm.display, e)) return;
      e_preventDefault(e);
      var word = cm.findWordAt(pos);
      extendSelection(cm.doc, word.anchor, word.head);
    }));
  else
    on(d.scroller, "dblclick", function(e) { signalDOMEvent(cm, e) || e_preventDefault(e); });
  // Some browsers fire contextmenu *after* opening the menu, at
  // which point we can't mess with it anymore. Context menu is
  // handled in onMouseDown for these browsers.
  if (!sniff.captureRightClick) on(d.scroller, "contextmenu", function(e) {onContextMenu(cm, e);});

  // Used to suppress mouse event handling when a touch happens
  var touchFinished;
  var prevTouch = <TouchState>{end: 0};
  function finishTouch() {
    if (d.activeTouch) {
      touchFinished = setTimeout(function() {d.activeTouch = null;}, 1000);
      prevTouch = d.activeTouch;
      prevTouch.end = +new Date;
    }
  };
  function isMouseLikeTouchEvent(e) {
    if (e.touches.length != 1) return false;
    var touch = e.touches[0];
    return touch.radiusX <= 1 && touch.radiusY <= 1;
  }
  function farAway(touch, other) {
    if (other.left == null) return true;
    var dx = other.left - touch.left, dy = other.top - touch.top;
    return dx * dx + dy * dy > 20 * 20;
  }
  on(d.scroller, "touchstart", function(e) {
    if (!isMouseLikeTouchEvent(e)) {
      clearTimeout(touchFinished);
      var now = +new Date;
      d.activeTouch = {
        start: now,
        moved: false,
        prev: now - prevTouch.end <= 300 ? prevTouch : null,
        end: null,
        left: null,
        top: null
      };
      if (e.touches.length == 1) {
        d.activeTouch.left = e.touches[0].pageX;
        d.activeTouch.top = e.touches[0].pageY;
      }
    }
  });
  on(d.scroller, "touchmove", function() {
    if (d.activeTouch) d.activeTouch.moved = true;
  });
  on(d.scroller, "touchend", function(e) {
    var touch = d.activeTouch;
    if (touch && !eventInWidget(d, e) && touch.left != null &&
        !touch.moved && new Date - touch.start < 300) {
      var pos = cm.coordsChar(d.activeTouch, "page"), range;
      if (!touch.prev || farAway(touch, touch.prev)) // Single tap
        range = new Range(pos, pos);
      else if (!touch.prev.prev || farAway(touch, touch.prev.prev)) // Double tap
        range = cm.findWordAt(pos);
      else // Triple tap
        range = new Range(Pos(pos.line, 0), clipPos(cm.doc, Pos(pos.line + 1, 0)));
      cm.setSelection(range.anchor, range.head);
      cm.focus();
      e_preventDefault(e);
    }
    finishTouch();
  });
  on(d.scroller, "touchcancel", finishTouch);

  // Sync scrolling between fake scrollbars and real scrollable
  // area, ensure viewport is updated when scrolling.
  on(d.scroller, "scroll", function() {
    if (d.scroller.clientHeight) {
      setScrollTop(cm, d.scroller.scrollTop);
      setScrollLeft(cm, d.scroller.scrollLeft, true);
      signal(cm, "scroll", cm);
    }
  });

  // Listen to wheel events in order to try and update the viewport on time.
  on(d.scroller, "mousewheel", function(e){onScrollWheel(cm, e);});
  on(d.scroller, "DOMMouseScroll", function(e){onScrollWheel(cm, e);});

  // Prevent wrapper from ever scrolling
  on(d.wrapper, "scroll", function() { d.wrapper.scrollTop = d.wrapper.scrollLeft = 0; });

  d.dragFunctions = {
    simple: function(e) {if (!signalDOMEvent(cm, e)) e_stop(e);},
    start: function(e){onDragStart(cm, e);},
    drop: operation(cm, onDrop)
  };

  var inp = d.input.getField();
  on(inp, "keyup", function(e) { onKeyUp.call(cm, e); });
  on(inp, "keydown", operation(cm, onKeyDown));
  on(inp, "keypress", operation(cm, onKeyPress));
  on(inp, "focus", bind(onFocus, cm));
  on(inp, "blur", bind(onBlur, cm));
}

function dragDropChanged(cm: CodeMirror, value, old) {
  var wasOn = old && old != CodeMirror.Init;
  if (!value != !wasOn) {
    var funcs = cm.display.dragFunctions;
    var toggle = value ? on : off;
    toggle(cm.display.scroller, "dragstart", funcs.start);
    toggle(cm.display.scroller, "dragenter", funcs.simple);
    toggle(cm.display.scroller, "dragover", funcs.simple);
    toggle(cm.display.scroller, "drop", funcs.drop);
  }
}

/** Called when the window resizes */
function onResize(cm: CodeMirror) {
  var d = cm.display;
  if (d.lastWrapHeight == d.wrapper.clientHeight && d.lastWrapWidth == d.wrapper.clientWidth)
    return;
  // Might be a text scaling operation, clear size caches.
  d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;
  d.scrollbarsClipped = false;
  cm.setSize();
}

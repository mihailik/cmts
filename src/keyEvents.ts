// KEY EVENTS

/** Run a handler that was bound to a key. */
function doHandleBinding(cm: CodeMirror, bound: string | { (cm: CodeMirror): boolean | {}; }, dropShift: boolean) {
  if (typeof bound == "string") {
    bound = commands[bound];
    if (!bound) return false;
  }
  // Ensure previous input has been read, so that the handler sees a
  // consistent view of the document
  cm.display.input.ensurePolled();
  var prevShift = cm.display.shift, done = false;
  try {
    if (isReadOnly(cm)) cm.state.suppressEdits = true;
    if (dropShift) cm.display.shift = false;
    done = (<any>bound)(cm) != Pass;
  } finally {
    cm.display.shift = prevShift;
    cm.state.suppressEdits = false;
  }
  return done;
}

function lookupKeyForEditor(cm: CodeMirror, name: string, handle: Function) {
  for (var i = 0; i < cm.state.keyMaps.length; i++) {
    var result = lookupKey(name, cm.state.keyMaps[i], handle, cm);
    if (result) return result;
  }
  return (cm.options.extraKeys && lookupKey(name, cm.options.extraKeys, handle, cm))
    || lookupKey(name, cm.options.keyMap, handle, cm);
}

var stopSeq = new Delayed;
function dispatchKey(cm: CodeMirror, name: string, e: KeyboardEvent, handle: Function) {
  var seq = cm.state.keySeq;
  if (seq) {
    if (isModifierKey(name)) return "handled";
    stopSeq.set(50, function() {
      if (cm.state.keySeq == seq) {
        cm.state.keySeq = null;
        cm.display.input.reset();
      }
    });
    name = seq + " " + name;
  }
  var result = lookupKeyForEditor(cm, name, handle);

  if (result == "multi")
    cm.state.keySeq = name;
  if (result == "handled")
    signalLater(cm, "keyHandled", cm, name, e);

  if (result == "handled" || result == "multi") {
    e_preventDefault(e);
    restartBlink(cm);
  }

  if (seq && !result && /\'$/.test(name)) {
    e_preventDefault(e);
    return true;
  }
  return !!result;
}

/** Handle a key from the keydown event. */
function handleKeyBinding(cm: CodeMirror, e: KeyboardEvent) {
  var name = keyName(e, true);
  if (!name) return false;

  if (e.shiftKey && !cm.state.keySeq) {
    // First try to resolve full name (including 'Shift-'). Failing
    // that, see if there is a cursor-motion command (starting with
    // 'go') bound to the keyname without 'Shift-'.
    return dispatchKey(cm, "Shift-" + name, e, function(b) {return doHandleBinding(cm, b, true);})
      || dispatchKey(cm, name, e, function(b) {
      if (typeof b == "string" ? /^go[A-Z]/.test(b) : b.motion)
        return doHandleBinding(cm, b);
    });
  } else {
    return dispatchKey(cm, name, e, function(b) { return doHandleBinding(cm, b); });
  }
}

/** Handle a key from the keypress event */
function handleCharBinding(cm: CodeMirror, e: KeyboardEvent, ch: string) {
  return dispatchKey(cm, "'" + ch + "'", e,
                     function(b) { return doHandleBinding(cm, b, true); });
}

var lastStoppedKey = null;
function onKeyDown(e: KeyboardEvent) {
  var cm = this;
  cm.curOp.focus = activeElt();
  if (signalDOMEvent(cm, e)) return;
  // IE does strange things with escape.
  if (sniff.ie && sniff.ie_version < 11 && e.keyCode == 27) e.returnValue = false;
  var code = e.keyCode;
  cm.display.shift = code == 16 || e.shiftKey;
  var handled = handleKeyBinding(cm, e);
  if (sniff.presto) {
    lastStoppedKey = handled ? code : null;
    // Opera has no cut event... we try to at least catch the key combo
    if (!handled && code == 88 && !hasCopyEvent && (sniff.mac ? e.metaKey : e.ctrlKey))
      cm.replaceSelection("", null, "cut");
  }

  // Turn mouse into crosshair when Alt is held on Mac.
  if (code == 18 && !/\bCodeMirror-crosshair\b/.test(cm.display.lineDiv.className))
    showCrossHair(cm);
}

function showCrossHair(cm: CodeMirror) {
  var lineDiv = cm.display.lineDiv;
  addClass(lineDiv, "CodeMirror-crosshair");

  function up(e: KeyboardEvent) {
    if (e.keyCode == 18 || !e.altKey) {
      rmClass(lineDiv, "CodeMirror-crosshair");
      off(document, "keyup", up);
      off(document, "mouseover", up);
    }
  }
  on(document, "keyup", up);
  on(document, "mouseover", up);
}

function onKeyUp(e: KeyboardEvent) {
  if (e.keyCode == 16) this.doc.sel.shift = false;
  signalDOMEvent(this, e);
}

function onKeyPress(e: KeyboardEvent) {
  var cm = this;
  if (eventInWidget(cm.display, e) || signalDOMEvent(cm, e) || e.ctrlKey && !e.altKey || sniff.mac && e.metaKey) return;
  var keyCode = e.keyCode, charCode = e.charCode;
  if (sniff.presto && keyCode == lastStoppedKey) {lastStoppedKey = null; e_preventDefault(e); return;}
  if ((sniff.presto && (!e.which || e.which < 10)) && handleKeyBinding(cm, e)) return;
  var ch = String.fromCharCode(charCode == null ? keyCode : charCode);
  if (handleCharBinding(cm, e, ch)) return;
  cm.display.input.onKeyPress(e);
}

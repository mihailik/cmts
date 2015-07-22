// INPUT HANDLING

function ensureFocus(cm: CodeMirror) {
  if (!cm.state.focused) { cm.display.input.focus(); onFocus(cm); }
}

function isReadOnly(cm: CodeMirror) {
  return cm.options.readOnly || cm.doc.cantEdit;
}

/**
 * This will be set to an array of strings when copying, so that,
 * when pasting, we know what kind of selections the copied text
 * was made out of.
 */
var lastCopied: string[] = null;

function applyTextInput(cm: CodeMirror, inserted: string, deleted: number, sel: EditorSelection, origin: string) {
  var doc = cm.doc;
  cm.display.shift = false;
  if (!sel) sel = doc.sel;

  var paste = cm.state.pasteIncoming || origin == "paste";
  var textLines = splitLines(inserted), multiPaste = null;
  // When pasing N lines into N selections, insert one line per selection
  if (paste && sel.ranges.length > 1) {
    if (lastCopied && lastCopied.join("") == inserted)
      multiPaste = sel.ranges.length % lastCopied.length == 0 && map(lastCopied, splitLines);
    else if (textLines.length == sel.ranges.length)
      multiPaste = map(textLines, function(l) { return [l]; });
  }

  // Normal behavior is to insert the new text into every selection
  for (var i = sel.ranges.length - 1; i >= 0; i--) {
    var range = sel.ranges[i];
    var from = range.from(), to = range.to();
    if (range.empty()) {
      if (deleted && deleted > 0) // Handle deletion
        from = Pos(from.line, from.ch - deleted);
      else if (cm.state.overwrite && !paste) // Handle overwrite
        to = Pos(to.line, Math.min(getLine(doc, to.line).contentLength(), to.ch + lst(textLines).length));
    }
    var updateInput = cm.curOp.updateInput;
    var changeEvent = {from: from, to: to, text: multiPaste ? multiPaste[i % multiPaste.length] : textLines,
                       origin: origin || (paste ? "paste" : cm.state.cutIncoming ? "cut" : "+input")};
    makeChange(cm.doc, changeEvent);
    signalLater(cm, "inputRead", cm, changeEvent);
  }
  if (inserted && !paste)
    triggerElectric(cm, inserted);

  ensureCursorVisible(cm);
  cm.curOp.updateInput = updateInput;
  cm.curOp.typing = true;
  cm.state.pasteIncoming = cm.state.cutIncoming = false;
}

function handlePaste(e: ClipboardEvent, cm: CodeMirror) {
  var pasted = e.clipboardData && e.clipboardData.getData("text/plain");
  if (pasted) {
    e.preventDefault();
    runInOp(cm, function() { applyTextInput(cm, pasted, 0, null, "paste"); });
    return true;
  }
}

function triggerElectric(cm: CodeMirror, inserted: string) {
  // When an 'electric' character is inserted, immediately trigger a reindent
  if (!cm.options.electricChars || !cm.options.smartIndent) return;
  var sel = cm.doc.sel;

  for (var i = sel.ranges.length - 1; i >= 0; i--) {
    var range = sel.ranges[i];
    if (range.head.ch > 100 || (i && sel.ranges[i - 1].head.line == range.head.line)) continue;
    var mode = cm.getModeAt(range.head);
    var indented = false;
    if (mode.electricChars) {
      for (var j = 0; j < mode.electricChars.length; j++)
        if (inserted.indexOf(mode.electricChars.charAt(j)) > -1) {
          indented = indentLine(cm, range.head.line, "smart");
          break;
        }
    } else if (mode.electricInput) {
      if (mode.electricInput.test(getLine(cm.doc, range.head.line).text.slice(0, range.head.ch)))
        indented = indentLine(cm, range.head.line, "smart");
    }
    if (indented) signalLater(cm, "electricInput", cm, range.head.line);
  }
}

function copyableRanges(cm: CodeMirror) {
  var text = [], ranges = [];
  for (var i = 0; i < cm.doc.sel.ranges.length; i++) {
    var line = cm.doc.sel.ranges[i].head.line;
    var lineRange = {anchor: Pos(line, 0), head: Pos(line + 1, 0)};
    ranges.push(lineRange);
    text.push(cm.getRange(lineRange.anchor, lineRange.head));
  }
  return {text: text, ranges: ranges};
}

function disableBrowserMagic(field: HTMLElement) {
  field.setAttribute("autocorrect", "off");
  field.setAttribute("autocapitalize", "off");
  field.setAttribute("spellcheck", "false");
}

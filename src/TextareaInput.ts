// TEXTAREA INPUT STYLE

class TextareaInput {

  /** See input.poll and input.reset */
  prevInput = "";

  /**
   * Flag that indicates whether we expect input to appear real soon
   * now (after some event like 'keypress' or 'input') and are
   * polling intensively.
   */
  pollingFast = false;

  /** Self-resetting timeout for the poller */
  polling = new Delayed();

  /**
   * Tracks when input.reset has punted to just putting a short
   * string into the textarea instead of the full selection.
   */
  inaccurateSelection = false;

  /** Used to work around IE issue with selection being forgotten when focus moves away from textarea */
  hasSelection = false;

  composing = null;

  wrapper: HTMLDivElement = null;
  textarea: HTMLTextAreaElement = null;
  needsContentAttribute = false;

  constructor(public cm: CodeMirror) {
  }

  init(display: Display) {
    var input = this, cm = this.cm;

    // Wraps and hides input textarea
    var div = this.wrapper = hiddenTextarea();
    // The semihidden textarea that is focused when the editor is
    // focused, and receives input.
    var te = this.textarea = <HTMLTextAreaElement>div.firstChild;
    display.wrapper.insertBefore(div, display.wrapper.firstChild);

    // Needed to hide big blue blinking cursor on Mobile Safari (doesn't seem to work in iOS 8 anymore)
    if (sniff.ios) te.style.width = "0px";

    on(te, "input", function() {
      if (ie && ie_version >= 9 && input.hasSelection) input.hasSelection = null;
      input.poll();
    });

    on(te, "paste", function(e) {
      if (handlePaste(e, cm)) return true;

      cm.state.pasteIncoming = true;
      input.fastPoll();
    });

    function prepareCopyCut(e) {
      if (cm.somethingSelected()) {
        lastCopied = cm.getSelections();
        if (input.inaccurateSelection) {
          input.prevInput = "";
          input.inaccurateSelection = false;
          te.value = lastCopied.join("");
          selectInput(te);
        }
      } else if (!cm.options.lineWiseCopyCut) {
        return;
      } else {
        var ranges = copyableRanges(cm);
        lastCopied = ranges.text;
        if (e.type == "cut") {
          cm.setSelections(ranges.ranges, null, sel_dontScroll);
        } else {
          input.prevInput = "";
          te.value = lastCopied.join("");
          selectInput(te);
        }
      }
      if (e.type == "cut") cm.state.cutIncoming = true;
    }
    on(te, "cut", prepareCopyCut);
    on(te, "copy", prepareCopyCut);

    on(display.scroller, "paste", function(e) {
      if (eventInWidget(display, e)) return;
      cm.state.pasteIncoming = true;
      input.focus();
    });

    // Prevent normal selection in the editor (we handle our own)
    on(display.lineSpace, "selectstart", function(e) {
      if (!eventInWidget(display, e)) e_preventDefault(e);
    });

    on(te, "compositionstart", function() {
      var start = cm.getCursor("from");
      input.composing = {
        start: start,
        range: cm.markText(start, cm.getCursor("to"), {className: "CodeMirror-composing"})
      };
    });
    on(te, "compositionend", function() {
      if (input.composing) {
        input.poll();
        input.composing.range.clear();
        input.composing = null;
      }
    });
  }

  prepareSelection() {
    // Redraw the selection and/or cursor
    var cm = this.cm, display = cm.display, doc = cm.doc;
    var result = prepareSelection(cm);

    // Move the hidden textarea near the cursor to prevent scrolling artifacts
    if (cm.options.moveInputWithCursor) {
      var headPos = cursorCoords(cm, doc.sel.primary().head, "div");
      var wrapOff = display.wrapper.getBoundingClientRect(), lineOff = display.lineDiv.getBoundingClientRect();
      result.teTop = Math.max(0, Math.min(display.wrapper.clientHeight - 10,
                                          headPos.top + lineOff.top - wrapOff.top));
      result.teLeft = Math.max(0, Math.min(display.wrapper.clientWidth - 10,
                                           headPos.left + lineOff.left - wrapOff.left));
    }

    return result;
  }

  showSelection(drawn) {
    var cm = this.cm, display = cm.display;
    removeChildrenAndAdd(display.cursorDiv, drawn.cursors);
    removeChildrenAndAdd(display.selectionDiv, drawn.selection);
    if (drawn.teTop != null) {
      this.wrapper.style.top = drawn.teTop + "px";
      this.wrapper.style.left = drawn.teLeft + "px";
    }
  }

  /**
   * Reset the input to correspond to the selection (or to be empty,
   * when not typing and nothing is selected)
   */
  reset(typing: boolean) {
    if (this.contextMenuPending) return;
    var minimal, selected, cm = this.cm, doc = cm.doc;
    if (cm.somethingSelected()) {
      this.prevInput = "";
      var range = doc.sel.primary();
      minimal = hasCopyEvent &&
        (range.to().line - range.from().line > 100 || (selected = cm.getSelection()).length > 1000);
      var content = minimal ? "-" : selected || cm.getSelection();
      this.textarea.value = content;
      if (cm.state.focused) selectInput(this.textarea);
      if (sniff.ie && sniff.ie_version >= 9) this.hasSelection = content;
    } else if (!typing) {
      this.prevInput = this.textarea.value = "";
      if (sniff.ie && snifff.ie_version >= 9) this.hasSelection = null;
    }
    this.inaccurateSelection = minimal;
  }

  getField() { return this.textarea; }

  supportsTouch() { return false; }

  focus() {
    if (this.cm.options.readOnly != "nocursor" && (!sniff.mobile || activeElt() != this.textarea)) {
      try { this.textarea.focus(); }
      catch (e) {} // IE8 will throw if the textarea is display: none or not in DOM
    }
  }

  blur() { this.textarea.blur(); }

  resetPosition() {
    this.wrapper.style.top = this.wrapper.style.left = <any>0;
  }

  receivedFocus() { this.slowPoll(); }

  /**
   * Poll for input changes, using the normal rate of polling. This
   * runs as long as the editor is focused.
   */
  slowPoll() {
    var input = this;
    if (input.pollingFast) return;
    input.polling.set(this.cm.options.pollInterval, function() {
      input.poll();
      if (input.cm.state.focused) input.slowPoll();
    });
  }

  /**
   * When an event has just come in that is likely to add or change
   * something in the input textarea, we poll faster, to ensure that
   * the change appears on the screen quickly.
   */
  fastPoll() {
    var missed = false, input = this;
    input.pollingFast = true;
    function p() {
      var changed = input.poll();
      if (!changed && !missed) {missed = true; input.polling.set(60, p);}
      else {input.pollingFast = false; input.slowPoll();}
    }
    input.polling.set(20, p);
  }

  /**
   * Read input from the textarea, and update the document to match.
   * When something is selected, it is present in the textarea, and
   * selected (unless it is huge, in which case a placeholder is
   * used). When nothing is selected, the cursor sits after previously
   * seen text (can be empty), which is stored in prevInput (we must
   * not reset the textarea when typing, because that breaks IME).
   */
  poll() {
    var cm = this.cm, input = this.textarea, prevInput = this.prevInput;
    // Since this is called a *lot*, try to bail out as cheaply as
    // possible when it is clear that nothing happened. hasSelection
    // will be the case when there is a lot of text in the textarea,
    // in which case reading its value would be expensive.
    if (this.contextMenuPending || !cm.state.focused ||
        (hasSelection(input) && !prevInput && !this.composing) ||
        isReadOnly(cm) || cm.options.disableInput || cm.state.keySeq)
      return false;

    var text = input.value;
    // If nothing changed, bail.
    if (text == prevInput && !cm.somethingSelected()) return false;
    // Work around nonsensical selection resetting in IE9/10, and
    // inexplicable appearance of private area unicode characters on
    // some key combos in Mac (#2689).
    if (ie && ie_version >= 9 && this.hasSelection === text ||
        mac && /[\uf700-\uf7ff]/.test(text)) {
      cm.display.input.reset();
      return false;
    }

    if (cm.doc.sel == cm.display.selForContextMenu) {
      var first = text.charCodeAt(0);
      if (first == 0x200b && !prevInput) prevInput = "\u200b";
      if (first == 0x21da) { this.reset(); return this.cm.execCommand("undo"); }
    }
    // Find the part of the input that is actually new
    var same = 0, l = Math.min(prevInput.length, text.length);
    while (same < l && prevInput.charCodeAt(same) == text.charCodeAt(same)) ++same;

    var self = this;
    runInOp(cm, function() {
      applyTextInput(cm, text.slice(same), prevInput.length - same,
                     null, self.composing ? "*compose" : null);

      // Don't leave long text in the textarea, since it makes further polling slow
      if (text.length > 1000 || text.indexOf("\n") > -1) input.value = self.prevInput = "";
      else self.prevInput = text;

      if (self.composing) {
        self.composing.range.clear();
        self.composing.range = cm.markText(self.composing.start, cm.getCursor("to"),
                                           {className: "CodeMirror-composing"});
      }
    });
    return true;
  }

  ensurePolled() {
    if (this.pollingFast && this.poll()) this.pollingFast = false;
  }

  onKeyPress() {
    if (ie && ie_version >= 9) this.hasSelection = null;
    this.fastPoll();
  }

  onContextMenu(e) {
    var input = this, cm = input.cm, display = cm.display, te = input.textarea;
    var pos = posFromMouse(cm, e), scrollPos = display.scroller.scrollTop;
    if (!pos || presto) return; // Opera is difficult.

    // Reset the current text selection only if the click is done outside of the selection
    // and 'resetSelectionOnContextMenu' option is true.
    var reset = cm.options.resetSelectionOnContextMenu;
    if (reset && cm.doc.sel.contains(pos) == -1)
      operation(cm, setSelection)(cm.doc, simpleSelection(pos), sel_dontScroll);

    var oldCSS = te.style.cssText;
    input.wrapper.style.position = "absolute";
    te.style.cssText = "position: fixed; width: 30px; height: 30px; top: " + (e.clientY - 5) +
      "px; left: " + (e.clientX - 5) + "px; z-index: 1000; background: " +
      (ie ? "rgba(255, 255, 255, .05)" : "transparent") +
      "; outline: none; border-width: 0; outline: none; overflow: hidden; opacity: .05; filter: alpha(opacity=5);";
    if (webkit) var oldScrollY = window.scrollY; // Work around Chrome issue (#2712)
    display.input.focus();
    if (webkit) window.scrollTo(null, oldScrollY);
    display.input.reset();
    // Adds "Select all" to context menu in FF
    if (!cm.somethingSelected()) te.value = input.prevInput = " ";
    input.contextMenuPending = true;
    display.selForContextMenu = cm.doc.sel;
    clearTimeout(display.detectingSelectAll);

    // Select-all will be greyed out if there's nothing to select, so
    // this adds a zero-width space so that we can later check whether
    // it got selected.
    function prepareSelectAllHack() {
      if (te.selectionStart != null) {
        var selected = cm.somethingSelected();
        var extval = "\u200b" + (selected ? te.value : "");
        te.value = "\u21da"; // Used to catch context-menu undo
        te.value = extval;
        input.prevInput = selected ? "" : "\u200b";
        te.selectionStart = 1; te.selectionEnd = extval.length;
        // Re-set this, in case some other handler touched the
        // selection in the meantime.
        display.selForContextMenu = cm.doc.sel;
      }
    }
    function rehide() {
      input.contextMenuPending = false;
      input.wrapper.style.position = "relative";
      te.style.cssText = oldCSS;
      if (ie && ie_version < 9) display.scrollbars.setScrollTop(display.scroller.scrollTop = scrollPos);

      // Try to detect the user choosing select-all
      if (te.selectionStart != null) {
        if (!ie || (ie && ie_version < 9)) prepareSelectAllHack();
        var i = 0, poll = function() {
          if (display.selForContextMenu == cm.doc.sel && te.selectionStart == 0 &&
              te.selectionEnd > 0 && input.prevInput == "\u200b")
            operation(cm, commands.selectAll)(cm);
          else if (i++ < 10) display.detectingSelectAll = setTimeout(poll, 500);
          else display.input.reset();
        };
        display.detectingSelectAll = setTimeout(poll, 200);
      }
    }

    if (sniff.ie && sniff.ie_version >= 9) prepareSelectAllHack();
    if (captureRightClick) {
      e_stop(e);
      var mouseup = function() {
        off(window, "mouseup", mouseup);
        setTimeout(rehide, 20);
      };
      on(window, "mouseup", mouseup);
    } else {
      setTimeout(rehide, 50);
    }
  }

  setUneditable() { }

}

CodeMirror.inputStyles.textarea = TextareaInput;

function hiddenTextarea(): HTMLDivElement {
  var te = elt("textarea", null, null, "position: absolute; padding: 0; width: 1px; height: 1em; outline: none");
  var div = elt("div", [te], null, "overflow: hidden; position: relative; width: 3px; height: 0px;");
  // The textarea is kept positioned near the cursor to prevent the
  // fact that it'll be scrolled into view on input from scrolling
  // our fake cursor out of view. On webkit, when wrap=off, paste is
  // very slow. So make the area wide instead.
  if (sniff.webkit) te.style.width = "1000px";
  else te.setAttribute("wrap", "off");
  // If border: 0; -- iOS fails to open keyboard (issue #1287)
  if (sniff.ios) te.style.border = "1px solid black";
  disableBrowserMagic(te);
  return div;
}


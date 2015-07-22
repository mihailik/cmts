class NativeScrollbars {

  cm: CodeMirror;
  vert: HTMLDivElement;
  horiz: HTMLDivElement;
  checkedOverlay: boolean;

  constructor(place: (content: HTMLElement) => void, scroll, cm: CodeMirror) {
    this.cm = cm;
    var vert = this.vert = elt("div", [elt("div", null, null, "min-width: 1px")], "CodeMirror-vscrollbar");
    var horiz = this.horiz = elt("div", [elt("div", null, null, "height: 100%; min-height: 1px")], "CodeMirror-hscrollbar");
    place(vert); place(horiz);

    on(vert, "scroll", function() {
      if (vert.clientHeight) scroll(vert.scrollTop, "vertical");
    });
    on(horiz, "scroll", function() {
      if (horiz.clientWidth) scroll(horiz.scrollLeft, "horizontal");
    });

    this.checkedOverlay = false;
    // Need to set a minimum width to see the scrollbar on IE7 (but must not set it on IE8).
    if (sniff.ie && sniff.ie_version < 8) this.horiz.style.minHeight = this.vert.style.minWidth = "18px";
  }

  update(measure) {
    var needsH = measure.scrollWidth > measure.clientWidth + 1;
    var needsV = measure.scrollHeight > measure.clientHeight + 1;
    var sWidth = measure.nativeBarWidth;

    if (needsV) {
      this.vert.style.display = "block";
      this.vert.style.bottom = needsH ? sWidth + "px" : "0";
      var totalHeight = measure.viewHeight - (needsH ? sWidth : 0);
      // A bug in IE8 can cause this value to be negative, so guard it.
      (<HTMLElement>this.vert.firstChild).style.height =
      Math.max(0, measure.scrollHeight - measure.clientHeight + totalHeight) + "px";
    } else {
      this.vert.style.display = "";
      (<HTMLElement>this.vert.firstChild).style.height = "0";
    }

    if (needsH) {
      this.horiz.style.display = "block";
      this.horiz.style.right = needsV ? sWidth + "px" : "0";
      this.horiz.style.left = measure.barLeft + "px";
      var totalWidth = measure.viewWidth - measure.barLeft - (needsV ? sWidth : 0);
      this.horiz.firstChild.style.width =
      (measure.scrollWidth - measure.clientWidth + totalWidth) + "px";
    } else {
      this.horiz.style.display = "";
      this.horiz.firstChild.style.width = "0";
    }

    if (!this.checkedOverlay && measure.clientHeight > 0) {
      if (sWidth == 0) this.overlayHack();
      this.checkedOverlay = true;
    }

    return { right: needsV ? sWidth : 0, bottom: needsH ? sWidth : 0 };
  }

  setScrollLeft(pos: number) {
    if (this.horiz.scrollLeft != pos) this.horiz.scrollLeft = pos;
  }

  setScrollTop(pos: number) {
    if (this.vert.scrollTop != pos) this.vert.scrollTop = pos;
  }

  overlayHack() {
    var w = sniff.mac && !sniff.mac_geMountainLion ? "12px" : "18px";
    this.horiz.style.minHeight = this.vert.style.minWidth = w;
    var self = this;
    var barMouseDown = function(e) {
      if (e_target(e) != self.vert && e_target(e) != self.horiz)
        operation(self.cm, onMouseDown)(e);
    };
    on(this.vert, "mousedown", barMouseDown);
    on(this.horiz, "mousedown", barMouseDown);
  }

  clear() {
    var parent = this.horiz.parentNode;
    parent.removeChild(this.horiz);
    parent.removeChild(this.vert);
  }
}

CodeMirror.scrollbarModel.native = NativeScrollbars;
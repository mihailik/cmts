class NullScrollbars {
  constructor() { }

  update() { return { bottom: 0, right: 0 }; }
  setScrollLeft() { }
  setScrollTop() { }
  clear() { }
}

CodeMirror.scrollbarModel["null"] = NullScrollbars;
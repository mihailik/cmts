class DisplayUpdate {

  visible: { from: number; to: number; };
  editorIsHidden: boolean;
  wrapperHeight: number;
  wrapperWidth: number;
  oldDisplayWidth: number;
  dims: Dimensions;
  events: IArguments[];

  constructor(cm: CodeMirror, public viewport: Viewport, public force?: boolean) {
    var display = cm.display;

    this.viewport = viewport;
    // Store some values that we'll need later (but don't want to force a relayout for)
    this.visible = visibleLines(display, cm.doc, viewport);
    this.editorIsHidden = !display.wrapper.offsetWidth;
    this.wrapperHeight = display.wrapper.clientHeight;
    this.wrapperWidth = display.wrapper.clientWidth;
    this.oldDisplayWidth = displayWidth(cm);
    this.force = force;
    this.dims = getDimensions(cm);
    this.events = [];
  }

  signal(emitter, type) {
    if (hasHandler(emitter, type))
      this.events.push(arguments);
  }

  finish() {
    for (var i = 0; i < this.events.length; i++)
      signal.apply(null, this.events[i]);
  }
}

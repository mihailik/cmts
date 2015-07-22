  // DISPLAY CONSTRUCTOR

 /**
  * The display handles the DOM integration, both for input reading
  * and content drawing. It holds references to DOM nodes and
  * display-related state.
  */
class Display {

  /** Covers bottom-right square when both scrollbars are present. */
  scrollbarFiller: HTMLDivElement;

	/** Covers bottom of gutter when coverGutterNextToScrollbar is on and h scrollbar is present. */
  gutterFiller: HTMLDivElement;

  /** Will contain the actual code, positioned to cover the viewport. */
  lineDiv: HTMLDivElement;

  /** Elements are added to these to represent selection and cursors. */
  selectionDiv: HTMLDivElement;
  cursorDiv: HTMLDivElement;

  /** A visibility: hidden element used to find the size of things. */
  measure: HTMLDivElement;

  /** When lines outside of the viewport are measured, they are drawn in this. */
  lineMeasure: HTMLDivElement;

  /** Wraps everything that needs to exist inside the vertically-padded coordinate system */
  lineSpace: HTMLDivElement;

  /** Moved around its parent to cover visible view. */
  mover: HTMLDivElement;

  /** Set to the height of the document, allowing scrolling. */
  sizer: HTMLDivElement;
  sizerWidth: number;

  /** Behavior of elts with overflow: auto and padding is
   * inconsistent across browsers. This is used to ensure the
   * scrollable area is big enough. */
  heightForcer: HTMLDivElement;

  /** Will contain the gutters, if any. */
  gutters: HTMLDivElement;

  lineGutter: HTMLDivElement;

  /** Actual scrollable element. */
  scroller: HTMLDivElement;

  /** The element in which the editor lives. */
  wrapper: HTMLDivElement;

  /** Current rendered range (may be bigger than the view window). */
  viewFrom: number;
  viewTo: number;
  reportedViewFrom: number;
  reportedViewTo: number;

  /** Information about the rendered lines. */
  view: LineView[];
  renderedView: LineView[];

  /**
   * Holds info about a single rendered line when it was rendered
   * for measurement, while not in view.
   */
  externalMeasured: LineViewWithLineN;

  viewOffset: number;
  lastWrapHeight: number;
  lastWrapWidth: number;

  updateLineNumbers: number;

  nativeBarWidth: number;
  barHeight: number;
	barWidth: number;

  scrollbarsClipped: boolean;

  /**
   * Used to only resize the line number gutter when necessary (when
   * the amount of lines crosses a boundary that makes its width change)
   */
  lineNumWidth: number;
  lineNumInnerWidth: number;
  lineNumChars: number;

  /**
   * Set to true when a non-horizontal-scrolling line widget is
   * added. As an optimization, line widget aligning is skipped when
   * this is false.
   */
  alignWidgets: boolean;

  cachedCharWidth: number;
  cachedTextHeight: number;
  cachedPaddingH: number;

  /**
   * Tracks the maximum line length so that the horizontal scrollbar
   * can be kept static when scrolling.
   */
  maxLine: number;
  maxLineLength: number;
  maxLineChanged: boolean;

  /** Used for measuring wheel scrolling granularity. */
  wheelDX: number;
  wheelDY: number;
  wheelStartX: number;
  wheelStartY: number;

	/** True when shift is held down. */
  shift: boolean;

  /**
   * Used to track whether anything happened since the context menu
   * was opened.
   */
  selForContextMenu: EditorSelection;

  activeTouch: TouchState;

  dragFunctions: DragFunctions = null;
  currentWheelTarget: HTMLElement = null;

  constructor(
    place: HTMLElement | { (content: HTMLElement): void; },
    doc: Doc,
    public input: ContentEditableInput | TextareaInput) {

    this.scrollbarFiller = elt("div", null, "CodeMirror-scrollbar-filler");
    this.scrollbarFiller.setAttribute("cm-not-content", "true");

    this.gutterFiller = elt("div", null, "CodeMirror-gutter-filler");
    this.gutterFiller.setAttribute("cm-not-content", "true");

    this.lineDiv = elt("div", null, "CodeMirror-code");

    this.selectionDiv = elt("div", null, null, "position: relative; z-index: 1");
    this.cursorDiv = elt("div", null, "CodeMirror-cursors");

    this.measure = elt("div", null, "CodeMirror-measure");

    this.lineMeasure = elt("div", null, "CodeMirror-measure");

    this.lineSpace = elt("div", [this.measure, this.lineMeasure, this.selectionDiv, this.cursorDiv, this.lineDiv],
      null, "position: relative; outline: none");

    this.mover = elt("div", [elt("div", [this.lineSpace], "CodeMirror-lines")], null, "position: relative");

    this.sizer = elt("div", [this.mover], "CodeMirror-sizer");
    this.sizerWidth = null;

    this.heightForcer = elt("div", null, null, "position: absolute; height: " + scrollerGap + "px; width: 1px;");

    this.gutters = elt("div", null, "CodeMirror-gutters");
    this.lineGutter = null;

    this.scroller = elt("div", [this.sizer, this.heightForcer, this.gutters], "CodeMirror-scroll");
    this.scroller.setAttribute("tabIndex", "-1");

    this.wrapper = elt("div", [this.scrollbarFiller, this.gutterFiller, this.scroller], "CodeMirror");

    // Work around IE7 z-index bug (not perfect, hence IE7 not really being supported)
    if (sniff.ie && sniff.ie_version < 8) { this.gutters.style.zIndex = <any>-1; this.scroller.style.paddingRight = <any>0; }
    if (!sniff.webkit && !(sniff.gecko && sniff.mobile)) this.scroller.draggable = true;

    if (place) {
      if ((<HTMLElement>place).appendChild) (<HTMLElement>place).appendChild(this.wrapper);
      else (<any>place)(this.wrapper);
    }

    this.viewFrom = this.viewTo = doc.first;
    this.reportedViewFrom = this.reportedViewTo = doc.first;

    this.view = [];
    this.renderedView = null;

    this.externalMeasured = null;

    this.viewOffset = 0;
    this.lastWrapHeight = this.lastWrapWidth = 0;
    this.updateLineNumbers = null;

    this.nativeBarWidth = this.barHeight = this.barWidth = 0;
    this.scrollbarsClipped = false;

    this.lineNumWidth = this.lineNumInnerWidth = this.lineNumChars = null;

    this.alignWidgets = false;

    this.cachedCharWidth = this.cachedTextHeight = this.cachedPaddingH = null;

    this.maxLine = null;
    this.maxLineLength = 0;
    this.maxLineChanged = false;

    this.wheelDX = this.wheelDY = this.wheelStartX = this.wheelStartY = null;

    this.shift = false;

    this.selForContextMenu = null;

    this.activeTouch = null;

    input.init(this);
  }
}

interface LineViewWithLineN extends LineView {

  lineN?: number;

}
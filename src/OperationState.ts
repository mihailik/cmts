interface OperationState {
  cm: CodeMirror,

  /** Flag that indicates that lines might need to be redrawn */
  viewChanged: boolean;

  /** Used to detect need to update scrollbar */
  startHeight: number;

  /** Used to force a redraw */
  forceUpdate: boolean;

  /** Whether to reset the input textarea */
  updateInput: {};

  /** Whether this reset should be careful to leave existing text (for compositing) */
  typing: boolean;

  /** Accumulated changes, for firing change events */
  changeObjs: {}[];

  /** Set of handlers to fire cursorActivity on */
  cursorActivityHandlers: Function[];

  /** Tracks which cursorActivity handlers have been called already */
  cursorActivityCalled: number;

  /** Whether the selection needs to be redrawn */
  selectionChanged: boolean;

  /** Set when the widest line needs to be determined anew */
  updateMaxLine: boolean;

  /** Intermediate scroll position, not pushed to DOM yet */
  scrollLeft: number;
  scrollTop: number;

  /** Used to scroll to a specific position */
  scrollToPos: Pos;

  focus: boolean;

  /** Unique ID */
  id: number;

  mustUpdate: DisplayUpdate;
  update: DisplayUpdate;
  updatedDisplay: boolean;

  barMeasure: ViewportMetrics;

  adjustWidthTo: number;
  maxScrollLeft: number;
  preparedSelection: EditorSelection;
  forceScroll: boolean;
  maybeHiddenMarkers: {}[];
  maybeUnhiddenMarkers: {}[];

  ownsGroup: OperationGroup;
}
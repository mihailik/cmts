/**
 * These objects are used to represent the visible (currently drawn)
 * part of the document. A LineView may correspond to multiple
 * logical lines, if those are connected by collapsed ranges.
 */
class LineView {
  /** The starting line */
  line: number;

  /** Continuing lines, if any */
  rest;

  /** Number of logical lines in this visual line */
  size: number;

  node: {} = null;
  text: string = null;

  hidden: boolean;

  changes: {}[] = null;

  constructor(doc: Doc, line: number, lineN: number) {
    this.line = line;
    this.rest = visualLineContinued(line);

    this.size = this.rest ? lineNo(lst(this.rest)) - lineN + 1 : 1;
    this.hidden = lineIsHidden(doc, line);
  }
}
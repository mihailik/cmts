// POSITION OBJECT

/** A Pos instance represents a position within the text. */
class Pos {

  line: number;
  ch: number;

  constructor(line: number, ch: number) {
    if (!(this instanceof Pos)) return new Pos(line, ch);
    this.line = line; this.ch = ch;
  }

}

CodeMirror.Pos = Pos;

/**
 * Compare two positions, return 0 if they are the same, a negative
 * number when a is less, and a positive number otherwise.
 */
function cmp(a: Pos, b: Pos) { return a.line - b.line || a.ch - b.ch; }

CodeMirror.cmpPos = cmp;

function copyPos(x: Pos) {return new Pos(x.line, x.ch);}
function maxPos(a: Pos, b: Pos) { return cmp(a, b) < 0 ? b : a; }
function minPos(a: Pos, b: Pos) { return cmp(a, b) < 0 ? a : b; }

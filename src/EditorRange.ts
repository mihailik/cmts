class EditorRange {
  constructor(public anchor: Pos, public head: Pos) {
  }

  from() { return minPos(this.anchor, this.head); }

  to() { return maxPos(this.anchor, this.head); }

  empty() {
    return this.head.line == this.anchor.line && this.head.ch == this.anchor.ch;
  }
}
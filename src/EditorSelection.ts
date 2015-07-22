/**
 * Selection objects are immutable. A new one is created every time
 * the selection changes. A selection is one or more non-overlapping
 * (and non-touching) ranges, sorted, and an integer that indicates
 * which one is the primary selection (the one that's scrolled into
 * view, that getCursor returns, etc).
 */
class EditorSelection {
  constructor(public ranges: EditorRange[], public primIndex: number) {
  }

  primary() { return this.ranges[this.primIndex]; }

  equals(other: EditorSelection) {
    if (other == this) return true;
    if (other.primIndex != this.primIndex || other.ranges.length != this.ranges.length) return false;
    for (var i = 0; i < this.ranges.length; i++) {
      var here = this.ranges[i], there = other.ranges[i];
      if (cmp(here.anchor, there.anchor) != 0 || cmp(here.head, there.head) != 0) return false;
    }
    return true;
  }

  deepCopy() {
    for (var out = [], i = 0; i < this.ranges.length; i++)
      out[i] = new EditorRange(copyPos(this.ranges[i].anchor), copyPos(this.ranges[i].head));
    return new EditorSelection(out, this.primIndex);
  }

  somethingSelected() {
    for (var i = 0; i < this.ranges.length; i++)
      if (!this.ranges[i].empty()) return true;
    return false;
  }

  contains(pos, end) {
    if (!end) end = pos;
    for (var i = 0; i < this.ranges.length; i++) {
      var range = this.ranges[i];
      if (cmp(end, range.from()) >= 0 && cmp(pos, range.to()) <= 0)
        return i;
    }
    return -1;
  }
}
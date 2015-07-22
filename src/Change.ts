interface Change {
  from: Pos;
  to: Pos;
  text: string[];

  origin?: string;
  canceled?: boolean;
  removed: {};

  update?: (from: Pos, to: Pos, text: string[], origin: string) => void;
}
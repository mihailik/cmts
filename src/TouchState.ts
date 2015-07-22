interface TouchState {
  start: number;
  moved: boolean;
  prev: TouchState;
  end: number;
  left: number;
  top: number;
}
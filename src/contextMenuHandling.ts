// CONTEXT MENU HANDLING

/**
 * To make the context menu work, we need to briefly unhide the
 * textarea (making it as unobtrusive as possible) to let the
 * right-click take effect on it.
 */
function onContextMenu(cm: CodeMirror, e) {
  if (eventInWidget(cm.display, e) || contextMenuInGutter(cm, e)) return;
  cm.display.input.onContextMu(e);
  }

function contextMenuInGutter(cm: CodeMirror, e) {
  if (!hasHandler(cm, "gutterContextMenu")) return false;
  return gutterEvent(cm, e, "gutterContextMenu", false, signal);
}

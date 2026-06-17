export const $ = (sel, root = document) => root.querySelector(sel)

/** Вставка только неформатированного текста в фокус contenteditable. */
export function insertPlainTextAtCaret(text) {
  const txt = text ?? ''
  try {
    document.execCommand('insertText', false, txt)
    return true
  } catch {
    const sel = window.getSelection()
    if (!sel.rangeCount) return false
    const r = sel.getRangeAt(0)
    r.deleteContents()
    const tn = document.createTextNode(txt)
    r.insertNode(tn)
    r.setStartAfter(tn)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
    return true
  }
}

/**
 * Обработчик paste: только text/plain, затем optional callback (например нормализация эмодзи).
 * @param {ClipboardEvent} e
 * @param {() => void} [afterInsert]
 */
export function onPasteInsertPlainText(e, afterInsert) {
  e.preventDefault()
  const raw = e.clipboardData?.getData('text/plain') ?? ''
  insertPlainTextAtCaret(raw)
  if (typeof afterInsert === 'function') {
    queueMicrotask(afterInsert)
  }
}

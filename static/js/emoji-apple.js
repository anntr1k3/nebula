/**
 * Рендер эмодзи как изображений Apple (iamcal/emoji-datasource-apple), чтобы везде в UI
 * не подставлялись системные шрифты (Segoe / Noto).
 */
const APPLE_EMOJI_CDN_64 =
  'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64'
const APPLE_EMOJI_CDN_32 =
  'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/32'

function emojiToAppleImageFilename(emoji) {
  if (!emoji) return ''
  const parts = []
  let i = 0
  while (i < emoji.length) {
    const cp = emoji.codePointAt(i)
    parts.push(cp.toString(16))
    i += cp >= 0x10000 ? 2 : 1
  }
  return parts.join('-')
}

function appleEmojiImgUrl(emoji, size = 64) {
  const name = emojiToAppleImageFilename(emoji)
  if (!name) return ''
  const base = size === 32 ? APPLE_EMOJI_CDN_32 : APPLE_EMOJI_CDN_64
  return `${base}/${name}.png`
}

const EMOJI_SEGMENT_RE = /\p{Extended_Pictographic}/u

function wireAppleEmojiImgError(img, emoji) {
  img.addEventListener('error', function onImgErr() {
    if (img.dataset.appleSize === '32') {
      img.classList.add('inline-apple-emoji--missing')
      img.removeAttribute('src')
      img.removeEventListener('error', onImgErr)
      return
    }
    img.dataset.appleSize = '32'
    img.src = appleEmojiImgUrl(emoji, 32)
  })
}

/** Одно эмодзи как &lt;img&gt; Apple CDN (без подмены на системный глиф). */
export function createAppleEmojiImg(emoji, extraClasses = '') {
  const img = document.createElement('img')
  img.className = extraClasses ? `inline-apple-emoji ${extraClasses}` : 'inline-apple-emoji'
  img.alt = emoji
  img.draggable = false
  img.loading = 'lazy'
  img.src = appleEmojiImgUrl(emoji, 64)
  wireAppleEmojiImgError(img, emoji)
  return img
}

function appendSegmentTo(el, segment) {
  if (EMOJI_SEGMENT_RE.test(segment)) {
    el.appendChild(createAppleEmojiImg(segment))
  } else {
    el.appendChild(document.createTextNode(segment))
  }
}

/** Рендер смешанного текста: эмодзи — PNG Apple (CDN), остальное — текстовые узлы. */
export function fillElementWithAppleEmoji(el, text) {
  if (!el) return
  el.textContent = ''
  if (text == null || text === '') return
  const str = String(text)
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      for (const { segment } of segmenter.segment(str)) {
        appendSegmentTo(el, segment)
      }
      return
    } catch {
      /* ниже — запасной разбор */
    }
  }
  let i = 0
  while (i < str.length) {
    const cp = str.codePointAt(i)
    const ch = String.fromCodePoint(cp)
    if (EMOJI_SEGMENT_RE.test(ch)) {
      el.appendChild(createAppleEmojiImg(ch))
      i += cp >= 0x10000 ? 2 : 1
    } else {
      el.appendChild(document.createTextNode(str.charAt(i)))
      i += 1
    }
  }
}

/** Плоский текст из contenteditable (текст + alt у inline-apple-emoji). */
export function plainTextFromComposerRoot(root) {
  if (!root) return ''
  return root.innerText.replace(/\r\n/g, '\n')
}

export function setComposerPlainText(root, text) {
  if (!root) return
  root.textContent = ''
  if (text == null || text === '') {
    syncComposerEmptyAttr(root)
    return
  }
  fillElementWithAppleEmoji(root, String(text))
  syncComposerEmptyAttr(root)
}

export function syncComposerEmptyAttr(root) {
  if (!root) return
  const raw = plainTextFromComposerRoot(root).replace(/\u200b/g, '')
  root.dataset.empty = raw.trim().length === 0 ? 'true' : 'false'
}

/** Как maxlength у &lt;input&gt;: обрезка по UTF-16 единицам. */
export function truncatePlainToMaxCodeUnits(str, max) {
  const s = String(str)
  if (s.length <= max) return s
  return s.slice(0, max)
}

export function getComposerCaretPlainOffset(root) {
  if (!root) return 0
  const sel = window.getSelection()
  if (!sel.rangeCount) return 0
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer) && range.startContainer !== root) {
    return plainTextFromComposerRoot(root).length
  }
  const pre = document.createRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  const holder = document.createElement('div')
  holder.appendChild(pre.cloneContents())
  return holder.innerText.replace(/\r\n/g, '\n').length
}

export function setComposerCaretPlainOffset(root, target) {
  if (!root) return
  const max = plainTextFromComposerRoot(root).length
  const t = Math.max(0, Math.min(target, max))
  root.focus()
  const sel = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(root)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  if (typeof sel.modify !== 'function') return
  try {
    for (let i = 0; i < t; i++) {
      sel.modify('move', 'forward', 'character')
    }
  } catch {
    /* оставляем каретку в начале */
  }
}

export function normalizeComposerEmojiInPlace(root) {
  if (!root || typeof Intl === 'undefined' || !Intl.Segmenter) return
  let off = 0
  try {
    off = getComposerCaretPlainOffset(root)
  } catch {
    off = plainTextFromComposerRoot(root).length
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  const textNodes = []
  let n
  while ((n = walker.nextNode())) {
    if (n.nodeValue && EMOJI_SEGMENT_RE.test(n.nodeValue)) textNodes.push(n)
  }
  for (const textNode of textNodes) {
    const str = textNode.nodeValue
    if (!str) continue
    const parent = textNode.parentNode
    if (!parent) continue
    const frag = document.createDocumentFragment()
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const { segment } of segmenter.segment(str)) {
      appendSegmentTo(frag, segment)
    }
    parent.replaceChild(frag, textNode)
  }
  try {
    setComposerCaretPlainOffset(root, off)
  } catch {
    /* ignore */
  }
  syncComposerEmptyAttr(root)
}

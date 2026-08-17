// Replaces the legacy sanitizer's ASCII-strip approach (phase 2 §4.5; that module was
// deleted in Phase 6 §5.1). The old sanitizer NFKD-decomposed text and then stripped
// everything non-ASCII, which turned every accented character into its unaccented base
// and erased non-Latin scripts outright. This is
// deliberately minimal: compose (not decompose), normalize line endings and horizontal
// whitespace, de-hyphenate PDF line-wraps, cap blank-line runs — and nothing else. No
// HTML-tag stripping (mangles "if x < 3 then y > 5"), no URL/email masking (destroys the
// identifiers FR-SRCH-02 requires be findable), no emoji/punctuation removal.
export function normalize(text) {
  return text
    .normalize('NFC')                        // compose: "café" stays one char per glyph
    .replace(/\r\n?/g, '\n')                 // CRLF/CR → LF
    .replace(/[­​]/g, '')          // soft hyphen + zero-width space: invisible, break tokenization
    .replace(/([a-z])-\n([a-z])/g, '$1$2')   // de-hyphenate PDF line wraps: "informa-\ntion" → "information"
    .replace(/[ \t]+/g, ' ')                 // collapse horizontal whitespace only
    .replace(/\n{3,}/g, '\n\n')              // cap blank runs at one, preserving paragraph breaks
    .trim();
}

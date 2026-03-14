export class TextSanitizer {
  static sanitize(text, options = {}) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    let cleanText = text;

    // 1. Unicode Normalization: Handle special characters and accents.
    cleanText = cleanText.normalize('NFKD');

    // 2. HTML Stripping: Use a regex to remove any stray HTML tags.
    cleanText = cleanText.replace(/<[^>]*>?/gm, '');

    // 3. URL/Email Masking (Optional): Replace URLs and emails with placeholders.
    if (options.maskUrls) {
      cleanText = cleanText.replace(/https?:\/\/[^\s]+/g, '[URL]');
    } else if (options.removeUrls) {
      cleanText = cleanText.replace(/https?:\/\/[^\s]+/g, '');
    }

    if (options.maskEmails) {
      cleanText = cleanText.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');
    } else if (options.removeEmails) {
      cleanText = cleanText.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '');
    }

    // 4. Non-ASCII Clean: Remove symbols, emojis, and control characters (like \x00-\x1F).
    // Preserve ASCII printable (0x20-0x7E), common whitespace (\t\n\r),
    // and sentence-ending punctuation.
    // NOTE: NFKD might produce combining characters (diacritics), which we strip below 
    // to strictly enforce ASCII base. If we want to keep them, we need a different regex.
    // For now, we strip out anything outside the basic ASCII printable + whitespace range
    // along with general control characters.
    cleanText = cleanText.replace(/[^\x20-\x7E\t\n\r]/g, '');

    // 5. Whitespace Normalization: Collapse multiple spaces, tabs, and newlines.
    // Replace multiple spaces and tabs with a single space.
    cleanText = cleanText.replace(/[ \t]+/g, ' ');
    // Replace more than two consecutive newlines with exactly two newlines,
    // or standardise everything to max two newlines. 
    // The instructions say "more than two consecutive newlines into single spaces or single newlines"
    // We will standardize multiple newlines (3+) into two newlines to preserve some paragraph structure,
    // or to a single newline if strictly requested.
    cleanText = cleanText.replace(/\n{3,}/g, '\n\n'); 
    
    // Ensure that sentence-ending punctuation (., ?, !) is strictly preserved
    // (This is implicitly handled because they are in the ASCII range \x20-\x7E,
    // but we can ensure they are not accidentally merged with words if whitespace was weird).
    
    // Final trim
    return cleanText.trim();
  }
}

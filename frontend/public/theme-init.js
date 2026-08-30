// phase_1 §3 "The flash problem" — next-themes sets the `.dark` class before React's
// first commit, but the page's own background still paints white before the bundle
// loads. This blocking script runs before any stylesheet is parsed (so it can't read a
// CSS variable) and sets both the class and an inline background matching theme.css's
// --surface / .dark --surface. The two hex values are duplicated from theme.css on
// purpose — see theme.css's own :root/.dark blocks for the source of truth.
//
// Phase 8 §3.2: extracted out of index.html's inline <script> into this same-origin
// file so it satisfies `script-src 'self'` with no 'unsafe-inline' and no per-build CSP
// hash to keep in sync — a plain <script src> in <head> is still parser-blocking and
// runs before <body>, so the behavior below is unchanged from the inline version.
(function () {
  try {
    var t = localStorage.getItem('cerebro-theme');
    var dark = t === 'dark' ||
      ((!t || t === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
    document.documentElement.style.background = dark ? '#0B1224' : '#FBFBFE';
  } catch (e) { /* private mode: fall through to the CSS default */ }
})();

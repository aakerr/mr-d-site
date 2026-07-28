// =============================================================================
// escape.js — the one HTML escaper, shared by every module
// =============================================================================
// Nine modules grew their own private copy of this function, and nine copies
// means nine chances for one of them to drift (miss a quote, forget the
// ampersand-first rule) without anyone noticing until a house named
// "Sea & Sky" renders wrong on exactly one screen. Everything the teacher can
// type — house names, mottos, quest titles, item descriptions — passes through
// here on its way into markup, so this file is the whole of the app's
// stored-XSS defence. Keep it boring.

// Escapes text for interpolation into HTML CONTENT (between tags).
// null/undefined come out as '' — half the callers feed optional fields
// straight in, and "undefined" printed on a classroom projector is worse
// than a blank.
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Escapes text for interpolation into a quoted ATTRIBUTE value. The character
// set is the same as escapeHtml — quotes are what break out of an attribute,
// and they are already covered — but the two names exist so a call site says
// which context it is writing into. If the attribute rules ever need to
// diverge (they have before, in other codebases), only this function moves.
export function escapeAttr(str) {
  return escapeHtml(str);
}

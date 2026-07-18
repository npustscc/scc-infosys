// server/src/openmail/sanitize.js -- v202 openmail: HTML sanitizer (pure function, no new deps).
//
// This is the first line of defense before mail HTML content enters the system (the second line
// is the frontend sandboxed iframe rendering, see the corresponding frontend change) -- it must be
// independently complete and must not assume the frontend always does the right thing. A hand
// rolled regex based HTML processor can never reach full HTML parser precision (e.g. an unescaped
// `>` inside an attribute value can confuse tag boundary detection), but the required attack
// surface for this task is covered:
//   - strip <script>/<iframe>/<object>/<embed>/<form>/<link>/<meta>/<base> entirely (with content)
//   - strip every on* event attribute (onclick/onerror/onload/...)
//   - strip javascript:/vbscript:/data:text/html URLs from href/src/action/formaction/background
//   - inside <style> tags and style="" attributes, neutralize CSS expression()/url(javascript:...)
//   - remote images src="http(s)://..." are rewritten to data-om-src (never auto-loaded), and the
//     number of rewrites is returned as blockedRemoteImages
//   - cid: image src values are left untouched (the caller in openmail/actions.js swaps them for
//     data URIs after parsing the message)
// Any exception during processing falls back to escaping the entire raw string as plain text, so
// the return value is always a string and never contains executable content.
'use strict';

const REMOVE_TAGS_WITH_CONTENT = ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'];

function stripTagsWithContent(html, tagNames) {
  let out = html;
  for (const tag of tagNames) {
    const paired = new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '\\s*>', 'gi');
    out = out.replace(paired, '');
    // Leftover self-closing/unclosed tags of the same name (e.g. <link ...> with no </link>).
    const unpaired = new RegExp('<' + tag + '\\b[^>]*\\/?>', 'gi');
    out = out.replace(unpaired, '');
  }
  return out;
}

// CSS expression() (legacy IE, no modern browser support but still stripped) / url(javascript:...)
// pseudo-protocol.
function sanitizeStyleBody(css) {
  if (!css) return css;
  let out = String(css);
  // Allow one level of nested parens (covers the common expression(alert(1)) shape) so the whole
  // call -- including its inner arguments -- is removed instead of leaving a stray trailing ")".
  out = out.replace(/expression\s*\((?:[^()]|\([^()]*\))*\)/gi, '');
  out = out.replace(/url\s*\(\s*(['"]?)\s*(javascript|vbscript):(?:[^()]|\([^()]*\))*\)/gi, 'none');
  return out;
}

// Attribute string -> [{name, value|null}]. value is null for valueless attributes (e.g. disabled).
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

function parseAttrs(attrStr) {
  const attrs = [];
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(attrStr))) {
    const name = m[1];
    let value = m[3];
    if (value == null) {
      attrs.push({ name: name, value: null });
      continue;
    }
    if ((value[0] === '"' && value[value.length - 1] === '"') || (value[0] === "'" && value[value.length - 1] === "'")) {
      value = value.slice(1, -1);
    }
    attrs.push({ name: name, value: value });
  }
  return attrs;
}

function escapeAttrValue(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Dangerous URL scheme check: strip whitespace first (a common bypass trick is inserting tabs or
// newlines into the scheme, e.g. "java<TAB>script:"), then compare against the normalized prefix.
function isDangerousUrl(raw) {
  const norm = String(raw || '').replace(/\s+/g, '').toLowerCase();
  return norm.indexOf('javascript:') === 0 || norm.indexOf('vbscript:') === 0 || norm.indexOf('data:text/html') === 0;
}

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'background']);

// Walk every start tag: strip on*, sanitize URL-ish attributes/style, rewrite remote image src to
// data-om-src.
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*)?)(\/?)\s*>/g;

function sanitizeTags(html) {
  let blockedRemoteImages = 0;
  const out = html.replace(TAG_RE, function (full, closingSlash, tagName, attrStr, selfSlash) {
    if (closingSlash) return full; // closing tags carry no attributes, keep as-is
    if (!attrStr) return full;
    const attrs = parseAttrs(attrStr);
    const kept = [];
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      const lname = a.name.toLowerCase();
      if (lname.indexOf('on') === 0) continue; // strip every event handler attribute
      if (lname === 'style' && a.value != null) {
        kept.push({ name: 'style', value: sanitizeStyleBody(a.value) });
        continue;
      }
      if (URL_ATTRS.has(lname)) {
        const raw = a.value == null ? '' : a.value;
        if (isDangerousUrl(raw)) continue; // javascript:/vbscript:/data:text/html -> drop attribute
        if (lname === 'src' && /^cid:/i.test(raw.trim())) { kept.push(a); continue; }
        if (lname === 'src' && /^https?:\/\//i.test(raw.trim())) {
          blockedRemoteImages++;
          kept.push({ name: 'data-om-src', value: raw });
          continue;
        }
        kept.push(a);
        continue;
      }
      kept.push(a);
    }
    const rebuilt = kept
      .map(function (a) { return a.value == null ? a.name : a.name + '="' + escapeAttrValue(a.value) + '"'; })
      .join(' ');
    return '<' + tagName + (rebuilt ? ' ' + rebuilt : '') + (selfSlash ? ' /' : '') + '>';
  });
  return { html: out, blockedRemoteImages: blockedRemoteImages };
}

function escapeToText(input) {
  const s = typeof input === 'string' ? input : String(input == null ? '' : input);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Main entry point: always returns { html: string, blockedRemoteImages: number }. html is never
// null/undefined and this function never throws.
function sanitizeHtml(input) {
  try {
    if (typeof input !== 'string' || !input) return { html: '', blockedRemoteImages: 0 };
    let html = input;
    html = stripTagsWithContent(html, REMOVE_TAGS_WITH_CONTENT);
    // <style> tag body (not the attribute form): expression()/url(javascript:...).
    html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, function (m, open, body, close) {
      return open + sanitizeStyleBody(body) + close;
    });
    const tagged = sanitizeTags(html);
    return { html: tagged.html, blockedRemoteImages: tagged.blockedRemoteImages };
  } catch (_e) {
    return { html: escapeToText(input), blockedRemoteImages: 0 };
  }
}

module.exports = { sanitizeHtml: sanitizeHtml, escapeToText: escapeToText, sanitizeStyleBody: sanitizeStyleBody, isDangerousUrl: isDangerousUrl };

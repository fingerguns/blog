// Parsing for the `_headers` file so the requests the site and the admin
// actually make can be asserted against the deployed Content-Security-Policy.
//
// Matching here is a practical subset of the CSP source-expression grammar —
// enough for the host, scheme and wildcard forms this policy uses. It is a
// test aid, not a browser.

export function parseHeadersFile(text) {
  const rules = [];
  let current = null;
  for (const raw of String(text || "").split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = { path: raw.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    if (!current) continue;
    const line = raw.trim();
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    current.headers[line.slice(0, colon).trim().toLowerCase()] = line
      .slice(colon + 1)
      .trim();
  }
  return rules;
}

export function parseCsp(policy) {
  const directives = {};
  for (const part of String(policy || "").split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    directives[tokens[0].toLowerCase()] = tokens.slice(1);
  }
  return directives;
}

// blob:, data: and filesystem: URLs inherit their origin from the page, but
// browsers still refuse them under 'self' — they have to be named by scheme.
// This is what made MapLibre's blob-wrapped worker need an explicit
// `worker-src blob:`, and it applies just as much to a preview <video>.
const OPAQUE_SCHEMES = new Set(["blob", "data", "filesystem"]);

function hostMatches(pattern, host) {
  if (pattern === host) return true;
  // `*.example.com` covers subdomains but not the bare apex.
  return pattern.startsWith("*.") && host.endsWith(pattern.slice(1));
}

function matchesHostSource(source, target) {
  const parts = /^(?:([a-z][a-z0-9+.-]*):\/\/)?([^/:]+)(?::(\d+|\*))?(\/.*)?$/i.exec(source);
  if (!parts) return false;
  const [, scheme, host, port, path] = parts;
  if (scheme && `${scheme.toLowerCase()}:` !== target.protocol) return false;
  if (!hostMatches(host.toLowerCase(), target.hostname.toLowerCase())) return false;
  if (port && port !== "*" && port !== target.port) return false;
  if (path && path !== "/" && !target.pathname.startsWith(path)) return false;
  return true;
}

export function cspAllows(sources, url, selfOrigin = "") {
  if (!Array.isArray(sources) || !sources.length) return false;
  if (sources.includes("*")) return true;

  const scheme = (/^([a-z][a-z0-9+.-]*):/i.exec(String(url).trim()) || [])[1];
  if (!scheme) return false;

  let target = null;
  try {
    target = new URL(url);
  } catch {
    target = null;
  }

  for (const source of sources) {
    if (source === "'self'") {
      if (OPAQUE_SCHEMES.has(scheme.toLowerCase())) continue;
      if (target && selfOrigin && target.origin === new URL(selfOrigin).origin) return true;
      continue;
    }
    // Quoted keywords ('unsafe-inline', nonces, hashes) never match a URL.
    if (source.startsWith("'")) continue;
    if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) {
      if (source.slice(0, -1).toLowerCase() === scheme.toLowerCase()) return true;
      continue;
    }
    if (target && matchesHostSource(source, target)) return true;
  }
  return false;
}

/**
 * Pixel dimensions of a photo, read from the first bytes of the file.
 *
 * The build needs to know whether a single Thinking photo is landscape so it
 * can render it at its own shape rather than as a square crop — and it needs
 * to know at build time, so the page ships with the right box and nothing
 * jumps when the image arrives. D1 doesn't store dimensions, so the build
 * reads them from the file header: a ranged GET of the first 64 KB covers
 * JPEG (including a large EXIF block ahead of the frame header), PNG, GIF and
 * WebP. Results are cached in D1's build_cache, so each photo is fetched once.
 *
 * Dimensions are reported as displayed: a JPEG whose EXIF orientation says
 * "rotate 90°" (5–8) has its width and height swapped, because browsers apply
 * that rotation when they draw it.
 */

const HEADER_BYTES = 64 * 1024;

/** { width, height } from an image's leading bytes, or null if unrecognised. */
export function imageSizeFromBytes(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 12) return null;

  // PNG: IHDR is always the first chunk.
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b.length >= 24) {
    return valid(be32(b, 16), be32(b, 20));
  }
  // GIF87a / GIF89a: logical screen size, little-endian.
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return valid(le16(b, 6), le16(b, 8));
  }
  // WebP: RIFF....WEBP then a VP8 / VP8L / VP8X chunk.
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP" && b.length >= 30) {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X") return valid(1 + le24(b, 24), 1 + le24(b, 27));
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return valid(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff));
    }
    if (chunk === "VP8 ") return valid(le16(b, 26) & 0x3fff, le16(b, 28) & 0x3fff);
    return null;
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  if (b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  return null;
}

function jpegSize(b) {
  let orientation = 1;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = be16(b, i + 2);
    if (len < 2) return null;
    if (marker === 0xe1 && ascii(b, i + 4, 4) === "Exif") {
      orientation = exifOrientation(b, i + 10, i + 2 + len) || orientation;
    }
    // SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > b.length) return null;
      const height = be16(b, i + 5);
      const width = be16(b, i + 7);
      return orientation >= 5 && orientation <= 8 ? valid(height, width) : valid(width, height);
    }
    i += 2 + len;
  }
  return null;
}

// Orientation tag (0x0112) from IFD0 of the TIFF block starting at `start`.
function exifOrientation(b, start, end) {
  if (start + 8 > Math.min(end, b.length)) return 0;
  const little = b[start] === 0x49 && b[start + 1] === 0x49;
  const u16 = (o) => (little ? le16(b, o) : be16(b, o));
  const u32 = (o) => (little ? le32(b, o) : be32(b, o));
  const ifd = start + u32(start + 4);
  if (ifd + 2 > b.length) return 0;
  const count = u16(ifd);
  for (let n = 0; n < count; n++) {
    const e = ifd + 2 + n * 12;
    if (e + 12 > b.length) return 0;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return 0;
}

/**
 * Fetch just enough of `url` to read its dimensions. Returns { width, height }
 * or null (unreachable, not an image, or a header we can't parse). Callers
 * cache null as `false` — a photo's size does not change.
 */
export async function fetchImageSize(url, { timeoutMs = 8000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { Range: `bytes=0-${HEADER_BYTES - 1}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    // A server that ignores Range sends the whole file; read only what we need.
    const reader = res.body?.getReader?.();
    if (!reader) return imageSizeFromBytes(new Uint8Array(await res.arrayBuffer()));
    const chunks = [];
    let total = 0;
    while (total < HEADER_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    reader.cancel().catch(() => {});
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { bytes.set(c, off); off += c.length; }
    return imageSizeFromBytes(bytes);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function valid(width, height) {
  return width > 0 && height > 0 ? { width, height } : null;
}
function ascii(b, o, n) {
  let s = "";
  for (let k = 0; k < n && o + k < b.length; k++) s += String.fromCharCode(b[o + k]);
  return s;
}
function be16(b, o) { return (b[o] << 8) | b[o + 1]; }
function le16(b, o) { return b[o] | (b[o + 1] << 8); }
function le24(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); }
function be32(b, o) { return ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]); }
function le32(b, o) { return ((b[o + 3] << 24) >>> 0) + ((b[o + 2] << 16) | (b[o + 1] << 8) | b[o]); }

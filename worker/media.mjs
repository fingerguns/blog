import { serveMediaThumb } from "./image-thumb.mjs";

const CACHE_CONTROL =
  "public, max-age=31536000, immutable, stale-while-revalidate=86400";

function parseRange(rangeHeader, size) {
  const m = /^bytes=(\d+)-(\d*)$/i.exec(String(rangeHeader || "").trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] !== "" ? Number(m[2]) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return null;
  }
  return { offset: start, length: Math.min(end - start + 1, size - start) };
}

function mediaContentType(key, object) {
  if (key.endsWith(".m4a")) return "audio/mp4";
  if (key.endsWith(".mp3")) return "audio/mpeg";
  if (key.endsWith(".aac")) return "audio/mp4";
  if (key.endsWith(".mp4")) return "video/mp4";
  if (key.endsWith(".mov")) return "video/quicktime";
  if (key.endsWith(".m4v")) return "video/x-m4v";
  return object?.httpMetadata?.contentType || "application/octet-stream";
}

function mediaHeaders(key, object, size) {
  const headers = new Headers();
  if (object) object.writeHttpMetadata(headers);
  headers.set("Content-Type", mediaContentType(key, object));
  headers.set("etag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", CACHE_CONTROL);
  headers.set("CDN-Cache-Control", CACHE_CONTROL);
  headers.set("Vary", "Range");
  if (size != null) headers.set("Content-Length", String(size));
  return headers;
}

/** Serve R2 objects at rommy.blog/media/* with byte-range support for iOS Safari. */
export async function serveMedia(request, env) {
  if (!env.MEDIA) {
    return new Response("Media storage is not configured", { status: 500 });
  }

  // cf.image subrequests must reach the original bytes without re-entering transforms.
  if (/image-resizing/i.test(request.headers.get("via") || "")) {
    return serveMediaObject(request, env);
  }

  const method = request.method;
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const pathname = new URL(request.url).pathname;
  const thumbMatch = /^\/media\/thumb\/(\d+)\/(.+)$/.exec(pathname);
  if (thumbMatch) {
    const width = Number(thumbMatch[1]);
    const sourceKey = decodeURIComponent(thumbMatch[2]);
    return serveMediaThumb(request, env, width, sourceKey);
  }

  return serveMediaObject(request, env);
}

async function serveMediaObject(request, env) {
  const method = request.method;
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/media\//, ""));
  if (!key || key.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const head = await env.MEDIA.head(key);
  if (!head) {
    return new Response("Not found", { status: 404 });
  }

  const size = head.size;
  const rangeHeader = request.headers.get("Range");

  if (method === "HEAD") {
    const headers = mediaHeaders(key, head, size);
    return new Response(null, { status: 200, headers });
  }

  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }

    const object = await env.MEDIA.get(key, { range });
    if (!object) {
      return new Response("Not found", { status: 404 });
    }

    const end = range.offset + range.length - 1;
    const headers = mediaHeaders(key, object, range.length);
    headers.set("Content-Range", `bytes ${range.offset}-${end}/${size}`);
    return new Response(object.body, { status: 206, headers });
  }

  const object = await env.MEDIA.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = mediaHeaders(key, object, size);
  return new Response(object.body, { headers });
}

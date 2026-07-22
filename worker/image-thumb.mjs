const THUMB_CACHE_PREFIX = "thumbs";
const ALLOWED_WIDTHS = new Set([64, 128, 252, 512]);
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

const CACHE_CONTROL =
  "public, max-age=31536000, immutable, stale-while-revalidate=86400";

function isThumbSourceKey(key) {
  return /^(thinking|reading)\/.+\.(jpe?g|png|webp|gif)$/i.test(key);
}

function thumbCacheKey(width, sourceKey) {
  return `${THUMB_CACHE_PREFIX}/w${width}/${sourceKey.replace(/\.(png|webp|gif)$/i, ".jpg")}`;
}

function isJpeg(bytes) {
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function generateThumbBytes(env, width, sourceKey) {
  const object = await env.MEDIA.get(sourceKey);
  if (!object) return null;

  if (env.IMAGES) {
    const response = (
      await env.IMAGES.input(object.body)
        .transform({ width, height: width, fit: "cover" })
        .output({ format: "image/jpeg", quality: 82 })
    ).response();
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return isJpeg(bytes) ? bytes : null;
  }

  const publicBase = (env.MEDIA_PUBLIC_URL || "https://rommy.blog/media").replace(/\/$/, "");
  const sourceUrl = `${publicBase}/${sourceKey}`;
  const res = await fetch(sourceUrl, {
    headers: { Accept: "image/jpeg,image/*" },
    cf: {
      image: {
        width,
        height: width,
        fit: "cover",
        format: "jpeg",
        quality: 82,
      },
    },
  });
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return isJpeg(bytes) ? bytes : null;
}

function jpegResponse(bytes, method, etag) {
  const headers = {
    "Content-Type": "image/jpeg",
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": CACHE_CONTROL,
    "CDN-Cache-Control": CACHE_CONTROL,
  };
  if (etag) headers.etag = etag;
  if (method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(bytes, { headers });
}

/** Serve /media/thumb/{width}/{sourceKey} — edge-cached square JPEG thumbs. */
export async function serveMediaThumb(request, env, width, sourceKey) {
  if (!env.MEDIA) {
    return new Response("Media storage is not configured", { status: 500 });
  }

  const method = request.method;
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!ALLOWED_WIDTHS.has(width) || !sourceKey || sourceKey.includes("..") || !isThumbSourceKey(sourceKey)) {
    return new Response("Not found", { status: 404 });
  }

  const cacheKey = thumbCacheKey(width, sourceKey);
  const cached = await env.MEDIA.head(cacheKey);
  if (cached) {
    if (method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": String(cached.size),
          "Cache-Control": CACHE_CONTROL,
          "CDN-Cache-Control": CACHE_CONTROL,
          etag: cached.httpEtag,
        },
      });
    }
    const object = await env.MEDIA.get(cacheKey);
    if (!object) return new Response("Not found", { status: 404 });
    const bytes = await object.arrayBuffer();
    if (!isJpeg(new Uint8Array(bytes))) {
      await env.MEDIA.delete(cacheKey);
    } else {
      return jpegResponse(bytes, "GET", object.httpEtag);
    }
  }

  const sourceHead = await env.MEDIA.head(sourceKey);
  if (!sourceHead || sourceHead.size > MAX_SOURCE_BYTES) {
    return new Response("Not found", { status: 404 });
  }

  let thumbBytes;
  try {
    thumbBytes = await generateThumbBytes(env, width, sourceKey);
  } catch {
    return new Response("Could not generate thumbnail", { status: 502 });
  }
  if (!thumbBytes || thumbBytes.byteLength === 0) {
    return new Response("Could not generate thumbnail", { status: 502 });
  }

  await env.MEDIA.put(cacheKey, thumbBytes, {
    httpMetadata: { contentType: "image/jpeg" },
  });

  return jpegResponse(thumbBytes, method);
}

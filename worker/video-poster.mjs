export function thinkingVideoPosterKey(videoKey) {
  return String(videoKey || "").replace(/\.(mp4|mov|m4v)$/i, "-poster.jpg");
}

export function isValidThinkingVideoPosterKey(key) {
  return /^thinking\/video\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}-poster\.jpg$/i.test(
    String(key || "")
  );
}

/** Store a 512×512 JPEG poster alongside a thinking video in R2. */
export async function uploadVideoPosterToR2(env, videoKey, posterFile) {
  if (!env.MEDIA || !posterFile || posterFile.size <= 0) return null;

  const key = thinkingVideoPosterKey(videoKey);
  if (!isValidThinkingVideoPosterKey(key)) {
    throw new Error("Invalid video poster upload.");
  }
  if (posterFile.size > 512 * 1024) {
    throw new Error("Video poster must be 512 KB or smaller.");
  }

  const mimeType = (posterFile.type || "image/jpeg").toLowerCase().split(";")[0].trim();
  if (mimeType && mimeType !== "image/jpeg" && mimeType !== "image/jpg") {
    throw new Error("Video poster must be JPEG.");
  }

  const bytes = await posterFile.arrayBuffer();
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  return key;
}

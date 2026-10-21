import { test } from "node:test";
import assert from "node:assert/strict";

import { imageSizeFromBytes, fetchImageSize } from "./image-size.mjs";

// Tiny real images, generated with Pillow. jpegRotated is 64×48 as stored but
// carries EXIF orientation 6 (rotate 90°), the way an iPhone writes a photo
// taken upright — it displays as 48×64.
const FIXTURES = {
  jpeg: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwC3RRRXhH0wUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH/2Q==",
  jpegRotated: "/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwC3RRRXhH0wUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH/2Q==",
  png: "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAALklEQVR4nO3NMQEAMAgAoLmExjGisazg5wMFiK58F/7JKhaLxWKxWCwWi8XilQHeIwHMU90C1gAAAABJRU5ErkJggg==",
  gif: "R0lGODdhHgAoAIEAAMh4UAAAAAAAAAAAACwAAAAAHgAoAEAIOgABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzAxBgQAOw==",
  webpLossy: "UklGRkoAAABXRUJQVlA4ID4AAABQAwCdASoyABQAPm02mEikIyKhJAgAgA2JZwB2AABBGkjDQAD+zoL//sWctgXj//+N48CvJdj4KBo4RwAAAA==",
  webpLossless: "UklGRh4AAABXRUJQVlA4TBEAAAAvE0AMAAdQvCIXqv+BiOh/AAA=",
};
const bytes = (name) => new Uint8Array(Buffer.from(FIXTURES[name], "base64"));

test("reads dimensions from JPEG, PNG, GIF and both WebP encodings", () => {
  assert.deepEqual(imageSizeFromBytes(bytes("jpeg")), { width: 64, height: 48 });
  assert.deepEqual(imageSizeFromBytes(bytes("png")), { width: 40, height: 30 });
  assert.deepEqual(imageSizeFromBytes(bytes("gif")), { width: 30, height: 40 });
  assert.deepEqual(imageSizeFromBytes(bytes("webpLossy")), { width: 50, height: 20 });
  assert.deepEqual(imageSizeFromBytes(bytes("webpLossless")), { width: 20, height: 50 });
});

test("a JPEG rotated by EXIF reports its displayed size", () => {
  assert.deepEqual(imageSizeFromBytes(bytes("jpegRotated")), { width: 48, height: 64 });
});

test("unrecognised or truncated input gives null", () => {
  assert.equal(imageSizeFromBytes(new TextEncoder().encode("<!doctype html><html></html>")), null);
  assert.equal(imageSizeFromBytes(bytes("jpeg").slice(0, 20)), null);
  assert.equal(imageSizeFromBytes(new Uint8Array(0)), null);
});

test("fetchImageSize asks for a byte range and parses the response", async () => {
  let range;
  const fetchImpl = async (_url, init) => {
    range = init.headers.Range;
    return new Response(bytes("png"), { status: 206 });
  };
  assert.deepEqual(await fetchImageSize("https://example.test/a.png", { fetchImpl }), { width: 40, height: 30 });
  assert.equal(range, "bytes=0-65535");
});

test("fetchImageSize gives null on an HTTP error or a network failure", async () => {
  assert.equal(await fetchImageSize("x", { fetchImpl: async () => new Response("", { status: 404 }) }), null);
  assert.equal(await fetchImageSize("x", { fetchImpl: async () => { throw new Error("offline"); } }), null);
});

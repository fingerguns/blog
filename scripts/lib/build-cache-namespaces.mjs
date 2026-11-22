/**
 * Namespaces of the D1 build_cache table. Its own module, free of Node
 * built-ins, so the Worker's live overlay can read the same caches the build
 * writes (see build-cache.mjs for the cache itself).
 */
export const CACHE_NAMESPACES = {
  READING_COVERS: "reading-covers",
  SPOTIFY_THUMBNAILS: "spotify-thumbnails",
  VIDEO_POSTERS: "video-posters",
  VIDEO_FRAMES: "video-frames",
  LINKLOG_UNFURLS: "linklog-unfurls",
  THINKING_UNFURLS: "thinking-unfurls",
  NEIGHBORHOOD_PLACES: "neighborhood-places",
  // Who's On First neighborhood outlines for the /now/ map, keyed "wof:<id>";
  // false = looked up, no usable outline (worker/location.mjs).
  NEIGHBORHOOD_OUTLINES: "neighborhood-outlines",
  THINKING_PHOTO_SIZES: "thinking-photo-sizes",
};

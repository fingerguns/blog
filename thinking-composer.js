/**
 * The Thinking composer — one implementation, mounted in two places: the
 * admin's Thinking tab and the fold-down composer on the homepage.
 *
 *   ThinkingComposer.mount(container, {
 *     apiUrl,            // the admin Worker endpoint
 *     getPassword,       // () => the signed-in admin password, or null
 *     idPrefix,          // keeps label/input ids unique on the page (default "t")
 *     signedOutMessage,  // shown when getPassword() returns nothing
 *     onSaved,           // (result) => void, after a successful post
 *   })
 *
 * It renders its own markup, so both pages get the same form; the styles are
 * in styles.css under .thinking-composer. Photo compression and the byte
 * formatter are also exported, because the admin's Writing tab uses them.
 *
 * Plain ES5 in an IIFE: it is served as-is from the site root and loaded by a
 * <script> tag, with no build step.
 */
(function () {
  "use strict";

  var MAX_PHOTO_SITE = 5 * 1024 * 1024;
  // Bluesky's blob limit is 2,000,000 bytes, not 2 MiB; must match
  // MAX_BLUESKY_IMAGE_BYTES in the Worker, which cannot compress itself.
  var MAX_PHOTO_BLUESKY = 2000000;
  var MAX_PHOTO_INPUT = 25 * 1024 * 1024;
  var MAX_VIDEO_INPUT = 100 * 1024 * 1024;
  var THINKING_SOFT_MAX = 300;
  var MAX_THINKING_PHOTOS = 4;
  var GRID_POSTER_SIZE = 512;

  function formatBytes(n) {
    if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function isAllowedThinkingVideo(file) {
    var type = (file.type || "").toLowerCase().split(";")[0].trim();
    var name = (file.name || "").toLowerCase();
    if (type === "video/mp4" || type === "video/quicktime" || type === "video/x-m4v") {
      return true;
    }
    return name.endsWith(".mp4") || name.endsWith(".mov") || name.endsWith(".m4v");
  }

  function resolveVideoMimeForUpload(file) {
    var type = (file.type || "").toLowerCase().split(";")[0].trim();
    var name = (file.name || "").toLowerCase();
    if (type === "video/mp4" || type === "video/quicktime" || type === "video/x-m4v") {
      return type;
    }
    if (name.endsWith(".mp4")) return "video/mp4";
    if (name.endsWith(".mov")) return "video/quicktime";
    if (name.endsWith(".m4v")) return "video/x-m4v";
    return type || "video/mp4";
  }

  function compressPhotoForBluesky(file) {
    return new Promise(function (resolve, reject) {
      if (file.size <= MAX_PHOTO_BLUESKY) {
        resolve(null);
        return;
      }
      if (file.type === "image/gif") {
        // Canvas re-encoding would flatten the animation to a static frame.
        // Let the worker decide: it either sends the original GIF (if under
        // Bluesky's limit) or skips the Bluesky attachment with a warning.
        resolve(null);
        return;
      }
      var objectUrl = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(objectUrl);
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        var maxDim = 2000;
        if (w > maxDim || h > maxDim) {
          var scale = maxDim / Math.max(w, h);
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
        }
        var canvas = document.createElement("canvas");
        var dimScales = [1, 0.85, 0.7, 0.55];
        var qualities = [0.82, 0.72, 0.62, 0.52, 0.42];

        function tryEncode(si, qi) {
          if (si >= dimScales.length) {
            reject(new Error("Could not compress this photo under 2 MB for Bluesky."));
            return;
          }
          var cw = Math.max(1, Math.round(w * dimScales[si]));
          var ch = Math.max(1, Math.round(h * dimScales[si]));
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, cw, ch);
          if (qi >= qualities.length) {
            tryEncode(si + 1, 0);
            return;
          }
          canvas.toBlob(
            function (blob) {
              if (!blob) {
                tryEncode(si, qi + 1);
                return;
              }
              if (blob.size <= MAX_PHOTO_BLUESKY) {
                resolve(new File([blob], "bluesky.jpg", { type: "image/jpeg" }));
                return;
              }
              tryEncode(si, qi + 1);
            },
            "image/jpeg",
            qualities[qi]
          );
        }
        tryEncode(0, 0);
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not read this photo for Bluesky compression."));
      };
      img.src = objectUrl;
    });
  }

  function compressPhotoForSite(file) {
    return new Promise(function (resolve, reject) {
      if (file.size <= MAX_PHOTO_SITE) {
        resolve(file);
        return;
      }
      if (file.size > MAX_PHOTO_INPUT) {
        reject(new Error("Photo must be 25 MB or smaller (yours is " + formatBytes(file.size) + ")."));
        return;
      }
      if (file.type === "image/gif") {
        reject(new Error("GIF must be 5 MB or smaller (yours is " + formatBytes(file.size) + ")."));
        return;
      }
      var objectUrl = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(objectUrl);
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        var canvas = document.createElement("canvas");
        var qualities = [0.92, 0.85, 0.78, 0.72, 0.65, 0.58, 0.5, 0.42];

        function tryEncode(wi, hi, qi) {
          canvas.width = wi;
          canvas.height = hi;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, wi, hi);
          if (qi >= qualities.length) {
            if (wi <= 1 && hi <= 1) {
              reject(new Error("Could not compress this photo under 5 MB."));
              return;
            }
            tryEncode(Math.max(1, Math.round(wi * 0.9)), Math.max(1, Math.round(hi * 0.9)), 0);
            return;
          }
          canvas.toBlob(
            function (blob) {
              if (!blob) {
                tryEncode(wi, hi, qi + 1);
                return;
              }
              if (blob.size <= MAX_PHOTO_SITE) {
                resolve(new File([blob], "photo.jpg", { type: "image/jpeg" }));
                return;
              }
              tryEncode(wi, hi, qi + 1);
            },
            "image/jpeg",
            qualities[qi]
          );
        }

        tryEncode(w, h, 0);
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not read this photo."));
      };
      img.src = objectUrl;
    });
  }

  function xhrProgress(xhr, onProgress) {
    xhr.upload.onprogress = function (e) {
      if (!onProgress) return;
      if (e.lengthComputable && e.total > 0) {
        var pct = Math.min(100, Math.round((e.loaded / e.total) * 100));
        onProgress(pct, "upload", e.loaded, e.total);
      } else {
        onProgress(null, "upload", e.loaded, 0);
      }
    };
  }

  function postThinkingMultipart(apiUrl, fd, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", apiUrl);
      xhrProgress(xhr, onProgress);
      xhr.onload = function () {
        if (onProgress) onProgress(100, "processing");
        var data;
        try {
          data = JSON.parse(xhr.responseText || "{}");
        } catch (parseErr) {
          reject(new Error("Could not parse API response."));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
          return;
        }
        reject(new Error(data.error || "Request failed"));
      };
      xhr.onerror = function () {
        reject(new Error("Upload failed — check your connection and try again."));
      };
      xhr.onabort = function () {
        reject(new Error("Upload cancelled."));
      };
      xhr.send(fd);
    });
  }

  function putFileToPresignedUrl(url, file, contentType, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
      xhrProgress(xhr, onProgress);
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        reject(new Error("Direct upload failed (HTTP " + xhr.status + "). Try again."));
      };
      xhr.onerror = function () {
        reject(new Error("Direct upload failed — check your connection."));
      };
      xhr.onabort = function () {
        reject(new Error("Upload cancelled."));
      };
      xhr.send(file);
    });
  }

  async function postJson(apiUrl, body) {
    var res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  async function callThinkingVideoAPI(apiUrl, pw, text, videoFile, videoPoster, onProgress) {
    var mimeType = resolveVideoMimeForUpload(videoFile);
    var initRes = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: pw,
        action: "thinking-video-upload-url",
        mimeType: mimeType,
        fileName: videoFile.name,
        size: videoFile.size,
      }),
    });
    var init = await initRes.json();
    if (!initRes.ok) {
      if (initRes.status === 503 || (init.error && init.error.indexOf("not configured") !== -1)) {
        var fd = new FormData();
        fd.append("password", pw);
        fd.append("action", "thinking");
        fd.append("text", text);
        fd.append("video", videoFile);
        if (videoPoster) fd.append("video_poster", videoPoster, "poster.jpg");
        if (onProgress) return postThinkingMultipart(apiUrl, fd, onProgress);
        var fallbackRes = await fetch(apiUrl, { method: "POST", body: fd });
        var fallbackData = await fallbackRes.json();
        if (!fallbackRes.ok) throw new Error(fallbackData.error || "Request failed");
        return fallbackData;
      }
      throw new Error(init.error || "Request failed");
    }

    await putFileToPresignedUrl(init.uploadUrl, videoFile, init.mimeType, onProgress);
    if (videoPoster && init.posterUploadUrl) {
      await putFileToPresignedUrl(init.posterUploadUrl, videoPoster, "image/jpeg", null);
    }
    if (onProgress) onProgress(100, "processing");

    return postJson(apiUrl, {
      password: pw,
      action: "thinking",
      text: text,
      video_key: init.key,
      video_mime: init.mimeType,
    });
  }

  async function callThinkingAPI(apiUrl, pw, text, photoFiles, blueskyPhotoFiles, audioFile, videoFile, videoPoster, onProgress) {
    if (videoFile) {
      return callThinkingVideoAPI(apiUrl, pw, text, videoFile, videoPoster, onProgress);
    }
    var photos = Array.isArray(photoFiles) ? photoFiles.filter(Boolean) : photoFiles ? [photoFiles] : [];
    // Positional, one per photo: null means "no Bluesky copy needed" and is
    // sent as an empty file so the Worker pairs each copy with its photo.
    var blueskyPhotos = Array.isArray(blueskyPhotoFiles)
      ? blueskyPhotoFiles
      : blueskyPhotoFiles
        ? [blueskyPhotoFiles]
        : [];
    if (photos.length || audioFile) {
      var fd = new FormData();
      fd.append("password", pw);
      fd.append("action", "thinking");
      fd.append("text", text);
      for (var i = 0; i < photos.length; i++) fd.append("photo", photos[i]);
      if (blueskyPhotos.some(Boolean)) {
        for (var j = 0; j < blueskyPhotos.length; j++) {
          fd.append("photo_bluesky", blueskyPhotos[j] || new Blob([]), "bluesky.jpg");
        }
      }
      if (audioFile) fd.append("audio", audioFile);
      if (onProgress) return postThinkingMultipart(apiUrl, fd, onProgress);
      var res = await fetch(apiUrl, { method: "POST", body: fd });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data;
    }
    return postJson(apiUrl, { password: pw, action: "thinking", text: text });
  }

  function thinkingUploadShowsProgress(videoFile, audioFile, photoFile) {
    if (videoFile) return true;
    if (audioFile && audioFile.size > 500 * 1024) return true;
    if (photoFile && photoFile.size > 500 * 1024) return true;
    return false;
  }

  /** The save result as status text: one line for the site, one per platform that complained. */
  function formatSaveStatus(result) {
    var lines = ["rommy.blog: Posted — it's live now."];
    if (result.microblogWarning) lines.push(result.microblogWarning);
    if (result.blueskyWarning) {
      lines.push(result.blueskyWarning);
    } else if (result.blueskyCompressed) {
      lines.push("Bluesky: Posted a compressed copy (under 2 MB).");
    }
    if (result.mastodonWarning) lines.push(result.mastodonWarning);
    var warn = !!(result.microblogWarning || result.blueskyWarning || result.mastodonWarning);
    return { text: lines.join("\n"), warn: warn };
  }

  function markup(p) {
    return (
      '<form class="thinking-composer-form">' +
      '<label for="' + p + '-text">Thought</label>' +
      '<textarea id="' + p + '-text" class="thinking-composer-text" placeholder="What\'s on your mind? (optional if you add photos, audio, or video)"></textarea>' +
      '<div class="thinking-meta-row"><div class="thinking-media-pickers">' +
      '<div class="thinking-photo-upload">' +
      '<input id="' + p + '-photo" class="thinking-photo-input" data-role="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple />' +
      '<div class="thinking-photo-picker">' +
      '<label for="' + p + '-photo" class="thinking-photo-icon-btn" title="Add photos (up to 4)" aria-label="Add photos (up to 4)">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect><circle cx="9" cy="9" r="2" fill="currentColor"></circle><path fill="currentColor" d="M6 18h12l-4.5-6-2.5 3-2-2.5L6 18z"></path></svg>' +
      '</label><span class="thinking-photo-name" data-role="photo-name">No photos</span></div></div>' +
      '<div class="thinking-photo-upload">' +
      '<input id="' + p + '-audio" class="thinking-photo-input" data-role="audio" type="file" accept="audio/mp4,audio/x-m4a,audio/m4a,audio/mpeg,.m4a,.mp3" />' +
      '<div class="thinking-photo-picker">' +
      '<label for="' + p + '-audio" class="thinking-photo-icon-btn" title="Add audio (Voice Memos)" aria-label="Add audio">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"></rect><path fill="none" stroke="currentColor" stroke-width="2" d="M5 11a7 7 0 0 0 14 0"></path><path fill="none" stroke="currentColor" stroke-width="2" d="M12 18v3"></path></svg>' +
      '</label><span class="thinking-photo-name" data-role="audio-name">No audio</span></div></div>' +
      '<div class="thinking-photo-upload">' +
      '<input id="' + p + '-video" class="thinking-photo-input" data-role="video" type="file" accept="video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v" />' +
      '<div class="thinking-photo-picker">' +
      '<label for="' + p + '-video" class="thinking-photo-icon-btn" title="Add video (MP4 or iPhone MOV)" aria-label="Add video">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"></rect><path fill="currentColor" d="M16 10.5l5-3v9l-5-3v-3z"></path></svg>' +
      '</label><span class="thinking-photo-name" data-role="video-name">No video</span></div></div>' +
      '</div><p class="thinking-char-count" data-role="count" aria-live="polite">0 / 300</p></div>' +
      '<p class="thinking-photo-warn" data-role="warn" hidden></p>' +
      '<div class="thinking-photo-previews" data-role="previews" hidden></div>' +
      '<audio class="thinking-audio-preview" data-role="audio-preview" controls hidden></audio>' +
      '<video class="thinking-video-preview" data-role="video-preview" controls playsinline hidden></video>' +
      '<button type="button" class="thinking-composer-secondary" data-role="remove" hidden>Remove media</button>' +
      '<button type="submit" class="thinking-composer-submit" data-role="submit">Save</button>' +
      '<div class="thinking-upload-progress" data-role="progress" hidden>' +
      '<progress max="100" value="0"></progress><p class="thinking-upload-progress-label"></p></div>' +
      '<p class="thinking-composer-status" data-role="status" hidden></p>' +
      "</form>"
    );
  }

  function mount(container, options) {
    var opts = options || {};
    var apiUrl = opts.apiUrl;
    var getPassword = opts.getPassword || function () { return null; };
    var signedOut = opts.signedOutMessage || "You need to be signed in.";
    var onSaved = opts.onSaved || function () {};

    container.classList.add("thinking-composer");
    container.innerHTML = markup(opts.idPrefix || "t");
    function q(role) {
      return container.querySelector('[data-role="' + role + '"]');
    }
    var form = container.querySelector("form");
    var textInput = container.querySelector("textarea");
    var status = q("status");
    var submit = q("submit");
    var charCount = q("count");
    var photoInput = q("photo");
    var audioInput = q("audio");
    var videoInput = q("video");
    var photoPreviews = q("previews");
    var audioPreview = q("audio-preview");
    var videoPreview = q("video-preview");
    var photoWarn = q("warn");
    var mediaRemove = q("remove");
    var photoName = q("photo-name");
    var audioName = q("audio-name");
    var videoName = q("video-name");
    var progressWrap = q("progress");
    var progressBar = progressWrap.querySelector("progress");
    var progressLabel = progressWrap.querySelector("p");
    var photoPreviewUrls = [];
    var videoPosterPromise = null;

    function showStatus(msg, isErr, isOk, isWarn) {
      status.hidden = false;
      status.textContent = msg;
      status.className =
        "thinking-composer-status" + (isErr ? " err" : isWarn ? " warn" : isOk ? " ok" : "");
    }

    function setProgress(visible, pct, label) {
      progressWrap.hidden = !visible;
      if (pct == null) progressBar.removeAttribute("value");
      else progressBar.value = pct;
      progressLabel.textContent = label || "";
    }

    function hideProgress() {
      setProgress(false, 0, "");
    }

    function captureVideoPosterBlob(videoEl) {
      return new Promise(function (resolve) {
        var settled = false;
        function settle(blob) {
          if (settled) return;
          settled = true;
          resolve(blob || null);
        }

        function snap() {
          try {
            var vw = videoEl.videoWidth;
            var vh = videoEl.videoHeight;
            if (!vw || !vh) {
              settle(null);
              return;
            }
            var canvas = document.createElement("canvas");
            canvas.width = GRID_POSTER_SIZE;
            canvas.height = GRID_POSTER_SIZE;
            var ctx = canvas.getContext("2d");
            var scale = Math.max(GRID_POSTER_SIZE / vw, GRID_POSTER_SIZE / vh);
            var dw = vw * scale;
            var dh = vh * scale;
            ctx.drawImage(videoEl, (GRID_POSTER_SIZE - dw) / 2, (GRID_POSTER_SIZE - dh) / 2, dw, dh);
            canvas.toBlob(
              function (blob) {
                settle(blob);
              },
              "image/jpeg",
              0.82
            );
          } catch (err) {
            settle(null);
          }
        }

        function seekAndSnap() {
          var sought = false;
          function finish() {
            if (sought) return;
            sought = true;
            snap();
          }
          videoEl.addEventListener("seeked", finish, { once: true });
          try {
            videoEl.currentTime = 0.001;
          } catch (err) {
            finish();
          }
          setTimeout(finish, 1500);
        }

        if (videoEl.readyState >= 2) {
          seekAndSnap();
        } else {
          // Clear the deadline once data arrives: a decode that lands just
          // under it would otherwise lose the race and have its frame
          // thrown away, since the first settle wins.
          var dataDeadline = setTimeout(function () {
            settle(null);
          }, 8000);
          videoEl.addEventListener(
            "loadeddata",
            function () {
              clearTimeout(dataDeadline);
              seekAndSnap();
            },
            { once: true }
          );
        }
      });
    }

    function queueVideoPosterCapture() {
      // Start on selection and keep the promise, rather than assigning a
      // blob to a variable that submit reads whenever it happens to run.
      // Posting straight after choosing a file used to beat the capture and
      // upload no poster at all, leaving a permanently blank grid tile.
      videoPosterPromise = captureVideoPosterBlob(videoPreview);
    }

    function selectedPhotoFiles() {
      if (!photoInput.files || !photoInput.files.length) return [];
      return Array.prototype.slice.call(photoInput.files, 0, MAX_THINKING_PHOTOS);
    }

    function anyMediaSelected() {
      return !!(
        selectedPhotoFiles().length ||
        (audioInput.files && audioInput.files[0]) ||
        (videoInput.files && videoInput.files[0])
      );
    }

    function clearPhotoPreviews() {
      photoPreviewUrls.forEach(function (u) {
        URL.revokeObjectURL(u);
      });
      photoPreviewUrls = [];
      photoPreviews.innerHTML = "";
      photoPreviews.hidden = true;
    }

    function renderPhotoPreviews(files) {
      clearPhotoPreviews();
      if (!files.length) return;
      files.forEach(function (file) {
        var url = URL.createObjectURL(file);
        photoPreviewUrls.push(url);
        var img = document.createElement("img");
        img.src = url;
        img.alt = file.name || "Photo preview";
        photoPreviews.appendChild(img);
      });
      photoPreviews.hidden = false;
    }

    function revokeVideoPreviewUrl() {
      if (videoPreview._objectUrl) {
        URL.revokeObjectURL(videoPreview._objectUrl);
        videoPreview._objectUrl = null;
      }
    }

    function updateCharCount() {
      var n = textInput.value.length;
      charCount.textContent = n + " / " + THINKING_SOFT_MAX;
      charCount.classList.toggle("over-limit", n > THINKING_SOFT_MAX);
    }
    textInput.addEventListener("input", updateCharCount);
    updateCharCount();

    function setWarn(text) {
      photoWarn.textContent = text || "";
      photoWarn.hidden = !text;
    }

    function clearPhotoSelection() {
      photoInput.value = "";
      clearPhotoPreviews();
      photoName.textContent = "No photos";
    }

    function clearAudioSelection() {
      audioInput.value = "";
      audioPreview.hidden = true;
      audioPreview.removeAttribute("src");
      if (audioPreview._objectUrl) {
        URL.revokeObjectURL(audioPreview._objectUrl);
        audioPreview._objectUrl = null;
      }
      audioName.textContent = "No audio";
    }

    function clearVideoSelection() {
      videoInput.value = "";
      videoPreview.hidden = true;
      videoPreview.removeAttribute("src");
      revokeVideoPreviewUrl();
      videoName.textContent = "No video";
      videoPosterPromise = null;
    }

    function clearMedia() {
      clearPhotoSelection();
      clearAudioSelection();
      clearVideoSelection();
      mediaRemove.hidden = true;
      setWarn("");
    }

    mediaRemove.addEventListener("click", clearMedia);

    photoInput.addEventListener("change", function () {
      var allFiles = photoInput.files ? Array.prototype.slice.call(photoInput.files) : [];
      if (!allFiles.length) {
        clearPhotoSelection();
        if (!anyMediaSelected()) mediaRemove.hidden = true;
        return;
      }
      clearAudioSelection();
      clearVideoSelection();
      var files = allFiles.slice(0, MAX_THINKING_PHOTOS);
      renderPhotoPreviews(files);
      mediaRemove.hidden = false;
      photoName.textContent =
        files.length === 1
          ? files[0].name
          : files.length + " photos" + (allFiles.length > MAX_THINKING_PHOTOS ? " (max 4)" : "");
      var tooBig = files.find(function (f) {
        return f.size > MAX_PHOTO_INPUT;
      });
      var needsSiteCompress = files.some(function (f) {
        return f.size > MAX_PHOTO_SITE;
      });
      var needsBluesky = files.some(function (f) {
        return f.size > MAX_PHOTO_BLUESKY;
      });
      if (allFiles.length > MAX_THINKING_PHOTOS) {
        setWarn("Only the first " + MAX_THINKING_PHOTOS + " photos will be uploaded.");
      } else if (tooBig) {
        setWarn("A file is " + formatBytes(tooBig.size) + " (max 25 MB each).");
      } else if (needsSiteCompress) {
        setWarn("One or more photos are over 5 MB — they will be compressed on upload.");
      } else if (needsBluesky) {
        setWarn(
          "Bluesky: one or more photos exceed 2 MB. Compressed copies will be sent to Bluesky; rommy.blog and micro.blog keep the originals."
        );
      } else {
        setWarn("");
      }
    });

    audioInput.addEventListener("change", function () {
      var file = audioInput.files && audioInput.files[0];
      if (!file) {
        clearAudioSelection();
        if (!anyMediaSelected()) mediaRemove.hidden = true;
        return;
      }
      clearPhotoSelection();
      clearVideoSelection();
      if (audioPreview._objectUrl) URL.revokeObjectURL(audioPreview._objectUrl);
      audioPreview._objectUrl = URL.createObjectURL(file);
      audioPreview.src = audioPreview._objectUrl;
      audioPreview.hidden = false;
      mediaRemove.hidden = false;
      audioName.textContent = file.name;
      setWarn(
        file.size > MAX_PHOTO_INPUT
          ? "This file is " + formatBytes(file.size) + " (max 25 MB)."
          : "Audio plays on rommy.blog; Bluesky, Mastodon, and Micro.blog get a link only."
      );
    });

    videoInput.addEventListener("change", function () {
      var file = videoInput.files && videoInput.files[0];
      if (!file) {
        clearVideoSelection();
        if (!anyMediaSelected()) mediaRemove.hidden = true;
        return;
      }
      clearPhotoSelection();
      clearAudioSelection();
      if (!isAllowedThinkingVideo(file)) {
        clearVideoSelection();
        setWarn("Use MP4 or MOV (iPhone camera / Photos).");
        return;
      }
      revokeVideoPreviewUrl();
      videoPreview._objectUrl = URL.createObjectURL(file);
      // captureVideoPosterBlob waits for readyState itself, so start it
      // here rather than from a "loadeddata" listener: iOS Safari will not
      // pull media data for a video nobody has played, so that event can
      // never fire and the capture would never even begin. preload="auto"
      // nudges it to decode enough of the local blob to yield a frame.
      videoPreview.preload = "auto";
      videoPreview.src = videoPreview._objectUrl;
      videoPreview.hidden = false;
      queueVideoPosterCapture();
      mediaRemove.hidden = false;
      videoName.textContent = file.name;
      setWarn(
        file.size > MAX_VIDEO_INPUT
          ? "This file is " + formatBytes(file.size) + " (max 100 MB)."
          : "MP4 or MOV from iPhone. Plays on rommy.blog; syndication sends text and a link to the post."
      );
    });

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var pw = getPassword();
      if (!pw) {
        showStatus(signedOut, true);
        return;
      }
      var text = textInput.value.trim();
      var photoFiles = selectedPhotoFiles();
      var audioFile = audioInput.files && audioInput.files[0];
      var videoFile = videoInput.files && videoInput.files[0];
      if (!text && !photoFiles.length && !audioFile && !videoFile) {
        showStatus("Add text, photos, audio, or video.", true);
        return;
      }
      if ([photoFiles.length > 0, audioFile, videoFile].filter(Boolean).length > 1) {
        showStatus("Add photos, audio, or video — not more than one kind.", true);
        return;
      }
      var oversizedPhoto = photoFiles.find(function (f) {
        return f.size > MAX_PHOTO_INPUT;
      });
      if (oversizedPhoto) {
        showStatus("Each photo must be 25 MB or smaller (one is " + formatBytes(oversizedPhoto.size) + ").", true);
        return;
      }
      if (audioFile && audioFile.size > MAX_PHOTO_INPUT) {
        showStatus("Audio must be 25 MB or smaller (yours is " + formatBytes(audioFile.size) + ").", true);
        return;
      }
      if (videoFile && !isAllowedThinkingVideo(videoFile)) {
        showStatus("Video must be MP4 or MOV (iPhone).", true);
        return;
      }
      if (videoFile && videoFile.size > MAX_VIDEO_INPUT) {
        showStatus("Video must be 100 MB or smaller (yours is " + formatBytes(videoFile.size) + ").", true);
        return;
      }
      submit.disabled = true;
      var largestPhoto = photoFiles.reduce(function (max, f) {
        return !max || f.size > max.size ? f : max;
      }, null);
      var useProgress = thinkingUploadShowsProgress(videoFile, audioFile, largestPhoto);
      if (useProgress) {
        status.hidden = true;
        setProgress(true, 0, videoFile ? "Uploading video… 0%. Keep this page open." : "Uploading… 0%. Keep this page open.");
      } else {
        hideProgress();
        showStatus("Saving to rommy.blog…", false);
      }
      try {
        var blueskyFiles = [];
        var sitePhotos = photoFiles.slice();
        if (sitePhotos.length) {
          if (!useProgress) showStatus("Preparing photos…", false);
          for (var pi = 0; pi < sitePhotos.length; pi++) {
            sitePhotos[pi] = await compressPhotoForSite(sitePhotos[pi]);
            blueskyFiles.push(await compressPhotoForBluesky(sitePhotos[pi]));
          }
        }
        var onProgress = useProgress
          ? function (pct, phase, loaded) {
              if (phase === "processing") {
                setProgress(true, 100, "Publishing — cross-posting, then it goes live.");
                return;
              }
              var label = videoFile
                ? "Uploading video"
                : audioFile
                  ? "Uploading audio"
                  : "Uploading photo" + (sitePhotos.length > 1 ? "s" : "");
              if (pct == null) {
                setProgress(true, null, label + "… " + formatBytes(loaded) + " sent. Keep this page open.");
              } else {
                setProgress(true, pct, label + "… " + pct + "%. Keep this page open.");
              }
            }
          : null;
        var videoPoster = videoFile && videoPosterPromise ? await videoPosterPromise : null;
        var result = await callThinkingAPI(
          apiUrl,
          pw,
          textInput.value,
          sitePhotos,
          blueskyFiles,
          audioFile || null,
          videoFile || null,
          videoPoster,
          onProgress
        );
        hideProgress();
        var out = formatSaveStatus(result);
        showStatus(out.text, false, !out.warn, out.warn);
        textInput.value = "";
        updateCharCount();
        clearMedia();
        onSaved(result);
      } catch (err) {
        hideProgress();
        var errMsg = err.message || "Request failed";
        if (!/^rommy\.blog:|^micro\.blog:|^Bluesky:|^Mastodon:/i.test(errMsg)) {
          errMsg = "rommy.blog: " + errMsg;
        }
        showStatus(errMsg, true);
      } finally {
        submit.disabled = false;
      }
    });

    return {
      focus: function () {
        textInput.focus({ preventScroll: true });
      },
    };
  }

  window.ThinkingComposer = {
    mount: mount,
    compressPhotoForSite: compressPhotoForSite,
    formatBytes: formatBytes,
    MAX_PHOTO_INPUT: MAX_PHOTO_INPUT,
  };
})();

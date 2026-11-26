/*
 * The admin Health tab: an Oura dashboard. Fetched the first time the tab is
 * opened (loadOuraDashboard in admin/index.html), then draws everything from
 * one `oura-dashboard` Worker action (getOuraDashboard in worker/oura.mjs,
 * shaped by scripts/lib/oura-metrics.mjs).
 *
 * Charts are hand-drawn SVG, no library. Colours come from the .oura-dash
 * tokens in admin/index.html (validated for both themes' page colours); text
 * always uses the page's text colours, never a series colour. Every chart has
 * a hover read-out, and the trend data is also a table.
 */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var TZ = "America/New_York";
  var RANGES = [
    { key: "7", label: "7d" },
    { key: "30", label: "30d" },
    { key: "90", label: "90d" },
    { key: "365", label: "1y" },
    { key: "all", label: "All" },
  ];
  var RANGE_KEY = "oura-range";
  var STRIDE_M = 0.762; // the /now/ Walking line's stride (distanceTextFromSteps)

  // ── Formatting ──────────────────────────────────────────────────────────

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    return n;
  }
  var has = function (v) { return v !== null && v !== undefined && !Number.isNaN(v); };
  function int(v) { return has(v) ? Math.round(v).toLocaleString("en-US") : "—"; }
  function dur(sec) {
    if (!has(sec)) return "—";
    var m = Math.round(sec / 60);
    var h = Math.floor(m / 60);
    return h ? h + "h " + String(m % 60).padStart(2, "0") + "m" : m + "m";
  }
  function hoursShort(sec) { return has(sec) ? (sec / 3600).toFixed(1) + "h" : "—"; }
  function signed(v, digits) {
    if (!has(v)) return "—";
    var s = v.toFixed(digits);
    return v > 0 ? "+" + s : s;
  }
  function miles(steps) { return has(steps) ? ((steps * STRIDE_M) / 1609.344).toFixed(1) + " mi" : "—"; }
  function dayDate(iso) { return new Date(iso + "T12:00:00Z"); }
  var fmtDayLong = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  var fmtDayShort = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  var fmtMonth = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  var fmtTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
  var fmtHour = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: TZ });
  function addDays(iso, n) {
    var d = dayDate(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function ago(iso) {
    if (!iso) return "never";
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 90) return "just now";
    if (s < 5400) return Math.round(s / 60) + " min ago";
    if (s < 129600) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " days ago";
  }

  // ── Metric definitions for the trends ───────────────────────────────────

  var METRICS = {
    steps: { label: "Steps", fmt: int, delta: function (v) { return has(v) ? (v < 0 ? "−" : "+") + int(Math.abs(v)) : "—"; } },
    activityScore: { label: "Activity", fmt: int, delta: function (v) { return signed(v, 1); } },
    sleepScore: { label: "Sleep", fmt: int, delta: function (v) { return signed(v, 1); } },
    readinessScore: { label: "Readiness", fmt: int, delta: function (v) { return signed(v, 1); } },
    totalSleep: { label: "Total sleep", fmt: dur, delta: function (v) { return has(v) ? (v < 0 ? "−" : "+") + dur(Math.abs(v)) : "—"; } },
    restingHr: { label: "Resting heart rate", fmt: function (v) { return has(v) ? Math.round(v) + " bpm" : "—"; }, delta: function (v) { return signed(v, 1) + " bpm"; } },
    hrv: { label: "HRV", fmt: function (v) { return has(v) ? Math.round(v) + " ms" : "—"; }, delta: function (v) { return signed(v, 1) + " ms"; } },
    tempDev: { label: "Temperature", fmt: function (v) { return has(v) ? signed(v, 2) + " °C" : "—"; }, delta: function (v) { return signed(v, 2) + " °C"; } },
  };

  // ── Tooltip (one per dashboard) ─────────────────────────────────────────

  function makeTip(root) {
    var tip = el("div", "oura-tip");
    tip.hidden = true;
    root.appendChild(tip);
    return {
      show: function (lines, clientX, clientY) {
        tip.textContent = "";
        lines.forEach(function (l, i) {
          var row = el("div", i === 0 ? "oura-tip-head" : "oura-tip-row");
          if (l.swatch) {
            var sw = el("span", "oura-swatch");
            sw.style.background = l.swatch;
            row.appendChild(sw);
          }
          row.appendChild(document.createTextNode(l.text));
          tip.appendChild(row);
        });
        tip.hidden = false;
        var box = root.getBoundingClientRect();
        var w = tip.offsetWidth;
        var x = clientX - box.left + 14;
        if (x + w > box.width) x = clientX - box.left - w - 14;
        tip.style.left = Math.max(0, x) + "px";
        tip.style.top = clientY - box.top + 14 + "px";
      },
      hide: function () { tip.hidden = true; },
    };
  }

  // ── Chart primitives ────────────────────────────────────────────────────

  /** Round axis bounds and a round step (1, 2, 2.5 or 5 × a power of ten). */
  function niceScale(lo, hi, target) {
    if (!(hi > lo)) hi = lo + 1;
    var raw = (hi - lo) / (target || 3);
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / p;
    var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step: step };
  }
  function ticks(min, max, step) {
    var out = [];
    for (var v = min; v <= max + step / 1000; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }
  // One style per axis: compact (5K, 10K) on an axis that reaches 10,000.
  function axisLabel(v, fmtAxis, compact) {
    if (fmtAxis) return fmtAxis(v);
    if (compact) return v === 0 ? "0" : Math.round(v / 100) / 10 + "K";
    return Math.round(v).toLocaleString("en-US");
  }
  function css(name) { return "var(" + name + ")"; }

  /**
   * A day-by-day chart frame: y gridlines with labels, x labels at a few days,
   * a hover column that reports the day under the pointer. `draw` paints the
   * marks given the scales; `tipLines(row)` gives the read-out.
   */
  function dayChart(opts) {
    var rows = opts.rows;
    var W = Math.max(280, opts.width);
    var H = opts.height || 150;
    var M = { top: 8, right: 8, bottom: 20, left: 40 };
    var iw = W - M.left - M.right;
    var ih = H - M.top - M.bottom;
    var n = rows.length;
    var band = n ? iw / n : iw;
    var x = function (i) { return M.left + band * i + band / 2; };
    var y = function (v) { return M.top + ih - ((v - opts.yMin) / (opts.yMax - opts.yMin)) * ih; };

    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", role: "img", "aria-label": opts.label, class: "oura-chart" });
    ticks(opts.yMin, opts.yMax, opts.yStep).forEach(function (t) {
      s.appendChild(svg("line", { x1: M.left, x2: W - M.right, y1: y(t), y2: y(t), class: "oura-grid" }));
      var lab = svg("text", { x: M.left - 6, y: y(t) + 3, "text-anchor": "end", class: "oura-axis" });
      lab.textContent = axisLabel(t, opts.fmtAxis, Math.max(Math.abs(opts.yMin), Math.abs(opts.yMax)) >= 10000);
      s.appendChild(lab);
    });
    // x labels: about five, at even spacing, first and last included.
    var count = Math.min(5, n);
    for (var k = 0; k < count && n; k++) {
      var i = count === 1 ? 0 : Math.round((k * (n - 1)) / (count - 1));
      var lab2 = svg("text", { x: x(i), y: H - 5, "text-anchor": k === 0 ? "start" : k === count - 1 ? "end" : "middle", class: "oura-axis" });
      if (k === 0) lab2.setAttribute("x", M.left);
      if (k === count - 1) lab2.setAttribute("x", W - M.right);
      lab2.textContent = n > 120 ? fmtMonth.format(dayDate(rows[i].day)) : fmtDayShort.format(dayDate(rows[i].day));
      s.appendChild(lab2);
    }
    var marks = svg("g", {});
    s.appendChild(marks);
    opts.draw(marks, { x: x, y: y, band: band, M: M, ih: ih, W: W, H: H });

    var cross = svg("line", { y1: M.top, y2: M.top + ih, class: "oura-cross", visibility: "hidden" });
    s.appendChild(cross);
    var hit = svg("rect", { x: M.left, y: M.top, width: iw, height: ih, fill: "transparent" });
    s.appendChild(hit);
    function at(evt) {
      var r = s.getBoundingClientRect();
      var px = ((evt.clientX - r.left) / r.width) * W;
      var i = Math.floor((px - M.left) / band);
      return Math.max(0, Math.min(n - 1, i));
    }
    hit.addEventListener("pointermove", function (evt) {
      if (!n) return;
      var i = at(evt);
      cross.setAttribute("x1", x(i));
      cross.setAttribute("x2", x(i));
      cross.setAttribute("visibility", "visible");
      opts.tip.show([{ text: fmtDayLong.format(dayDate(rows[i].day)) }].concat(opts.tipLines(rows[i], i)), evt.clientX, evt.clientY);
    });
    hit.addEventListener("pointerleave", function () {
      cross.setAttribute("visibility", "hidden");
      opts.tip.hide();
    });
    return s;
  }

  /** A path through (x, y) points that breaks at missing values. */
  function linePath(rows, key, x, y) {
    var d = "";
    var pen = false;
    rows.forEach(function (r, i) {
      var v = r[key];
      if (!has(v)) { pen = false; return; }
      d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1);
      pen = true;
    });
    return d;
  }

  /** A column with a 4px rounded data end and a square baseline. */
  function column(x, w, yTop, yBase, color) {
    var h = Math.max(0, yBase - yTop);
    if (h <= 0 || w <= 0) return null;
    var r = Math.min(4, w / 2, h);
    var d = "M" + x + " " + yBase + "V" + (yTop + r) + "Q" + x + " " + yTop + " " + (x + r) + " " + yTop +
      "H" + (x + w - r) + "Q" + (x + w) + " " + yTop + " " + (x + w) + " " + (yTop + r) + "V" + yBase + "Z";
    return svg("path", { d: d, fill: color });
  }
  function barWidth(band) {
    var gap = band >= 6 ? 2 : band >= 3 ? 1 : 0;
    return Math.max(1, Math.min(24, band - gap));
  }

  // ── Trend charts ────────────────────────────────────────────────────────

  function rolling(rows, key, days) {
    return rows.map(function (r, i) {
      var vals = [];
      for (var j = Math.max(0, i - days + 1); j <= i; j++) if (has(rows[j][key])) vals.push(rows[j][key]);
      return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : null;
    });
  }

  function stepsChart(rows, width, tip) {
    var avg = rolling(rows, "steps", 7);
    var sc0 = niceScale(0, Math.max.apply(null, rows.map(function (r) { return r.steps || 0; }).concat([1000])), 4);
    return dayChart({
      rows: rows, width: width, tip: tip, yMin: 0, yMax: sc0.max, yStep: sc0.step, label: "Daily steps with a 7-day average",
      draw: function (g, sc) {
        var w = barWidth(sc.band);
        rows.forEach(function (r, i) {
          if (!has(r.steps)) return;
          var c = column(sc.x(i) - w / 2, w, sc.y(r.steps), sc.y(0), css("--viz-1"));
          if (c) g.appendChild(c);
        });
        var d = "";
        var pen = false;
        avg.forEach(function (v, i) {
          if (!has(v)) { pen = false; return; }
          d += (pen ? "L" : "M") + sc.x(i).toFixed(1) + " " + sc.y(v).toFixed(1);
          pen = true;
        });
        g.appendChild(svg("path", { d: d, class: "oura-line oura-line-ink" }));
      },
      tipLines: function (r, i) {
        return [
          { text: int(r.steps) + " steps", swatch: css("--viz-1") },
          { text: "7-day average " + int(avg[i]) },
        ];
      },
    });
  }

  // Past 90 days a daily line is mostly noise: lines plot a 7-day average
  // instead (the hover still gives the day's own value).
  var SMOOTH_AFTER = 92;
  function plotted(rows, key) {
    if (rows.length <= SMOOTH_AFTER) return { rows: rows, key: key, smoothed: false };
    var avg = rolling(rows, key, 7);
    return {
      rows: rows.map(function (r, i) { var o = { day: r.day }; o[key] = has(r[key]) ? avg[i] : null; return o; }),
      key: key,
      smoothed: true,
    };
  }

  var SCORE_SERIES = [
    { key: "readinessScore", label: "Readiness", color: "--viz-1" },
    { key: "sleepScore", label: "Sleep", color: "--viz-2" },
    { key: "activityScore", label: "Activity", color: "--viz-3" },
  ];

  function scoresChart(rows, width, tip) {
    // The axis fits what is drawn: the 7-day averages at long ranges.
    var lo = Math.min.apply(null, SCORE_SERIES.flatMap(function (s) {
      var p = plotted(rows, s.key);
      return p.rows.map(function (r) { return has(r[s.key]) ? r[s.key] : 100; });
    }).concat([100]));
    var sc0 = niceScale(Math.max(0, lo - 3), 100, 3);
    return dayChart({
      rows: rows, width: width, tip: tip, yMin: sc0.min, yMax: 100, yStep: sc0.step, height: 170,
      label: "Readiness, sleep and activity scores",
      draw: function (g, sc) {
        SCORE_SERIES.forEach(function (s) {
          var p = plotted(rows, s.key);
          g.appendChild(svg("path", { d: linePath(p.rows, s.key, sc.x, sc.y), class: "oura-line", stroke: css(s.color) }));
        });
      },
      tipLines: function (r) {
        return SCORE_SERIES.map(function (s) { return { text: s.label + " " + (has(r[s.key]) ? r[s.key] : "—"), swatch: css(s.color) }; });
      },
    });
  }

  var STAGES = [
    { key: "deepSleep", label: "Deep", color: "--stage-deep" },
    { key: "remSleep", label: "REM", color: "--stage-rem" },
    { key: "lightSleep", label: "Light", color: "--stage-light" },
  ];

  function sleepChart(rows, width, tip) {
    var hrs = niceScale(0, Math.max.apply(null, rows.map(function (r) { return r.totalSleep || 0; }).concat([3600])) / 3600, 3);
    var stepH = Math.max(1, hrs.step);
    var maxH = Math.ceil(hrs.max / stepH) * stepH;
    return dayChart({
      rows: rows, width: width, tip: tip, yMin: 0, yMax: maxH * 3600, yStep: stepH * 3600, label: "Sleep by stage, per night",
      fmtAxis: function (v) { return Math.round(v / 3600) + "h"; },
      draw: function (g, sc) {
        var w = barWidth(sc.band);
        var gap = w >= 4 ? 2 : 0;
        rows.forEach(function (r, i) {
          var base = 0;
          STAGES.forEach(function (st, k) {
            var v = r[st.key];
            if (!has(v) || v <= 0) return;
            var yTop = sc.y(base + v);
            var yBase = sc.y(base) - (base > 0 ? gap : 0);
            var mark = k === STAGES.length - 1 || !STAGES.slice(k + 1).some(function (n) { return has(r[n.key]) && r[n.key] > 0; })
              ? column(sc.x(i) - w / 2, w, yTop, yBase, css(st.color))
              : svg("rect", { x: sc.x(i) - w / 2, y: yTop, width: w, height: Math.max(0, yBase - yTop), fill: css(st.color) });
            if (mark) g.appendChild(mark);
            base += v;
          });
        });
      },
      tipLines: function (r) {
        return [{ text: "Total " + dur(r.totalSleep) }].concat(
          STAGES.map(function (st) { return { text: st.label + " " + dur(r[st.key]), swatch: css(st.color) }; })
        );
      },
    });
  }

  function singleLineChart(rows, key, width, tip, label) {
    var vals = plotted(rows, key).rows.map(function (r) { return r[key]; }).filter(has);
    var lo = vals.length ? Math.min.apply(null, vals) : 0;
    var hi = vals.length ? Math.max.apply(null, vals) : 1;
    var sc0 = niceScale(lo - 1, hi + 1, 3);
    return dayChart({
      rows: rows, width: width, tip: tip, yMin: sc0.min, yMax: sc0.max, yStep: sc0.step, label: label,
      draw: function (g, sc) {
        var p = plotted(rows, key);
        g.appendChild(svg("path", { d: linePath(p.rows, key, sc.x, sc.y), class: "oura-line", stroke: css("--viz-1") }));
        if (rows.length <= 31) {
          rows.forEach(function (r, i) {
            if (has(r[key])) g.appendChild(svg("circle", { cx: sc.x(i), cy: sc.y(r[key]), r: 3, class: "oura-dot", fill: css("--viz-1") }));
          });
        }
      },
      tipLines: function (r) { return [{ text: METRICS[key].fmt(r[key]), swatch: css("--viz-1") }]; },
    });
  }

  function tempChart(rows, width, tip) {
    var vals = rows.map(function (r) { return Math.abs(r.tempDev || 0); });
    var m = Math.max(0.5, Math.ceil(Math.max.apply(null, vals.concat([0])) * 2) / 2);
    return dayChart({
      rows: rows, width: width, tip: tip, yMin: -m, yMax: m, yStep: m, label: "Temperature deviation from baseline",
      fmtAxis: function (v) { return signed(v, 1); },
      draw: function (g, sc) {
        var w = barWidth(sc.band);
        rows.forEach(function (r, i) {
          if (!has(r.tempDev) || r.tempDev === 0) return;
          var top = Math.min(sc.y(r.tempDev), sc.y(0));
          var h = Math.abs(sc.y(r.tempDev) - sc.y(0));
          g.appendChild(svg("rect", { x: sc.x(i) - w / 2, y: top, width: w, height: Math.max(1, h), rx: Math.min(2, w / 2), fill: css("--viz-1") }));
        });
        g.appendChild(svg("line", { x1: sc.M.left, x2: sc.W - sc.M.right, y1: sc.y(0), y2: sc.y(0), class: "oura-baseline" }));
      },
      tipLines: function (r) { return [{ text: METRICS.tempDev.fmt(r.tempDev), swatch: css("--viz-1") }]; },
    });
  }

  // ── Day-view figures ────────────────────────────────────────────────────

  /** A 24-hour activity strip from 04:00: column height = intensity. */
  function activityStrip(strip, width, tip) {
    var W = Math.max(280, width);
    var H = 64;
    var M = { top: 4, bottom: 18, left: 0, right: 0 };
    var ih = H - M.top - M.bottom;
    var slot = W / 288;
    var LEVEL = { nonwear: 0, rest: 0.12, inactive: 0.25, low: 0.5, medium: 0.75, high: 1 };
    var LABEL = { nonwear: "Not worn", rest: "Rest", inactive: "Inactive", low: "Low activity", medium: "Medium activity", high: "High activity" };
    var start = Date.parse(strip.start || "");
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", role: "img", "aria-label": "Activity through the day, from 4 a.m.", class: "oura-chart" });
    s.appendChild(svg("line", { x1: 0, x2: W, y1: M.top + ih, y2: M.top + ih, class: "oura-grid" }));
    strip.runs.forEach(function (run) {
      var h = LEVEL[run.level] * ih;
      if (!h) return;
      s.appendChild(svg("rect", { x: run.start * slot, y: M.top + ih - h, width: Math.max(0.5, run.length * slot), height: h, fill: css("--viz-3") }));
    });
    if (Number.isFinite(start)) {
      for (var hr = 0; hr <= 24; hr += 4) {
        var t = svg("text", { x: Math.min(W - 2, Math.max(2, (hr * 12) * slot)), y: H - 4, "text-anchor": hr === 0 ? "start" : hr === 24 ? "end" : "middle", class: "oura-axis" });
        t.textContent = fmtHour.format(new Date(start + hr * 3600000));
        s.appendChild(t);
      }
    }
    var hit = svg("rect", { x: 0, y: 0, width: W, height: M.top + ih, fill: "transparent" });
    s.appendChild(hit);
    hit.addEventListener("pointermove", function (evt) {
      var r = s.getBoundingClientRect();
      var i = Math.max(0, Math.min(287, Math.floor((((evt.clientX - r.left) / r.width) * W) / slot)));
      var run = strip.runs.find(function (x) { return i >= x.start && i < x.start + x.length; });
      if (!run) return;
      var lines = [{ text: Number.isFinite(start) ? fmtTime.format(new Date(start + i * 300000)) : "" }];
      lines.push({ text: LABEL[run.level], swatch: run.level === "nonwear" ? null : css("--viz-3") });
      tip.show(lines, evt.clientX, evt.clientY);
    });
    hit.addEventListener("pointerleave", tip.hide);
    return s;
  }

  var HYP = [
    { stage: "awake", label: "Awake", color: "--stage-awake" },
    { stage: "rem", label: "REM", color: "--stage-rem" },
    { stage: "light", label: "Light", color: "--stage-light" },
    { stage: "deep", label: "Deep", color: "--stage-deep" },
  ];

  /** The night's stages as a stepped band chart: awake at the top, deep at the bottom. */
  function hypnogram(sleep, width, tip) {
    var W = Math.max(280, width);
    var H = 110;
    var M = { top: 4, bottom: 18, left: 46, right: 0 };
    var rowH = (H - M.top - M.bottom) / HYP.length;
    var total = sleep.hypnogram.reduce(function (a, r) { return Math.max(a, r.start + r.length); }, 0) || 1;
    var slot = (W - M.left - M.right) / total;
    var start = Date.parse(sleep.bedtimeStart || "");
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", role: "img", "aria-label": "Sleep stages through the night", class: "oura-chart" });
    HYP.forEach(function (h, k) {
      var t = svg("text", { x: M.left - 6, y: M.top + rowH * k + rowH / 2 + 3, "text-anchor": "end", class: "oura-axis" });
      t.textContent = h.label;
      s.appendChild(t);
      s.appendChild(svg("line", { x1: M.left, x2: W, y1: M.top + rowH * (k + 1), y2: M.top + rowH * (k + 1), class: "oura-grid" }));
    });
    sleep.hypnogram.forEach(function (run) {
      var k = HYP.findIndex(function (h) { return h.stage === run.stage; });
      if (k < 0) return;
      s.appendChild(svg("rect", {
        x: M.left + run.start * slot, y: M.top + rowH * k + 2, width: Math.max(0.5, run.length * slot), height: rowH - 4,
        rx: 2, fill: css(HYP[k].color),
      }));
    });
    if (Number.isFinite(start)) {
      // Labels on whole hours: the first one after bedtime, then every hour
      // (every two on a long night).
      var endMs = start + total * 300000;
      var stepMs = total / 12 > 8 ? 7200000 : 3600000;
      var first = Math.ceil(start / 3600000) * 3600000;
      for (var t = first; t <= endMs; t += stepMs) {
        var px = M.left + ((t - start) / 300000) * slot;
        if (px > W - 14) break;
        var t2 = svg("text", { x: px, y: H - 4, "text-anchor": "middle", class: "oura-axis" });
        t2.textContent = fmtHour.format(new Date(t));
        s.appendChild(t2);
      }
    }
    var hit = svg("rect", { x: M.left, y: 0, width: W - M.left, height: H - M.bottom, fill: "transparent" });
    s.appendChild(hit);
    hit.addEventListener("pointermove", function (evt) {
      var r = s.getBoundingClientRect();
      var i = Math.floor(((((evt.clientX - r.left) / r.width) * W) - M.left) / slot);
      var run = sleep.hypnogram.find(function (x) { return i >= x.start && i < x.start + x.length; });
      if (!run) return;
      var h = HYP.find(function (x) { return x.stage === run.stage; });
      tip.show([
        { text: Number.isFinite(start) ? fmtTime.format(new Date(start + run.start * 300000)) + "–" + fmtTime.format(new Date(start + (run.start + run.length) * 300000)) : "" },
        { text: h.label + " · " + dur(run.length * 300), swatch: css(h.color) },
      ], evt.clientX, evt.clientY);
    });
    hit.addEventListener("pointerleave", tip.hide);
    return s;
  }

  /** Overnight samples (heart rate or HRV) as a line with gaps. */
  function overnightLine(series, unit, width, tip, label) {
    var W = Math.max(280, width);
    var H = 90;
    var M = { top: 6, bottom: 18, left: 46, right: 4 };
    var vals = series.items.filter(has);
    if (!vals.length) return null;
    var lo = Math.floor(Math.min.apply(null, vals) - 3);
    var hi = Math.ceil(Math.max.apply(null, vals) + 3);
    var iw = W - M.left - M.right;
    var ih = H - M.top - M.bottom;
    var n = series.items.length;
    var x = function (i) { return M.left + (n > 1 ? (i / (n - 1)) * iw : 0); };
    var y = function (v) { return M.top + ih - ((v - lo) / (hi - lo)) * ih; };
    var start = Date.parse(series.start || "");
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", role: "img", "aria-label": label, class: "oura-chart" });
    [lo, hi].forEach(function (t) {
      s.appendChild(svg("line", { x1: M.left, x2: W - M.right, y1: y(t), y2: y(t), class: "oura-grid" }));
      var lab = svg("text", { x: M.left - 6, y: y(t) + 3, "text-anchor": "end", class: "oura-axis" });
      lab.textContent = t + " " + unit;
      s.appendChild(lab);
    });
    s.appendChild(svg("path", { d: linePath(series.items.map(function (v) { return { v: v }; }), "v", x, y), class: "oura-line", stroke: css("--viz-1") }));
    var minI = series.items.indexOf(Math.min.apply(null, vals));
    if (unit === "bpm" && minI >= 0) {
      s.appendChild(svg("circle", { cx: x(minI), cy: y(series.items[minI]), r: 4, class: "oura-dot", fill: css("--viz-1") }));
    }
    var cross = svg("line", { y1: M.top, y2: M.top + ih, class: "oura-cross", visibility: "hidden" });
    s.appendChild(cross);
    var hit = svg("rect", { x: M.left, y: M.top, width: iw, height: ih, fill: "transparent" });
    s.appendChild(hit);
    hit.addEventListener("pointermove", function (evt) {
      var r = s.getBoundingClientRect();
      var px = (((evt.clientX - r.left) / r.width) * W - M.left) / iw;
      var i = Math.max(0, Math.min(n - 1, Math.round(px * (n - 1))));
      cross.setAttribute("x1", x(i));
      cross.setAttribute("x2", x(i));
      cross.setAttribute("visibility", "visible");
      tip.show([
        { text: Number.isFinite(start) ? fmtTime.format(new Date(start + i * series.interval * 1000)) : "" },
        { text: has(series.items[i]) ? Math.round(series.items[i]) + " " + unit : "no reading", swatch: css("--viz-1") },
      ], evt.clientX, evt.clientY);
    });
    hit.addEventListener("pointerleave", function () { cross.setAttribute("visibility", "hidden"); tip.hide(); });
    return s;
  }

  // ── Layout pieces ───────────────────────────────────────────────────────

  function stat(label, value, note) {
    var d = el("div", "oura-stat");
    d.appendChild(el("span", "oura-stat-label", label));
    d.appendChild(el("span", "oura-stat-value", value));
    if (note) d.appendChild(el("span", "oura-stat-note", note));
    return d;
  }
  function panel(title) {
    var p = el("section", "oura-panel");
    p.appendChild(el("h3", "oura-panel-title", title));
    return p;
  }
  function legend(items) {
    var l = el("div", "oura-legend");
    items.forEach(function (it) {
      var k = el("span", "oura-legend-item");
      var sw = el("span", "oura-swatch");
      sw.style.background = css(it.color);
      k.appendChild(sw);
      k.appendChild(document.createTextNode(it.label));
      l.appendChild(k);
    });
    return l;
  }
  /** Horizontal magnitude bars for a breakdown (one hue; the label says what). */
  function breakdown(items, total) {
    var wrap = el("div", "oura-breakdown");
    items.forEach(function (it) {
      var row = el("div", "oura-breakdown-row");
      row.appendChild(el("span", "oura-breakdown-label", it.label));
      var track = el("span", "oura-breakdown-track");
      var fill = el("span", "oura-breakdown-fill");
      fill.style.width = total > 0 && has(it.value) ? Math.max(0.5, (it.value / total) * 100) + "%" : "0";
      fill.style.background = css(it.color || "--viz-3");
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("span", "oura-breakdown-value", it.text));
      wrap.appendChild(row);
    });
    return wrap;
  }
  function trendBlock(title, metricKeys, stats, chart, extra) {
    var b = el("section", "oura-trend");
    var head = el("div", "oura-trend-head");
    head.appendChild(el("h3", "oura-panel-title", title));
    b.appendChild(head);
    if (extra) b.appendChild(extra);
    b.appendChild(chart);
    var line = el("p", "oura-trend-stats");
    metricKeys.forEach(function (k, idx) {
      var m = METRICS[k];
      var st = stats[k] || {};
      var parts = [];
      if (metricKeys.length > 1) parts.push(m.label);
      parts.push("avg " + m.fmt(st.avg));
      if (has(st.change)) parts.push(m.delta(st.change) + " vs previous");
      if (st.best) parts.push("best " + m.fmt(st.best.value) + " on " + fmtDayShort.format(dayDate(st.best.day)));
      if (idx) line.appendChild(el("br"));
      line.appendChild(document.createTextNode(parts.join(" · ")));
    });
    b.appendChild(line);
    return b;
  }

  // ── The dashboard ───────────────────────────────────────────────────────

  function mount(root, opts) {
    var callAPI = opts.callAPI;
    var state = { day: null, range: "30", data: null, loading: false };
    try { state.range = localStorage.getItem(RANGE_KEY) || "30"; } catch (e) { /* private mode */ }
    if (!RANGES.some(function (r) { return r.key === state.range; })) state.range = "30";

    root.classList.add("oura-dash");
    root.textContent = "";
    var tip = makeTip(root);
    var dayNav = el("div", "oura-daynav");
    var prev = el("button", "oura-navbtn", "‹");
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous day");
    var next = el("button", "oura-navbtn", "›");
    next.type = "button";
    next.setAttribute("aria-label", "Next day");
    var dayLabel = el("div", "oura-daylabel", "Loading…");
    dayNav.appendChild(prev);
    dayNav.appendChild(dayLabel);
    dayNav.appendChild(next);
    var dayView = el("div", "oura-dayview");
    var trendsHead = el("div", "oura-trends-head");
    trendsHead.appendChild(el("h2", "oura-heading", "Over time"));
    var rangeBar = el("div", "oura-ranges");
    rangeBar.setAttribute("role", "group");
    rangeBar.setAttribute("aria-label", "Range");
    RANGES.forEach(function (r) {
      var b = el("button", "oura-range", r.label);
      b.type = "button";
      b.dataset.range = r.key;
      rangeBar.appendChild(b);
    });
    trendsHead.appendChild(rangeBar);
    var trends = el("div", "oura-trends");
    var footer = el("p", "oura-footer");
    var synced = el("span", "", "");
    var syncBtn = el("button", "oura-syncbtn", "Sync now");
    syncBtn.type = "button";
    footer.appendChild(synced);
    footer.appendChild(syncBtn);
    var status = el("p", "admin-status");
    status.hidden = true;

    var dayHeading = el("h2", "oura-heading", "Day");
    root.appendChild(dayHeading);
    root.appendChild(dayNav);
    root.appendChild(dayView);
    root.appendChild(trendsHead);
    root.appendChild(trends);
    root.appendChild(footer);
    root.appendChild(status);

    function showError(msg) {
      status.hidden = false;
      status.textContent = msg;
    }

    async function load() {
      if (state.loading) return;
      state.loading = true;
      root.classList.add("is-loading");
      try {
        var payload = { action: "oura-dashboard", range: state.range };
        if (state.day) payload.day = state.day;
        state.data = await callAPI(payload);
        state.day = state.data.day;
        status.hidden = true;
        render();
      } catch (err) {
        showError("Could not load Oura data — " + (err.message || "request failed"));
      } finally {
        state.loading = false;
        root.classList.remove("is-loading");
      }
    }

    function width(node) { return Math.round((node || root).clientWidth || root.clientWidth || 600); }

    function renderDay() {
      var d = state.data;
      var det = d.detail;
      dayLabel.textContent = fmtDayLong.format(dayDate(d.day)) + " and the night after";
      prev.disabled = !!d.firstDay && d.day <= d.firstDay;
      next.disabled = d.day >= d.today;
      dayView.textContent = "";

      var scores = el("div", "oura-scores");
      [["Readiness", det.scores.readiness, "next morning"], ["Sleep", det.scores.sleep, "that night"], ["Activity", det.scores.activity, d.day === d.today ? "so far" : ""]].forEach(function (s) {
        var t = el("div", "oura-score");
        t.appendChild(el("span", "oura-stat-label", s[0]));
        t.appendChild(el("span", "oura-score-value", has(s[1]) ? String(s[1]) : "—"));
        if (s[2]) t.appendChild(el("span", "oura-stat-note", s[2]));
        scores.appendChild(t);
      });
      dayView.appendChild(scores);

      var act = panel("Activity");
      if (det.activity) {
        var a = det.activity;
        var row = el("div", "oura-stats");
        row.appendChild(stat("Steps", int(a.steps), miles(a.steps)));
        row.appendChild(stat("Active calories", int(a.activeCalories)));
        row.appendChild(stat("Total calories", int(a.totalCalories)));
        act.appendChild(row);
        var t = a.time;
        var awake = [t.high, t.medium, t.low, t.sedentary].reduce(function (x, v) { return x + (v || 0); }, 0);
        act.appendChild(breakdown([
          { label: "High", value: t.high, text: dur(t.high) },
          { label: "Medium", value: t.medium, text: dur(t.medium) },
          { label: "Low", value: t.low, text: dur(t.low) },
          { label: "Sedentary", value: t.sedentary, text: dur(t.sedentary) },
        ], awake));
        if (a.strip) act.appendChild(activityStrip(a.strip, width(dayView), tip));
      } else {
        act.appendChild(el("p", "oura-empty", "No activity recorded for this day."));
      }
      dayView.appendChild(act);

      var sl = panel("Sleep");
      if (det.sleep) {
        var s = det.sleep;
        var row2 = el("div", "oura-stats");
        row2.appendChild(stat("Total sleep", dur(s.total), "in bed " + dur(s.timeInBed)));
        row2.appendChild(stat("Bedtime", s.bedtimeStart ? fmtTime.format(new Date(s.bedtimeStart)) : "—", s.bedtimeEnd ? "up " + fmtTime.format(new Date(s.bedtimeEnd)) : ""));
        row2.appendChild(stat("Efficiency", has(s.efficiency) ? s.efficiency + "%" : "—", has(s.latency) ? "asleep in " + dur(s.latency) : ""));
        sl.appendChild(row2);
        var total = (s.stages.deep || 0) + (s.stages.rem || 0) + (s.stages.light || 0) + (s.stages.awake || 0);
        sl.appendChild(breakdown([
          { label: "Deep", value: s.stages.deep, text: dur(s.stages.deep), color: "--stage-deep" },
          { label: "REM", value: s.stages.rem, text: dur(s.stages.rem), color: "--stage-rem" },
          { label: "Light", value: s.stages.light, text: dur(s.stages.light), color: "--stage-light" },
          { label: "Awake", value: s.stages.awake, text: dur(s.stages.awake), color: "--stage-awake" },
        ], total));
        if (s.hypnogram && s.hypnogram.length) sl.appendChild(hypnogram(s, width(dayView), tip));
        if (s.heartRate) {
          var hr = overnightLine(s.heartRate, "bpm", width(dayView), tip, "Heart rate through the night");
          if (hr) { sl.appendChild(el("p", "oura-chart-title", "Heart rate")); sl.appendChild(hr); }
        }
        if (s.hrv) {
          var hv = overnightLine(s.hrv, "ms", width(dayView), tip, "HRV through the night");
          if (hv) { sl.appendChild(el("p", "oura-chart-title", "HRV")); sl.appendChild(hv); }
        }
      } else {
        sl.appendChild(el("p", "oura-empty",
          d.day >= d.today ? "Tonight's sleep isn't in yet." :
          d.day === addDays(d.today, -1) ? "Last night isn't synced yet." :
          "No sleep recorded for this night."));
      }
      if (det.naps && det.naps.length) {
        sl.appendChild(el("p", "oura-stat-note", det.naps.map(function (n) {
          return (n.type === "rest" ? "Rest " : "Nap ") + dur(n.total) + (n.start ? " at " + fmtTime.format(new Date(n.start)) : "");
        }).join(" · ")));
      }
      dayView.appendChild(sl);

      var body = panel("Body");
      var b = det.body;
      var row3 = el("div", "oura-stats");
      row3.appendChild(stat("Resting heart rate", has(b.restingHr) ? b.restingHr + " bpm" : "—", has(b.averageHr) ? "avg " + Math.round(b.averageHr) + " bpm" : ""));
      row3.appendChild(stat("HRV", has(b.hrv) ? Math.round(b.hrv) + " ms" : "—"));
      row3.appendChild(stat("Temperature", has(b.tempDev) ? signed(b.tempDev, 2) + " °C" : "—", "from baseline"));
      row3.appendChild(stat("Breathing", has(b.breath) ? b.breath.toFixed(1) + " /min" : "—"));
      row3.appendChild(stat("Stress", has(b.stressHigh) ? dur(b.stressHigh) : "—", has(b.recoveryHigh) ? "recovery " + dur(b.recoveryHigh) : ""));
      row3.appendChild(stat("SpO2", has(b.spo2) ? b.spo2.toFixed(1) + "%" : "—", has(b.breathingDisturbance) ? "breathing index " + b.breathingDisturbance : ""));
      body.appendChild(row3);
      dayView.appendChild(body);
    }

    function renderTrends() {
      var d = state.data;
      rangeBar.querySelectorAll(".oura-range").forEach(function (b) {
        b.setAttribute("aria-pressed", b.dataset.range === d.range ? "true" : "false");
      });
      trends.textContent = "";
      var rows = d.series;
      if (!rows.length) {
        trends.appendChild(el("p", "oura-empty", "Nothing stored for this range yet."));
        return;
      }
      var w = width(trends);
      trends.appendChild(trendBlock("Steps", ["steps"], d.stats, stepsChart(rows, w, tip), legend([{ label: "Steps", color: "--viz-1" }, { label: "7-day average", color: "--text" }])));
      trends.appendChild(trendBlock("Scores", ["readinessScore", "sleepScore", "activityScore"], d.stats, scoresChart(rows, w, tip),
        legend(SCORE_SERIES.map(function (s) { return { label: s.label, color: s.color }; }))));
      trends.appendChild(trendBlock("Sleep", ["totalSleep"], d.stats, sleepChart(rows, w, tip),
        legend(STAGES.map(function (s) { return { label: s.label, color: s.color }; }))));
      trends.appendChild(trendBlock("Resting heart rate", ["restingHr"], d.stats, singleLineChart(rows, "restingHr", w, tip, "Resting heart rate per night")));
      trends.appendChild(trendBlock("HRV", ["hrv"], d.stats, singleLineChart(rows, "hrv", w, tip, "Average HRV per night")));
      trends.appendChild(trendBlock("Temperature", ["tempDev"], d.stats, tempChart(rows, w, tip)));
      if (rows.length > SMOOTH_AFTER) {
        trends.insertBefore(el("p", "oura-stat-note", "Lines show a 7-day average at this range; hover for each day's value."), trends.firstChild);
      }
      trends.appendChild(dataTable(rows));
    }

    function dataTable(rows) {
      var det = el("details", "oura-table-wrap");
      det.appendChild(el("summary", "", "Table"));
      var table = el("table", "oura-table");
      var cols = [
        ["Day", function (r) { return fmtDayShort.format(dayDate(r.day)); }],
        ["Steps", function (r) { return int(r.steps); }],
        ["Activity", function (r) { return has(r.activityScore) ? r.activityScore : "—"; }],
        ["Sleep", function (r) { return has(r.sleepScore) ? r.sleepScore : "—"; }],
        ["Readiness", function (r) { return has(r.readinessScore) ? r.readinessScore : "—"; }],
        ["Slept", function (r) { return dur(r.totalSleep); }],
        ["RHR", function (r) { return has(r.restingHr) ? r.restingHr : "—"; }],
        ["HRV", function (r) { return has(r.hrv) ? r.hrv : "—"; }],
        ["Temp", function (r) { return has(r.tempDev) ? signed(r.tempDev, 2) : "—"; }],
      ];
      var thead = el("thead");
      var hr = el("tr");
      cols.forEach(function (c) { hr.appendChild(el("th", "", c[0])); });
      thead.appendChild(hr);
      table.appendChild(thead);
      var tb = el("tbody");
      rows.slice().reverse().forEach(function (r) {
        var tr = el("tr");
        cols.forEach(function (c) { tr.appendChild(el("td", "", String(c[1](r)))); });
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      det.appendChild(table);
      return det;
    }

    function render() {
      if (!state.data) return;
      renderDay();
      renderTrends();
      synced.textContent = "Synced " + ago(state.data.sync && state.data.sync.last_sync_at);
    }

    prev.addEventListener("click", function () {
      if (!state.data) return;
      state.day = addDays(state.data.day, -1);
      load();
    });
    next.addEventListener("click", function () {
      if (!state.data) return;
      state.day = addDays(state.data.day, 1);
      load();
    });
    rangeBar.addEventListener("click", function (e) {
      var b = e.target.closest(".oura-range");
      if (!b) return;
      state.range = b.dataset.range;
      try { localStorage.setItem(RANGE_KEY, state.range); } catch (err) { /* private mode */ }
      load();
    });
    syncBtn.addEventListener("click", async function () {
      syncBtn.disabled = true;
      syncBtn.textContent = "Syncing…";
      try {
        await callAPI({ action: "sync-oura" });
        await load();
      } catch (err) {
        showError("Sync failed — " + (err.message || "request failed"));
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = "Sync now";
      }
    });
    var lastW = 0;
    var ro = new ResizeObserver(function () {
      var w = root.clientWidth;
      if (Math.abs(w - lastW) < 8) return;
      lastW = w;
      render();
    });
    ro.observe(root);

    return { load: load };
  }

  window.OuraDashboard = { mount: mount };
})();

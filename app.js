(function () {
  "use strict";

  const TOPO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
  const DATA_URL = "./data.json";
  const FETCH_TIMEOUT_MS = 12000;
  const EXCLUDED_FIPS = new Set(["02", "15", "60", "66", "69", "72", "78"]);

  const state = {
    year: 2022,
    selectedStateAbbr: null,
    data: null,
    statesGeo: null,
    stateByFips: new Map(),
    stateByAbbr: new Map()
  };

  const dom = {
    statusBanner: document.getElementById("status-banner"),
    mapCaption: document.getElementById("map-caption"),
    mapSvg: document.getElementById("us-map"),
    dumbbellWrap: document.getElementById("dumbbell-chart"),
    distWrap: document.getElementById("distribution-chart"),
    trendWrap: document.getElementById("trend-chart"),
    barsTitle: document.getElementById("bars-title"),
    barsSub: document.getElementById("bars-sub"),
    yearBtns: Array.from(document.querySelectorAll(".year-btn")),
    inspectorSection: document.getElementById("inspector-section"),
    inspectorTitle: document.getElementById("inspector-title"),
    inspectorMeta: document.getElementById("inspector-meta"),
    inspectorTbody: document.getElementById("inspector-tbody"),
    inspectorClose: document.getElementById("inspector-close"),
    zipSearch: document.getElementById("zip-search"),
    tooltip: document.getElementById("tooltip")
  };

  const fmtInt = d3.format(",");

  function yearKey(yr) {
    if (yr === 2007) return "v07";
    if (yr === 2017) return "v17";
    return "v22";
  }

  function formatSigned(n) {
    if (n > 0) return "+" + fmtInt(n);
    if (n < 0) return fmtInt(n);
    return "0";
  }

  async function fetchJsonWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = window.setTimeout(function () {
      controller.abort();
    }, timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error("HTTP " + res.status + " while loading " + url);
      }
      return await res.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  function isTouchInput() {
    return window.matchMedia && window.matchMedia("(hover: none), (pointer: coarse)").matches;
  }

  function showTooltip(html, evt) {
    dom.tooltip.innerHTML =
      "<button type=\"button\" class=\"tooltip-close\" aria-label=\"Close tooltip\">&times;</button>" +
      "<div class=\"tooltip-body\">" + html + "</div>";
    dom.tooltip.hidden = false;
    positionTooltip(evt);
  }

  function positionTooltip(evt) {
    if (dom.tooltip.hidden || !evt) return;
    const pad = 14;
    const margin = 10;
    const rect = dom.tooltip.getBoundingClientRect();
    const clientX = typeof evt.clientX === "number" ? evt.clientX : window.innerWidth / 2;
    const clientY = typeof evt.clientY === "number" ? evt.clientY : window.innerHeight / 2;

    let x = clientX + pad;
    let y = clientY - rect.height - 10;

    if (x + rect.width > window.innerWidth - margin) {
      x = clientX - rect.width - pad;
    }
    if (x + rect.width > window.innerWidth - margin) {
      x = window.innerWidth - rect.width - margin;
    }
    if (x < margin) {
      x = margin;
    }

    if (y < margin) {
      y = clientY + pad;
    }
    if (y + rect.height > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - rect.height - margin);
    }

    dom.tooltip.style.left = Math.round(x) + "px";
    dom.tooltip.style.top = Math.round(y) + "px";
  }

  function hideTooltip() {
    dom.tooltip.hidden = true;
  }

  function setStatus(msg, isError) {
    dom.statusBanner.textContent = msg;
    dom.statusBanner.classList.toggle("is-error", Boolean(isError));
    dom.statusBanner.hidden = !msg;
  }

  function getNationalForYear(yr) {
    return state.data.national.find(function (d) {
      return d.year === yr;
    });
  }

  function selectState(abbr) {
    if (state.selectedStateAbbr === abbr) {
      state.selectedStateAbbr = null;
    } else {
      state.selectedStateAbbr = abbr;
    }
    dom.zipSearch.value = "";
    renderMap();
    renderDumbbell();
    renderInspector();
  }

  function setYear(yr) {
    hideTooltip();
    state.year = yr;
    dom.yearBtns.forEach(function (btn) {
      const active = Number(btn.dataset.year) === yr;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    renderMap();
    renderDistribution();
    renderTrend();
    if (state.selectedStateAbbr) {
      renderInspector();
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Centerpiece US Map (Full ZCTA Dots OR Editorial Choropleth + Hub Dots)
  // ---------------------------------------------------------------------------
  function renderMap() {
    const svg = d3.select(dom.mapSvg);
    svg.selectAll("*").remove();

    const yr = state.year;
    const vKey = yearKey(yr);
    const nat = getNationalForYear(yr);
    const fullZips = Boolean(state.data.meta && state.data.meta.has_full_zip_coords);

    const contiguous = {
      type: "FeatureCollection",
      features: state.statesGeo.features.filter(function (f) {
        return !EXCLUDED_FIPS.has(String(f.id).padStart(2, "0"));
      })
    };

    const projection = d3.geoAlbersUsa().fitExtent([[34, 52], [652, 392]], contiguous);
    const path = d3.geoPath(projection);

    // Proportional circle scale shared across dots and legend
    const maxZipDomain = 58;
    const rScale = d3.scaleSqrt()
      .domain([1, maxZipDomain])
      .range(fullZips ? [1.7, 15.5] : [3.0, 15.5]);

    const stateColorScale = d3.scaleSequential()
      .domain([0, 750])
      .interpolator(d3.interpolateRgbBasis(["#F1ECE2", "#EED0AC", "#E89B4C", "#C85A28"]));

    if (fullZips) {
      dom.mapCaption.textContent =
        yr + " Census operations across " + fmtInt(nat.valid_zips) + " ZIP codes (click any state to inspect ZIPs)";
    } else {
      dom.mapCaption.textContent =
        yr + " Census operations by state with verified top commercial ZIP hubs (click any state to inspect all ZIPs)";
    }

    // Draw state polygons
    const statesLayer = svg.append("g").attr("class", "states-layer");
    statesLayer.selectAll("path")
      .data(contiguous.features)
      .join("path")
      .attr("class", function (d) {
        const fips = String(d.id).padStart(2, "0");
        const rec = state.stateByFips.get(fips);
        const isSel = rec && state.selectedStateAbbr === rec.abbr;
        const isDim = state.selectedStateAbbr && (!rec || rec.abbr !== state.selectedStateAbbr);
        return "state-path" + (isSel ? " is-selected" : "") + (isDim ? " is-dimmed" : "");
      })
      .attr("d", path)
      .attr("fill", function (d) {
        if (fullZips) return "#EAE5DC";
        const fips = String(d.id).padStart(2, "0");
        const rec = state.stateByFips.get(fips);
        const val = rec ? rec["ops_" + yr] : 0;
        return val > 0 ? stateColorScale(val) : "#EFECE6";
      })
      .on("mouseenter", function (evt, d) {
        const fips = String(d.id).padStart(2, "0");
        const rec = state.stateByFips.get(fips);
        if (!rec) return;
        const ops = rec["ops_" + yr];
        const zips = rec["zips_" + yr];
        const hubs = rec["hubs_" + yr];
        const topZip = rec["top_zip_" + yr];
        const topVal = rec["top_val_" + yr];
        const deltaTxt = rec.pct_07_22 !== null
          ? formatSigned(rec.chg_07_22) + " (" + (rec.pct_07_22 > 0 ? "+" : "") + rec.pct_07_22 + "% since 2007)"
          : formatSigned(rec.chg_07_22) + " since 2007";
        const hubLine = topZip
          ? "<br/>Top ZIP: " + topZip + " with " + fmtInt(topVal) + " farms (" + hubs + " hub ZIPs with 10+ farms)."
          : "";
        showTooltip(
          "<strong>" + rec.name + " (" + yr + ")</strong><br/>" +
          fmtInt(ops) + " turkey-selling operations across " + fmtInt(zips) + " valid ZIP codes.<br/>" +
          "2007 to 2022 shift: " + deltaTxt + "." + hubLine,
          evt
        );
      })
      .on("mousemove", positionTooltip)
      .on("mouseleave", hideTooltip)
      .on("click", function (evt, d) {
        const fips = String(d.id).padStart(2, "0");
        const rec = state.stateByFips.get(fips);
        if (rec) selectState(rec.abbr);
      });

    // Plot ZIP points (all geocoded ZIPs in full mode, or verified hubs in out-of-the-box mode)
    const mappableZips = state.data.zips.filter(function (z) {
      if (typeof z.lat !== "number" || typeof z.lon !== "number") return false;
      if (z.s === "AK" || z.s === "HI") return false;
      return z[vKey] > 0;
    });

    // Draw smaller circles first so dense hubs stay readable on top
    mappableZips.sort(function (a, b) {
      return a[vKey] - b[vKey];
    });

    const dotsLayer = svg.append("g").attr("class", "dots-layer");
    dotsLayer.selectAll("circle")
      .data(mappableZips)
      .join("circle")
      .attr("class", function (d) {
        const isDim = state.selectedStateAbbr && d.s !== state.selectedStateAbbr;
        return "zip-dot" + (isDim ? " is-dimmed" : "");
      })
      .attr("cx", function (d) {
        const pt = projection([d.lon, d.lat]);
        return pt ? pt[0] : -999;
      })
      .attr("cy", function (d) {
        const pt = projection([d.lon, d.lat]);
        return pt ? pt[1] : -999;
      })
      .attr("r", function (d) {
        return rScale(d[vKey]);
      })
      .attr("fill", function (d) {
        if (!fullZips) return "#9E3B16";
        return d[vKey] >= 10 ? "#C85A28" : "#E89B4C";
      })
      .attr("fill-opacity", function (d) {
        if (!fullZips) return 0.88;
        return d[vKey] >= 10 ? 0.86 : 0.68;
      })
      .attr("stroke", function (d) {
        return d[vKey] >= 10 || !fullZips ? "#FAF8F5" : "none";
      })
      .attr("stroke-width", function (d) {
        return d[vKey] >= 10 || !fullZips ? 1.1 : 0;
      })
      .on("mouseenter", function (evt, d) {
        const place = d.city ? d.city + ", " + d.s + " (" + d.z + ")" : "ZIP " + d.z + " (" + d.s + ")";
        const val = d[vKey];
        const diff = d.v22 - d.v07;
        showTooltip(
          "<strong>" + place + "</strong><br/>" +
          fmtInt(val) + " turkey-selling operations in " + yr + " (circle area scales with ZIP count).<br/>" +
          "History: " + fmtInt(d.v07) + " in 2007, " + fmtInt(d.v17) + " in 2017, " + fmtInt(d.v22) + " in 2022 (" + formatSigned(diff) + ").",
          evt
        );
      })
      .on("mousemove", positionTooltip)
      .on("mouseleave", hideTooltip)
      .on("click", function (evt, d) {
        selectState(d.s);
      });

    // External non-overlapping editorial callouts for the 4 headline hub ZIPs
    const calloutSpecs = [
      {
        zip: "56201",
        tx: 382,
        ty: 20,
        elbowX: 372,
        elbowY: 20,
        anchor: "start",
        note: function (d, y) {
          return y === 2022 ? "MN: 33 farms" : "MN: " + d[vKey] + " farms";
        }
      },
      {
        zip: "45846",
        tx: 558,
        ty: 20,
        elbowX: 548,
        elbowY: 20,
        anchor: "start",
        note: function (d, y) {
          if (y === 2022) return "OH: 58 farms (#1 ZIP)";
          if (y === 2017) return "OH: 60 farms (#1 ZIP)";
          return "OH: 41 farms";
        }
      },
      {
        zip: "28328",
        tx: 654,
        ty: 286,
        elbowX: 642,
        elbowY: 286,
        anchor: "start",
        note: function (d, y) {
          if (y === 2022) return "NC: 34 farms (down from 68)";
          if (y === 2017) return "NC: 39 farms (down from 68)";
          return "NC: 68 farms (#1 in 2007)";
        }
      },
      {
        zip: "47553",
        tx: 470,
        ty: 408,
        elbowX: 462,
        elbowY: 408,
        anchor: "start",
        note: function (d, y) {
          return "IN: " + d[vKey] + " farms";
        }
      }
    ];

    const calloutLayer = svg.append("g").attr("class", "callouts-layer");
    calloutSpecs.forEach(function (spec) {
      const zRec = state.data.zips.find(function (r) {
        return r.z === spec.zip;
      });
      if (!zRec || !zRec[vKey]) return;
      const pt = projection([zRec.lon, zRec.lat]);
      if (!pt) return;

      const r = rScale(zRec[vKey]);
      let startX = pt[0];
      let startY = pt[1];
      if (spec.ty < pt[1]) startY = pt[1] - r - 1;
      else if (spec.ty > pt[1] + 50) startY = pt[1] + r + 1;
      else startX = pt[0] + r + 1;

      const pathData = spec.zip === "47553"
        ? "M" + startX + "," + startY + " L" + startX + "," + spec.elbowY + " L" + spec.elbowX + "," + spec.elbowY
        : "M" + startX + "," + startY + " L" + spec.elbowX + "," + spec.elbowY + " L" + (spec.tx - 4) + "," + spec.ty;

      calloutLayer.append("path")
        .attr("class", "callout-line")
        .attr("d", pathData);

      calloutLayer.append("text")
        .attr("class", "callout-title")
        .attr("x", spec.tx)
        .attr("y", spec.ty - 2)
        .attr("text-anchor", spec.anchor)
        .text(zRec.z + (zRec.city ? " " + zRec.city : ""));

      calloutLayer.append("text")
        .attr("class", "callout-sub")
        .attr("x", spec.tx)
        .attr("y", spec.ty + 12)
        .attr("text-anchor", spec.anchor)
        .text(spec.note(zRec, yr));
    });

    // Proportional circle size legend (strictly in open bottom-left whitespace)
    const legendG = svg.append("g")
      .attr("class", "size-legend")
      .attr("transform", "translate(18, 294)");

    legendG.append("text")
      .attr("class", "legend-heading")
      .attr("x", 0)
      .attr("y", 0)
      .text(fullZips ? "Operations per ZIP" : "Hub ZIP operations");

    const sizes = [58, 30, 10, 1];
    const baseCircleY = 48;
    const centerX = 24;

    sizes.forEach(function (val) {
      const r = rScale(val);
      const cy = baseCircleY - r;
      legendG.append("circle")
        .attr("cx", centerX)
        .attr("cy", cy)
        .attr("r", r)
        .attr("fill", "none")
        .attr("stroke", "#5C6066")
        .attr("stroke-width", 0.9);

      const topY = baseCircleY - 2 * r;
      legendG.append("line")
        .attr("x1", centerX)
        .attr("x2", 52)
        .attr("y1", topY)
        .attr("y2", topY)
        .attr("stroke", "#9A968E")
        .attr("stroke-width", 0.7)
        .attr("stroke-dasharray", "2,2");

      legendG.append("text")
        .attr("class", "legend-tick")
        .attr("x", 56)
        .attr("y", topY + 3.5)
        .text(String(val));
    });

    // Compact state choropleth color bar when in out-of-the-box state+hub mode
    if (!fullZips) {
      const defs = svg.append("defs");
      const grad = defs.append("linearGradient")
        .attr("id", "state-fill-grad")
        .attr("x1", "0%")
        .attr("x2", "100%");
      grad.append("stop").attr("offset", "0%").attr("stop-color", "#F1ECE2");
      grad.append("stop").attr("offset", "35%").attr("stop-color", "#EED0AC");
      grad.append("stop").attr("offset", "68%").attr("stop-color", "#E89B4C");
      grad.append("stop").attr("offset", "100%").attr("stop-color", "#C85A28");

      const barG = legendG.append("g").attr("transform", "translate(0, 68)");
      barG.append("text")
        .attr("class", "legend-heading")
        .attr("x", 0)
        .attr("y", 0)
        .text("State total (" + yr + ")");

      barG.append("rect")
        .attr("x", 0)
        .attr("y", 7)
        .attr("width", 112)
        .attr("height", 8)
        .attr("rx", 2)
        .attr("fill", "url(#state-fill-grad)")
        .attr("stroke", "#D5CEC2")
        .attr("stroke-width", 0.6);

      barG.append("text")
        .attr("class", "legend-tick")
        .attr("x", 0)
        .attr("y", 26)
        .text("0");

      barG.append("text")
        .attr("class", "legend-tick")
        .attr("x", 56)
        .attr("y", 26)
        .attr("text-anchor", "middle")
        .text("375");

      barG.append("text")
        .attr("class", "legend-tick")
        .attr("x", 112)
        .attr("y", 26)
        .attr("text-anchor", "end")
        .text("750+");
    }

    // Transparent clickable Alaska / Hawaii note cleanly beneath the legend
    const ak = state.stateByAbbr.get("AK");
    const hi = state.stateByAbbr.get("HI");
    const akVal = ak ? ak["ops_" + yr] : 0;
    const hiVal = hi ? hi["ops_" + yr] : 0;
    const noteY = fullZips ? 76 : 114;

    const akHiG = legendG.append("g").attr("transform", "translate(0, " + noteY + ")");
    akHiG.append("text")
      .attr("class", "legend-tick")
      .attr("x", 0)
      .attr("y", 0)
      .text("Non-contiguous: ");

    akHiG.append("text")
      .attr("class", "ak-hi-link")
      .attr("x", 82)
      .attr("y", 0)
      .text("AK (" + akVal + ")")
      .on("click", function () { selectState("AK"); });

    akHiG.append("text")
      .attr("class", "legend-tick")
      .attr("x", 121)
      .attr("y", 0)
      .text("|");

    akHiG.append("text")
      .attr("class", "ak-hi-link")
      .attr("x", 128)
      .attr("y", 0)
      .text("HI (" + hiVal + ")")
      .on("click", function () { selectState("HI"); });
  }

  // ---------------------------------------------------------------------------
  // 2. Left Lower Panel: 2007 to 2022 Top 8 States Dumbbell Plot
  // ---------------------------------------------------------------------------
  function renderDumbbell() {
    const container = d3.select(dom.dumbbellWrap);
    container.selectAll("*").remove();

    const top8 = state.data.states.slice(0, 8);
    const width = 415;
    const rowH = 32;
    const margin = { top: 8, right: 42, bottom: 10, left: 112 };
    const height = margin.top + margin.bottom + top8.length * rowH;

    const svg = container.append("svg")
      .attr("viewBox", "0 0 " + width + " " + height)
      .attr("role", "img")
      .attr("aria-label", "Connected dumbbell plot comparing 2007 and 2022 turkey farm operations across the top 8 states");

    const x = d3.scaleLinear()
      .domain([240, 760])
      .range([margin.left, width - margin.right]);

    top8.forEach(function (d, i) {
      const cy = margin.top + i * rowH + rowH / 2;
      const x07 = x(d.ops_2007);
      const x22 = x(d.ops_2022);
      const grew = d.ops_2022 >= d.ops_2007;
      const lineColor = grew ? "#C85A28" : "#1F4E79";

      const row = svg.append("g")
        .attr("class", "dumbbell-row" + (state.selectedStateAbbr === d.abbr ? " is-selected" : ""))
        .on("mouseenter", function (evt) {
          showTooltip(
            "<strong>" + d.name + "</strong><br/>" +
            "2007: " + fmtInt(d.ops_2007) + " operations.<br/>" +
            "2017: " + fmtInt(d.ops_2017) + " operations.<br/>" +
            "2022: " + fmtInt(d.ops_2022) + " operations (" + formatSigned(d.chg_07_22) + ", " +
            (d.pct_07_22 > 0 ? "+" : "") + d.pct_07_22 + "% since 2007).",
            evt
          );
        })
        .on("mousemove", positionTooltip)
        .on("mouseleave", hideTooltip)
        .on("click", function () {
          selectState(d.abbr);
        });

      // Invisible hit target for easy hover/click
      row.append("rect")
        .attr("x", 0)
        .attr("y", cy - rowH / 2)
        .attr("width", width)
        .attr("height", rowH)
        .attr("fill", "transparent");

      // Faint baseline guide
      row.append("line")
        .attr("x1", margin.left)
        .attr("x2", width - margin.right)
        .attr("y1", cy)
        .attr("y2", cy)
        .attr("stroke", "#E9E3D9")
        .attr("stroke-width", 1);

      // State label
      row.append("text")
        .attr("class", "db-label")
        .attr("x", margin.left - 10)
        .attr("y", cy + 4)
        .attr("text-anchor", "end")
        .text(d.name);

      // Connecting segment
      row.append("line")
        .attr("x1", x07)
        .attr("x2", x22)
        .attr("y1", cy)
        .attr("y2", cy)
        .attr("stroke", lineColor)
        .attr("stroke-width", 2.6);

      // 2007 dot (slate blue)
      row.append("circle")
        .attr("cx", x07)
        .attr("cy", cy)
        .attr("r", 5.2)
        .attr("fill", "#1F4E79")
        .attr("stroke", "#FAF8F5")
        .attr("stroke-width", 1);

      // 2022 dot (burnt terracotta)
      row.append("circle")
        .attr("cx", x22)
        .attr("cy", cy)
        .attr("r", 5.8)
        .attr("fill", "#C85A28")
        .attr("stroke", "#FAF8F5")
        .attr("stroke-width", 1);

      // Direct non-overlapping value labels placed strictly outside the outer endpoints
      const leftVal = grew ? d.ops_2007 : d.ops_2022;
      const rightVal = grew ? d.ops_2022 : d.ops_2007;
      const leftX = Math.min(x07, x22) - 9;
      const rightX = Math.max(x07, x22) + 9;

      row.append("text")
        .attr("class", "db-val")
        .attr("x", leftX)
        .attr("y", cy + 4)
        .attr("text-anchor", "end")
        .attr("fill", grew ? "#1F4E79" : "#C85A28")
        .text(fmtInt(leftVal));

      row.append("text")
        .attr("class", "db-val")
        .attr("x", rightX)
        .attr("y", cy + 4)
        .attr("text-anchor", "start")
        .attr("fill", grew ? "#C85A28" : "#1F4E79")
        .text(fmtInt(rightVal));
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Right Upper Panel: ZIP Density Distribution Bars
  // ---------------------------------------------------------------------------
  function renderDistribution() {
    const container = d3.select(dom.distWrap);
    container.selectAll("*").remove();

    const yr = state.year;
    const nat = getNationalForYear(yr);
    dom.barsSub.textContent = "Share of " + fmtInt(nat.valid_zips) + " valid ZIP codes in " + yr;

    const width = 310;
    const barH = 24;
    const gap = 8;
    const height = nat.buckets.length * (barH + gap) - gap + 4;

    const svg = container.append("svg")
      .attr("viewBox", "0 0 " + width + " " + height)
      .attr("role", "img")
      .attr("aria-label", "Horizontal bar chart of ZIP codes grouped by turkey farm count");

    const x = d3.scaleLinear().domain([0, 100]).range([0, width]);

    nat.buckets.forEach(function (b, i) {
      const y = i * (barH + gap);
      const barW = Math.max(4, x(b.zip_pct));
      const labelText = b.label + ": " + b.zip_pct.toFixed(1) + "%";
      const inside = barW > 132;

      const barTipHtml =
        "<strong>" + b.label + " (" + yr + ")</strong><br/>" +
        fmtInt(b.zips) + " ZIP codes (" + b.zip_pct.toFixed(1) + "% of all valid ZIPs).<br/>" +
        "Accounts for " + fmtInt(b.ops) + " operations (" + b.ops_pct.toFixed(1) + "% of valid ZIP total).";

      const row = svg.append("g")
        .attr("class", "dist-bar-row")
        .on("mouseenter", function (evt) {
          showTooltip(barTipHtml, evt);
        })
        .on("mousemove", positionTooltip)
        .on("mouseleave", hideTooltip)
        .on("click", function (evt) {
          evt.stopPropagation();
          showTooltip(barTipHtml, evt);
        });

      row.append("rect")
        .attr("x", 0)
        .attr("y", y)
        .attr("width", width)
        .attr("height", barH)
        .attr("rx", 2)
        .attr("fill", "#D7CFC3");

      row.append("rect")
        .attr("x", 0)
        .attr("y", y)
        .attr("width", barW)
        .attr("height", barH)
        .attr("rx", 2)
        .attr("fill", "#C85A28");

      row.append("text")
        .attr("class", "dist-bar-label")
        .attr("x", inside ? 9 : barW + 8)
        .attr("y", y + barH / 2 + 4)
        .attr("fill", inside ? "#FAF8F5" : "#2B2D30")
        .text(labelText);
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Right Lower Panel: National Total by Census Year (True Time Spacing)
  // ---------------------------------------------------------------------------
  function renderTrend() {
    const container = d3.select(dom.trendWrap);
    container.selectAll("*").remove();

    const data = state.data.national;
    const width = 310;
    const height = 104;
    const margin = { top: 24, right: 44, bottom: 24, left: 42 };

    const svg = container.append("svg")
      .attr("viewBox", "0 0 " + width + " " + height)
      .attr("role", "img")
      .attr("aria-label", "Line chart of total U.S. turkey-selling operations across 2007, 2017, and 2022");

    // True proportional time scale (10-year span 2007-2017, 5-year span 2017-2022)
    const x = d3.scaleLinear()
      .domain([2007, 2022])
      .range([margin.left, width - margin.right]);

    const y = d3.scaleLinear()
      .domain([7200, 12000])
      .range([height - margin.bottom, margin.top]);

    const line = d3.line()
      .x(function (d) { return x(d.year); })
      .y(function (d) { return y(d.total_ops); });

    // Baseline subtle axis line
    svg.append("line")
      .attr("x1", margin.left - 12)
      .attr("x2", width - margin.right + 12)
      .attr("y1", height - margin.bottom)
      .attr("y2", height - margin.bottom)
      .attr("stroke", "#E5DFD5")
      .attr("stroke-width", 1);

    // Connected trend line
    svg.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", "#C85A28")
      .attr("stroke-width", 2.8)
      .attr("d", line);

    data.forEach(function (d) {
      const cx = x(d.year);
      const cy = y(d.total_ops);
      const isActive = d.year === state.year;

      const g = svg.append("g")
        .attr("class", "trend-point-group")
        .on("mouseenter", function (evt) {
          showTooltip(
            "<strong>" + d.year + " USDA Census</strong><br/>" +
            fmtInt(d.total_ops) + " total turkey-selling operations across " + d.states + " states.<br/>" +
            fmtInt(d.valid_zips) + " valid ZIP codes plus " + fmtInt(d.unallocated_ops) + " unallocated (ZIP 99999) operations.",
            evt
          );
        })
        .on("mousemove", positionTooltip)
        .on("mouseleave", hideTooltip)
        .on("click", function () {
          setYear(d.year);
        });

      if (isActive) {
        g.append("circle")
          .attr("cx", cx)
          .attr("cy", cy)
          .attr("r", 9.5)
          .attr("fill", "rgba(200, 90, 40, 0.16)");
      }

      g.append("circle")
        .attr("cx", cx)
        .attr("cy", cy)
        .attr("r", isActive ? 5.6 : 4.6)
        .attr("fill", isActive ? "#C85A28" : "#FAF8F5")
        .attr("stroke", "#C85A28")
        .attr("stroke-width", 2.2);

      // Direct non-overlapping value label
      const labelY = d.year === 2017 ? cy - 12 : (d.year === 2007 ? cy + 19 : cy + 19);
      const anchor = d.year === 2007 ? "start" : (d.year === 2022 ? "end" : "middle");
      const labelX = d.year === 2007 ? cx - 22 : (d.year === 2022 ? cx + 28 : cx);

      g.append("text")
        .attr("class", "trend-val-label")
        .attr("x", labelX)
        .attr("y", labelY)
        .attr("text-anchor", anchor)
        .text(d.year + ": " + fmtInt(d.total_ops));
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Optional Inline State ZIP Inspector (opens on state click)
  // ---------------------------------------------------------------------------
  function renderInspector() {
    const abbr = state.selectedStateAbbr;
    if (!abbr) {
      dom.inspectorSection.hidden = true;
      return;
    }

    const st = state.stateByAbbr.get(abbr);
    if (!st) {
      dom.inspectorSection.hidden = true;
      return;
    }

    dom.inspectorSection.hidden = false;
    dom.inspectorTitle.textContent = st.name + " ZIP Code Breakdown";

    const unallocNote = st["unalloc_" + state.year] > 0
      ? " Includes " + fmtInt(st["unalloc_" + state.year]) + " unallocated (ZIP 99999) operations in " + state.year + "."
      : "";
    dom.inspectorMeta.textContent =
      "Total operations: " + fmtInt(st.ops_2007) + " (2007), " +
      fmtInt(st.ops_2017) + " (2017), " + fmtInt(st.ops_2022) + " (2022). " +
      fmtInt(st["zips_" + state.year]) + " valid ZIPs in " + state.year + "." + unallocNote;

    const query = dom.zipSearch.value.trim().toLowerCase();
    const rows = state.data.zips.filter(function (z) {
      if (z.s !== abbr) return false;
      if (!query) return true;
      const cityStr = z.city ? z.city.toLowerCase() : "";
      return z.z.includes(query) || cityStr.includes(query);
    });

    const vKey = yearKey(state.year);
    rows.sort(function (a, b) {
      return (b[vKey] - a[vKey]) || (b.v22 - a.v22) || a.z.localeCompare(b.z);
    });

    dom.inspectorTbody.innerHTML = rows.slice(0, 250).map(function (r) {
      const diff = r.v22 - r.v07;
      const cls = diff > 0 ? "chg-pos" : (diff < 0 ? "chg-neg" : "");
      const label = r.city ? r.z + " (" + r.city + ")" : r.z;
      return "<tr>" +
        "<td>" + label + "</td>" +
        "<td class=\"num\">" + fmtInt(r.v07) + "</td>" +
        "<td class=\"num\">" + fmtInt(r.v17) + "</td>" +
        "<td class=\"num\">" + fmtInt(r.v22) + "</td>" +
        "<td class=\"num " + cls + "\">" + formatSigned(diff) + "</td>" +
        "</tr>";
    }).join("");

    if (rows.length === 0) {
      dom.inspectorTbody.innerHTML = "<tr><td colspan=\"5\">No matching ZIP codes found in " + st.name + ".</td></tr>";
    }
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------
  async function init() {
    dom.yearBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        setYear(Number(btn.dataset.year));
      });
    });

    dom.inspectorClose.addEventListener("click", function () {
      hideTooltip();
      state.selectedStateAbbr = null;
      renderMap();
      renderDumbbell();
      renderInspector();
    });

    dom.zipSearch.addEventListener("input", renderInspector);

    // Dismiss tooltips via close button, tapping tooltip on touch devices, tapping outside, scrolling, or Escape
    dom.tooltip.addEventListener("click", function (evt) {
      if (evt.target && evt.target.closest && evt.target.closest(".tooltip-close")) {
        evt.stopPropagation();
        hideTooltip();
        return;
      }
      if (isTouchInput()) {
        evt.stopPropagation();
        hideTooltip();
      }
    });

    document.addEventListener("pointerdown", function (evt) {
      if (dom.tooltip.hidden) return;
      const target = evt.target;
      if (target && target.closest && target.closest("#tooltip")) {
        return;
      }
      const onInteractiveMark = target && target.closest && target.closest(
        ".state-path, .zip-dot, .dumbbell-row, .dist-bar-row, .trend-point-group"
      );
      if (!onInteractiveMark) {
        hideTooltip();
      }
    });

    window.addEventListener("scroll", hideTooltip, { passive: true });
    window.addEventListener("resize", hideTooltip, { passive: true });
    document.addEventListener("keydown", function (evt) {
      if (evt.key === "Escape") {
        hideTooltip();
      }
    });

    try {
      const results = await Promise.all([
        fetchJsonWithTimeout(DATA_URL, FETCH_TIMEOUT_MS),
        fetchJsonWithTimeout(TOPO_URL, FETCH_TIMEOUT_MS)
      ]);

      const data = results[0];
      const topo = results[1];

      if (!data || !Array.isArray(data.states) || !Array.isArray(data.zips)) {
        throw new Error("Unexpected data.json format.");
      }

      state.data = data;
      state.statesGeo = topojson.feature(topo, topo.objects.states);

      data.states.forEach(function (s) {
        state.stateByFips.set(s.fips, s);
        state.stateByAbbr.set(s.abbr, s);
      });

      setStatus("", false);
      renderMap();
      renderDumbbell();
      renderDistribution();
      renderTrend();
    } catch (err) {
      setStatus("Could not load visualization data (" + err.message + "). Run over HTTP rather than file://.", true);
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();

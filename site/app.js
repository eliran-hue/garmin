/* Garmin dashboard: loads site/data/*.json (built by scripts/build_dataset.py) and renders tabs. */
(function () {
  const C = window.Charts;
  const SLEEP_TARGET = 7.5; // hours
  const state = { days: 90, tab: "overview", data: null, exField: null };

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const dateSpan = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
  const vals = (a) => a.filter((v) => v != null && !Number.isNaN(v));
  const mean = (a) => { const v = vals(a); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const sum = (a) => vals(a).reduce((s, x) => s + x, 0);
  const sd = (a) => { const v = vals(a), m = mean(v); return v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) : null; };
  const rolling = (a, n, minCount = 1) => a.map((_, i) => { const w = vals(a.slice(Math.max(0, i - n + 1), i + 1)); return w.length >= minCount ? w.reduce((s, x) => s + x, 0) / w.length : null; });
  const rollingSum = (a, n) => a.map((_, i) => a.slice(Math.max(0, i - n + 1), i + 1).reduce((s, x) => s + (x || 0), 0));
  const hm = (h) => { if (h == null) return "–"; const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
  const clock = (minAfter18) => { if (minAfter18 == null) return "–"; const m = Math.round((minAfter18 + 1080) % 1440); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
  const r1 = (v) => (v == null ? "–" : (+v.toFixed(1)).toLocaleString("he-IL"));
  const r0 = (v) => (v == null ? "–" : Math.round(v).toLocaleString("he-IL"));
  const signed = (v, f = r1) => { const t = f(Math.abs(v)); const z = /^0([.,]0+)?$/.test(t); return "\u2066" + (z ? "" : v > 0 ? "+" : v < 0 ? "−" : "") + t + "\u2069"; };
  const pct = (a, b) => (a != null && b ? ((a - b) / b) * 100 : null);
  const lastIdx = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return i; return -1; };
  const weekStart = (d) => { const t = new Date(d + "T12:00:00Z"); return addDays(d, -t.getUTCDay()); }; // week starts Sunday

  const TYPE_GROUPS = [
    { key: "run", name: "ריצה", color: "--series-1", match: /run/ },
    { key: "bike", name: "רכיבה", color: "--series-2", match: /cycl|bik|ride|gravel/ },
    { key: "strength", name: "כוח", color: "--series-3", match: /strength|weight|hiit|crossfit|fitness_equipment|indoor_cardio/ },
    { key: "walk", name: "הליכה וטיולים", color: "--series-4", match: /walk|hik/ },
    { key: "swim", name: "שחייה", color: "--series-5", match: /swim/ },
    { key: "other", name: "אחר", color: "--other", match: /.*/ },
  ];
  const typeGroup = (t) => TYPE_GROUPS.find((g) => g.match.test(t || "")) || TYPE_GROUPS[TYPE_GROUPS.length - 1];
  const TYPE_NAMES = { running: "ריצה", trail_running: "ריצת שטח", treadmill_running: "ריצת הליכון", cycling: "רכיבה", road_biking: "רכיבת כביש",
    mountain_biking: "רכיבת שטח", indoor_cycling: "אופני כושר", virtual_ride: "רכיבה וירטואלית", strength_training: "אימון כוח", walking: "הליכה",
    hiking: "טיול רגלי", lap_swimming: "שחייה בבריכה", open_water_swimming: "שחייה במים פתוחים", yoga: "יוגה", hiit: "HIIT", cardio: "קרדיו",
    indoor_cardio: "קרדיו", pilates: "פילאטיס", elliptical: "אליפטי", other: "אחר" };

  const ENDPOINT_NAMES = { daily_summary: "סיכום יומי", sleep: "שינה", sleep_summary: "סיכום שינה", hrv: "HRV", heart_rate: "דופק",
    body_battery: "Body Battery", stress: "לחץ", steps: "צעדים", hydration: "שתייה", weight: "משקל והרכב גוף", weight_goal: "יעד משקל",
    spo2: "רוויון חמצן", fitness_age: "גיל כושר", wellness_activity: "פעילות יומית", food_logs: "תזונה", menstrual_cycle: "מחזור" };

  // ---------- data ----------
  async function load() {
    const get = (f) => fetch(`data/${f}?v=${Date.now()}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [daily, activities, explorer, meta] = await Promise.all(["daily.json", "activities.json", "explorer.json", "meta.json"].map(get));
    if (!daily || !daily.length) {
      $("#updated").textContent = "עדיין אין נתונים. הרץ את ה-workflow ב-GitHub Actions.";
      return null;
    }
    const first = daily[0].date, last = daily[daily.length - 1].date;
    const dates = dateSpan(first, last);
    const idx = Object.fromEntries(dates.map((d, i) => [d, i]));
    const cols = {};
    const keys = new Set();
    daily.forEach((r) => Object.keys(r).forEach((k) => k !== "date" && keys.add(k)));
    keys.forEach((k) => (cols[k] = new Array(dates.length).fill(null)));
    daily.forEach((r) => keys.forEach((k) => (cols[k][idx[r.date]] = r[k] ?? null)));
    // training load per day from activities
    cols.load = new Array(dates.length).fill(0);
    cols.train_min = new Array(dates.length).fill(0);
    (activities || []).forEach((a) => {
      const i = idx[a.date];
      if (i == null) return;
      cols.load[i] += a.load || 0;
      cols.train_min[i] += a.duration_min || 0;
    });
    return { dates, idx, cols, activities: activities || [], explorer, meta: meta || {}, last };
  }

  function windowed() {
    const D = state.data;
    const n = state.days ? Math.min(state.days, D.dates.length) : D.dates.length;
    const from = D.dates.length - n;
    const sl = (a) => a.slice(from);
    return { dates: sl(D.dates), from, col: (k) => sl(D.cols[k] || []), sl };
  }

  // ---------- overview ----------
  function tiles() {
    const D = state.data, c = D.cols, n = D.dates.length;
    const lastOf = (k, maxBack = 3) => { const i = lastIdx(c[k]); return i >= 0 && n - 1 - i <= maxBack ? i : -1; };
    const last30 = (k) => c[k].slice(-30);
    const items = [];

    const si = lastOf("sleep_h");
    items.push({ label: "שינה אמש", value: si >= 0 ? hm(c.sleep_h[si]) : "–", unit: "שעות",
      delta: si >= 0 ? [c.sleep_score[si] != null ? `ציון ${r0(c.sleep_score[si])}` : null, `ממוצע 7 לילות ${hm(mean(c.sleep_h.slice(-7)))}`].filter(Boolean).join(" · ") : "",
      spark: last30("sleep_h"), color: "--series-1" });

    const hi = lastOf("hrv");
    if (hi >= 0) {
      const lo = c.hrv_low[hi], up = c.hrv_high[hi], v = c.hrv[hi];
      const where = lo != null && up != null ? (v < lo ? "מתחת לטווח הבסיס" : v > up ? "מעל טווח הבסיס" : "בתוך טווח הבסיס") : "";
      items.push({ label: "HRV לילי", value: r0(v), unit: "ms", delta: [where, lo != null ? `(${r0(lo)}–${r0(up)})` : `ממוצע 7 ימים ${r0(mean(c.hrv.slice(-7)))}`].join(" "), spark: last30("hrv"), color: "--series-1" });
    }

    const ri = lastOf("rhr");
    if (ri >= 0) {
      const base = mean(c.rhr.slice(-31, -3));
      items.push({ label: "דופק במנוחה", value: r0(c.rhr[ri]), unit: "bpm", delta: base ? `${signed(c.rhr[ri] - base, r0)} מול ממוצע 4 שבועות` : "", spark: last30("rhr"), color: "--series-1" });
    }

    const bi = lastOf("bb_high");
    if (bi >= 0) items.push({ label: "Body Battery שיא היום", value: r0(c.bb_high[bi]), unit: "", delta: c.bb_sleep_change[bi] != null ? `נטען בלילה ${signed(c.bb_sleep_change[bi], r0)}` : c.bb_low[bi] != null ? `שפל ${r0(c.bb_low[bi])}` : "", spark: last30("bb_high"), color: "--series-1" });

    const wi = lastIdx(c.weight_kg);
    if (wi >= 0) {
      const ma = rolling(c.weight_kg, 7);
      const prev = ma[Math.max(0, wi - 30)];
      items.push({ label: "משקל", value: r1(c.weight_kg[wi]), unit: "ק״ג", delta: `${prev != null && wi >= 30 ? `${signed(ma[wi] - prev)} ק״ג ב-30 יום · ` : ""}נשקל ${C.fmtDate(D.dates[wi])}`, spark: c.weight_kg.slice(-90), color: "--series-1" });
    }

    const acute = sum(c.load.slice(-7)), chronic = sum(c.load.slice(-28)) / 4;
    if (D.activities.length) items.push({ label: "עומס אימון 7 ימים", value: r0(acute), unit: "", delta: chronic ? `יחס לממוצע 4 שבועות ${(acute / chronic).toFixed(2)}` : "", spark: rollingSum(c.load, 7).slice(-30), color: "--series-1" });

    const st = mean(c.steps.slice(-7));
    if (st != null) items.push({ label: "צעדים ביום (ממוצע 7 ימים)", value: r0(st), unit: "", delta: `${signed(pct(st, mean(c.steps.slice(-35, -7))) || 0, r0)}% מול 4 השבועות הקודמים`, spark: rolling(c.steps, 7).slice(-30), color: "--series-1" });

    $("#tiles").innerHTML = items.map((t, i) => `<div class="tile"><div class="label">${t.label}</div><div class="value">${t.value}${t.unit ? `<small>${t.unit}</small>` : ""}</div><div class="delta">${t.delta || ""}</div><div class="spark" id="spark-${i}"></div></div>`).join("");
    items.forEach((t, i) => C.spark(document.getElementById(`spark-${i}`), t.spark, t.color));
  }

  const ICONS = {
    good: '<svg class="status-icon" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="var(--good)"/><path d="M6 10.5l2.6 2.5L14 7.5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warning: '<svg class="status-icon" viewBox="0 0 20 20"><path d="M10 2L19 18H1z" fill="var(--warning)"/><path d="M10 8v4.5M10 15v.5" stroke="#3a2a00" stroke-width="2" stroke-linecap="round"/></svg>',
    serious: '<svg class="status-icon" viewBox="0 0 20 20"><path d="M10 2L19 18H1z" fill="var(--serious)"/><path d="M10 8v4.5M10 15v.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
    critical: '<svg class="status-icon" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="var(--critical)"/><path d="M10 5.5v5.5M10 14v.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
    info: '<svg class="status-icon" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="var(--accent)"/><path d="M10 9v5.5M10 6v.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  };
  const LEVEL_LABEL = { good: "טוב", warning: "לתשומת לב", serious: "חשוב", critical: "דחוף", info: "מידע" };

  function insights() {
    const D = state.data, c = D.cols, n = D.dates.length, out = [];
    const recent = (k, a, b) => c[k].slice(n - a, b ? n - b : n);

    // 1. Readiness today
    {
      const reasons = []; let score = 0, signals = 0;
      const hi = lastIdx(c.hrv);
      if (hi >= n - 2) {
        signals++;
        const lo = c.hrv_low[hi] ?? (mean(recent("hrv", 31, 1)) - (sd(recent("hrv", 31, 1)) || 0));
        const up = c.hrv_high[hi] ?? (mean(recent("hrv", 31, 1)) + (sd(recent("hrv", 31, 1)) || 0));
        if (c.hrv[hi] < lo) { score--; reasons.push(`ה-HRV אמש (${r0(c.hrv[hi])}) מתחת לטווח הרגיל שלך`); }
        else if (c.hrv[hi] >= lo) { score++; reasons.push(`ה-HRV אמש (${r0(c.hrv[hi])}) בטווח הרגיל שלך או מעליו`); }
      }
      const ri = lastIdx(c.rhr), rb = mean(recent("rhr", 31, 3));
      if (ri >= n - 2 && rb) {
        signals++;
        const d = c.rhr[ri] - rb;
        if (d >= 3) { score--; reasons.push(`דופק המנוחה גבוה ב-${r0(d)} מהממוצע`); }
        else if (d <= 0) { score++; reasons.push("דופק המנוחה בממוצע שלך או נמוך ממנו"); }
      }
      const si = lastIdx(c.sleep_h);
      if (si >= n - 2) {
        signals++;
        if (c.sleep_h[si] < 6) { score--; reasons.push(`ישנת רק ${hm(c.sleep_h[si])} שעות`); }
        else if (c.sleep_h[si] >= 7) { score++; reasons.push(`ישנת ${hm(c.sleep_h[si])} שעות`); }
      }
      if (signals >= 2) {
        const level = score >= 2 ? "good" : score <= -2 ? "serious" : score < 0 ? "warning" : "info";
        const title = score >= 2 ? "מוכנות להיום: אפשר להתאמן חזק" : score <= -2 ? "מוכנות להיום: עדיף יום התאוששות" : score < 0 ? "מוכנות להיום: עדיף אימון קל" : "מוכנות להיום: אימון בינוני";
        out.push({ level, title, text: reasons.join(". ") + ".", tag: "התאוששות" });
      }
    }

    // 2. Elevated resting HR (3-day)
    {
      const a = mean(recent("rhr", 3)), b = mean(recent("rhr", 31, 3));
      if (a && b && a - b >= 3) out.push({ level: "serious", tag: "התאוששות", title: "דופק מנוחה גבוה מהרגיל ב-3 הימים האחרונים",
        text: `ממוצע ${r1(a)} לעומת ${r1(b)} בחודש שלפני (${signed(a - b)}). זה סימן מוכר לעייפות מצטברת, למחלה בתחילתה, לאלכוהול או לחוסר שינה. כדאי להוריד עצימות עד שהדופק יחזור לרגיל.` });
    }

    // 3. Sleep trend + debt
    {
      const a = mean(recent("sleep_h", 7)), b = mean(recent("sleep_h", 35, 7));
      if (a != null) {
        const debt = sum(recent("sleep_h", 7).map((h) => (h == null ? null : Math.max(0, SLEEP_TARGET - h))));
        const level = a < 6.5 ? "serious" : a < 7 ? "warning" : "good";
        const diff = b != null ? Math.round((a - b) * 60) : null;
        out.push({ level, tag: "שינה", title: `שינה ממוצעת השבוע: ${hm(a)} שעות`,
          text: `${diff != null ? `${diff >= 0 ? "יותר" : "פחות"} ב-${Math.abs(diff)} דקות מהממוצע שלך בחודש הקודם. ` : ""}חוב שינה מצטבר ב-7 הלילות מול יעד של ${SLEEP_TARGET} שעות: ${hm(debt)} שעות.` });
      }
    }

    // 4. Bedtime consistency
    {
      const bt = recent("bedtime_min", 14), s = sd(bt);
      if (vals(bt).length >= 7 && s != null) {
        const level = s > 60 ? "warning" : s <= 30 ? "good" : "info";
        out.push({ level, tag: "שינה", title: s > 60 ? "שעת השינה שלך לא קבועה" : "עקביות שעת השינה",
          text: `בשבועיים האחרונים הלכת לישון בממוצע ב-${clock(mean(bt))}, בסטייה של כ-${r0(s)} דקות. ${s > 60 ? "סטייה של יותר משעה פוגעת בדרך כלל באיכות השינה. שעה קבועה, גם בסופי שבוע, היא אחד הצעדים הכי יעילים לשיפור." : s <= 30 ? "עקביות טובה מאוד." : "סביר. מתחת ל-30 דקות זה אידיאלי."}` });
      }
    }

    // 5. HRV trend
    {
      const a = mean(recent("hrv", 7)), b = mean(recent("hrv", 35, 7)), p = pct(a, b);
      if (p != null && vals(recent("hrv", 35, 7)).length >= 14) {
        const level = p <= -8 ? "warning" : p >= 5 ? "good" : "info";
        out.push({ level, tag: "התאוששות", title: `מגמת HRV: ${signed(p, r0)}% השבוע`,
          text: `ממוצע 7 ימים ${r0(a)} מול ${r0(b)} בחודש הקודם. ${p <= -8 ? "ירידה מתמשכת מעידה בדרך כלל על עומס, לחץ או שינה לא מספקת." : p >= 5 ? "עלייה מעידה בדרך כלל על הסתגלות טובה לאימונים ועל התאוששות טובה." : "יציב."}` });
      }
    }

    // 6. Training load ratio (acute:chronic)
    if (D.activities.length) {
      const acute = sum(c.load.slice(-7)), chronic = sum(c.load.slice(-28)) / 4;
      const firstAct = D.activities[0].date;
      if (chronic > 0 && D.dates.indexOf(firstAct) <= n - 28) {
        const ratio = acute / chronic;
        const level = ratio > 1.5 ? "serious" : ratio > 1.3 ? "warning" : ratio >= 0.8 ? "good" : "info";
        const msg = ratio > 1.5 ? "קפיצה חדה בעומס. זה הטווח שבו הסיכון לפציעה עולה. כדאי לשלב יום קל." :
          ratio > 1.3 ? "עומס גבוה מהרגיל. זה בסדר לתקופה קצרה, אבל כדאי לשים לב להתאוששות." :
          ratio >= 0.8 ? "עומס מאוזן: בונה כושר בלי קפיצות חדות." : "העומס ירד מתחת לרגיל שלך. מתאים לשבוע הורדת עומס, אבל לאורך זמן הכושר יירד.";
        out.push({ level, tag: "אימונים", title: `יחס עומס אימון: ${ratio.toFixed(2)}`, text: `עומס 7 ימים ${r0(acute)} מול ממוצע שבועי של ${r0(chronic)} ב-4 השבועות האחרונים. ${msg}` });
      }
    }

    // 7. Intensity minutes this week
    {
      const im = recent("intensity_min", 7);
      if (vals(im).length >= 5) {
        const t = sum(im);
        out.push({ level: t >= 150 ? "good" : "info", tag: "אימונים", title: `דקות פעילות עצימה ב-7 הימים האחרונים: ${r0(t)}`,
          text: t >= 150 ? "עמדת בהמלצה של 150 דקות בשבוע." : `חסרות ${r0(150 - t)} דקות להמלצה של 150 דקות בשבוע. דקה עצימה מאוד נספרת כפול.` });
      }
    }

    // 8. Weight trend (regression on last 28 days)
    {
      const xs = [], ys = [];
      c.weight_kg.slice(-28).forEach((v, i) => v != null && (xs.push(i), ys.push(v)));
      if (xs.length >= 5) {
        const mx = mean(xs), my = mean(ys);
        const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
        const perWeek = slope * 7;
        const level = Math.abs(perWeek) > 0.9 ? "warning" : "info";
        out.push({ level, tag: "משקל", title: `מגמת משקל: ${signed(perWeek, (v) => v.toFixed(2))} ק״ג בשבוע`,
          text: `מבוסס על ${xs.length} שקילות ב-4 השבועות האחרונים. ${Math.abs(perWeek) < 0.15 ? "המשקל יציב." : Math.abs(perWeek) > 0.9 ? "קצב שינוי מהיר. בירידה במשקל, קצב מהיר מדי מגדיל את הסיכון לאבד מסת שריר." : perWeek < 0 ? "ירידה בקצב מתון." : "עלייה בקצב מתון."}` });
      } else if (lastIdx(c.weight_kg) < 0) {
        out.push({ level: "info", tag: "משקל", title: "אין עדיין שקילות", text: "שקילות מסונכרנות מ-Garmin Index או שנרשמות ידנית באפליקציית Connect יופיעו כאן." });
      }
    }

    // 9. Sleep length → HRV
    {
      const long = [], short = [];
      for (let i = 0; i < n; i++) if (c.sleep_h[i] != null && c.hrv[i] != null) (c.sleep_h[i] >= 7 ? long : short).push(c.hrv[i]);
      if (long.length >= 6 && short.length >= 6) {
        const p = pct(mean(long), mean(short));
        out.push({ level: "info", tag: "קשרים בנתונים", title: "השפעת אורך השינה על ה-HRV שלך",
          text: `בלילות של 7 שעות ומעלה (${long.length} לילות) ה-HRV הממוצע ${r0(mean(long))}, ובלילות קצרים יותר (${short.length}) ${r0(mean(short))}. ${p >= 3 ? `פער של ${r0(p)}% לטובת שינה ארוכה.` : p <= -3 ? "אצלך, באופן מפתיע, אין יתרון ל-HRV בלילות הארוכים." : "אין פער משמעותי."}` });
      }
    }

    // 10. Hard training days → next-night HRV
    if (D.activities.length >= 15) {
      const loads = vals(c.load.filter((v) => v > 0)).sort((a, b) => a - b);
      const p75 = loads[Math.floor(loads.length * 0.75)];
      const hard = [], other = [];
      for (let i = 0; i < n - 1; i++) if (c.hrv[i + 1] != null) (c.load[i] >= p75 && p75 > 0 ? hard : other).push(c.hrv[i + 1]);
      if (hard.length >= 6 && other.length >= 6) {
        const p = pct(mean(hard), mean(other));
        out.push({ level: "info", tag: "קשרים בנתונים", title: "מה אימון קשה עושה ל-HRV בלילה שאחריו",
          text: `אחרי ימי אימון קשים (רבע העליון של העומס, ${hard.length} ימים) ה-HRV בלילה שאחרי ${r0(mean(hard))}, ובשאר הימים ${r0(mean(other))} (${signed(p || 0, r0)}%). ${p <= -5 ? "הגוף שלך מגיב לאימון קשה בירידה ברורה. כדאי לתכנן יום קל אחריו." : "התאוששות טובה יחסית אחרי אימונים קשים."}` });
      }
    }

    // 11. Bedtime → sleep score
    {
      const bt = [], sc = [];
      for (let i = 0; i < n; i++) if (c.bedtime_min[i] != null && c.sleep_score[i] != null) { bt.push(c.bedtime_min[i]); sc.push(c.sleep_score[i]); }
      if (bt.length >= 20) {
        const med = bt.slice().sort((a, b) => a - b)[Math.floor(bt.length / 2)];
        const early = sc.filter((_, i) => bt[i] <= med), late = sc.filter((_, i) => bt[i] > med);
        const d = mean(early) - mean(late);
        out.push({ level: "info", tag: "קשרים בנתונים", title: "האם ללכת לישון מוקדם עוזר?",
          text: `בלילות שהלכת לישון עד ${clock(med)} ציון השינה הממוצע ${r0(mean(early))}, ובלילות מאוחרים יותר ${r0(mean(late))}. ${Math.abs(d) >= 3 ? `פער של ${r0(Math.abs(d))} נקודות לטובת ${d > 0 ? "השינה המוקדמת" : "השינה המאוחרת"}.` : "אין פער משמעותי."}` });
      }
    }

    // 12. Best / worst night of week
    {
      const by = Array.from({ length: 7 }, () => []);
      D.dates.forEach((d, i) => { if (c.sleep_h[i] != null) by[new Date(addDays(d, -1) + "T12:00:00Z").getUTCDay()].push(c.sleep_h[i]); });
      if (by.every((a) => a.length >= 6)) {
        const names = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
        const m = by.map(mean);
        const best = m.indexOf(Math.max(...m)), worst = m.indexOf(Math.min(...m));
        out.push({ level: "info", tag: "שינה", title: "הלילות הטובים והחלשים בשבוע",
          text: `הלילה הארוך ביותר שלך הוא בדרך כלל ליל ${names[best]} (${hm(m[best])} בממוצע), והקצר ביותר ליל ${names[worst]} (${hm(m[worst])}).` });
      }
    }

    const order = { critical: 0, serious: 1, warning: 2, good: 3, info: 4 };
    out.sort((a, b) => order[a.level] - order[b.level]);
    $("#insights").innerHTML = out.length ? out.map((it) => `<div class="insight ${it.level}"><div class="head">${ICONS[it.level]}<span>${it.title}</span></div><p>${it.text}</p><div style="margin-top:8px;display:flex;gap:6px"><span class="badge">${LEVEL_LABEL[it.level]}</span><span class="badge">${it.tag}</span></div></div>`).join("")
      : `<p class="muted">צריך עוד כמה ימים של נתונים כדי להפיק תובנות.</p>`;
  }

  // ---------- sleep tab ----------
  function sleepTab() {
    const w = windowed();
    C.bars($("#c-sleep-stages"), { x: w.dates, yFmt: hm, tickFmt: (v) => v, series: [
      { name: "שינה עמוקה", values: w.col("deep_h"), color: "--series-1" },
      { name: "REM", values: w.col("rem_h"), color: "--series-2" },
      { name: "שינה קלה", values: w.col("light_h"), color: "--series-3" },
      { name: "ערות", values: w.col("awake_h"), color: "--series-4" },
    ], refs: [{ y: SLEEP_TARGET, label: `יעד ${SLEEP_TARGET} שעות` }], totalLabel: "סה״כ שינה" });
    dotsAndAvg("#c-sleep-score", w, "sleep_score", "ציון", r0);
    const hrv = w.col("hrv");
    C.line($("#c-hrv"), { x: w.dates, yFmt: r0, band: { low: w.col("hrv_low"), high: w.col("hrv_high"), color: "--series-1", name: "טווח בסיס" },
      series: [{ name: "HRV לילי", values: hrv, color: "--series-1", dotsOnly: true, dotOpacity: 0.55 }, { name: "ממוצע 7 ימים", values: avg7(w, "hrv"), color: "--series-1" }] });
    dotsAndAvg("#c-rhr", w, "rhr", "דופק במנוחה", r0);
    C.line($("#c-bb"), { x: w.dates, yFmt: r0, yMin: 0, yMax: 100, series: [
      { name: "שיא", values: w.col("bb_high"), color: "--series-1" }, { name: "שפל", values: w.col("bb_low"), color: "--series-2" }] });
    C.line($("#c-bedtime"), { x: w.dates, yFmt: clock, tickStep: 120, series: [
      { name: "הירדמות", values: w.col("bedtime_min"), color: "--series-7", dotsOnly: true },
      { name: "קימה", values: w.col("wake_min").map((v) => (v == null ? null : v + 360)), color: "--series-2", dotsOnly: true }] });
    dotsAndAvg("#c-stress", w, "stress", "לחץ", r0);
  }

  function avg7(w, key) {
    const full = rolling(state.data.cols[key], 7, 3);
    return w.sl(full);
  }
  function dotsAndAvg(sel, w, key, name, fmt, extra = {}) {
    C.line($(sel), Object.assign({ x: w.dates, yFmt: fmt, series: [
      { name, values: w.col(key), color: "--series-1", dotsOnly: true, dotOpacity: 0.5 },
      { name: "ממוצע 7 ימים", values: avg7(w, key), color: "--series-1" }] }, extra));
  }

  // ---------- training tab ----------
  function trainingTab() {
    const D = state.data, w = windowed();
    const from = w.dates[0];
    const acts = D.activities.filter((a) => a.date >= from);
    // weekly volume by type group
    const weeks = [];
    for (let d = weekStart(from); d <= D.last; d = addDays(d, 7)) weeks.push(d);
    const wIdx = Object.fromEntries(weeks.map((d, i) => [d, i]));
    const groups = TYPE_GROUPS.map((g) => ({ ...g, values: new Array(weeks.length).fill(0) }));
    acts.forEach((a) => { const g = groups.find((x) => x.key === typeGroup(a.type).key); const i = wIdx[weekStart(a.date)]; if (i != null) g.values[i] += a.duration_min || 0; });
    const used = groups.filter((g) => g.values.some((v) => v > 0));
    const weekFmt = (d) => `שבוע מ-${C.fmtDate(d)}`;
    C.bars($("#c-weekly-volume"), { x: weeks, xFmt: weekFmt, yFmt: (v) => `${r0(v)} דק׳`, tickFmt: r0, series: used.map((g) => ({ name: g.name, values: g.values.map((v) => v || null), color: g.color })) });

    C.line($("#c-load"), { x: w.dates, yFmt: r0, series: [
      { name: "עומס 7 ימים", values: w.sl(rollingSum(D.cols.load, 7)), color: "--series-1" },
      { name: "ממוצע שבועי, 4 שבועות", values: w.sl(rollingSum(D.cols.load, 28).map((v) => v / 4)), color: "--series-2", dash: true }] });

    const im = new Array(weeks.length).fill(null);
    w.dates.forEach((d, i) => { const v = w.col("intensity_min")[i]; if (v != null) { const k = wIdx[weekStart(d)]; im[k] = (im[k] || 0) + v; } });
    C.bars($("#c-intensity"), { x: weeks, xFmt: weekFmt, yFmt: r0, refs: [{ y: 150, label: "150" }], series: [{ name: "דקות עצימות", values: im, color: "--series-1" }] });

    C.bars($("#c-steps"), { x: w.dates, yFmt: r0, series: [{ name: "צעדים", values: w.col("steps"), color: "--series-1" }] });

    const runs = new Array(w.dates.length).fill(null);
    const widx = Object.fromEntries(w.dates.map((d, i) => [d, i]));
    acts.filter((a) => typeGroup(a.type).key === "run" && a.pace_min_km && a.pace_min_km < 15).forEach((a) => { runs[widx[a.date]] = a.pace_min_km; });
    const paceFmt = (v) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, "0")}`;
    C.line($("#c-run"), { x: w.dates, yFmt: paceFmt, series: [{ name: "קצב", values: runs, color: "--series-1", dotsOnly: true }] });

    const rows = acts.slice().reverse().slice(0, 25);
    $("#t-activities").innerHTML = rows.length ? `<table><thead><tr><th>תאריך</th><th>סוג</th><th>שם</th><th>משך</th><th>מרחק</th><th>קצב</th><th>דופק ממוצע</th><th>עומס</th><th>אפקט אירובי</th></tr></thead><tbody>` +
      rows.map((a) => { const g = typeGroup(a.type); return `<tr><td class="num">${a.start.slice(8, 10)}/${a.start.slice(5, 7)} ${a.start.slice(11)}</td><td><i class="type-dot" style="background:var(${g.color})"></i>${TYPE_NAMES[a.type] || a.type}</td><td>${a.name || ""}</td><td class="num">${a.duration_min ? hm(a.duration_min / 60) : "–"}</td><td class="num">${a.distance_km ? r1(a.distance_km) + " ק״מ" : "–"}</td><td class="num">${g.key === "run" && a.pace_min_km ? paceFmt(a.pace_min_km) : "–"}</td><td class="num">${r0(a.avg_hr)}</td><td class="num">${r0(a.load)}</td><td class="num">${a.te_aerobic != null ? r1(a.te_aerobic) : "–"}</td></tr>`; }).join("") + "</tbody></table>"
      : `<p class="muted">אין אימונים בטווח הזה.</p>`;
  }

  // ---------- weight tab ----------
  function weightTab() {
    const w = windowed();
    const wkg = state.data.cols.weight_kg;
    // 7-day moving average over calendar days, carried across days without a weigh-in
    const ma = rolling(wkg, 7).map((v, i) => (lastIdx(wkg.slice(0, i + 1)) >= 0 ? v : null));
    C.line($("#c-weight"), { x: w.dates, yFmt: (v) => r1(v), series: [
      { name: "שקילה", values: w.col("weight_kg"), color: "--series-1", dotsOnly: true, dotOpacity: 0.6 },
      { name: "ממוצע נע 7 ימים", values: w.sl(ma), color: "--series-1", connect: true }] });
    const trend = (key, name, fmt, tickFmt) => {
      const full = state.data.cols[key];
      const ma = rolling(full, 14, 2).map((v, i) => (lastIdx(full.slice(0, i + 1)) >= 0 ? v : null));
      return { x: w.dates, yFmt: fmt, tickFmt, series: [
        { name, values: w.col(key), color: "--series-1", dotsOnly: true, dotOpacity: 0.6 },
        { name: "ממוצע נע 14 ימים", values: w.sl(ma), color: "--series-1", connect: true }] };
    };
    C.line($("#c-fat"), trend("body_fat", "מדידה", (v) => r1(v) + "%", r1));
    C.line($("#c-muscle"), trend("muscle_kg", "מדידה", r1));
  }

  // ---------- explorer ----------
  function explorerTab() {
    const E = state.data.explorer;
    if (!E || !E.dates) return;
    const list = $("#ex-list");
    if (!list.dataset.built) {
      list.innerHTML = Object.entries(E.endpoints).map(([ep, fields]) =>
        `<div class="grp">${ENDPOINT_NAMES[ep] || ep}</div>` + Object.keys(fields).sort().map((f) => `<button data-ep="${ep}" data-f="${f}" title="${f}">${f.replace(/^[^.]+\./, "")}</button>`).join("")).join("") || `<p class="muted" style="padding:10px">אין נתונים</p>`;
      list.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state.exField = [b.dataset.ep, b.dataset.f]; list.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); drawExplorer(); });
      list.dataset.built = "1";
      const firstBtn = list.querySelector("button");
      if (firstBtn) { firstBtn.classList.add("on"); state.exField = [firstBtn.dataset.ep, firstBtn.dataset.f]; }
      const cov = state.data.meta.coverage || {};
      const dates = E.dates;
      $("#t-coverage").innerHTML = `<table><thead><tr><th>סוג נתון</th><th>ימים עם נתונים</th><th>שדות מספריים</th></tr></thead><tbody>` +
        Object.keys(cov).sort((a, b) => cov[b] - cov[a]).map((ep) => `<tr><td>${ENDPOINT_NAMES[ep] || ep} <span class="muted">(${ep})</span></td><td class="num">${cov[ep]} מתוך ${dates.length}</td><td class="num">${Object.keys(E.endpoints[ep] || {}).length}</td></tr>`).join("") + "</tbody></table>";
    }
    drawExplorer();
  }
  function drawExplorer() {
    const E = state.data.explorer;
    if (!state.exField) return;
    const [ep, f] = state.exField;
    const col = E.endpoints[ep][f];
    const n = state.days ? Math.min(state.days, E.dates.length) : E.dates.length;
    const dates = E.dates.slice(-n), v = col.slice(-n);
    // explorer dates are only days that had any data; re-grid onto calendar days
    const span = dateSpan(dates[0], dates[dates.length - 1]);
    const m = Object.fromEntries(dates.map((d, i) => [d, v[i]]));
    const values = span.map((d) => (m[d] === undefined ? null : m[d]));
    $("#ex-title").textContent = `${ENDPOINT_NAMES[ep] || ep} · ${f}`;
    const vv = vals(values);
    $("#ex-stats").textContent = vv.length ? `${vv.length} ימים · מינימום ${C.defFmt(Math.min(...vv))} · מקסימום ${C.defFmt(Math.max(...vv))} · ממוצע ${C.defFmt(mean(vv))} · אחרון ${C.defFmt(vv[vv.length - 1])}` : "אין ערכים בטווח";
    C.line($("#c-explorer"), { x: span, series: [
      { name: f, values, color: "--series-1", dotsOnly: true, dotOpacity: 0.55 },
      { name: "ממוצע 7 ימים", values: rolling(values, 7, 3), color: "--series-1" }] });
  }

  // ---------- render / wiring ----------
  function render() {
    if (!state.data) return;
    if (state.tab === "overview") { tiles(); insights(); }
    if (state.tab === "sleep") sleepTab();
    if (state.tab === "training") trainingTab();
    if (state.tab === "weight") weightTab();
    if (state.tab === "explorer") explorerTab();
  }

  function wire() {
    $("#range").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      state.days = +b.dataset.days;
      document.querySelectorAll("#range button").forEach((x) => x.classList.toggle("on", x === b));
      try { localStorage.setItem("garmin.days", state.days); } catch (_) {}
      render();
    });
    $("#tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      state.tab = b.dataset.tab;
      document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
      document.querySelectorAll("section[data-panel]").forEach((s) => s.classList.toggle("on", s.dataset.panel === state.tab));
      history.replaceState(null, "", "#" + state.tab);
      render();
    });
    $("#theme").addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("garmin.theme", next); } catch (_) {}
      render();
    });
    let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(render, 150); });
  }

  async function init() {
    try {
      const th = localStorage.getItem("garmin.theme"); if (th) document.documentElement.dataset.theme = th;
      const d = localStorage.getItem("garmin.days"); if (d != null) state.days = +d;
    } catch (_) {}
    document.querySelectorAll("#range button").forEach((x) => x.classList.toggle("on", +x.dataset.days === state.days));
    wire();
    state.data = await load();
    if (!state.data) return;
    const lf = state.data.meta.last_fetch;
    const when = lf && lf.fetched_at ? new Date(lf.fetched_at) : null;
    $("#updated").textContent = `עודכן ${when ? when.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "–"} · ${state.data.dates.length} ימים · ${state.data.activities.length} אימונים`;
    const hash = location.hash.slice(1);
    const btn = hash && document.querySelector(`#tabs button[data-tab="${hash}"]`);
    if (btn) btn.click(); else render();
  }
  init();
})();

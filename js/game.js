/* ============================================================
 * 错别字大侦探 - 游戏逻辑
 * 流程：开始界面 → 逐关挑战（点击找错别字）→ 过场 → 结算 → 错题回顾
 * ============================================================ */

(function () {
  "use strict";

  /* ---------- 常量 ---------- */
  const BASE_SCORE = 100;          // 每个错别字基础分
  const WRONG_PENALTY = 30;        // 点错扣分
  const TIME_BONUS = 30;           // 找对一个字 +30 秒
  const TIME_PENALTY = 10;         // 点错一个字 -10 秒
  const COMBO_THRESHOLD = 3;       // 连击达到该值后每个额外 +50%
  const COMBO_BONUS_RATE = 0.5;
  const HINTS_PER_LEVEL = 3;       // 每关提示次数
  const DIFF_MULT = [1, 1, 1.2, 1.4, 1.6, 1.8]; // 难度 1~5 得分倍率

  /* ---------- DOM 快捷引用 ---------- */
  const $ = (id) => document.getElementById(id);
  const screens = {
    start: $("screen-start"),
    game: $("screen-game"),
    chapter: $("screen-chapter"),
    clear: $("screen-levelclear"),
    chapterResult: $("screen-chapter-result"),
    result: $("screen-result"),
    review: $("screen-review"),
  };

  /* ---------- 全局状态 ---------- */
  const state = {
    levelIdx: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    hintsLeft: HINTS_PER_LEVEL,
    found: 0,            // 当前关已找到数
    totalClicks: 0,      // 全局点击次数（算准确率）
    hitClicks: 0,        // 点中次数
    totalFound: 0,       // 全局找到数
    totalTypos: GAME_LEVELS.reduce((s, l) => s + l.typos.length, 0),
    wrongNotes: [],      // 错题本
    // “全部找出”的关卡（侧边栏打勾用），存全局唯一键 lv.key（如 "2-1"），localStorage 持久化
    cleared: new Set(JSON.parse(localStorage.getItem("typoGameCleared.v2") || "[]")),
    expandedChapters: new Set(),  // 侧边栏中已展开的章节 id（默认全部收起）
    timer: null,
    timeLeft: 0,
    locked: false,       // 关卡切换锁定
    typoMap: new Map(),  // "line-index" -> typo
    levelStart: { score: 0, clicks: 0, hits: 0, t: 0 },  // 本关开始时的快照（算章级增量）
    // 章级累计统计：进入每章第一关时重置（见 initChapterStats），每关结束时累加（见 endLevel）
    chapterStats: null,
  };

  /* ---------- 章级统计 ---------- */
  function initChapterStats(chapterId, levelCount) {
    state.chapterStats = {
      chapterId,          // 统计归属的章 id
      levelCount,         // 本章总关数（来自 lv.chapter.count）
      levelsPlayed: 0,    // 本次实际游玩的关数（中途跳关时可能小于 levelCount）
      score: 0,           // 本章得分（各关得分增量之和）
      found: 0,           // 本章找到的错字数
      totalTypos: 0,      // 本章游玩关卡中的错字总数（找对率分母）
      clicks: 0,          // 本章点击次数
      hits: 0,            // 本章点中次数
      maxCombo: 0,        // 本章最大连击
      time: 0,            // 本章累计用时（秒）
      notesStart: state.wrongNotes.length,  // 本章错题在错题本中的起始下标（切片用）
    };
  }

  /* ---------- 工具 ---------- */
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
  }

  function fmtTime(sec) { return Math.max(0, Math.ceil(sec)) + "s"; }

  /* 章节小结用的时间格式：83 秒 → “1 分 23 秒”，45 秒 → “45 秒” */
  function fmtDuration(sec) {
    const s = Math.max(0, Math.round(sec));
    if (s < 60) return s + " 秒";
    return Math.floor(s / 60) + " 分 " + String(s % 60).padStart(2, "0") + " 秒";
  }

  /* ============================================================
   * 关卡渲染（按展示形式分派：对话气泡 / 文档卡片）
   * ============================================================ */
  function renderLevel() {
    const lv = GAME_LEVELS[state.levelIdx];
    state.found = 0;
    state.hintsLeft = HINTS_PER_LEVEL;
    state.typoMap.clear();
    // 每次进入关卡都要重置本关的 _found 标记：
    // 否则上次未过关时已找对的字会残留 _found=true，重玩时点它会被误判为“点错”
    lv.typos.forEach((t) => {
      t._found = false;
      state.typoMap.set(t.line + "-" + t.index, t);
    });

    $("hud-level").textContent = `${lv.chapter.id}-${lv.chapter.idxInChapter} / ${GAME_LEVELS.length}`;
    $("hint-count").textContent = state.hintsLeft;
    $("btn-hint").disabled = false;
    updateHud();

    const area = $("dialogue-area");
    area.innerHTML = "";
    if (lv.format === "dialogue") renderDialogue(area, lv);
    else renderDoc(area, lv);
    area.scrollTop = 0;
  }

  /* 把一段文本逐字包成可点击的 span（对话与文档共用） */
  function appendChars(parentEl, text, lineIdx) {
    [...text].forEach((ch, i) => {
      const span = document.createElement("span");
      span.className = "char";
      span.textContent = ch;
      span.dataset.pos = lineIdx + "-" + i;
      span.addEventListener("click", () => onCharClick(span));
      parentEl.appendChild(span);
    });
  }

  /* ---- 形式一：对话气泡 ---- */
  function renderDialogue(area, lv) {
    lv.dialogue.forEach((line, lineIdx) => {
      const bubble = document.createElement("div");
      bubble.className = "bubble " + (line.side === "right" ? "right" : "left");
      bubble.innerHTML = `
        <div class="avatar">${line.avatar || "🙂"}</div>
        <div class="bubble-body">
          <div class="speaker-name">${line.speaker || ""}</div>
          <div class="bubble-text"></div>
        </div>`;
      appendChars(bubble.querySelector(".bubble-text"), line.text, lineIdx);
      area.appendChild(bubble);
    });
  }

  /* ---- 形式二：文档卡片（小作文 / 通知 / 日记 / 书信） ---- */
  function renderDoc(area, lv) {
    const f = LEVEL_FORMATS[lv.format] || LEVEL_FORMATS.dialogue;
    const h = lv.heading || {};
    const card = document.createElement("div");
    card.className = "doc-card doc-" + lv.format;

    const parts = [];
    parts.push(`<div class="doc-badge">${f.icon} ${f.label}</div>`);
    if (h.title) parts.push(`<div class="doc-title">${h.title}</div>`);
    if (h.subtitle) parts.push(`<div class="doc-sub">${h.subtitle}</div>`);
    if (h.meta) parts.push(`<div class="doc-meta">${h.meta}</div>`);
    if (h.salutation) parts.push(`<div class="doc-salut">${h.salutation}</div>`);
    parts.push(`<div class="doc-body"></div>`);
    if (h.closing) parts.push(`<div class="doc-closing">${h.closing}</div>`);
    const signLines = [];
    if (h.signature) signLines.push(h.signature);
    if (h.date) signLines.push(h.date);
    if (signLines.length) parts.push(`<div class="doc-sign">${signLines.join("<br>")}</div>`);
    card.innerHTML = parts.join("");

    const body = card.querySelector(".doc-body");
    lv.dialogue.forEach((line, lineIdx) => {
      const p = document.createElement("p");
      p.className = "doc-para";
      p.style.animationDelay = Math.min(lineIdx * 0.09, 0.5) + "s";
      appendChars(p, line.text, lineIdx);
      body.appendChild(p);
    });
    area.appendChild(card);
  }

  function updateHud() {
    const lv = GAME_LEVELS[state.levelIdx];
    $("hud-score").textContent = state.score;
    $("hud-combo").textContent = "×" + state.combo;
    $("hud-found").textContent = `${state.found} / ${lv.typos.length}`;
  }

  /* ============================================================
   * 侧边选关抽屉
   * ============================================================ */
  function buildSidebar() {
    const body = $("sidebar-body");
    body.innerHTML = "";
    CHAPTERS.forEach((ch) => {
      const chLevels = GAME_LEVELS.filter((l) => l.chapter.id === ch.id);
      const typoCount = chLevels.reduce((s, l) => s + l.typos.length, 0);
      const expanded = state.expandedChapters.has(ch.id);

      const chEl = document.createElement("div");
      chEl.className = "side-chapter" + (expanded ? "" : " collapsed");
      chEl.innerHTML = `
        <button class="side-chapter-head">
          <span class="emoji">${ch.emoji}</span>
          <span class="ch-name">${ch.title}</span>
          <span class="meta">${ch.levels.length} 关 · ${typoCount} 字</span>
          <span class="chev">${expanded ? "▾" : "▸"}</span>
        </button>
        <div class="side-levels"></div>`;

      // 点击章节标题 → 展开 / 收起
      chEl.querySelector(".side-chapter-head").addEventListener("click", () => {
        const nowOpen = chEl.classList.toggle("collapsed") === false;
        chEl.querySelector(".chev").textContent = nowOpen ? "▾" : "▸";
        if (nowOpen) state.expandedChapters.add(ch.id);
        else state.expandedChapters.delete(ch.id);
      });

      const list = chEl.querySelector(".side-levels");
      chLevels.forEach((lv) => {
        const f = LEVEL_FORMATS[lv.format] || LEVEL_FORMATS.dialogue;
        // 非对话形式在副信息里加文体徽章（对话是默认形式，不标以免冗余）
        const fmtTag = lv.format === "dialogue" ? "" : ` · ${f.icon} ${f.label}`;
        const btn = document.createElement("button");
        btn.className = "side-level";
        if (GAME_LEVELS[state.levelIdx] === lv) btn.classList.add("current");
        btn.innerHTML = `
          <span class="lv-idx">${ch.id}-${lv.chapter.idxInChapter}</span>
          <span class="lv-info">
            <div class="lv-name">${lv.title.replace(/^第 \d+ 关 · /, "")}</div>
            <div class="lv-sub">${lv.typos.length} 个错别字 · ${"★".repeat(lv.difficulty)}${"☆".repeat(5 - lv.difficulty)}${fmtTag}</div>
          </span>
          <span class="lv-check">${state.cleared.has(lv.key) ? "✅" : ""}</span>`;
        btn.addEventListener("click", () => { closeSidebar(); jumpToLevel(GAME_LEVELS.indexOf(lv)); });
        list.appendChild(btn);
      });
      body.appendChild(chEl);
    });
    // 底部：总进度统计
    $("sidebar-progress").innerHTML =
      `已完美通关 <b>${state.cleared.size}</b> / ${GAME_LEVELS.length} 关`;
  }

  function clearProgress() {
    state.cleared.clear();
    localStorage.removeItem("typoGameCleared.v2");
    localStorage.removeItem("typoGameCleared"); // 兼容旧版本存档
    buildSidebar();
  }

  function openSidebar() { buildSidebar(); $("sidebar").classList.add("open"); $("sidebar-mask").classList.add("open"); }
  function closeSidebar() { $("sidebar").classList.remove("open"); $("sidebar-mask").classList.remove("open"); }

  /* 跳转到任意关卡：停表、重置本关状态，从该关继续推进 */
  function jumpToLevel(idx) {
    if (idx === state.levelIdx && screens.game.classList.contains("active")) return;
    // 从开始界面选关进入 → 视为开启新的一局（重置成绩）
    if (screens.start.classList.contains("active")) {
      SFX.unlock();
      resetStats();
    }
    clearInterval(state.timer);
    state.locked = false;
    state.levelIdx = idx;
    state.combo = 0;
    const lv = GAME_LEVELS[idx];
    // 章级统计初始化：进入新章首关、或跨章跳关（如直接从第 2 章第 2 关进入）时重新起算，
    // 避免把上一章 / 本章前段未游玩关卡的数据带入或漏掉
    if (lv.chapter.isFirst || !state.chapterStats || lv.chapter.id !== state.chapterStats.chapterId) {
      initChapterStats(lv.chapter.id, lv.chapter.count);
    }
    if (lv.chapter.isFirst) { renderLevel(); showChapterIntro(lv); }
    else beginLevel();
  }

  /* ============================================================
   * 计时器
   * ============================================================ */
  function startTimer() {
    const lv = GAME_LEVELS[state.levelIdx];
    state.timeLeft = lv.timeLimit;
    state._lastTickSec = Math.ceil(lv.timeLimit);
    // 记录本关开始的快照，关卡结束时据此计算“本关得分/点击/用时”增量并累加进章级统计
    state.levelStart = {
      score: state.score,
      clicks: state.totalClicks,
      hits: state.hitClicks,
      t: Date.now(),
    };
    const bar = $("timer-bar");
    const tick = () => {
      const ratio = state.timeLeft / lv.timeLimit;
      bar.style.width = (Math.min(ratio, 1) * 100).toFixed(1) + "%";
      bar.className = "timer-bar" + (ratio < 0.2 ? " danger" : ratio < 0.45 ? " warn" : "");
      $("timer-text").textContent = fmtTime(state.timeLeft);
      if (state.timeLeft <= 0) { endLevel(false); return; }
      // 最后 10 秒每秒滴答一声
      const sec = Math.ceil(state.timeLeft);
      if (sec <= 10 && sec < state._lastTickSec) {
        state._lastTickSec = sec;
        SFX.tick();
      }
      state.timeLeft -= 0.1;
    };
    clearInterval(state.timer);
    tick();
    state.timer = setInterval(tick, 100);
  }

  /* ============================================================
   * 点击判定
   * ============================================================ */
  function onCharClick(span) {
    if (state.locked || span.classList.contains("correct")) return;

    const key = span.dataset.pos;
    const typo = state.typoMap.get(key);
    state.totalClicks++;

    if (typo && !typo._found) {
      /* ---- 找对 ---- */
      typo._found = true;
      state.hitClicks++;
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      // 章级最大连击（连击在每关开始时清零，所以这里取本章各关峰值）
      if (state.chapterStats) state.chapterStats.maxCombo = Math.max(state.chapterStats.maxCombo, state.combo);

      const lv = GAME_LEVELS[state.levelIdx];
      let gain = Math.round(BASE_SCORE * DIFF_MULT[lv.difficulty]);
      if (state.combo >= COMBO_THRESHOLD) gain = Math.round(gain * (1 + COMBO_BONUS_RATE));
      state.score += gain;
      state.found++;
      state.totalFound++;
      state.timeLeft += TIME_BONUS;   // 找对奖励时间

      span.classList.add("correct");
      span.dataset.fix = "→ " + typo.correct;
      showFeedback(`+${gain} 分 · +${TIME_BONUS}s！「${typo.wrong}」应为「${typo.correct}」`, true);
      SFX.correct();
      if (state.combo >= COMBO_THRESHOLD) { showComboPop(state.combo); SFX.combo(state.combo); }
      updateHud();

      if (state.found >= lv.typos.length) endLevel(true);
    } else {
      /* ---- 点错 ---- */
      state.combo = 0;
      state.score = Math.max(0, state.score - WRONG_PENALTY);
      state.timeLeft = Math.max(0, state.timeLeft - TIME_PENALTY);   // 点错扣时间
      span.classList.add("wrong");
      setTimeout(() => span.classList.remove("wrong"), 450);
      showFeedback(`-${WRONG_PENALTY} 分 · -${TIME_PENALTY}s，这个字没错哦`, false);
      SFX.wrong();
      updateHud();
      if (state.timeLeft <= 0) endLevel(false);   // 时间被扣光，直接结束本关
    }
  }

  function showFeedback(text, good) {
    const el = $("feedback-tip");
    el.textContent = text;
    el.className = "feedback-tip " + (good ? "good" : "bad");
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ""; }, 1800);
  }

  function showComboPop(combo) {
    const el = $("combo-pop");
    el.textContent = `${combo} 连击！得分 +50%`;
    el.classList.remove("hidden");
    el.style.animation = "none";
    void el.offsetWidth; // 重触发动画
    el.style.animation = "";
    setTimeout(() => el.classList.add("hidden"), 850);
  }

  /* ============================================================
   * 提示
   * ============================================================ */
  function useHint() {
    if (state.locked || state.hintsLeft <= 0) return;
    const lv = GAME_LEVELS[state.levelIdx];
    const remaining = lv.typos.filter((t) => !t._found);
    if (!remaining.length) return;

    state.hintsLeft--;
    $("hint-count").textContent = state.hintsLeft;
    if (state.hintsLeft <= 0) $("btn-hint").disabled = true;

    const t = remaining[Math.floor(Math.random() * remaining.length)];
    const span = document.querySelector(`.char[data-pos="${t.line}-${t.index}"]`);
    if (span) {
      span.classList.add("hint-glow");
      span.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => span.classList.remove("hint-glow"), 3000);
    }
    showFeedback(`💡 有个可疑的字闪烁了一下……（剩 ${state.hintsLeft} 次）`, true);
    SFX.hint();
  }

  /* ============================================================
   * 关卡结束 / 推进
   * ============================================================ */
  function endLevel(allFound) {
    if (state.locked) return;
    state.locked = true;
    clearInterval(state.timer);

    const lv = GAME_LEVELS[state.levelIdx];
    // 全部找出 → 侧边栏打勾，并持久化到 localStorage
    if (allFound) {
      state.cleared.add(lv.key);
      localStorage.setItem("typoGameCleared.v2", JSON.stringify([...state.cleared]));
    }
    lv.typos.forEach((t) => {
      if (!t._found) {
        addWrongNote(lv, t, "未找到");
        const span = document.querySelector(`.char[data-pos="${t.line}-${t.index}"]`);
        if (span) { span.classList.add("correct"); span.dataset.fix = "→ " + t.correct; }
      }
    });

    // ---- 章级统计累加（放在错题记账之后，本章错题才能被切片到）----
    settleChapterStats(lv);

    // 点错的句子（若错字后来被找到则不进错题本；这里把“点错过但本关未找到”的情况已覆盖）
    setTimeout(() => {
      state.locked = false;
      const isGlobalLast = state.levelIdx >= GAME_LEVELS.length - 1;
      if (isGlobalLast) {
        showResult();                        // 全局最后一关 → 走原有全局结算
      } else if (lv.chapter.isLast) {
        showChapterResult();                 // 本章最后一关 → 章节小结
      } else {
        showLevelClear(allFound);
      }
    }, allFound ? 600 : 1400);
  }

  /* 把本关的得分/点击/找到数/用时增量累加进章级统计 */
  function settleChapterStats(lv) {
    const cs = state.chapterStats;
    if (!cs) return;   // 理论上不会发生：initChapterStats 在 resetStats / 换章时都会调用
    cs.levelsPlayed++;
    cs.score += state.score - state.levelStart.score;
    cs.clicks += state.totalClicks - state.levelStart.clicks;
    cs.hits += state.hitClicks - state.levelStart.hits;
    cs.found += state.found;
    cs.totalTypos += lv.typos.length;
    cs.time += (Date.now() - state.levelStart.t) / 1000;
  }

  function addWrongNote(lv, typo, reason) {
    const lineText = lv.dialogue[typo.line].text;
    // 构造带高亮错字的原句
    const marked =
      lineText.slice(0, typo.index) +
      "<mark>" + typo.wrong + "</mark>" +
      lineText.slice(typo.index + 1);

    // 出处标注：对话形式记说话人；文档形式记“文体 + 标题 + 第几段”
    const f = LEVEL_FORMATS[lv.format] || LEVEL_FORMATS.dialogue;
    let source;
    if (lv.format === "dialogue") {
      source = `${f.icon} ${lv.dialogue[typo.line].speaker || "文中"}`;
    } else {
      const t = lv.heading && lv.heading.title ? `《${lv.heading.title}》` : "";
      source = `${f.icon} ${f.label}${t} · 第 ${typo.line + 1} 段`;
    }

    // 对话引用加引号，文档段落按原文直录
    const sentence = lv.format === "dialogue" ? `“${marked}”` : marked;

    state.wrongNotes.push({
      level: state.levelIdx + 1,
      format: lv.format,
      speaker: lv.dialogue[typo.line].speaker || "",
      source,
      wrong: typo.wrong,
      correct: typo.correct,
      sentence,
      explain: typo.explain,
      reason,
    });
  }

  function showLevelClear(allFound) {
    const lv = GAME_LEVELS[state.levelIdx];
    const ch = lv.chapter;
    const nextLv = GAME_LEVELS[state.levelIdx + 1];
    // 注意：本章最后一关不再走这里，改走 showChapterResult() 章节小结

    $("clear-emoji").textContent = allFound ? "🎉" : "⏰";
    $("clear-title").textContent = allFound ? "全部找出！" : "时间到！";
    $("clear-stats").innerHTML = `
      <div>本关找出 <b>${state.found}</b> / ${lv.typos.length} 个错别字（第 ${ch.id} 章 · ${ch.idxInChapter}/${ch.count} 关）</div>
      <div>当前总分 <b>${state.score}</b> · 当前连击 ×${state.combo}</div>`;
    $("btn-next-level").textContent = nextLv.chapter.isFirst
      ? `进入${nextLv.chapter.title} ▶`
      : `下一关（第 ${nextLv.chapter.id} 章 · ${nextLv.chapter.idxInChapter}/${nextLv.chapter.count}）▶`;
    showScreen("clear");
    SFX.levelClear();
  }

  /* ---------- 章节结算 ---------- */

  /* 本章错题 = 错题本中从 notesStart 起的切片（本章中途加入时只含本章已游玩关卡的错题） */
  function getChapterNotes() {
    const cs = state.chapterStats;
    if (!cs) return [];
    return state.wrongNotes.slice(cs.notesStart);
  }

  function showChapterResult() {
    const lv = GAME_LEVELS[state.levelIdx];
    const ch = lv.chapter;
    const cs = state.chapterStats;
    const notes = getChapterNotes();
    const findRate = cs.totalTypos ? Math.round((cs.found / cs.totalTypos) * 100) : 100;

    $("chapter-result-emoji").textContent = ch.emoji;
    $("chapter-result-kicker").textContent = "CHAPTER " + ch.id + " CLEARED";
    $("chapter-result-title").textContent = `${ch.title} 完成！`;
    $("cr-rate").textContent = findRate + "%";
    $("cr-rate").className = "chapter-result-num " + (findRate >= 80 ? "c-green" : findRate >= 50 ? "c-gold" : "c-red");
    $("cr-score").textContent = cs.score;
    $("cr-time").textContent = fmtDuration(cs.time);
    $("cr-combo").textContent = "×" + cs.maxCombo;
    $("cr-wrong").textContent = notes.length;
    $("cr-wrong-count").textContent = notes.length;
    // 中途跳关进入本章时，实际游玩关数可能少于本章总关数，给一行提示说明统计口径
    $("chapter-result-note").innerHTML = cs.levelsPlayed < cs.levelCount
      ? `（本次从本章中途加入，以上仅统计已游玩的 ${cs.levelsPlayed}/${cs.levelCount} 关）`
      : "";
    $("btn-chapter-review").disabled = notes.length === 0;
    // 下一关必然是下一章的首关
    $("btn-next-chapter").textContent = `进入${GAME_LEVELS[state.levelIdx + 1].chapter.title} ▶`;

    showScreen("chapterResult");
    SFX.gameOver();
  }
  /* ---------- 章节开幕 ---------- */
  function showChapterIntro(lv) {
    const ch = lv.chapter;
    // 统计本章信息
    const chapterLevels = GAME_LEVELS.filter((l) => l.chapter.id === ch.id);
    const typoCount = chapterLevels.reduce((s, l) => s + l.typos.length, 0);
    const maxDiff = Math.max(...chapterLevels.map((l) => l.difficulty));
    // 本章包含的展示形式（多于一种时列出，让玩家知道会看到什么文体）
    const fmtIcons = [...new Set(chapterLevels.map((l) => l.format))]
      .map((fmt) => {
        const f = LEVEL_FORMATS[fmt] || LEVEL_FORMATS.dialogue;
        return `${f.icon}${f.label}`;
      })
      .join(" · ");

    $("chapter-emoji").textContent = ch.emoji;
    $("chapter-kicker").textContent = "CHAPTER " + ch.id;
    $("chapter-title").textContent = ch.title;
    $("chapter-desc").textContent = ch.desc;
    $("chapter-meta").textContent =
      `本章 ${ch.count} 关 · 共 ${typoCount} 个错别字 · 难度 ${"★".repeat(maxDiff)}${"☆".repeat(5 - maxDiff)}`
      + (fmtIcons ? ` · ${fmtIcons}` : "");
    showScreen("chapter");
  }

  /* 真正进入当前关的游戏画面 */
  function beginLevel() {
    renderLevel();
    showScreen("game");
    startTimer();
  }

  function nextLevel() {
    state.levelIdx++;
    state.combo = 0; // 跨关连击清零
    const lv = GAME_LEVELS[state.levelIdx];
    if (lv.chapter.isFirst) {
      initChapterStats(lv.chapter.id, lv.chapter.count);   // 新章节：章级统计重新起算
      showChapterIntro(lv);                                 // 新章节先过开幕页
    } else beginLevel();
  }

  /* ============================================================
   * 结算
   * ============================================================ */
  function showResult() {
    clearInterval(state.timer);
    const acc = state.totalClicks ? Math.round((state.hitClicks / state.totalClicks) * 100) : 100;
    const findRate = state.totalFound / state.totalTypos;

    // 评级：综合找出率与准确率
    let rank, title;
    const grade = findRate * 0.6 + (acc / 100) * 0.4;
    if (grade >= 0.95) { rank = "S"; title = "火眼金睛 · 一字不苟"; }
    else if (grade >= 0.85) { rank = "A"; title = "明察秋毫 · 字字珠玑"; }
    else if (grade >= 0.7) { rank = "B"; title = "小有眼力 · 再接再厉"; }
    else if (grade >= 0.5) { rank = "C"; title = "马马虎虎 · 还需磨练"; }
    else { rank = "D"; title = "雾里看花 · 勤能补拙"; }

    $("result-rank").textContent = rank;
    $("result-title").textContent = title;
    $("r-score").textContent = state.score;
    $("r-accuracy").textContent = acc + "%";
    $("r-combo").textContent = "×" + state.maxCombo;
    $("r-found").textContent = `${state.totalFound}/${state.totalTypos}`;
    $("r-wrong-count").textContent = state.wrongNotes.length;
    $("btn-review").disabled = state.wrongNotes.length === 0;

    localStorage.setItem("typoGameWrongNotes", JSON.stringify(state.wrongNotes));
    showScreen("result");
    SFX.gameOver();
  }

  /* ============================================================
   * 错题回顾
   * ============================================================ */
  function showReview(notes, backTo) {
    const list = $("review-list");
    list.innerHTML = "";
    if (!notes.length) {
      list.innerHTML = `<div class="review-empty">🎊 没有错题，全部找对了！</div>`;
    } else {
      notes.forEach((n) => {
        // 兼容旧存档错题（无 source / format 字段）：回退到说话人，并补上对话引号
        const source = n.source || (n.speaker ? `💬 ${n.speaker}` : "📄 文中");
        const isDialogue = !n.format || n.format === "dialogue";
        const sentence = isDialogue && !n.sentence.startsWith("“") ? `“${n.sentence}”` : n.sentence;
        const item = document.createElement("div");
        item.className = "review-item";
        item.innerHTML = `
          <div class="review-head">
            <span class="review-wrong">${n.wrong}</span>
            <span class="review-arrow">→</span>
            <span class="review-right">${n.correct}</span>
            <span class="review-tag">第 ${n.level} 关 · ${n.reason}</span>
          </div>
          <div class="review-source">${source}</div>
          <div class="review-sentence">${sentence}</div>
          <div class="review-explain">💬 ${n.explain}</div>`;
        list.appendChild(item);
      });
    }
    showScreen("review");
    // 按来源微调标题文案：全局结算 / 章节小结 / 开始界面
    const isChapter = backTo === "chapter";
    $("review-title").textContent = isChapter ? "📖 本章错题回顾" : "📖 错题回顾";
    $("btn-back-result").textContent = backTo === "start" ? "返回首页"
      : isChapter ? "返回章节小结" : "返回结算";
    $("btn-back-result").onclick = () => {
      if (backTo === "start") showScreen("start");
      else if (isChapter) showScreen("chapterResult");
      else showScreen("result");
    };
  }

  /* ============================================================
   * 开始 / 重开
   * ============================================================ */
  function resetStats() {
    // 重置所有 _found 标记
    GAME_LEVELS.forEach((lv) => lv.typos.forEach((t) => { t._found = false; }));
    Object.assign(state, {
      levelIdx: 0, score: 0, combo: 0, maxCombo: 0,
      hintsLeft: HINTS_PER_LEVEL, found: 0, totalClicks: 0,
      hitClicks: 0, totalFound: 0, wrongNotes: [], locked: false,
    });
    // 章级统计从第一章重新起算
    const first = GAME_LEVELS[0];
    initChapterStats(first.chapter.id, first.chapter.count);
    // 注意：不清空 state.cleared —— 通关进度是持久化的，重开一局仍保留
  }

  function startGame() {
    SFX.unlock();   // 用户手势内解锁音频
    resetStats();
    renderLevel();
    showChapterIntro(GAME_LEVELS[0]);   // 先展示第一章开幕页
  }

  /* ---------- 事件绑定 ---------- */
  $("btn-start").addEventListener("click", startGame);
  $("btn-restart").addEventListener("click", startGame);
  $("btn-hint").addEventListener("click", useHint);
  $("btn-skip").addEventListener("click", () => endLevel(false));
  $("btn-next-level").addEventListener("click", nextLevel);
  $("btn-chapter-start").addEventListener("click", () => { SFX.unlock(); beginLevel(); });

  // 章节结算页：查看本章错题 / 进入下一章（下一关必然是下一章首关，nextLevel 内部会调 showChapterIntro）
  $("btn-chapter-review").addEventListener("click", () => showReview(getChapterNotes(), "chapter"));
  $("btn-next-chapter").addEventListener("click", nextLevel);

  // 侧边选关抽屉
  $("btn-menu").addEventListener("click", openSidebar);
  $("btn-select-level").addEventListener("click", openSidebar);
  $("btn-close-sidebar").addEventListener("click", closeSidebar);
  $("sidebar-mask").addEventListener("click", closeSidebar);
  $("btn-clear-progress").addEventListener("click", clearProgress);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSidebar(); });
  $("btn-review").addEventListener("click", () => showReview(state.wrongNotes, "result"));

  // 音效开关
  const btnSound = $("btn-sound");
  const syncSoundIcon = () => { btnSound.textContent = SFX.muted ? "🔇" : "🔊"; };
  syncSoundIcon();
  btnSound.addEventListener("click", () => { SFX.toggle(); syncSoundIcon(); });

  // 开始界面的“上次错题”入口
  const savedNotes = JSON.parse(localStorage.getItem("typoGameWrongNotes") || "[]");
  if (savedNotes.length) {
    const btn = $("btn-review-entry");
    btn.classList.remove("hidden");
    btn.textContent = `📖 查看上次错题回顾（${savedNotes.length}）`;
    btn.addEventListener("click", () => showReview(savedNotes, "start"));
  }
})();

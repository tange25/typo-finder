/* ============================================================
 * 错别字大侦探 - 电子音效（Web Audio API 实时合成，零音频文件）
 * ------------------------------------------------------------
 * 对外接口（挂载到 window.SFX）：
 *   SFX.unlock()      首次用户交互时调用，解锁 AudioContext
 *   SFX.correct()     选对：明亮上行双音
 *   SFX.wrong()       选错：低沉下坠蜂鸣
 *   SFX.combo(n)      连击：随连击数升高的琶音
 *   SFX.hint()        提示：柔和风铃音
 *   SFX.levelClear()  过关：短号角
 *   SFX.gameOver()    结算：完整小号角
 *   SFX.tick()        最后 10 秒滴答
 *   SFX.toggle()      静音开关，返回当前是否静音
 *   SFX.muted         当前静音状态（localStorage 持久化）
 * ============================================================ */

const SFX = (function () {
  "use strict";

  let ctx = null;
  let muted = localStorage.getItem("typoGameMuted") === "1";

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /* 用户首次交互后必须解锁一次，否则浏览器会禁止发声 */
  function unlock() { ensureCtx(); }

  /**
   * 播放单个音符
   * @param freq     频率 Hz
   * @param start    相对当前时刻的起始偏移（秒）
   * @param dur      时长（秒）
   * @param type     波形：sine / square / triangle / sawtooth
   * @param vol      音量 0~1
   * @param slideTo  可选：滑音目标频率（营造电子上扬/下坠感）
   */
  function note(freq, start, dur, type, vol, slideTo) {
    if (muted) return;
    const ac = ensureCtx();
    if (!ac) return;
    const t0 = ac.currentTime + start;

    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);

    // 快速起音 + 指数衰减，模拟电子音信封
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  return {
    get muted() { return muted; },

    unlock,

    toggle() {
      muted = !muted;
      localStorage.setItem("typoGameMuted", muted ? "1" : "0");
      if (!muted) unlock();
      return muted;
    },

    /* 选对：sol→do 明亮上行 + 高八度闪光 */
    correct() {
      note(659.25, 0,    0.12, "sine",     0.30);
      note(987.77, 0.08, 0.18, "sine",     0.30);
      note(1975.5, 0.10, 0.10, "triangle", 0.10);
    },

    /* 选错：方波下坠 + 低频嗡声 */
    wrong() {
      note(220, 0,    0.22, "square", 0.16, 110);
      note(90,  0.02, 0.25, "sine",   0.20);
    },

    /* 连击：随连击数升调的三连琶音（封顶避免刺耳） */
    combo(n) {
      const base = Math.min(523.25 * Math.pow(1.06, n), 1400);
      note(base,        0,    0.08, "triangle", 0.22);
      note(base * 1.25, 0.06, 0.08, "triangle", 0.22);
      note(base * 1.5,  0.12, 0.14, "triangle", 0.24);
    },

    /* 提示：风铃般的两音 */
    hint() {
      note(1318.5, 0,    0.20, "sine", 0.18);
      note(1760.0, 0.12, 0.30, "sine", 0.14);
    },

    /* 过关：do-mi-sol-do 短号角 */
    levelClear() {
      const seq = [523.25, 659.25, 783.99, 1046.5];
      seq.forEach((f, i) => note(f, i * 0.11, 0.16, "triangle", 0.26));
    },

    /* 结算：稍完整的小号角 */
    gameOver() {
      const seq = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      seq.forEach((f, i) => note(f, i * 0.13, 0.20, "triangle", 0.26));
      note(261.63, 0, 0.9, "sine", 0.10);
    },

    /* 最后 10 秒滴答 */
    tick() {
      note(880, 0, 0.05, "square", 0.10);
    },
  };
})();

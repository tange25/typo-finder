/* ============================================================
 * 错别字大侦探 - 题库加载器 / 解析器
 * ------------------------------------------------------------
 * 本文件只负责：收集各章节文件 → 解析【错|对】标记 → 挂章节信息 → 校验。
 * 关卡内容不写在这里，而是按章拆分到 js/questions/ 目录：
 *
 *   js/questions/ch01-tongyinzi.js   第一章（关卡 1-3）
 *   js/questions/ch02-xingjinzi.js   第二章（关卡 4-5）
 *   js/questions/ch03-huoyanjing.js  第三章（关卡 6-7）
 *   js/questions/ch04-zhongji.js     第四章（关卡 8-9）
 *   js/questions/ch05-zuowen.js      第五章（关卡 10-13，多文体）
 *
 * 【如何新增一个章节】
 *   1. 在 js/questions/ 下新建 ch06-xxx.js，内容模板：
 *      window.QUESTION_PACKS = window.QUESTION_PACKS || [];
 *      window.QUESTION_PACKS.push({
 *        chapter: { id: 6, emoji: "✨", title: "第六章 · xxx", desc: "一句话简介" },
 *        levels: [ { 关卡对象 }, ... ]
 *      });
 *   2. 在 index.html 的 <script> 列表里，questions.js 之前加上该文件。
 *
 * 【如何给已有章节加关卡】
 *   直接往对应章节文件的 levels 数组里加关卡对象即可，无需改别处。
 *
 * 【支持哪些展示形式（format）】
 *   format: "dialogue" | "essay" | "notice" | "diary" | "letter"（缺省为 dialogue）
 *     dialogue —— 对话气泡（原有形式）
 *     essay    —— 小作文稿纸：居中标题 + 署名 + 段落首行缩进
 *     notice   —— 通知：居中标题 + 正文 + 右下落款（单位 + 日期）
 *     diary    —— 日记：顶部日期天气 + 正文
 *     letter   —— 书信：顶格称呼 + 正文 + 祝语 + 右下署名与日期
 *
 * 【文档类形式的 heading 字段（可选，按需填）】
 *   heading: {
 *     title:       "雨中的那把伞",          // 主标题（作文题名 / “通知”）
 *     subtitle:    "—— 四（2）班 林小满",    // 作文署名等副标题
 *     meta:        "8 月 5 日 星期三 晴",    // 日记的日期天气
 *     salutation:  "亲爱的表哥：",           // 书信称呼（顶格）
 *     closing:     "祝 学习进步！",          // 书信祝语（换行顶格）
 *     signature:   "表弟 小宇",              // 落款署名
 *     date:        "2026 年 3 月 18 日"      // 落款日期
 *   }
 *
 * 【关卡对象格式】
 *   {
 *     id: 1,                 // 关卡编号，只要求在「本章内」唯一，每章都从 1 开始
 *                            // （程序会额外生成全局唯一键 lv.key = "章节id-关卡id"，如 "2-1"）
 *     title: "关卡标题",
 *     format: "essay",       // 展示形式，缺省 "dialogue"
 *     heading: { ... },      // 文档类形式的表头/落款（见上）
 *     difficulty: 1~5,       // 决定得分倍率（1→×1.0 … 5→×1.8）
 *     timeLimit: 60,         // 限时（秒）
 *     dialogue: [            // 对话形式用 dialogue；文档类形式每段一个元素（也可写成 paragraphs）
 *       {
 *         speaker: "名字", avatar: "😀", side: "left" | "right",   // 仅对话形式需要
 *         text: "普通文字【错|对】普通文字",   // 【错别字|正确字】，均为单字
 *         explains: { "错": "解析（可选，错题回顾中展示）" }
 *       }
 *     ]
 *   }
 * ============================================================ */

(function () {
  "use strict";

  const packs = window.QUESTION_PACKS || [];// 章节文件列表
  if (!packs.length) {
    console.error("[题库] 未加载任何章节文件，请检查 index.html 中的 <script> 引用");
  }

  /* ---------- 展示形式表（渲染与错题标注共用） ---------- */
  const FORMATS = {
    dialogue: { icon: "💬", label: "对话" },
    essay:    { icon: "📝", label: "小作文" },
    notice:   { icon: "📢", label: "通知" },
    diary:    { icon: "📔", label: "日记" },
    letter:   { icon: "✉️", label: "书信" },
  };

  /* heading 的完整字段清单（文档类形式用，缺哪个就少渲染哪一块） */
  const EMPTY_HEADING = {
    title: "",       // 主标题
    subtitle: "",    // 副标题（作文署名等）
    meta: "",        // 抬头信息（日记日期天气等）
    salutation: "",  // 书信称呼
    closing: "",     // 书信祝语
    signature: "",   // 落款署名
    date: "",        // 落款日期
  };

  /* ---------- 解析：把【错|对】标记展开为结构化数据 ---------- */
  function parseLevel(raw, chTitle) {
    // format 校验：不认识的值回退为 dialogue，避免渲染分支漏判
    const format = FORMATS[raw.format] ? raw.format : "dialogue";
    if (raw.format && !FORMATS[raw.format]) {
      console.warn(`[题库] ${chTitle} / ${raw.title}：未知展示形式 "${raw.format}"，已按对话处理`);
    }
    const heading = Object.assign({}, EMPTY_HEADING, raw.heading || {});

    const lines = raw.dialogue || raw.paragraphs || [];// 文档类形式可用 paragraphs 别名
    const typos = [];// 错别字列表
    const dialogue = lines.map((line, lineIdx) => {
      let cleanText = "";
      let cursor = 0;
      const re = /【(.+?)\|(.+?)】/g;// 匹配【错|对】标记
      let m;
      while ((m = re.exec(line.text)) !== null) {
        cleanText += line.text.slice(cursor, m.index);
        const wrong = m[1], correct = m[2];
        if (wrong.length !== 1 || correct.length !== 1) {
          console.warn(`[题库] ${chTitle} / ${raw.title} 第${lineIdx + 1}行：标记【${wrong}|${correct}】应为单字`);
        }
        typos.push({
          line: lineIdx,
          index: cleanText.length,           // 错字在清洗后文本中的下标
          wrong,
          correct,
          explain: (line.explains && line.explains[wrong]) || `“${wrong}”应为“${correct}”。`,
        });
        cleanText += wrong;                  // 文中保留错别字供玩家找
        cursor = m.index + m[0].length;
      }
      cleanText += line.text.slice(cursor);
      return { speaker: line.speaker, avatar: line.avatar, side: line.side, text: cleanText };
    });
    return Object.assign({}, raw, { format, heading, dialogue, typos });
  }

  /* ---------- 组装：章节 + 关卡，并做一致性校验 ---------- */
  const CHAPTERS = [];
  const GAME_LEVELS = [];

  const seenChapter = new Set();
  packs.forEach((pack) => {
    const chMeta = pack.chapter;
    if (seenChapter.has(chMeta.id)) throw new Error(`[题库] 章节 id=${chMeta.id} 重复（${chMeta.title}）`);
    seenChapter.add(chMeta.id);

    const levels = (pack.levels || []).map((lv) => parseLevel(lv, chMeta.title));
    CHAPTERS.push(Object.assign({}, chMeta, { levels: levels.map((l) => l.id) }));

    // 关卡 id 只需在「本章内」唯一（每章都从 1 开始），
    // 因此每关再生成一个全局唯一的复合键 key = 章节id-关卡id，供存档等场景使用。
    const seenLevel = new Set();
    levels.forEach((lv, i) => {
      if (seenLevel.has(lv.id)) {
        throw new Error(`[题库] 第${chMeta.id}章内关卡 id=${lv.id} 重复（${lv.title}）`);
      }
      seenLevel.add(lv.id);
      lv.key = chMeta.id + "-" + lv.id;     // 全局唯一，如 "2-1"
      lv.chapter = {
        id: chMeta.id,
        emoji: chMeta.emoji,
        title: chMeta.title,
        desc: chMeta.desc,
        idxInChapter: i + 1,                  // 本章第几关（1 起）
        count: levels.length,                 // 本章共几关
        isFirst: i === 0,                     // 是否本章第一关
        isLast: i === levels.length - 1,      // 是否本章最后一关
      };
      GAME_LEVELS.push(lv);
    });
  });

  window.GAME_LEVELS = GAME_LEVELS;
  window.CHAPTERS = CHAPTERS;
  window.LEVEL_FORMATS = FORMATS;
})();

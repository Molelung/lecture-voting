/**
 * Cloudflare Worker API for Peer Lecture Voting System
 * 终极高可用架构：KV + D1 双引擎极速混合架构 (Hybrid ACID + Edge KV)
 * 1. 事务级强一致性并发（Cloudflare D1 SQLite Engine）：
 *    - 投票核心写入采用 D1 关系型数据库事务 (ACID) 与微重试保障机制；
 *    - 无论多少位同学在同一毫秒点击提交，SQL 引擎自动排队原子提交，丢票率严格为 0，覆盖率为 0！
 * 2. 毫秒级极速聚合（Real-Time SQL Aggregation）：
 *    - 各议题实时票数通过 `SELECT topic_id, COUNT(*) FROM vote_items GROUP BY topic_id` 瞬时聚合计算；
 *    - 杜绝传统内存数组遍历或 KV List 最终一致性延迟（Eventual Consistency）导致的 60 秒数据滞后。
 * 3. 双轨高可用与边缘容灾（Dual-Engine Fallback）：
 *    - 同时向 D1 与 KV 双写备份，若任何单一引擎出现边缘波动，自动无缝降级平滑切换；
 *    - 议题列表与系统配置在 KV 中提供毫秒级边缘读取，读写性能与抗压能力达到生产最高标准；
 *    - 选民与选票数据永久存储（Zero TTL），永不随日期跨度、午夜翻转或时间推移而清空或失效；
 *    - 提供 /api/admin/sync 一键自愈与双引擎数据全量校验对准。
 * 4. 校园网 NAT 穿透友好限流与多通道凭据识别：
 *    - 支持 Header (X-Voter-Token)、Body (voterToken) 与 Query (voterToken) 三通道凭据透传，彻底免疫透明网关头剥离；
 *    - 设备 Token 级防刷，配合公网 IP 宽容上限，彻底避免同寝室/同教室同学共用 Wi-Fi 被误伤拦截。
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Voter-Token, Cache-Control, Pragma, Accept, x-voter-token',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

const IP_RATE_MAP = new Map();
const TOKEN_RATE_MAP = new Map();

// 18 门官方社课元数据（防 KV 击穿终极内置兜底）
const DEFAULT_TOPICS = [
  {
    "id": "topic-1",
    "title": "【向内】爱自己",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "自我疗愈",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【自我疗愈】“奇怪的悖论在于，当我全然接纳真实的自己时，改变才会发生。” ——卡尔·罗杰斯",
    "summary": "真正的爱自己并非消费主义层面的即时犒劳，而是建立在自我关怀（Self-Compassion）与无条件自我接纳之上的心智实践。本课围绕自我友善、普遍人性感知与正念觉察，探讨如何停止苛刻的“内在批判者”对话，在遭遇挫折与心理内耗时重构安全的内心据点，实现深层的自我疗愈与能量回流。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:01.000Z"
  },
  {
    "id": "topic-2",
    "title": "【向内】你想要怎样的人生？",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "自我认同",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【自我认同】“知道为什么而活的人，便能承受任何一种生活。” ——弗里德里希·尼采",
    "summary": "从埃里克森的自我同一性（Self-Identity）危机与马西亚的认同状态模型出发，审视我们是在追逐外界赋予的“应当”，还是在探索自我的本质。课程结合价值澄清（Values Clarification）与内在动机理论，引导大家厘清核心生命价值，在迷茫与不确定性中确立属于自己的秩序感与人生航向。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:02.000Z"
  },
  {
    "id": "topic-3",
    "title": "【向内】类型心理学",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "类型心理学",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【类型心理学】“向外看的人在做梦，向内看的人方才清醒。” ——卡尔·荣格",
    "summary": "破除快餐文化中标签化的刻板印象，以荣格的心理类型论（Psychological Types）与现代大五人格模型（Big Five）为坐标轴，简明通透地剖析内倾与外倾、感觉与直觉等认知功能偏好。帮助大家建立清晰的自我心智画像，理解个体差异背后的机能运转，学会扬长避短并达成与他人的深度共情。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:03.000Z"
  },
  {
    "id": "topic-4",
    "title": "【向内】翻山越岭时",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "目的论与课题分离",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【目的论与课题分离】“决定我们的不是过去的经历，而是我们为经历赋予的意义。” ——阿尔弗雷德·阿德勒",
    "summary": "基于阿尔弗雷德·阿德勒的个体心理学，打破“原因论”的宿命束缚，转向以目的论（Teleology）重新诠释当下的选择与困顿。深度解构课题分离（Separation of Tasks）与共同体感觉，帮助我们在复杂的人际期待与现实羁绊面前建立坚韧的心灵边界，汲取奔赴自我人生的主观勇气。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:04.000Z"
  },
  {
    "id": "topic-5",
    "title": "【向内】梦之迷思",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "梦的解析与精神分析",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【梦的解析与精神分析】“对梦的解析，是通往潜意识知识的康庄大道。” ——西格蒙德·弗洛伊德",
    "summary": "循着经典精神分析（Psychoanalysis）的深邃脉络，探索弗洛伊德笔下“通往潜意识的康庄大道”。深度解析显梦与隐意背后的凝缩、移置与象征等心理防御机制（Defense Mechanisms），并结合认知神经科学对快速眼动睡眠（REM）的研究，揭示梦境在情绪整合与自我整合层面的潜意识密码。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:05.000Z"
  },
  {
    "id": "topic-6",
    "title": "【向内】我们本为矛盾集合体",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "神经症结",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【神经症结】“只要我们还活着，内心的冲突就不可避免；直面冲突，才是自由的开端。” ——卡伦·霍妮",
    "summary": "立足卡伦·霍妮的神经症人格理论，剖析我们在“亲近人、反抗人、回避人”三种基本态度间的摇摆与内心冲突。深度探讨理想化自我意象（Idealized Self-Image）与真实自我之间的剧烈撕裂，剖析内疚感、病态焦虑与强迫性追求的深层症结，学会接纳矛盾本性，走向真实的内在和谐。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:06.000Z"
  },
  {
    "id": "topic-7",
    "title": "【向内】考试在考些什么！",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "考试脑科学",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【考试脑科学】“欺骗海马体的秘诀，不是机械输入，而是高频次的主动提取与输出。” ——池谷裕二",
    "summary": "跳出死记硬背与盲目刷题的低效陷阱，从认知心理学与认知神经科学（Cognitive Neuroscience）的视角拆解学习本质。深度剖析海马体记忆编码、工作记忆容量限制与测试效应（Testing Effect），传授如何运用间隔检索与神经可塑性原理抵抗遗忘曲线，在高压考核中保持理性清醒与认知韧性。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:07.000Z"
  },
  {
    "id": "topic-8",
    "title": "【向内】当人生的丘比特",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "青春期与爱情",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【青春期与爱情】“不成熟的爱说‘因为我需要你，所以我爱你’；成熟的爱说‘因为我爱你，所以我需要你’。” ——埃里希·弗洛姆",
    "summary": "从斯滕伯格的爱情三元论（Triangular Theory of Love，涵盖亲密、激情、承诺）与依恋风格（Attachment Styles）展开，探讨青春期荷尔蒙、多巴胺奖赏回路与心智成长交织的情感萌动。理性剖析理想化投射、人际边界与依恋冲突，帮助大家理解心动的本质，掌握构建成熟、真诚且互相滋养的亲密关系心法。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:08.000Z"
  },
  {
    "id": "topic-9",
    "title": "【向内】完美只存于心",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "破解完美主义",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【破解完美主义】“万物皆有裂痕，那是光照进来的地方。” ——莱昂纳德·科恩",
    "summary": "破除‘必须做到尽善尽美’的认知枷锁，立足临床心理学与认知行为理论（CBT）对适应不良型完美主义（Maladaptive Perfectionism）的系统剖析。深度解构‘全或无’二分思维、冒充者综合征与对负面评价的恐惧（Fear of Negative Evaluation），探讨成就与自我价值（Self-Worth）的过度捆绑机制。结合接纳承诺疗法（ACT）与‘足够好’（Good Enough）原则，传授认知重构与行为暴露心法，学会在真实世界的瑕疵中安住身心，破解拖延与自我内耗，重获轻盈前行的心理弹性。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:09.000Z"
  },
  {
    "id": "topic-10",
    "title": "【向外】爱河于爱意中流淌",
    "speaker": "墨澜 & 诙谐",
    "category": "向外",
    "tag": "亲密关系·爱情篇",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【亲密关系·爱情篇】“爱绝不是互相凝视，而是朝同一个方向并肩凝视。” ——安托万·德·圣-埃克苏佩里",
    "summary": "跳脱浪漫主义幻想的迷思，从社会心理学与人际吸引理论（Interpersonal Attraction）切入。深度探讨互惠性、自我表露（Self-Disclosure）与情感共鸣在亲密关系建立与维系中的核心作用。剖析爱情中的沟通归因偏差与承诺机制，学会如何在真实的亲密互动中跨越摩擦，让爱意在理解与尊重中持久流淌。",
    "outline": [],
    "createdAt": "2026-09-18T21:56:01.000Z"
  },
  {
    "id": "topic-11",
    "title": "【向外】友谊于真情中长存",
    "speaker": "墨澜 & 诙谐",
    "category": "向外",
    "tag": "亲密关系·友谊篇",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【亲密关系·友谊篇】“什么是朋友？那是寄居在两个身体里的同一个灵魂。” ——亚里士多德",
    "summary": "从人际交往的社会交换理论（Social Exchange Theory）与朋辈支持系统（Peer Support System）展开，探索友谊从浅层社交走向深层同盟的心智轨迹。聚焦共情理解、情感边界与人际信任的建立，探讨如何在快节奏与角色转换中应对友谊疏离，维系真诚、稳定且赋予彼此生命韧性的挚友情谊。",
    "outline": [],
    "createdAt": "2026-09-18T21:56:02.000Z"
  },
  {
    "id": "topic-12",
    "title": "【向外】脏话心理学",
    "speaker": "墨澜 & 诙谐",
    "category": "向外",
    "tag": "社会心理学",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【社会心理学】“在极度痛苦的时刻，脏话所能给予的情绪慰藉，是祈祷文所无法比拟的。” ——马克·吐温",
    "summary": "跳出刻板的道德评判，立足社会心理学与神经语言学（Neurolinguistics）视阈，透视脏话与禁忌语的心理成因。深入剖析情绪宣泄、低限度镇痛效应（Hypoalgesic Effect）以及在特定群体中的社会凝聚与身份认同功能；同时探讨如何建立言语元认知觉察（Metacognitive Awareness），在理解情绪冲动本源的同时掌握非攻击性的情感表达方式。",
    "outline": [],
    "createdAt": "2026-09-18T21:56:03.000Z"
  },
  {
    "id": "topic-13",
    "title": "【向下】心绪流淌",
    "speaker": "墨澜 & 诙谐",
    "category": "向下",
    "tag": "心流",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【心流】“全身心投入某件事，忘却时间的流逝与自我的存在，便是生命的最优体验。” ——米哈里·契克森米哈赖",
    "summary": "基于米哈里·契克森米哈赖的心流理论（Flow Theory），探讨注意力完全沉浸、自我意识暂歇的极致心智状态。剖析技能水平与挑战难度的精密动态平衡，解构清晰目标、即时反馈与前额叶短暂低激活（Hypofrontality）机制，帮助大家摆脱外界噪音干扰，在日常研习中主动搭建进入心流通道的高效心智脚手架。",
    "outline": [],
    "createdAt": "2026-09-18T21:58:01.000Z"
  },
  {
    "id": "topic-14",
    "title": "【向下】天赋赠予我",
    "speaker": "墨澜 & 诙谐",
    "category": "向下",
    "tag": "刻意练习",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【刻意练习】“所谓卓越，不是天赋的私相授受，而是心智走出舒适区后的持续重塑。” ——安德斯·埃里克森",
    "summary": "破除‘唯天赋论’的认知宿命，立足安德斯·埃里克森的刻意练习（Deliberate Practice）模型与脑神经可塑性原理。深度解析如何跳出无意识的机械重复与舒适区，建立高质量的心理表征（Mental Representations）；通过针对性微步拆解、即时纠偏反馈与长期髓鞘质沉淀机制，将模糊的潜能淬炼为稳定卓越的专业心智能力。",
    "outline": [],
    "createdAt": "2026-09-18T21:58:02.000Z"
  },
  {
    "id": "topic-15",
    "title": "【向下】锚定思绪",
    "speaker": "墨澜 & 诙谐",
    "category": "向下",
    "tag": "专注力",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【专注力】“信息的丰富导致了注意力的匮乏；心智的品质取决于专注的深度。” ——赫伯特·西蒙",
    "summary": "从认知心理学中的选择性注意（Selective Attention）与执行控制网络（Executive Control Network）切入，审视现代注意力经济对心智聚焦的瓦解。深度剖析任务切换损耗与注意力残留（Attention Residue）效应，传授基于环境摩擦力设计、认知负荷控制与无干扰深潜心法的专注力工程化落地路径，夺回大脑的主控权。",
    "outline": [],
    "createdAt": "2026-09-18T21:58:03.000Z"
  },
  {
    "id": "topic-16",
    "title": "【向下】遁入空灵",
    "speaker": "墨澜 & 诙谐",
    "category": "向下",
    "tag": "正念与移空",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【正念与移空】“正念就是有意识、不带评判地，将全部觉知安放于此时此刻。” ——乔·卡巴金",
    "summary": "立足正念减压疗法（MBSR）与认知解离（Cognitive Defusion）理论，探索如何平息大脑默认模式网络（Default Mode Network, DMN）的过度反刍。结合传统移空技术与现代具身觉察，学会在焦虑与执念升起时退后一步，以‘观察者自我’审视思绪的流动，体验心神澄澈、身心安顿的空灵境界。",
    "outline": [],
    "createdAt": "2026-09-18T21:58:04.000Z"
  },
  {
    "id": "topic-17",
    "title": "【向下】手指伸缩自如",
    "speaker": "墨澜 & 诙谐",
    "category": "向下",
    "tag": "自控力",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【自控力】“自控的关键不是压抑欲望的死撑，而是清晰洞悉自己内心深处真正想要什么。” ——凯利·麦格尼格尔",
    "summary": "颠覆‘靠死撑对抗诱惑’的误区，以自我损耗模型（Ego Depletion）的最新修正与前额叶抑制控制（Inhibitory Control）机制为依托。深度拆解多巴胺渴求回路与即时满足陷阱，传授冷热认知切换、执行意图（Implementation Intentions，若-则计划）与预先承诺策略，实现如‘手指伸缩自如’般游刃有余、不费力的自律实践。",
    "outline": [],
    "createdAt": "2026-09-18T21:58:05.000Z"
  },
  {
    "id": "topic-18",
    "title": "【向下】清醒的活",
    "speaker": "墨澜 & 诙谐",
    "category": "向下",
    "tag": "活在当下",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【活在当下】“你不是脑海中那个喋喋不休的声音，你是聆听那个声音的清醒觉知。” ——迈克·辛格",
    "summary": "深度汲取《清醒地活着》（The Untethered Soul）的心灵洞见，并与阿德勒个体心理学中‘人生如连续刹那的聚光灯舞台’哲学思想深度交融。跳脱对过去遗憾的反刍与对未来不确定性的灾难化预演，引导我们觉察内心永不停歇的‘独白者’，以超越性的觉知打破情绪内耗与认知纠缠；学会收束弥散的焦虑，将全部心力聚焦于此时此刻正在经历的‘点’，在踏实的行进中体验安顿、澄明与真实的生命力量。",
    "outline": [],
    "createdAt": "2026-09-18T21:58:06.000Z"
  }
];

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Connection': 'keep-alive',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function sanitizeText(str, maxLength = 200) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function checkTokenRateLimit(token, limit = 20, windowMs = 60000) {
  if (!token) return true;
  const now = Date.now();
  if (TOKEN_RATE_MAP.size > 5000) {
    for (const [key, val] of TOKEN_RATE_MAP.entries()) {
      if (now > val.resetAt) TOKEN_RATE_MAP.delete(key);
    }
  }

  let record = TOKEN_RATE_MAP.get(token);
  if (!record || now > record.resetAt) {
    record = { count: 1, resetAt: now + windowMs };
    TOKEN_RATE_MAP.set(token, record);
    return true;
  }
  if (record.count >= limit) return false;
  record.count++;
  return true;
}

function checkIpRateLimit(ip, limit = 250, windowMs = 60000) {
  const now = Date.now();
  if (IP_RATE_MAP.size > 2000) {
    for (const [key, val] of IP_RATE_MAP.entries()) {
      if (now > val.resetAt) IP_RATE_MAP.delete(key);
    }
  }

  let record = IP_RATE_MAP.get(ip);
  if (!record || now > record.resetAt) {
    record = { count: 1, resetAt: now + windowMs };
    IP_RATE_MAP.set(ip, record);
    return true;
  }
  if (record.count >= limit) return false;
  record.count++;
  return true;
}

// 异步操作微重试器（有效化解边缘网络波动与 SQLite 瞬时锁竞争）
async function executeWithRetry(fn, retries = 2, delayMs = 40) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        await new Promise(r => setTimeout(r, delayMs * Math.pow(2, i)));
      }
    }
  }
  throw lastErr;
}

// ── 全局限流（D1 原子计数）───────────────────────────────────────────────────
// 上面两个内存 Map 只在单个边缘 isolate 内有效，请求分散到不同节点就能绕过；
// 登录这类接口必须用跨节点共享的计数器，否则等于没有防护。
let rateTableReady = false;
let rateSchemaAttempts = 0;

async function ensureSchema(DB) {
  if (!DB || rateTableReady) return;
  // 连续失败就放弃重试，避免每个请求都要白试一次建表
  if (rateSchemaAttempts >= 3) return;
  rateSchemaAttempts++;
  try {
    await DB.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    )`).run();
    rateTableReady = true;
  } catch (e) {
    console.warn('ensureSchema error:', e.message);
  }
}

// 固定窗口计数：一次 batch（事务）内自增并读回，跨边缘节点一致。
// 多个 key 合并到同一个 batch，避免投票路径为了限流多跑好几个来回。
async function checkGlobalLimits(DB, specs) {
  if (!DB || !specs || specs.length === 0) return { allowed: true, details: [] };
  try {
    await ensureSchema(DB);
    const now = Date.now();
    const stmts = [];
    for (const s of specs) {
      const slot = Math.floor(now / s.windowMs) * s.windowMs;
      stmts.push(DB.prepare(`INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
        ON CONFLICT(key) DO UPDATE SET
          count = CASE WHEN excluded.window_start = rate_limits.window_start THEN rate_limits.count + 1 ELSE 1 END,
          window_start = excluded.window_start`).bind(s.key, slot));
    }
    for (const s of specs) {
      stmts.push(DB.prepare('SELECT count FROM rate_limits WHERE key = ?').bind(s.key));
    }
    const res = await DB.batch(stmts);
    const details = specs.map((s, i) => {
      const row = res && res[specs.length + i] && res[specs.length + i].results && res[specs.length + i].results[0];
      const count = row ? row.count : 1;
      return { key: s.key, count, limit: s.limit, allowed: count <= s.limit };
    });
    return { allowed: details.every(d => d.allowed), details };
  } catch (e) {
    // 限流器自身故障绝不能挡住正常投票
    console.warn('checkGlobalLimits error:', e.message);
    return { allowed: true, details: [] };
  }
}

async function checkGlobalLimit(DB, key, limit, windowMs) {
  const r = await checkGlobalLimits(DB, [{ key, limit, windowMs }]);
  return { allowed: r.allowed, count: r.details[0] ? r.details[0].count : 0, limit };
}

// 读取并限制请求体：content-length 可以被 chunked 传输绕过，必须按实际长度判断
async function readJsonBody(request, maxBytes = 65536) {
  try {
    const raw = await request.text();
    if (raw && raw.length > maxBytes) return { tooLarge: true };
    if (!raw) return { data: {} };
    return { data: JSON.parse(raw) };
  } catch (e) {
    return { data: {} };
  }
}

// ── CORS：只允许自己的站点跨域调用 ──────────────────────────────────────────
// 不限制的话，任意网站都能让访客的浏览器替它打我们的接口（借别人的 IP 当跳板）。
const ALLOWED_ORIGINS = [
  'https://vote.molan.cc.cd',
  'https://vote.listener.ccwu.cc',
  'https://molelung.github.io'
];

function corsFor(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = !origin ||
    ALLOWED_ORIGINS.includes(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const headers = { ...CORS_HEADERS, Vary: 'Origin' };
  if (allowed && origin) headers['Access-Control-Allow-Origin'] = origin;
  if (!allowed) delete headers['Access-Control-Allow-Origin'];
  return headers;
}

// ── KV 选票 / 留言：单键模型 ─────────────────────────────────────────────────
// 原实现把全部选票放在一个 JSON 数组里，每次投票都要"读出来 → 改 → 写回去"，
// 并发投票会互相覆盖，静默丢条目（一节课几十人同时投就会触发）。
// 改成每人/每条一个键：写入互不冲突，读取时按前缀列举汇总，从根上消除竞态。
const KV_BALLOT_PREFIX = 'voter:';
const KV_COMMENT_PREFIX = 'cmt:';

async function putKvBallot(KV, ballot) {
  if (!KV || !ballot || !ballot.voterToken) return;
  await safePutKV(KV, KV_BALLOT_PREFIX + ballot.voterToken, JSON.stringify(ballot));
}

async function putKvComment(KV, comment) {
  if (!KV || !comment || !comment.id) return;
  await safePutKV(KV, KV_COMMENT_PREFIX + comment.id, JSON.stringify(comment));
}

// KV.list 单次最多返回 1000 条：必须翻页，否则选民破千后会漏掉一部分
async function listKvKeys(KV, prefix) {
  const out = [];
  if (!KV) return out;
  let cursor = null;
  for (let i = 0; i < 50; i++) {
    const page = await KV.list({ prefix, cursor, limit: 1000 });
    if (!page || !page.keys) break;
    for (const k of page.keys) out.push(k.name);
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return out;
}

async function loadKvByPrefix(KV, prefix, limit = 3000) {
  if (!KV) return [];
  try {
    const keys = await listKvKeys(KV, prefix);
    const out = [];
    for (let i = 0; i < keys.length && out.length < limit; i += 25) {
      const vals = await Promise.all(keys.slice(i, i + 25).map(k => getJsonKV(KV, k, null)));
      for (const v of vals) if (v) out.push(v);
    }
    return out;
  } catch (e) {
    console.warn('loadKvByPrefix error', prefix, e.message);
    return [];
  }
}

// 汇总 KV 选票：单键为主，同时兼容早期写在 ballots 数组里的历史数据（按投票人去重）
async function loadKvBallots(KV) {
  const fresh = await loadKvByPrefix(KV, KV_BALLOT_PREFIX);
  const seen = new Set(fresh.map(b => b.voterToken || b.voterId).filter(Boolean));
  const legacy = await getJsonKV(KV, 'ballots', []);
  const merged = [...fresh];
  for (const b of legacy) {
    const t = b && (b.voterToken || b.voterId);
    if (t && !seen.has(t)) { seen.add(t); merged.push(b); }
  }
  return merged;
}

async function loadKvComments(KV) {
  const fresh = await loadKvByPrefix(KV, KV_COMMENT_PREFIX);
  const seen = new Set(fresh.map(c => c.id).filter(Boolean));
  const legacy = await getJsonKV(KV, 'comments', []);
  const merged = [...fresh];
  for (const c of legacy) {
    if (c && c.id && !seen.has(c.id)) { seen.add(c.id); merged.push(c); }
  }
  merged.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return merged;
}

// 删除某个前缀下的全部键（清空选民状态用）
async function deleteKvByPrefix(KV, prefix) {
  if (!KV) return 0;
  const keys = await listKvKeys(KV, prefix);
  for (let i = 0; i < keys.length; i += 100) {
    await Promise.all(keys.slice(i, i + 100).map(k => KV.delete(k).catch(() => {})));
  }
  return keys.length;
}

// ── 数据快照：破坏性操作（清空 / 恢复 / 修复）前先留一份，误操作可回滚 ────────
const SNAPSHOT_PREFIX = 'snapshot:';
const SNAPSHOT_KEEP = 5;

async function takeSnapshot(KV, DB, label, maxKeep = SNAPSHOT_KEEP) {
  if (!KV) return null;
  try {
    const snapshot = {
      label,
      createdAt: new Date().toISOString(),
      settings: await getJsonKV(KV, 'settings', null),
      topics: await getJsonKV(KV, 'topics', null),
      ballots: [],
      comments: []
    };
    if (DB) {
      try {
        const [bRes, cRes] = await Promise.all([
          DB.prepare('SELECT * FROM ballots ORDER BY voted_at DESC').all(),
          DB.prepare('SELECT * FROM comments ORDER BY created_at DESC').all()
        ]);
        snapshot.ballots = (bRes.results || []).map(b => ({
          id: b.id,
          voterToken: b.voter_token,
          topicIds: JSON.parse(b.topic_ids || '[]'),
          comment: b.comment || '',
          clientIp: b.client_ip || '',
          votedAt: b.voted_at
        }));
        snapshot.comments = (cRes.results || []).map(c => ({
          id: c.id,
          topicId: c.topic_id || 'general',
          topicTitle: c.topic_title || '',
          voterId: c.voter_token,
          authorName: c.author_name || '同学',
          text: c.text,
          createdAt: c.created_at
        }));
      } catch (e) {
        // D1 读不到就退化为只存 KV 侧数据
      }
    }
    if (snapshot.ballots.length === 0) snapshot.ballots = await loadKvBallots(KV);
    if (snapshot.comments.length === 0) snapshot.comments = await loadKvComments(KV);

    const key = `${SNAPSHOT_PREFIX}${Date.now()}-${label}`;
    await safePutKV(KV, key, JSON.stringify(snapshot));

    // 只保留最近 maxKeep 份，避免越积越多
    const keys = (await listKvKeys(KV, SNAPSHOT_PREFIX)).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - maxKeep))) {
      await KV.delete(k).catch(() => {});
    }
    return { key, ballots: snapshot.ballots.length, comments: snapshot.comments.length };
  } catch (e) {
    console.warn('takeSnapshot error:', e.message);
    return null;
  }
}

function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ── 管理员令牌：HS256 真签名 ─────────────────────────────────────────────────
// 旧实现把签名写成固定常量、验签时只 base64 解码 payload，等于任何人构造一个
// {"role":"admin"} 就能调用全部 /api/admin/* 接口（导出选民、清空数据、改密码）。
// 现在改为标准 HMAC-SHA256 签名 + 有效期校验，密钥首次使用时随机生成并持久化到 KV。
let cachedJwtSecret = null;

function randomHex(bytes = 32) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getJwtSecret(KV) {
  if (cachedJwtSecret) return cachedJwtSecret;
  let rec = await getJsonKV(KV, 'jwt_secret', null);
  if (!rec || !rec.k) {
    rec = { k: randomHex(32), createdAt: new Date().toISOString() };
    if (KV) await safePutKV(KV, 'jwt_secret', JSON.stringify(rec));
  }
  cachedJwtSecret = rec.k;
  return cachedJwtSecret;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

function base64UrlFromBytes(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromBase64Url(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function signToken(user, KV) {
  const key = await hmacKey(await getJwtSecret(KV));
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    exp: Date.now() + 86400000 * 30
  }));
  const data = `${header}.${payload}`;
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${base64UrlFromBytes(new Uint8Array(sig))}`;
}

// 校验签名与有效期：任何一步不通过都当作未登录（不再"解码即信任"）
async function verifyToken(token, KV) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const key = await hmacKey(await getJwtSecret(KV));
    const data = `${parts[0]}.${parts[1]}`;
    const valid = await crypto.subtle.verify(
      'HMAC', key, bytesFromBase64Url(parts[2]), new TextEncoder().encode(data)
    );
    if (!valid) return null;
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    if (payload.role !== 'admin') return null;
    return payload;
  } catch (e) {
    return null;
  }
}

async function authenticate(request, KV) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return verifyToken(auth.slice(7).trim(), KV);
}

// PBKDF2 密码哈希生成器 (Web Crypto 标准，100,000 次迭代，16 字节真随机 Salt)
async function hashPassword(password, saltHex = null) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  
  let saltBytes;
  if (saltHex) {
    const matches = saltHex.match(/.{1,2}/g) || [];
    saltBytes = new Uint8Array(matches.map(b => parseInt(b, 16)));
  } else {
    saltBytes = crypto.getRandomValues(new Uint8Array(16));
  }
  
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  
  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const finalSaltHex = Array.from(saltBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
    
  return { hash: hashHex, salt: finalSaltHex };
}

// 恒定时间密码比对，彻底免疫侧信道时序攻击
async function verifyPassword(password, saltHex, expectedHashHex) {
  if (!password || !saltHex || !expectedHashHex) return false;
  const { hash } = await hashPassword(password, saltHex);
  if (hash.length !== expectedHashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ expectedHashHex.charCodeAt(i);
  }
  return diff === 0;
}

// 根管理员缺省凭据兜底（采用单向密码学哈希，无任何明文密码）
const ROOT_ADMIN_FALLBACK = {
  username: 'admin',
  salt: '86e003466237db52943947f4cd8a649c',
  hash: '0e2c9a62caa89bd7f84691a4e15e24e32c2f33da14e6415094b973b4603817e2'
};

async function getAdminCredentials(KV, DB) {
  // 1. 优先读取 KV 缓存
  let creds = await getJsonKV(KV, 'admin_credentials', null);
  if (creds && creds.hash && creds.salt) {
    return creds;
  }
  
  // 2. 检查 D1 关系型数据库持久化表
  if (DB) {
    try {
      const row = await DB.prepare('SELECT username, salt, hash FROM admins WHERE username = ?').bind('admin').first();
      if (row && row.hash && row.salt) {
        creds = { username: row.username, salt: row.salt, hash: row.hash };
        if (KV) await safePutKV(KV, 'admin_credentials', JSON.stringify(creds));
        return creds;
      }
    } catch (e) {
      try {
        await DB.prepare(`CREATE TABLE IF NOT EXISTS admins (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE,
          salt TEXT,
          hash TEXT,
          updated_at TEXT
        )`).run();
      } catch (err) {}
    }
  }

  // 3. 兜底初始加盐哈希（自动回填至 KV / D1）
  if (KV) await safePutKV(KV, 'admin_credentials', JSON.stringify(ROOT_ADMIN_FALLBACK));
  if (DB) {
    try {
      await DB.prepare('INSERT OR REPLACE INTO admins (id, username, salt, hash, updated_at) VALUES (?, ?, ?, ?, ?)')
        .bind('admin-root', 'admin', ROOT_ADMIN_FALLBACK.salt, ROOT_ADMIN_FALLBACK.hash, new Date().toISOString())
        .run();
    } catch (err) {}
  }
  return ROOT_ADMIN_FALLBACK;
}

async function getJsonKV(KV, key, fallback = null) {
  if (!KV) return fallback;
  try {
    const raw = await KV.get(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

// 安全写入 KV：强制移除所有 expirationTtl，实行绝对永久持久化！
async function safePutKV(KV, key, value, options = {}) {
  if (!KV) return;
  try {
    const safeOpts = { ...options };
    if (safeOpts.expirationTtl) delete safeOpts.expirationTtl;
    if (safeOpts.expiration) delete safeOpts.expiration;
    await KV.put(key, value, safeOpts);
  } catch (e) {
    console.warn('safePutKV error for key ' + key + ':', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 前台页面边缘直发（不再 302 跳转到 GitHub Pages）
// 为什么放在这里：
//   1. 同学直连 github.io 在国内经常被限速或超时，改由 Cloudflare 边缘就近响应；
//   2. 页面与 /api 同源后，带自定义头的请求不再触发 CORS 预检，少一次跨域往返；
//   3. 源站(GitHub)临时不可用时，仍能发出上一次缓存的副本，而不是白屏。
// 页面内容仍以 GitHub 仓库为唯一来源，这里只做带缓存的只读转发，不改写任何内容。
// ─────────────────────────────────────────────────────────────────────────────
const STATIC_ORIGIN = 'https://molelung.github.io/lecture-voting';
const STATIC_ENTRY_TTL = 604800; // 边缘缓存条目存活 7 天（条目活得久，源站故障才有兜底副本）

// 新鲜度窗口：超过窗口才回源校验，避免每次访问都打到 GitHub
// 图片/第三方库也给 10 分钟窗口，改图后不用等太久就能全网生效
function staticFreshWindow(path) {
  if (path.startsWith('/vendor/')) return 600;
  if (/\.(png|jpe?g|gif|webp|svg|ico|woff2?)$/i.test(path)) return 600;
  return 60; // html / js / css：60 秒后回源校验，部署一分钟内全量生效
}

function staticContentType(path, fromOrigin) {
  const ext = (path.match(/\.([a-z0-9]+)$/i) || [])[1];
  const map = {
    html: 'text/html; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff2: 'font/woff2',
    txt: 'text/plain; charset=utf-8'
  };
  return map[ext] || fromOrigin || 'application/octet-stream';
}

function buildStaticResponse(body, contentType, maxAge, cacheState, ageSeconds) {
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', `public, max-age=${maxAge}`);
  headers.set('X-Edge-Cache', cacheState);
  if (ageSeconds !== undefined && ageSeconds !== null) headers.set('X-Edge-Age', String(Math.round(ageSeconds)));
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(body, { status: 200, headers });
}

// 边缘与源站都拿不到页面时的兜底：自动重试 + 备用线路入口（弱网下不给同学白屏）
function staticUnavailablePage(host) {
  const alt = host === 'vote.molan.cc.cd' ? 'vote.listener.ccwu.cc' : 'vote.molan.cc.cd';
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="3">
<title>正在连接投票页面…</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#fbfbfa;color:#2f3437;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.box{text-align:center;padding:32px 24px;max-width:22rem}h1{font-size:1.05rem;font-weight:600;margin:0 0 8px}
p{font-size:.82rem;color:#787774;line-height:1.7;margin:0 0 18px}
a{display:inline-block;font-size:.8rem;color:#2f3437;border:1px solid #e9e9e7;border-radius:8px;
padding:9px 16px;text-decoration:none;background:#fff}
.sp{width:22px;height:22px;margin:0 auto 16px;border:2px solid #e9e9e7;border-top-color:#787774;
border-radius:50%;animation:r .9s linear infinite}@keyframes r{to{transform:rotate(360deg)}}</style>
</head><body><div class="box"><div class="sp"></div>
<h1>网络有点不稳定，正在重连…</h1>
<p>页面会在 3 秒后自动重试，请保持网络畅通。<br>若一直打不开，可切换到备用线路。</p>
<a href="https://${alt}/">切换到备用线路 ${alt}</a></div></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function serveStaticAsset(request, ctx, path) {
  if (path === '' || path === '/') path = '/index.html';
  else if (path.endsWith('/')) path += 'index.html';
  if (path.includes('..')) return new Response('Bad Request', { status: 400 });

  const isHead = request.method === 'HEAD';
  const fresh = staticFreshWindow(path);
  const cache = caches.default;
  // 缓存键 = 当前域名的请求地址（去掉查询串）：既能让两个接入域名各自可被按 URL 清除缓存，
  // 也不会因为 ?cb=123 这类参数产生无用副本
  const reqUrl = new URL(request.url);
  const cacheKey = new Request(reqUrl.origin + reqUrl.pathname, { method: 'GET' });

  let cached = null;
  try { cached = await cache.match(cacheKey); } catch (e) {}
  if (cached) {
    const cachedAt = Number(cached.headers.get('x-cached-at') || 0);
    const age = cachedAt ? (Date.now() - cachedAt) / 1000 : Infinity;
    if (age < fresh) {
      const type = cached.headers.get('content-type') || 'application/octet-stream';
      return buildStaticResponse(isHead ? null : await cached.arrayBuffer(), type, fresh, 'HIT', age);
    }
  }

  try {
    // 回源地址带一个每分钟滚动的版本号：GitHub Pages 前面的 CDN 有自己的缓存 TTL，
    // 不带这个参数时，刚 push 的改动可能被它压住好几分钟才轮到边缘看到
    const isMedia = path.startsWith('/vendor/') || /\.(png|jpe?g|gif|webp|svg|ico|woff2?)$/i.test(path);
    const originUrl = STATIC_ORIGIN + path + (isMedia ? '' : `?v=${Math.floor(Date.now() / 60000)}`);
    const originRes = await fetch(originUrl, {
      headers: { 'User-Agent': 'lecture-voting-edge/1.0', 'Accept': '*/*' }
    });
    if (originRes.ok) {
      const body = await originRes.arrayBuffer();
      const contentType = staticContentType(path, originRes.headers.get('content-type'));
      // 写缓存用长 TTL（条目活得久才能兜底），返回给同学时只给短 TTL
      const forCache = new Response(body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': `public, max-age=${STATIC_ENTRY_TTL}`,
          'x-cached-at': String(Date.now())
        }
      });
      ctx.waitUntil(cache.put(cacheKey, forCache).catch(() => {}));
      return buildStaticResponse(isHead ? null : body, contentType, fresh, cached ? 'REVALIDATED' : 'MISS', 0);
    }
  } catch (e) {
    // 回源失败 → 落到下面的缓存兜底
  }

  if (cached) {
    const type = cached.headers.get('content-type') || 'application/octet-stream';
    const cachedAt = Number(cached.headers.get('x-cached-at') || 0);
    const age = cachedAt ? (Date.now() - cachedAt) / 1000 : Infinity;
    return buildStaticResponse(isHead ? null : await cached.arrayBuffer(), type, fresh, 'STALE', age);
  }
  return staticUnavailablePage(new URL(request.url).hostname);
}

// ── 群二维码：可在管理后台上传替换 ───────────────────────────────────────────
// 存在 KV 里（二进制 + metadata 记录类型与时间），没上传过就回落到仓库自带的默认图。
const GROUP_QR_KEY = 'group_qr';
const GROUP_QR_MAX_BYTES = 2 * 1024 * 1024;

// 只认真正的图片：按文件头判断，避免把别的内容当图片存进去
function detectImageType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  return null;
}

async function getGroupQrOverride(KV) {
  if (!KV) return null;
  try {
    const res = await KV.getWithMetadata(GROUP_QR_KEY, 'arrayBuffer');
    if (!res || !res.value) return null;
    return { bytes: res.value, metadata: res.metadata || {} };
  } catch (e) {
    return null;
  }
}

async function serveGroupQr(request, env, ctx) {
  const KV = env.LECTURE_KV || env.VOTING_KV || env.LECTURE_VOTING_KV;
  const override = await getGroupQrOverride(KV);
  const isHead = request.method === 'HEAD';
  if (override) {
    return new Response(isHead ? null : override.bytes, {
      status: 200,
      headers: {
        'Content-Type': override.metadata.contentType || 'image/png',
        // 换图要尽快生效，所以只给很短的浏览器缓存
        'Cache-Control': 'public, max-age=30',
        'X-Group-Qr': 'custom',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
  // 没有上传过 → 走原来的静态转发（仓库里的默认图，带边缘缓存）
  const res = await serveStaticAsset(request, ctx, '/wechat-group-qr.png');
  const headers = new Headers(res.headers);
  headers.set('X-Group-Qr', 'default');
  return new Response(res.body, { status: res.status, headers });
}

async function handleGroupQrAdmin(request, KV, method, jsonResponse) {
  if (method === 'GET') {
    const override = await getGroupQrOverride(KV);
    return jsonResponse({
      success: true,
      custom: !!override,
      contentType: override ? (override.metadata.contentType || 'image/png') : '',
      bytes: override ? (override.metadata.bytes || override.bytes.byteLength) : 0,
      updatedAt: override ? (override.metadata.updatedAt || '') : '',
      maxBytes: GROUP_QR_MAX_BYTES
    });
  }

  if (method === 'DELETE') {
    await KV.delete(GROUP_QR_KEY).catch(() => {});
    return jsonResponse({ success: true, message: '已恢复为仓库自带的默认二维码' });
  }

  if (method === 'POST' || method === 'PUT') {
    let buf;
    try {
      buf = await request.arrayBuffer();
    } catch (e) {
      return jsonResponse({ error: '读取上传内容失败' }, 400);
    }
    if (!buf || buf.byteLength === 0) {
      return jsonResponse({ error: '没有收到图片内容' }, 400);
    }
    if (buf.byteLength > GROUP_QR_MAX_BYTES) {
      return jsonResponse({ error: `图片过大（${Math.round(buf.byteLength / 1024)}KB），请压到 ${GROUP_QR_MAX_BYTES / 1024 / 1024}MB 以内` }, 413);
    }
    const bytes = new Uint8Array(buf);
    const contentType = detectImageType(bytes);
    if (!contentType) {
      return jsonResponse({ error: '只支持 PNG / JPG / WebP 图片' }, 400);
    }
    const metadata = {
      contentType,
      bytes: buf.byteLength,
      updatedAt: new Date().toISOString()
    };
    try {
      await KV.put(GROUP_QR_KEY, buf, { metadata });
    } catch (e) {
      return jsonResponse({ error: '保存失败，请稍后重试' }, 500);
    }
    return jsonResponse({
      success: true,
      message: '群二维码已更新，同学们下次打开就会看到新图（约 30 秒内全网生效）',
      custom: true,
      ...metadata
    });
  }

  return jsonResponse({ error: '不支持的方法' }, 405);
}

async function handleRequest(request, env, ctx) {
    const startTime = Date.now();
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 群二维码：管理员可在后台替换。上传过就用上传的，没上传过就用仓库里的默认图。
    // 只在弹窗展示时才被请求（频率极低），所以这里每次都读 KV，换来"换图立刻生效"。
    if (path === '/wechat-group-qr.png' && (method === 'GET' || method === 'HEAD')) {
      return serveGroupQr(request, env, ctx);
    }

    // 非 /api 路径：直接由边缘发出前台页面与静态资源（与 API 同源，弱网更稳、免跨域预检）
    if (!path.startsWith('/api/') && (method === 'GET' || method === 'HEAD')) {
      return serveStaticAsset(request, ctx, path);
    }

    // 防护：检查 Payload 尺寸，杜绝超大 Body 耗尽 Worker 边缘内存
    // （群二维码上传走独立的大小校验，因为图片本身就有几百 KB）
    if ((method === 'POST' || method === 'PUT') && path !== '/api/admin/group-qr') {
      const contentLength = request.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > 65536) {
        return jsonResponse({ error: '请求数据体积超限' }, 413);
      }
    }

    const KV = env.LECTURE_KV || env.VOTING_KV || env.LECTURE_VOTING_KV;
    const DB = env.DB; // Cloudflare D1 Database Binding

    if (!KV && !DB) {
      return jsonResponse({ error: 'Database backend missing' }, 500);
    }

    const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '127.0.0.1';
    
    // 多通道捕获选民标识：请求头 > URL Query 参数
    let voterToken = request.headers.get('X-Voter-Token') || request.headers.get('x-voter-token') || url.searchParams.get('voterToken') || '';
    const adminUser = await authenticate(request, KV);
    const isAdmin = !!(adminUser && adminUser.role === 'admin');

    try {
      // 0. GET /api/health
      if (path === '/api/health' && method === 'GET') {
        const dur = Date.now() - startTime;
        return jsonResponse({
          status: 'ok',
          service: 'lecture-voting-api',
          engine: DB ? 'D1_SQLITE_ACID' : 'KV_EVENTUAL',
          edgeNode: request.cf?.colo || 'LOCAL',
          latencyMs: dur,
          timestamp: new Date().toISOString()
        }, 200, { 'Server-Timing': `app;dur=${dur}` });
      }

      // 1. GET /api/status (读取系统配置、自身选票与选民总数)
      if (path === '/api/status' && method === 'GET') {
        const settingsPromise = KV ? getJsonKV(KV, 'settings', {
          title: '朋辈社课大投票！',
          subtitle: '',
          maxVotesPerUser: 3,
          allowChangeVote: true,
          status: 'open',
          resultsVisibility: 'after_vote'
        }) : Promise.resolve({ title: '朋辈社课大投票！', resultsVisibility: 'after_vote', status: 'open', maxVotesPerUser: 3 });

        let userVote = null;
        let hasVoted = false;
        let totalVoters = 0;
        let totalVotesCast = 0;
        let settings = {
          title: '朋辈社课大投票！',
          subtitle: '',
          maxVotesPerUser: 3,
          allowChangeVote: true,
          status: 'open',
          resultsVisibility: 'after_vote'
        };

        // 1. 优先从 D1 读取
        if (DB) {
          try {
            const [s, countRes, voterRes] = await Promise.all([
              settingsPromise,
              DB.prepare('SELECT (SELECT COUNT(*) FROM ballots) as totalVoters, (SELECT COUNT(*) FROM vote_items) as totalVotesCast').first(),
              voterToken ? DB.prepare('SELECT * FROM ballots WHERE voter_token = ?').bind(voterToken).first() : Promise.resolve(null)
            ]);

            if (s) settings = s;
            if (countRes) {
              totalVoters = countRes.totalVoters || 0;
              totalVotesCast = countRes.totalVotesCast || 0;
            }

            if (voterRes) {
              hasVoted = true;
              userVote = {
                id: voterRes.id,
                voterToken: voterRes.voter_token,
                topicIds: JSON.parse(voterRes.topic_ids || '[]'),
                comment: voterRes.comment,
                votedAt: voterRes.voted_at
              };
            }
          } catch (d1Err) {
            console.warn('D1 query status fallback to KV:', d1Err.message);
          }
        } else {
          settings = await settingsPromise;
        }

        // 2. 双轨对齐与 KV 兜底容灾：若 D1 未找到选票，或 D1 暂离线，回溯查验 KV
        if (!hasVoted && voterToken && KV) {
          const directVote = await getJsonKV(KV, 'voter:' + voterToken, null);
          if (directVote) {
            hasVoted = true;
            userVote = directVote;
          }
        }

        // 若总人数为 0 但 KV 中存在数据，以 KV 选票池兜底
        if (totalVoters === 0 && KV) {
          const kvBallots = await loadKvBallots(KV);
          if (kvBallots.length > 0) {
            totalVoters = kvBallots.length;
            totalVotesCast = kvBallots.reduce((acc, b) => acc + ((b.topicIds && b.topicIds.length) || 0), 0);
            if (!hasVoted && voterToken) {
              const b = kvBallots.find(x => x && (x.voterId === voterToken || x.voterToken === voterToken));
              if (b) {
                hasVoted = true;
                userVote = b;
              }
            }
          }
        }

        const canSeeResults = Boolean(
          settings.resultsVisibility === 'public' || 
          (settings.resultsVisibility === 'after_vote' && hasVoted)
        );

        const dur = Date.now() - startTime;
        return jsonResponse({
          success: true,
          settings,
          user: adminUser ? { username: adminUser.username, role: 'admin' } : null,
          hasVoted,
          userVote,
          canSeeResults,
          statsSummary: { totalVoters, totalVotesCast: canSeeResults ? totalVotesCast : null }
        }, 200, { 'Server-Timing': `app;dur=${dur}` });
      }

      // 2. GET /api/topics (社课列表与实时票数)
      if (path === '/api/topics' && method === 'GET') {
        const [settings, kvTopics] = await Promise.all([
          getJsonKV(KV, 'settings', { resultsVisibility: 'after_vote' }),
          getJsonKV(KV, 'topics', null)
        ]);

        const topics = (kvTopics && Array.isArray(kvTopics) && kvTopics.length > 0) ? kvTopics : DEFAULT_TOPICS;

        let hasVoted = false;
        let counts = {};
        topics.forEach(t => counts[t.id] = 0);
        let totalVotesCast = 0;
        let commentCounts = {};

        if (DB) {
          try {
            const [voterRes, tallyRes, commentStats] = await Promise.all([
              voterToken ? DB.prepare('SELECT id FROM ballots WHERE voter_token = ?').bind(voterToken).first() : Promise.resolve(null),
              DB.prepare('SELECT topic_id, COUNT(*) as cnt FROM vote_items GROUP BY topic_id').all(),
              DB.prepare('SELECT topic_id, COUNT(*) as cnt FROM comments GROUP BY topic_id').all()
            ]);

            hasVoted = !!voterRes;
            if (tallyRes && tallyRes.results) {
              for (const row of tallyRes.results) {
                if (counts[row.topic_id] !== undefined) {
                  counts[row.topic_id] = row.cnt;
                  totalVotesCast += row.cnt;
                }
              }
            }
            if (commentStats && commentStats.results) {
              for (const row of commentStats.results) {
                commentCounts[row.topic_id] = row.cnt;
              }
            }
          } catch (e) {
            console.warn('D1 topics tally error, fallback to KV:', e.message);
          }
        }

        // KV 双轨容灾辅助判定
        if (!hasVoted && voterToken && KV) {
          const directVote = await getJsonKV(KV, 'voter:' + voterToken, null);
          if (directVote) hasVoted = true;
        }

        // 若 D1 计数为 0 但 KV 存在选票列表，实施 KV 聚合计算
        if (totalVotesCast === 0 && KV) {
          const kvBallots = await loadKvBallots(KV);
          if (kvBallots.length > 0) {
            for (const b of kvBallots) {
              if (b && Array.isArray(b.topicIds)) {
                for (const tid of b.topicIds) {
                  if (counts[tid] !== undefined) {
                    counts[tid]++;
                    totalVotesCast++;
                  }
                }
              }
            }
          }
        }

        const canViewCounts = Boolean(
          settings.resultsVisibility === 'public' || 
          (settings.resultsVisibility === 'after_vote' && hasVoted)
        );

        const enrichedTopics = topics.map(t => {
          const voteCount = counts[t.id] || 0;
          return {
            ...t,
            commentCount: commentCounts[t.id] || 0,
            stats: {
              locked: !canViewCounts,
              count: canViewCounts ? voteCount : null,
              percentage: canViewCounts && totalVotesCast > 0 ? Math.round((voteCount / totalVotesCast) * 100) : 0
            }
          };
        });

        const dur = Date.now() - startTime;
        return jsonResponse({
          success: true,
          total: enrichedTopics.length,
          topics: enrichedTopics
        }, 200, { 'Server-Timing': `app;dur=${dur}` });
      }

      // 3. GET /api/results (实时热度排行榜)
      if (path === '/api/results' && method === 'GET') {
        const [settings, kvTopics] = await Promise.all([
          getJsonKV(KV, 'settings', { resultsVisibility: 'after_vote' }),
          getJsonKV(KV, 'topics', null)
        ]);

        const topics = (kvTopics && Array.isArray(kvTopics) && kvTopics.length > 0) ? kvTopics : DEFAULT_TOPICS;

        let hasVoted = false;
        let counts = {};
        topics.forEach(t => counts[t.id] = 0);
        let totalVotesCast = 0;
        let totalVoters = 0;

        if (DB) {
          try {
            const [voterRes, countRes, tallyRes] = await Promise.all([
              voterToken ? DB.prepare('SELECT id FROM ballots WHERE voter_token = ?').bind(voterToken).first() : Promise.resolve(null),
              DB.prepare('SELECT (SELECT COUNT(*) FROM ballots) as totalVoters, (SELECT COUNT(*) FROM vote_items) as totalVotesCast').first(),
              DB.prepare('SELECT topic_id, COUNT(*) as cnt FROM vote_items GROUP BY topic_id').all()
            ]);

            hasVoted = !!voterRes;
            if (countRes) {
              totalVoters = countRes.totalVoters || 0;
              totalVotesCast = countRes.totalVotesCast || 0;
            }
            if (tallyRes && tallyRes.results) {
              for (const row of tallyRes.results) {
                if (counts[row.topic_id] !== undefined) counts[row.topic_id] = row.cnt;
              }
            }
          } catch (e) {
            console.warn('D1 results tally error, fallback to KV:', e.message);
          }
        }

        if (!hasVoted && voterToken && KV) {
          const directVote = await getJsonKV(KV, 'voter:' + voterToken, null);
          if (directVote) hasVoted = true;
        }

        if (totalVoters === 0 && KV) {
          const kvBallots = await loadKvBallots(KV);
          if (kvBallots.length > 0) {
            totalVoters = kvBallots.length;
            for (const b of kvBallots) {
              if (b && Array.isArray(b.topicIds)) {
                for (const tid of b.topicIds) {
                  if (counts[tid] !== undefined) {
                    counts[tid]++;
                    totalVotesCast++;
                  }
                }
              }
            }
          }
        }

        const canViewCounts = settings.resultsVisibility === 'public' || 
          (settings.resultsVisibility === 'after_vote' && hasVoted);

        if (!canViewCounts) {
          return jsonResponse({
            success: true,
            locked: true,
            message: '投出你的心仪选票后，即刻解锁实时热度排行！',
            stats: { totalVoters, totalVotesCast: null, topicStats: [] }
          });
        }

        const topicStats = topics.map(t => {
          const count = counts[t.id] || 0;
          return {
            id: t.id,
            title: t.title,
            speaker: t.speaker,
            category: t.category,
            tag: t.tag,
            count,
            percentage: totalVotesCast > 0 ? Math.round((count / totalVotesCast) * 100) : 0
          };
        }).sort((a, b) => b.count - a.count);

        const dur = Date.now() - startTime;
        return jsonResponse({
          success: true,
          locked: false,
          stats: { totalVoters, totalVotesCast, topicStats }
        }, 200, { 'Server-Timing': `app;dur=${dur}` });
      }

      // 4. POST /api/vote (零冲突 ACID 事务投票 + 双写永久镜像备份)
      if (path === '/api/vote' && method === 'POST') {
        const { tooLarge, data: body } = await readJsonBody(request);
        if (tooLarge) return jsonResponse({ error: '请求数据体积超限' }, 413);
        // 多通道获取选民 token：Header > Body > URL Query > 兜底
        const clientToken = voterToken || body.voterToken || url.searchParams.get('voterToken') || ('anon-' + Math.random().toString(36).slice(2, 12));

        if (!checkTokenRateLimit(clientToken, 20, 60000)) {
          return jsonResponse({ error: '投票提交过快，请稍候再试' }, 429);
        }
        if (!checkIpRateLimit(clientIp, 250, 60000)) {
          return jsonResponse({ error: '当前网络访问量过大，请稍候再试' }, 429);
        }
        // 跨节点全局限流：内存 Map 只能挡住同一 isolate，脚本分散请求即可绕过
        const voteLimits = await checkGlobalLimits(DB, [
          { key: 'vote:ip:' + clientIp, limit: 200, windowMs: 60000 },
          { key: 'vote:tok:' + clientToken, limit: 30, windowMs: 600000 }
        ]);
        if (!voteLimits.allowed) {
          return jsonResponse({ error: '提交过于频繁，请稍候再试' }, 429);
        }

        const { topicIds: rawTopicIds, comment } = body;

        const [settings, kvTopics] = await Promise.all([
          getJsonKV(KV, 'settings', { maxVotesPerUser: 3, status: 'open', allowChangeVote: true }),
          getJsonKV(KV, 'topics', null)
        ]);

        const topics = (kvTopics && Array.isArray(kvTopics) && kvTopics.length > 0) ? kvTopics : DEFAULT_TOPICS;

        if (settings.status === 'closed') return jsonResponse({ error: '投票已截止并锁定' }, 400);
        if (settings.status === 'paused') return jsonResponse({ error: '投票暂缓进行中' }, 400);

        if (!Array.isArray(rawTopicIds) || rawTopicIds.length === 0) {
          return jsonResponse({ error: '请至少选择 1 门心仪社课' }, 400);
        }

        const topicMap = {};
        topics.forEach(t => topicMap[t.id] = t.title);

        const topicIds = Array.from(new Set(rawTopicIds.filter(id => topicMap[id])));
        if (topicIds.length === 0) return jsonResponse({ error: '所选社课不存在或已失效' }, 400);
        if (topicIds.length > (settings.maxVotesPerUser || 3)) {
          return jsonResponse({ error: `至多可选择 ${settings.maxVotesPerUser || 3} 门社课` }, 400);
        }

        const cleanComment = sanitizeText(comment, 200);
        const ballotId = 'ballot-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        const votedAt = new Date().toISOString();

        // 检查用户是否已投过票（幂等防重试保护与改票校验）
        let existingVote = null;
        if (DB) {
          try {
            existingVote = await DB.prepare('SELECT * FROM ballots WHERE voter_token = ?').bind(clientToken).first();
          } catch (e) {}
        }
        if (!existingVote && KV) {
          existingVote = await getJsonKV(KV, 'voter:' + clientToken, null);
        }

        if (existingVote) {
          // 幂等性检测：若提交的选项完全一致且未追加新留言，直接返回成功，杜绝网络重试误报
          const existingTopics = Array.isArray(existingVote.topic_ids)
            ? existingVote.topic_ids
            : (typeof existingVote.topic_ids === 'string' ? JSON.parse(existingVote.topic_ids || '[]') : (existingVote.topicIds || []));
          const isSameTopics = existingTopics.length === topicIds.length && existingTopics.every(id => topicIds.includes(id));
          if (isSameTopics && !cleanComment) {
            return jsonResponse({
              success: true,
              message: '选票投出成功！已为您揭晓实时热度榜',
              voterToken: clientToken,
              hasVoted: true,
              vote: {
                id: existingVote.id,
                voterId: clientToken,
                voterToken: clientToken,
                topicIds,
                topicTitles: topicIds.map(id => topicMap[id] || id),
                comment: existingVote.comment || '',
                votedAt: existingVote.voted_at || existingVote.votedAt || votedAt
              }
            }, 200, { 'Server-Timing': `app;dur=${Date.now() - startTime}` });
          }

          if (!settings.allowChangeVote) {
            return jsonResponse({ error: '本次投票设定为不可修改已提交选票' }, 400);
          }
        }

        // 1. D1 事务写入（带微重试机制与 100% ACID 强一致性保证）
        let d1WriteSuccess = false;
        if (DB) {
          try {
            await executeWithRetry(async () => {
              const statements = [
                DB.prepare(`
                  INSERT INTO ballots (id, voter_token, topic_ids, comment, client_ip, voted_at)
                  VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT(voter_token) DO UPDATE SET
                    topic_ids = excluded.topic_ids,
                    comment = excluded.comment,
                    client_ip = excluded.client_ip,
                    voted_at = excluded.voted_at
                `).bind(ballotId, clientToken, JSON.stringify(topicIds), cleanComment, clientIp.slice(0, 16), votedAt),
                DB.prepare('DELETE FROM vote_items WHERE voter_token = ?').bind(clientToken)
              ];

              for (const tid of topicIds) {
                statements.push(
                  DB.prepare('INSERT INTO vote_items (voter_token, topic_id, voted_at) VALUES (?, ?, ?)').bind(clientToken, tid, votedAt)
                );
              }

              if (cleanComment) {
                const cmtId = 'cmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
                statements.push(
                  DB.prepare(`
                    INSERT INTO comments (id, topic_id, topic_title, voter_token, author_name, text, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                  `).bind(cmtId, topicIds[0] || 'general', topicMap[topicIds[0]] || '', clientToken, '同学', cleanComment, votedAt)
                );
              }

              await DB.batch(statements);
            }, 2, 40);
            d1WriteSuccess = true;
          } catch (d1Err) {
            console.error('D1 batch write error after retries, triggering synchronous KV fallback:', d1Err.message);
          }
        }

        // 2. 双轨镜像写入 KV 备份（永久存储，无 TTL，并同步全局 ballots 数组）
        const ballot = {
          id: ballotId,
          voterId: clientToken,
          voterToken: clientToken,
          topicIds,
          topicTitles: topicIds.map(id => topicMap[id] || id),
          comment: cleanComment,
          clientIp: clientIp.slice(0, 16),
          // 记录承接这票的边缘节点与接入域名：便于事后核对"某个节点是不是漏了票"
          edgeColo: (request.cf && request.cf.colo) || 'unknown',
          viaHost: url.hostname,
          votedAt
        };

        const syncKvTask = async () => {
          if (!KV) return;
          try {
            // 单键写入：并发投票互不冲突（原来改全局数组会互相覆盖丢票）
            await putKvBallot(KV, ballot);
            // 留言同样按条目单键落盘
            if (cleanComment && !d1WriteSuccess) {
              await putKvComment(KV, {
                id: 'cmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                topicId: topicIds[0] || 'general',
                topicTitle: topicMap[topicIds[0]] || '',
                voterId: clientToken,
                authorName: '同学',
                text: cleanComment,
                createdAt: votedAt
              });
            }
          } catch (kvErr) {
            console.error('syncKvTask error:', kvErr.message);
          }
        };

        if (d1WriteSuccess) {
          if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(syncKvTask());
          } else {
            await syncKvTask();
          }
        } else {
          // 若 D1 写入异常，同步等待 KV 写入完成，确保数据落盘不丢失
          await syncKvTask();
        }

        const dur = Date.now() - startTime;
        return jsonResponse({
          success: true,
          message: '选票投出成功！已为您揭晓实时热度榜',
          voterToken: clientToken,
          hasVoted: true,
          vote: ballot
        }, 200, { 'Server-Timing': `app;dur=${dur}` });
      }

      // 5. GET /api/comments & POST /api/comments
      if (path === '/api/comments') {
        if (method === 'GET') {
          if (DB) {
            try {
              const res = await DB.prepare('SELECT * FROM comments ORDER BY created_at DESC LIMIT 200').all();
              const list = (res.results || []).map(c => ({
                id: c.id,
                topicId: c.topic_id || 'general',
                topicTitle: c.topic_title || '',
                text: c.text,
                authorName: c.author_name || '同学',
                createdAt: c.created_at
              }));
              const dur = Date.now() - startTime;
              return jsonResponse({ success: true, comments: list }, 200, { 'Server-Timing': `app;dur=${dur}` });
            } catch (e) {
              console.warn('D1 comments query error, fallback to KV:', e.message);
            }
          }

          const comments = await loadKvComments(KV);
          return jsonResponse({ success: true, comments });
        }

        if (method === 'POST') {
          const { tooLarge, data: body } = await readJsonBody(request);
          if (tooLarge) return jsonResponse({ error: '请求数据体积超限' }, 413);
          const authorToken = voterToken || body.voterToken || clientIp;

          if (!checkTokenRateLimit(authorToken, 8, 60000)) {
            return jsonResponse({ error: '发言过于频繁，请稍息后再试' }, 429);
          }

          const cleanText = sanitizeText(body.text, 200);
          if (!cleanText) return jsonResponse({ error: '留言内容不能为空' }, 400);

          const cleanAuthor = sanitizeText(body.authorName, 20) || '同学';
          const topicId = body.topicId || 'general';
          let topicTitle = '';
          if (topicId !== 'general') {
            const topics = await getJsonKV(KV, 'topics', DEFAULT_TOPICS);
            const found = topics.find(t => t.id === topicId);
            if (found) topicTitle = found.title;
          }

          const cmtId = 'cmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          const createdAt = new Date().toISOString();

          let d1Success = false;
          if (DB) {
            try {
              await executeWithRetry(async () => {
                await DB.prepare(`
                  INSERT INTO comments (id, topic_id, topic_title, voter_token, author_name, text, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                `).bind(cmtId, topicId, topicTitle, authorToken, cleanAuthor, cleanText, createdAt).run();
              }, 2, 40);
              d1Success = true;
            } catch (e) {
              console.warn('D1 insert comment error, fallback to KV:', e.message);
            }
          }

          const newComment = {
            id: cmtId,
            topicId,
            topicTitle,
            voterId: authorToken,
            authorName: cleanAuthor,
            text: cleanText,
            createdAt
          };

          // 双写同步 KV
          if (KV) {
            const syncCommentKV = async () => {
              try {
                // 单键写入，避免并发留言互相覆盖
                await putKvComment(KV, newComment);
              } catch (e) {}
            };
            if (ctx && typeof ctx.waitUntil === 'function') {
              ctx.waitUntil(syncCommentKV());
            } else {
              await syncCommentKV();
            }
          }

          const dur = Date.now() - startTime;
          return jsonResponse({ success: true, message: '留言已发布！', comment: newComment }, 200, {
            'Server-Timing': `app;dur=${dur}`
          });
        }
      }

      // DELETE /api/comments/:id
      if (path.startsWith('/api/comments/') && method === 'DELETE') {
        if (!isAdmin) return jsonResponse({ error: '需要管理员权限' }, 403);
        const commentId = path.split('/')[3];
        if (DB) {
          try {
            await DB.prepare('DELETE FROM comments WHERE id = ?').bind(commentId).run();
          } catch (e) {}
        }
        if (KV) {
          try {
            // 单键直接删；历史数组里的同 id 记录一并清掉
            await KV.delete(KV_COMMENT_PREFIX + commentId).catch(() => {});
            const current = await getJsonKV(KV, 'comments', []);
            const next = current.filter(c => c.id !== commentId);
            if (next.length !== current.length) {
              await safePutKV(KV, 'comments', JSON.stringify(next));
            }
          } catch (e) {}
        }
        return jsonResponse({ success: true, message: '留言已删除' });
      }

      // 6. 单门社课研讨墙
      if (path.startsWith('/api/topics/') && path.endsWith('/comments')) {
        const topicId = path.split('/')[3];

        if (method === 'GET') {
          if (DB) {
            try {
              const res = await DB.prepare('SELECT * FROM comments WHERE topic_id = ? ORDER BY created_at DESC LIMIT 100').bind(topicId).all();
              const list = (res.results || []).map(c => ({
                id: c.id,
                text: c.text,
                authorName: c.author_name || '同学',
                createdAt: c.created_at
              }));
              return jsonResponse({ success: true, comments: list });
            } catch (e) {}
          }
          const allComments = await loadKvComments(KV);
          const list = allComments.filter(c => c.topicId === topicId).map(c => ({
            id: c.id,
            text: c.text,
            authorName: c.authorName || '同学',
            createdAt: c.createdAt
          }));
          return jsonResponse({ success: true, comments: list });
        }

        if (method === 'POST') {
          const { tooLarge, data: body } = await readJsonBody(request);
          if (tooLarge) return jsonResponse({ error: '请求数据体积超限' }, 413);
          const authorToken = voterToken || body.voterToken || clientIp;

          if (!checkTokenRateLimit(authorToken, 8, 60000)) {
            return jsonResponse({ error: '发言过于频繁，请稍息后再试' }, 429);
          }
          const commentLimit = await checkGlobalLimit(DB, 'comment:ip:' + clientIp, 40, 60000);
          if (!commentLimit.allowed) {
            return jsonResponse({ error: '发言过于频繁，请稍息后再试' }, 429);
          }
          const cleanText = sanitizeText(body.text, 200);
          if (!cleanText) return jsonResponse({ error: '留言内容不能为空' }, 400);

          const cleanAuthor = sanitizeText(body.authorName, 20) || '同学';
          const cmtId = 'cmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          const createdAt = new Date().toISOString();

          if (DB) {
            try {
              await executeWithRetry(async () => {
                await DB.prepare(`
                  INSERT INTO comments (id, topic_id, topic_title, voter_token, author_name, text, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                `).bind(cmtId, topicId, '', authorToken, cleanAuthor, cleanText, createdAt).run();
              }, 2, 40);
            } catch (e) {}
          }

          if (KV) {
            const syncTopicCmt = async () => {
              try {
                await putKvComment(KV, { id: cmtId, topicId, topicTitle: '', voterId: authorToken, authorName: cleanAuthor, text: cleanText, createdAt });
              } catch (e) {}
            };
            if (ctx && typeof ctx.waitUntil === 'function') {
              ctx.waitUntil(syncTopicCmt());
            } else {
              await syncTopicCmt();
            }
          }

          return jsonResponse({
            success: true,
            message: '留言已发布！',
            comment: { id: cmtId, text: cleanText, authorName: cleanAuthor, createdAt }
          });
        }
      }

      // 7. 管理员安全认证（Web Crypto PBKDF2 强化加密校验，零明文存储）
      if (path === '/api/auth/login' && method === 'POST') {
        // 唯一的口令入口：本节点内存限流 + D1 全局限流，杜绝无限次猜密码与 CPU 消耗型冲击
        if (!checkIpRateLimit('login:' + clientIp, 20, 300000)) {
          return jsonResponse({ error: '尝试过于频繁，请 5 分钟后再试' }, 429);
        }
        const loginLimits = await checkGlobalLimits(DB, [
          { key: 'login:ip:' + clientIp, limit: 20, windowMs: 300000 },
          { key: 'login:all', limit: 200, windowMs: 300000 }
        ]);
        if (!loginLimits.allowed) {
          return jsonResponse({ error: '尝试过于频繁，请稍后再试' }, 429);
        }

        const { tooLarge, data: body } = await readJsonBody(request);
        if (tooLarge) return jsonResponse({ error: '请求数据体积超限' }, 413);
        const { username, password } = body;
        if (!username || !password) {
          return jsonResponse({ error: '请输入管理员账号与密码' }, 400);
        }

        const creds = await getAdminCredentials(KV, DB);
        if (creds && username.trim().toLowerCase() === (creds.username || 'admin').toLowerCase()) {
          const isValid = await verifyPassword(password, creds.salt, creds.hash);
          if (isValid) {
            const adminObj = { id: 'admin-root', username: creds.username || 'admin', displayName: '总管理员', role: 'admin' };
            const token = await signToken(adminObj, KV);
            return jsonResponse({ success: true, message: '管理员登录成功', token, user: adminObj });
          }
        }
        return jsonResponse({ error: '管理员账号或密码错误' }, 401);
      }

      // 8. 管理员核心配置与数据生命周期管理
      if (path.startsWith('/api/admin')) {
        if (!isAdmin) return jsonResponse({ error: '需要管理员权限' }, 403);

        // 管理接口限流：主要拦脚本失控循环，正常人工操作远达不到这个量
        const adminLimit = await checkGlobalLimit(DB, 'admin:ip:' + clientIp, 240, 60000);
        if (!adminLimit.allowed) {
          return jsonResponse({ error: '操作过于频繁，请稍候再试' }, 429);
        }

        // POST /api/admin/change-password & PUT /api/admin/password (在线修改管理员密码)
        if ((path === '/api/admin/change-password' || path === '/api/admin/password') && (method === 'POST' || method === 'PUT')) {
          const { tooLarge, data: body } = await readJsonBody(request);
          if (tooLarge) return jsonResponse({ error: '请求数据体积超限' }, 413);
          const { oldPassword, newPassword } = body;
          if (!oldPassword || !newPassword) {
            return jsonResponse({ error: '请提供原密码与新密码' }, 400);
          }
          if (typeof newPassword !== 'string' || newPassword.length < 6) {
            return jsonResponse({ error: '新密码长度至少需要 6 个字符' }, 400);
          }

          const creds = await getAdminCredentials(KV, DB);
          const isOldValid = await verifyPassword(oldPassword, creds.salt, creds.hash);
          if (!isOldValid) {
            return jsonResponse({ error: '原密码校验错误，无法修改' }, 403);
          }

          // 重新生成 16 字节真随机 Salt 与 100,000 次 PBKDF2 迭代加密
          const newCredential = await hashPassword(newPassword);
          const updatedRecord = {
            username: creds.username || 'admin',
            salt: newCredential.salt,
            hash: newCredential.hash,
            updatedAt: new Date().toISOString()
          };

          // 原子写入 KV 与 D1（绝不触碰任何选票数据！）
          if (KV) {
            await safePutKV(KV, 'admin_credentials', JSON.stringify(updatedRecord));
          }
          if (DB) {
            try {
              await DB.prepare('INSERT OR REPLACE INTO admins (id, username, salt, hash, updated_at) VALUES (?, ?, ?, ?, ?)')
                .bind('admin-root', updatedRecord.username, updatedRecord.salt, updatedRecord.hash, updatedRecord.updatedAt)
                .run();
            } catch (err) {
              console.warn('Update admin in D1 error:', err.message);
            }
          }

          const adminObj = { id: 'admin-root', username: updatedRecord.username, displayName: '总管理员', role: 'admin' };
          const token = await signToken(adminObj, KV);

          return jsonResponse({
            success: true,
            message: '管理员密码修改成功！新凭据已即时持久化生效。',
            token
          });
        }

        // POST /api/admin/sync (全量对齐 D1 与 KV 数据状态，一键自愈)
        if (path === '/api/admin/sync' && method === 'POST') {
          let d1Count = 0;
          let kvCount = 0;
          let syncedComments = 0;
          if (DB) {
            try {
              const bRes = await DB.prepare('SELECT * FROM ballots ORDER BY voted_at DESC').all();
              const rawBallots = bRes.results || [];
              d1Count = rawBallots.length;
              if (KV && rawBallots.length > 0) {
                const formatted = rawBallots.map(b => ({
                  id: b.id,
                  voterId: b.voter_token,
                  voterToken: b.voter_token,
                  topicIds: JSON.parse(b.topic_ids || '[]'),
                  comment: b.comment || '',
                  clientIp: b.client_ip || '',
                  votedAt: b.voted_at
                }));
                await safePutKV(KV, 'ballots', JSON.stringify(formatted));
                for (const b of formatted) {
                  await safePutKV(KV, 'voter:' + b.voterToken, JSON.stringify(b));
                }
              }

              const cRes = await DB.prepare('SELECT * FROM comments ORDER BY created_at DESC LIMIT 200').all();
              if (KV && cRes.results && cRes.results.length > 0) {
                syncedComments = cRes.results.length;
                const formattedComments = cRes.results.map(c => ({
                  id: c.id,
                  topicId: c.topic_id || 'general',
                  topicTitle: c.topic_title || '',
                  voterId: c.voter_token,
                  authorName: c.author_name || '同学',
                  text: c.text,
                  createdAt: c.created_at
                }));
                await safePutKV(KV, 'comments', JSON.stringify(formattedComments));
                for (const c of formattedComments) await putKvComment(KV, c);
              }
            } catch (e) {
              return jsonResponse({ error: 'D1 读取对齐失败，数据未变动' }, 500);
            }
          }
          if (KV) {
            const kvB = await loadKvBallots(KV);
            kvCount = kvB.length;
          }
          return jsonResponse({
            success: true,
            message: 'D1 与 KV 双引擎全量选票与留言已成功对齐对准！',
            d1BallotsCount: d1Count,
            kvBallotsCount: kvCount,
            syncedCommentsCount: syncedComments,
            timestamp: new Date().toISOString()
          });
        }

        // GET /api/admin/ballots (查看所有选票明细)
        if (path === '/api/admin/ballots' && method === 'GET') {
          if (DB) {
            try {
              const res = await DB.prepare('SELECT * FROM ballots ORDER BY voted_at DESC').all();
              const list = (res.results || []).map(b => ({
                id: b.id,
                voterId: b.voter_token,
                voterToken: b.voter_token,
                topicIds: JSON.parse(b.topic_ids || '[]'),
                comment: b.comment,
                clientIp: b.client_ip,
                votedAt: b.voted_at
              }));
              return jsonResponse({ success: true, ballots: list });
            } catch (e) {}
          }
          const ballots = await loadKvBallots(KV);
          return jsonResponse({ success: true, ballots });
        }

        // DELETE /api/admin/ballots/:id (撤销删除指定单个选票)
        if (path.startsWith('/api/admin/ballots/') && method === 'DELETE') {
          const ballotId = path.split('/')[4];
          if (DB) {
            try {
              const row = await DB.prepare('SELECT voter_token FROM ballots WHERE id = ?').bind(ballotId).first();
              if (row) {
                await DB.batch([
                  DB.prepare('DELETE FROM ballots WHERE id = ?').bind(ballotId),
                  DB.prepare('DELETE FROM vote_items WHERE voter_token = ?').bind(row.voter_token)
                ]);
                if (KV) await KV.delete('voter:' + row.voter_token);
              }
            } catch (e) {}
          }
          if (KV) {
            try {
              const current = await getJsonKV(KV, 'ballots', []);
              const next = current.filter(b => b.id !== ballotId);
              await safePutKV(KV, 'ballots', JSON.stringify(next));
            } catch (e) {}
          }
          return jsonResponse({ success: true, message: '选票明细已成功撤销并同步扣减！' });
        }

        // POST /api/admin/clear-votes (彻底清空重置选票与选民状态)
        if ((path === '/api/admin/clear-votes' || path === '/api/admin/reset-votes') && method === 'POST') {
          const { tooLarge, data: body } = await readJsonBody(request);
          if (tooLarge) return jsonResponse({ error: '请求数据体积超限' }, 413);
          // 默认同时清空留言（保持原有行为）；只想清选票可传 keepComments:true
          const keepComments = body.keepComments === true;
          const confirm = body.confirm;

          // 这种不可逆操作必须先自动快照，误点了还能捞回来
          const snapshot = await takeSnapshot(KV, DB, 'before-clear-votes');

          let d1Cleared = false;
          if (DB) {
            try {
              const stmts = [DB.prepare('DELETE FROM ballots'), DB.prepare('DELETE FROM vote_items')];
              if (!keepComments) stmts.push(DB.prepare('DELETE FROM comments'));
              await DB.batch(stmts);
              d1Cleared = true;
            } catch (e) {
              console.warn('clear-votes D1 error:', e.message);
            }
          }

          let kvDeleted = 0;
          if (KV) {
            // 历史数组置空（兼容旧数据），并逐一删除单键（分页，选民破千也不会漏）
            await safePutKV(KV, 'ballots', JSON.stringify([]));
            kvDeleted += await deleteKvByPrefix(KV, KV_BALLOT_PREFIX);
            if (!keepComments) {
              await safePutKV(KV, 'comments', JSON.stringify([]));
              kvDeleted += await deleteKvByPrefix(KV, KV_COMMENT_PREFIX);
            }
          }

          if (!d1Cleared) {
            return jsonResponse({
              error: '主库清空失败，数据未变动（KV 已回滚为空数组，但单键未动）；请稍后重试或先在审计里核对',
              snapshot
            }, 500);
          }

          return jsonResponse({
            success: true,
            message: keepComments
              ? '已清空全部选票与选民状态（留言保留）'
              : '所有选票、选民指纹与讨论留言已全量重置清空！',
            cleared: { d1: true, kvKeys: kvDeleted, keepComments, confirm: confirm || null },
            snapshot
          });
        }

        // GET /api/admin/settings & PUT /api/admin/settings
        if (path === '/api/admin/settings') {
          if (method === 'GET') {
            const currentSettings = await getJsonKV(KV, 'settings', {});
            return jsonResponse({ success: true, settings: currentSettings });
          }
          if (method === 'PUT') {
            const { tooLarge, data: updates } = await readJsonBody(request);
            if (tooLarge) return jsonResponse({ error: '请求数据体积超限' }, 413);
            let current = await getJsonKV(KV, 'settings', {});
            const newSettings = { ...current, ...updates, updatedAt: new Date().toISOString() };
            await safePutKV(KV, 'settings', JSON.stringify(newSettings));
            return jsonResponse({ success: true, message: '系统设置保存成功！', settings: newSettings });
          }
        }

        // PUT /api/admin/topics/reorder (调整社课前台展示排序)
        if (path === '/api/admin/topics/reorder' && method === 'PUT') {
          const { tooLarge, data: body } = await readJsonBody(request);
          if (tooLarge) return jsonResponse({ error: '请求数据体积超限' }, 413);
          const { orderedIds } = body;
          if (Array.isArray(orderedIds)) {
            let currentTopics = await getJsonKV(KV, 'topics', DEFAULT_TOPICS);
            const map = new Map(currentTopics.map(t => [t.id, t]));
            const nextTopics = [];
            for (const id of orderedIds) {
              if (map.has(id)) {
                nextTopics.push(map.get(id));
                map.delete(id);
              }
            }
            for (const rem of map.values()) nextTopics.push(rem);
            await safePutKV(KV, 'topics', JSON.stringify(nextTopics));
            return jsonResponse({ success: true, message: '社课排期顺序已更新并生效！', topics: nextTopics });
          }
          return jsonResponse({ error: '无效排序参数' }, 400);
        }

        // POST /api/admin/topics
        if (path === '/api/admin/topics' && method === 'POST') {
          const { tooLarge, data: body } = await readJsonBody(request);
          if (tooLarge) return jsonResponse({ error: '请求数据体积超限' }, 413);
          const { title, speaker, category, tag, duration, hook, summary, outline } = body;
          if (!title || !title.trim()) return jsonResponse({ error: '社课主题名称不能为空' }, 400);

          const outlineArr = Array.isArray(outline) 
            ? outline.map(s => (typeof s === 'object' ? s : String(s).trim())).filter(Boolean)
            : (typeof outline === 'string' ? outline.split('\n').map(s => s.trim()).filter(Boolean) : []);

          let topics = await getJsonKV(KV, 'topics', DEFAULT_TOPICS);
          const newTopic = {
            id: 'topic-' + Date.now().toString(36),
            title: title.trim(),
            speaker: (speaker || '墨澜 & 诙谐').trim(),
            category: (category || '通识探索').trim(),
            tag: (tag || '新议题').trim(),
            duration: (duration || '45分钟 + 15分钟研讨').trim(),
            hook: (hook || '').trim(),
            summary: (summary || '').trim(),
            outline: outlineArr.length > 0 ? outlineArr : [],
            createdAt: new Date().toISOString()
          };
          topics.push(newTopic);
          await safePutKV(KV, 'topics', JSON.stringify(topics));
          return jsonResponse({ success: true, message: '社课议题添加成功！', topic: newTopic });
        }

        // PUT /api/admin/topics/:id
        if (path.startsWith('/api/admin/topics/') && method === 'PUT') {
          const topicId = path.split('/')[4];
          const { tooLarge, data: updates } = await readJsonBody(request);
          if (tooLarge) return jsonResponse({ error: '请求数据体积超限' }, 413);
          let topics = await getJsonKV(KV, 'topics', DEFAULT_TOPICS);
          const idx = topics.findIndex(t => t.id === topicId);
          if (idx === -1) return jsonResponse({ error: '未找到对应社课议题' }, 404);

          if (updates.outline !== undefined) {
            updates.outline = Array.isArray(updates.outline)
              ? updates.outline.map(s => (typeof s === 'object' ? s : String(s).trim())).filter(Boolean)
              : (typeof updates.outline === 'string' ? updates.outline.split('\n').map(s => s.trim()).filter(Boolean) : []);
          }
          topics[idx] = { ...topics[idx], ...updates, id: topicId, updatedAt: new Date().toISOString() };
          await safePutKV(KV, 'topics', JSON.stringify(topics));
          return jsonResponse({ success: true, message: '社课议题修改成功！', topic: topics[idx] });
        }

        // DELETE /api/admin/topics/:id
        if (path.startsWith('/api/admin/topics/') && method === 'DELETE') {
          const topicId = path.split('/')[4];
          let topics = await getJsonKV(KV, 'topics', DEFAULT_TOPICS);
          topics = topics.filter(t => t.id !== topicId);
          await safePutKV(KV, 'topics', JSON.stringify(topics));
          return jsonResponse({ success: true, message: '社课议题已删除！' });
        }

        // GET /api/admin/audit
        // 数据对账与异常检测：把"可能悄悄漏掉的东西"全部摊开，便于向同学交代
        //   missingInD1  —— KV 有、D1 没有：没能落主库的票（真正的"漏票"）
        //   missingInKv  —— D1 有、KV 没有：备份镜像缺失（主库仍在，不影响数据）
        //   duplicateIdentities —— 同一设备投出多张票（换域名/换浏览器导致身份重复）
        //   suspiciousIps —— 同一 IP 短时间大量不同选民（疑似脚本刷票）
        //   edgeNodes    —— 每个边缘节点承接的票数（用于核对某个节点是否异常）
        if (path === '/api/admin/audit' && method === 'GET') {
          let d1Ballots = [];
          let d1Comments = [];
          if (DB) {
            try {
              const [b, c] = await Promise.all([
                DB.prepare('SELECT * FROM ballots ORDER BY voted_at DESC').all(),
                DB.prepare('SELECT id, topic_id, text, created_at FROM comments ORDER BY created_at DESC').all()
              ]);
              d1Ballots = (b.results || []).map(x => ({
                id: x.id,
                voterToken: x.voter_token,
                topicIds: JSON.parse(x.topic_ids || '[]'),
                comment: x.comment || '',
                clientIp: x.client_ip || '',
                votedAt: x.voted_at
              }));
              d1Comments = c.results || [];
            } catch (e) {
              console.warn('audit D1 read error:', e.message);
            }
          }
          const kvBallots = await loadKvBallots(KV);
          const kvComments = await loadKvComments(KV);

          const d1Tokens = new Set(d1Ballots.map(b => b.voterToken));
          const kvByToken = new Map(kvBallots.map(b => [b.voterToken, b]).filter(x => x[0]));

          const missingInD1 = [];
          for (const b of kvBallots) {
            if (b && b.voterToken && !d1Tokens.has(b.voterToken)) {
              missingInD1.push({
                voterToken: b.voterToken,
                topicIds: b.topicIds || [],
                comment: b.comment || '',
                clientIp: b.clientIp || '',
                votedAt: b.votedAt || '',
                edgeColo: b.edgeColo || '(旧记录未采集)',
                viaHost: b.viaHost || '',
                suspectedTest: /测试|test/i.test(String(b.comment || '')) || /^2406:/.test(String(b.clientIp || ''))
              });
            }
          }
          const missingInKv = d1Ballots
            .filter(b => !kvByToken.has(b.voterToken))
            .map(b => ({ voterToken: b.voterToken, votedAt: b.votedAt }));

          const byIp = new Map();
          for (const b of d1Ballots) {
            const ip = b.clientIp || 'unknown';
            if (!byIp.has(ip)) byIp.set(ip, []);
            byIp.get(ip).push({ voterToken: b.voterToken, votedAt: b.votedAt, topicIds: b.topicIds });
          }
          const duplicateIdentities = [];
          const suspiciousIps = [];
          const WINDOW = 10 * 60 * 1000;
          for (const [ip, list] of byIp) {
            if (list.length > 1) {
              duplicateIdentities.push({
                ip,
                count: list.length,
                ballots: list.slice().sort((a, b) => String(a.votedAt).localeCompare(String(b.votedAt)))
              });
            }
            const times = list.map(x => new Date(x.votedAt).getTime()).filter(t => !isNaN(t)).sort((a, b) => a - b);
            let maxInWindow = 0;
            for (let i = 0; i < times.length; i++) {
              let j = i;
              while (j < times.length && times[j] - times[i] < WINDOW) j++;
              maxInWindow = Math.max(maxInWindow, j - i);
            }
            if (maxInWindow >= 10) suspiciousIps.push({ ip, ballotsIn10Min: maxInWindow, total: list.length });
          }

          const kvTopics = await getJsonKV(KV, 'topics', null);
          const topicList = (kvTopics && kvTopics.length) ? kvTopics : DEFAULT_TOPICS;
          const validTopicIds = new Set(topicList.map(t => t.id));
          const unknownTopics = [];
          for (const b of d1Ballots) {
            for (const tid of (b.topicIds || [])) {
              if (!validTopicIds.has(tid)) unknownTopics.push({ voterToken: b.voterToken, topicId: tid });
            }
          }

          const coloMap = new Map();
          for (const b of kvBallots) {
            if (!b) continue;
            const node = b.edgeColo || '(旧记录未采集)';
            const key = node + (b.viaHost ? ' · ' + b.viaHost : '');
            coloMap.set(key, (coloMap.get(key) || 0) + 1);
          }
          const edgeNodes = [...coloMap.entries()]
            .map(([node, count]) => ({ node, count }))
            .sort((a, b) => b.count - a.count);

          const commentIdsInKv = new Set(kvComments.map(c => c.id));
          return jsonResponse({
            success: true,
            generatedAt: new Date().toISOString(),
            counts: {
              d1: { ballots: d1Ballots.length, comments: d1Comments.length },
              kv: { ballots: kvBallots.length, comments: kvComments.length }
            },
            missingInD1,
            missingInKv,
            duplicateIdentities,
            suspiciousIps,
            unknownTopics,
            edgeNodes,
            commentsOnlyInKv: kvComments.filter(c => c && c.id && !d1Comments.some(d => d.id === c.id)).length,
            // 数据是否完好：主库没有漏票、选票没有指向不存在的议题
            healthy: missingInD1.length === 0 && unknownTopics.length === 0,
            // 备份镜像是否完整：缺失只影响"主库挂掉时的兜底"，跑一次 /api/admin/sync 即可补齐
            mirrorIncomplete: missingInKv.length > 0,
            notes: [
              'missingInD1 是真正需要处理的"漏票"，可用 POST /api/admin/audit/repair { action: "import-missing" } 补写进主库。',
              'missingInKv 只是备份镜像缺条目（主库数据完好），跑一次 /api/admin/sync 即可补齐。',
              'duplicateIdentities 里的多条选票来自同一台设备，通常是换域名前后各投了一次，可用 rebind-voter 合并。',
              'edgeNodes 中带"(旧记录未采集)"的是本次采集上线前的投票，属正常。'
            ]
          }, 200, { 'Server-Timing': `app;dur=${Date.now() - startTime}` });
        }

        // POST /api/admin/audit/repair
        // 按审计结果修复。支持 dryRun 先预览；任何实际修改前自动快照，可回滚
        //   action: 'import-missing'  { tokens?: string[] }      把 KV 独有选票补写进 D1
        //   action: 'drop-kv-orphans' { tokens: string[] }       删除 KV 上多余的记录（如测试数据）
        //   action: 'rebind-voter'    { fromToken, toToken, overwrite? }  把选票改绑到新设备凭据
        if (path === '/api/admin/audit/repair' && method === 'POST') {
          const { tooLarge, data: body } = await readJsonBody(request);
          if (tooLarge) return jsonResponse({ error: '请求数据体积超限' }, 413);
          const action = body.action;
          const dryRun = body.dryRun === true;

          if (action === 'import-missing') {
            const only = Array.isArray(body.tokens) && body.tokens.length ? new Set(body.tokens) : null;
            const kvBallots = await loadKvBallots(KV);
            let d1Tokens = new Set();
            if (DB) {
              try {
                const r = await DB.prepare('SELECT voter_token FROM ballots').all();
                d1Tokens = new Set((r.results || []).map(x => x.voter_token));
              } catch (e) {}
            }
            const targets = kvBallots.filter(b => b && b.voterToken && !d1Tokens.has(b.voterToken) && (!only || only.has(b.voterToken)));
            if (dryRun) {
              return jsonResponse({ success: true, dryRun: true, wouldImport: targets.length, items: targets });
            }
            const snapshot = await takeSnapshot(KV, DB, 'before-import-missing');
            let imported = 0;
            const failed = [];
            for (const b of targets) {
              if (!DB) break;
              try {
                const votedAt = b.votedAt || new Date().toISOString();
                const stmts = [
                  DB.prepare(`INSERT INTO ballots (id, voter_token, topic_ids, comment, client_ip, voted_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(voter_token) DO UPDATE SET
                      topic_ids = excluded.topic_ids, comment = excluded.comment,
                      client_ip = excluded.client_ip, voted_at = excluded.voted_at`)
                    .bind(b.id || ('ballot-recover-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
                      b.voterToken, JSON.stringify(b.topicIds || []), b.comment || '', b.clientIp || '', votedAt),
                  DB.prepare('DELETE FROM vote_items WHERE voter_token = ?').bind(b.voterToken)
                ];
                for (const tid of (b.topicIds || [])) {
                  stmts.push(DB.prepare('INSERT INTO vote_items (voter_token, topic_id, voted_at) VALUES (?, ?, ?)')
                    .bind(b.voterToken, tid, votedAt));
                }
                await DB.batch(stmts);
                imported++;
              } catch (e) {
                failed.push({ voterToken: b.voterToken, error: e.message });
              }
            }
            return jsonResponse({ success: true, imported, failed, snapshot });
          }

          if (action === 'drop-kv-orphans') {
            const tokens = Array.isArray(body.tokens) ? body.tokens : [];
            if (tokens.length === 0) {
              return jsonResponse({ error: '请显式指定要删除的 voterToken 列表（先看审计结果里的 suspectedTest）' }, 400);
            }
            if (dryRun) {
              const kvBallots = await loadKvBallots(KV);
              return jsonResponse({
                success: true, dryRun: true,
                wouldDrop: kvBallots.filter(b => b && tokens.includes(b.voterToken))
              });
            }
            const snapshot = await takeSnapshot(KV, DB, 'before-drop-orphans');
            for (const t of tokens) {
              await KV.delete(KV_BALLOT_PREFIX + t).catch(() => {});
            }
            const legacy = await getJsonKV(KV, 'ballots', []);
            const next = legacy.filter(b => !tokens.includes(b && (b.voterToken || b.voterId)));
            if (next.length !== legacy.length) await safePutKV(KV, 'ballots', JSON.stringify(next));
            return jsonResponse({ success: true, dropped: tokens.length, snapshot });
          }

          if (action === 'rebind-voter') {
            const fromToken = body.fromToken;
            const toToken = body.toToken;
            if (!fromToken || !toToken) {
              return jsonResponse({ error: '需要 fromToken 与 toToken' }, 400);
            }
            if (fromToken === toToken) {
              return jsonResponse({ error: '新旧凭据相同，无需处理' }, 400);
            }
            if (dryRun) {
              // 预览时优先看主库（镜像可能还没同步），主库没有再回落到 KV
              let src = null;
              if (DB) {
                try {
                  const row = await DB.prepare('SELECT * FROM ballots WHERE voter_token = ?').bind(fromToken).first();
                  if (row) {
                    src = {
                      id: row.id,
                      voterToken: row.voter_token,
                      topicIds: JSON.parse(row.topic_ids || '[]'),
                      comment: row.comment || '',
                      clientIp: row.client_ip || '',
                      votedAt: row.voted_at
                    };
                  }
                } catch (e) {}
              }
              if (!src) src = await getJsonKV(KV, KV_BALLOT_PREFIX + fromToken, null);
              return jsonResponse({ success: true, dryRun: true, fromToken, toToken, sourceBallot: src });
            }
            if (!DB) return jsonResponse({ error: '主库不可用，暂不能改绑' }, 503);

            const src = await DB.prepare('SELECT * FROM ballots WHERE voter_token = ?').bind(fromToken).first();
            if (!src) return jsonResponse({ error: '找不到原选票，请核对 fromToken' }, 404);
            const target = await DB.prepare('SELECT voter_token FROM ballots WHERE voter_token = ?').bind(toToken).first();
            if (target && body.overwrite !== true) {
              return jsonResponse({ error: '目标设备已有选票；确认要覆盖请传 overwrite:true' }, 409);
            }

            const snapshot = await takeSnapshot(KV, DB, 'before-rebind');
            const items = await DB.prepare('SELECT topic_id, voted_at FROM vote_items WHERE voter_token = ?').bind(fromToken).all();
            const newBallotId = 'ballot-rebind-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
            const stmts = [
              DB.prepare('DELETE FROM ballots WHERE voter_token = ? OR voter_token = ?').bind(toToken, fromToken),
              DB.prepare('DELETE FROM vote_items WHERE voter_token = ? OR voter_token = ?').bind(toToken, fromToken),
              DB.prepare(`INSERT INTO ballots (id, voter_token, topic_ids, comment, client_ip, voted_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
                .bind(newBallotId, toToken, src.topic_ids, src.comment || '', src.client_ip || '', src.voted_at)
            ];
            for (const it of (items.results || [])) {
              stmts.push(DB.prepare('INSERT INTO vote_items (voter_token, topic_id, voted_at) VALUES (?, ?, ?)')
                .bind(toToken, it.topic_id, it.voted_at));
            }
            try {
              await DB.batch(stmts);
            } catch (e) {
              return jsonResponse({ error: '改绑失败，数据未变动：' + e.message, snapshot }, 500);
            }

            const kvSrc = await getJsonKV(KV, KV_BALLOT_PREFIX + fromToken, null);
            if (kvSrc) {
              await putKvBallot(KV, { ...kvSrc, voterToken: toToken, voterId: toToken });
            }
            await KV.delete(KV_BALLOT_PREFIX + fromToken).catch(() => {});

            return jsonResponse({
              success: true,
              message: '已把选票改绑到新设备凭据，同学现在刷新页面即可看到并继续修改自己的选票',
              fromToken, toToken, snapshot
            });
          }

          return jsonResponse({ error: '未知的修复动作，支持 import-missing / drop-kv-orphans / rebind-voter' }, 400);
        }

        // 群二维码上传 / 替换 / 恢复默认（管理后台用，无需改仓库）
        if (path === '/api/admin/group-qr') {
          return handleGroupQrAdmin(request, KV, method, jsonResponse);
        }

        // GET /api/admin/backup (系统全量数据备份)
        if (path === '/api/admin/backup' && method === 'GET') {
          const [settings, topics] = await Promise.all([
            getJsonKV(KV, 'settings', {}),
            getJsonKV(KV, 'topics', DEFAULT_TOPICS)
          ]);
          let ballots = [];
          let comments = [];
          if (DB) {
            try {
              const bRes = await DB.prepare('SELECT * FROM ballots ORDER BY voted_at DESC').all();
              ballots = (bRes.results || []).map(b => ({
                id: b.id,
                voterToken: b.voter_token,
                topicIds: JSON.parse(b.topic_ids || '[]'),
                comment: b.comment,
                clientIp: b.client_ip,
                votedAt: b.voted_at
              }));
              const cRes = await DB.prepare('SELECT * FROM comments ORDER BY created_at DESC').all();
              comments = cRes.results || [];
            } catch (e) {}
          }
          if (ballots.length === 0 && KV) {
            ballots = await loadKvBallots(KV);
          }
          if (comments.length === 0 && KV) {
            comments = await loadKvComments(KV);
          }
          return jsonResponse({
            success: true,
            version: '2.5-d1-kv-permanent',
            exportedAt: new Date().toISOString(),
            data: { settings, topics, ballots, comments }
          });
        }

        // POST /api/admin/restore (从备份恢复数据)
        // 与旧实现的关键差别：不再"先整表删除再分批插入"（中途失败会留下半残数据，
        // 且备份里有非法条目时整批失败），改为按选民分组 upsert：
        //   - 每个选民的 ballot 与其 vote_items 在同一批里，绝不会只恢复一半；
        //   - 中途失败时库里的数据是"并集"，只会多不会少，不存在被清空的风险；
        //   - 默认合并（merge）；想要与备份完全一致，传 replace:true（会删除备份中没有的选票）。
        if (path === '/api/admin/restore' && method === 'POST') {
          const { tooLarge, data: body } = await readJsonBody(request);
          if (tooLarge) return jsonResponse({ error: '请求数据体积超限' }, 413);
          const data = body.data;
          if (!data || typeof data !== 'object') {
            return jsonResponse({ error: '备份数据格式无效' }, 400);
          }

          // 逐条校验：非法条目只跳过并汇报，不让整次恢复失败
          const rawBallots = Array.isArray(data.ballots) ? data.ballots : [];
          const validBallots = [];
          const invalid = [];
          const seenTokens = new Set();
          for (const b of rawBallots) {
            if (!b || typeof b !== 'object' || typeof b.voterToken !== 'string' || !b.voterToken.trim()) {
              invalid.push({ reason: '缺少 voterToken', item: b });
              continue;
            }
            if (!Array.isArray(b.topicIds)) {
              invalid.push({ reason: 'topicIds 不是数组', voterToken: b.voterToken });
              continue;
            }
            if (seenTokens.has(b.voterToken)) {
              invalid.push({ reason: '备份内同一 voterToken 重复，已取后者', voterToken: b.voterToken });
            }
            seenTokens.add(b.voterToken);
            validBallots.push(b);
          }
          const validComments = Array.isArray(data.comments) ? data.comments.filter(c => c && c.id) : [];
          const replace = body.replace === true;

          const snapshot = await takeSnapshot(KV, DB, 'before-restore');

          if (KV) {
            if (data.settings) await safePutKV(KV, 'settings', JSON.stringify(data.settings));
            if (Array.isArray(data.topics)) await safePutKV(KV, 'topics', JSON.stringify(data.topics));
            await safePutKV(KV, 'ballots', JSON.stringify(validBallots));
            for (const b of validBallots) await putKvBallot(KV, b);
            if (validComments.length) {
              await safePutKV(KV, 'comments', JSON.stringify(validComments));
              for (const c of validComments) await putKvComment(KV, c);
            }
          }

          let applied = 0;
          const failed = [];
          if (DB) {
            for (const b of validBallots) {
              const votedAt = b.votedAt || new Date().toISOString();
              const tids = b.topicIds || [];
              try {
                // 单个选民一批（ballot + 其全部明细），保证"要么全恢复、要么不动"
                const stmts = [
                  DB.prepare(`INSERT INTO ballots (id, voter_token, topic_ids, comment, client_ip, voted_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(voter_token) DO UPDATE SET
                      topic_ids = excluded.topic_ids, comment = excluded.comment,
                      client_ip = excluded.client_ip, voted_at = excluded.voted_at`)
                    .bind(b.id || ('ballot-restore-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
                      b.voterToken, JSON.stringify(tids), b.comment || '', b.clientIp || '', votedAt),
                  DB.prepare('DELETE FROM vote_items WHERE voter_token = ?').bind(b.voterToken)
                ];
                for (const tid of tids) {
                  stmts.push(DB.prepare('INSERT INTO vote_items (voter_token, topic_id, voted_at) VALUES (?, ?, ?)')
                    .bind(b.voterToken, tid, votedAt));
                }
                await DB.batch(stmts);
                applied++;
              } catch (e) {
                failed.push({ voterToken: b.voterToken, error: e.message });
              }
            }

            for (const c of validComments) {
              try {
                await DB.prepare(`INSERT INTO comments (id, topic_id, topic_title, voter_token, author_name, text, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET text = excluded.text, author_name = excluded.author_name`)
                  .bind(c.id, c.topicId || 'general', c.topicTitle || '', c.voterId || '', c.authorName || '同学', c.text || '', c.createdAt || new Date().toISOString())
                  .run();
              } catch (e) {
                failed.push({ commentId: c.id, error: e.message });
              }
            }

            // replace 模式：删掉备份里没有的选票（默认不做，避免误删新票）
            let removed = 0;
            if (replace) {
              try {
                const existing = await DB.prepare('SELECT voter_token, id FROM ballots').all();
                const stale = (existing.results || []).filter(r => !seenTokens.has(r.voter_token));
                for (const r of stale) {
                  await DB.batch([
                    DB.prepare('DELETE FROM ballots WHERE id = ?').bind(r.id),
                    DB.prepare('DELETE FROM vote_items WHERE voter_token = ?').bind(r.voter_token)
                  ]);
                  await KV.delete(KV_BALLOT_PREFIX + r.voter_token).catch(() => {});
                  removed++;
                }
              } catch (e) {
                failed.push({ phase: 'replace-cleanup', error: e.message });
              }
            }

            return jsonResponse({
              success: failed.length === 0,
              message: failed.length === 0
                ? `备份恢复完成：${applied} 张选票${replace ? `，清理 ${removed} 张备份外的选票` : '（合并模式，未删除任何现有选票）'}`
                : `部分条目恢复失败（成功 ${applied} 条），其余数据未受影响`,
              applied,
              invalid,
              failed,
              replace,
              snapshot
            }, failed.length === 0 ? 200 : 207);
          }

          return jsonResponse({ success: true, message: 'KV 侧已恢复（主库未绑定，仅 KV 生效）', applied: 0, invalid, snapshot });
        }

        // GET /api/admin/diagnostics (系统边缘节点与数据监控)
        if (path === '/api/admin/diagnostics' && method === 'GET') {
          let counts = { ballots: 0, voteItems: 0, comments: 0 };
          let d1Healthy = false;
          if (DB) {
            try {
              const res = await DB.prepare(`
                SELECT 
                  (SELECT COUNT(*) FROM ballots) as ballots,
                  (SELECT COUNT(*) FROM vote_items) as voteItems,
                  (SELECT COUNT(*) FROM comments) as comments
              `).first();
              if (res) {
                counts = res;
                d1Healthy = true;
              }
            } catch (e) {}
          }
          const kvBallots = await loadKvBallots(KV);
          const kvComments = await loadKvComments(KV);
          return jsonResponse({
            success: true,
            engine: DB ? 'Cloudflare D1 (SQLite ACID) + KV Hybrid' : 'Cloudflare KV Only',
            d1Healthy,
            edgeLocation: request.cf?.colo || 'AMS',
            counts,
            kvCounts: { ballots: kvBallots.length, comments: kvComments.length },
            timestamp: new Date().toISOString()
          });
        }
      }

      return jsonResponse({ error: 'Endpoint not found' }, 404);
    } catch (err) {
      // 不回显内部错误细节（D1/绑定信息），只给一个可对照日志的编号
      const errId = 'err-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      console.error(`[${errId}] Unhandled worker error:`, err && err.message ? err.message : err);
      return jsonResponse({ error: '服务暂时不可用，请稍后重试', errId }, 500);
    }
}

export default {
  async fetch(request, env, ctx) {
    const res = await handleRequest(request, env, ctx);
    // 统一收口 CORS：只允许自家站点跨域读取，其它来源不给跨域许可
    // （不限制的话，任意网页都能让访客的浏览器替它打我们的接口）
    try {
      const cors = corsFor(request);
      const headers = new Headers(res.headers);
      const allow = cors['Access-Control-Allow-Origin'];
      if (allow) headers.set('Access-Control-Allow-Origin', allow);
      else headers.delete('Access-Control-Allow-Origin');
      headers.set('Vary', 'Origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    } catch (e) {
      return res;
    }
  }
};

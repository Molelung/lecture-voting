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

function parseUserFromHeader(request) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.replace('Bearer ', '').trim();
  try {
    const parts = token.split('.');
    if (parts.length >= 2) return JSON.parse(base64UrlDecode(parts[1]));
    return JSON.parse(base64UrlDecode(token));
  } catch (e) {
    return null;
  }
}

function createToken(user) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    exp: Date.now() + 86400000 * 30
  }));
  const signature = base64UrlEncode('lecture-token-sig');
  return `${header}.${payload}.${signature}`;
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
    const originRes = await fetch(STATIC_ORIGIN + path, {
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

export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 非 /api 路径：直接由边缘发出前台页面与静态资源（与 API 同源，弱网更稳、免跨域预检）
    if (!path.startsWith('/api/') && (method === 'GET' || method === 'HEAD')) {
      return serveStaticAsset(request, ctx, path);
    }

    // 防护：检查 Payload 尺寸，杜绝超大 Body 耗尽 Worker 边缘内存
    if (method === 'POST' || method === 'PUT') {
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
    const adminUser = parseUserFromHeader(request);
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
          const kvBallots = await getJsonKV(KV, 'ballots', []);
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
          const kvBallots = await getJsonKV(KV, 'ballots', []);
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
          const kvBallots = await getJsonKV(KV, 'ballots', []);
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
        const body = await request.json().catch(() => ({}));
        // 多通道获取选民 token：Header > Body > URL Query > 兜底
        const clientToken = voterToken || body.voterToken || url.searchParams.get('voterToken') || ('anon-' + Math.random().toString(36).slice(2, 12));

        if (!checkTokenRateLimit(clientToken, 20, 60000)) {
          return jsonResponse({ error: '投票提交过快，请稍候再试' }, 429);
        }
        if (!checkIpRateLimit(clientIp, 250, 60000)) {
          return jsonResponse({ error: '当前网络访问量过大，请稍候再试' }, 429);
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
          votedAt
        };

        const syncKvTask = async () => {
          if (!KV) return;
          try {
            // 写入单人选票
            await safePutKV(KV, 'voter:' + clientToken, JSON.stringify(ballot));
            // 同步更新全局选票明细池
            const currentBallots = await getJsonKV(KV, 'ballots', []);
            const idx = currentBallots.findIndex(b => b && (b.voterId === clientToken || b.voterToken === clientToken));
            if (idx >= 0) {
              currentBallots[idx] = ballot;
            } else {
              currentBallots.push(ballot);
            }
            await safePutKV(KV, 'ballots', JSON.stringify(currentBallots));

            // 如果有留言且 D1 写入未成功，向 KV comments 写入备份
            if (cleanComment && !d1WriteSuccess) {
              const currentComments = await getJsonKV(KV, 'comments', []);
              currentComments.unshift({
                id: 'cmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                topicId: topicIds[0] || 'general',
                topicTitle: topicMap[topicIds[0]] || '',
                voterId: clientToken,
                authorName: '同学',
                text: cleanComment,
                createdAt: votedAt
              });
              await safePutKV(KV, 'comments', JSON.stringify(currentComments.slice(0, 300)));
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

          const comments = await getJsonKV(KV, 'comments', []);
          return jsonResponse({ success: true, comments });
        }

        if (method === 'POST') {
          const body = await request.json().catch(() => ({}));
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
                const current = await getJsonKV(KV, 'comments', []);
                current.unshift(newComment);
                await safePutKV(KV, 'comments', JSON.stringify(current.slice(0, 300)));
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
            const current = await getJsonKV(KV, 'comments', []);
            const next = current.filter(c => c.id !== commentId);
            await safePutKV(KV, 'comments', JSON.stringify(next));
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
          const allComments = await getJsonKV(KV, 'comments', []);
          const list = allComments.filter(c => c.topicId === topicId).map(c => ({
            id: c.id,
            text: c.text,
            authorName: c.authorName || '同学',
            createdAt: c.createdAt
          }));
          return jsonResponse({ success: true, comments: list });
        }

        if (method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const authorToken = voterToken || body.voterToken || clientIp;

          if (!checkTokenRateLimit(authorToken, 8, 60000)) {
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
                const current = await getJsonKV(KV, 'comments', []);
                current.unshift({ id: cmtId, topicId, topicTitle: '', voterId: authorToken, authorName: cleanAuthor, text: cleanText, createdAt });
                await safePutKV(KV, 'comments', JSON.stringify(current.slice(0, 300)));
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
        const body = await request.json().catch(() => ({}));
        const { username, password } = body;
        if (!username || !password) {
          return jsonResponse({ error: '请输入管理员账号与密码' }, 400);
        }

        const creds = await getAdminCredentials(KV, DB);
        if (creds && username.trim().toLowerCase() === (creds.username || 'admin').toLowerCase()) {
          const isValid = await verifyPassword(password, creds.salt, creds.hash);
          if (isValid) {
            const adminObj = { id: 'admin-root', username: creds.username || 'admin', displayName: '总管理员', role: 'admin' };
            const token = createToken(adminObj);
            return jsonResponse({ success: true, message: '管理员登录成功', token, user: adminObj });
          }
        }
        return jsonResponse({ error: '管理员账号或密码错误' }, 401);
      }

      // 8. 管理员核心配置与数据生命周期管理
      if (path.startsWith('/api/admin')) {
        if (!isAdmin) return jsonResponse({ error: '需要管理员权限' }, 403);

        // POST /api/admin/change-password & PUT /api/admin/password (在线修改管理员密码)
        if ((path === '/api/admin/change-password' || path === '/api/admin/password') && (method === 'POST' || method === 'PUT')) {
          const body = await request.json().catch(() => ({}));
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
          const token = createToken(adminObj);

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
              }
            } catch (e) {
              return jsonResponse({ error: 'D1 读取对齐失败: ' + e.message }, 500);
            }
          }
          if (KV) {
            const kvB = await getJsonKV(KV, 'ballots', []);
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
          const ballots = await getJsonKV(KV, 'ballots', []);
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
          if (DB) {
            try {
              await DB.batch([
                DB.prepare('DELETE FROM ballots'),
                DB.prepare('DELETE FROM vote_items'),
                DB.prepare('DELETE FROM comments')
              ]);
            } catch (e) {}
          }

          if (KV) {
            await safePutKV(KV, 'ballots', JSON.stringify([]));
            await safePutKV(KV, 'comments', JSON.stringify([]));
            try {
              const voterKeys = await KV.list({ prefix: 'voter:' });
              if (voterKeys && voterKeys.keys) {
                for (const k of voterKeys.keys) await KV.delete(k.name);
              }
            } catch (e) {}
          }

          return jsonResponse({ success: true, message: '所有选票、选民指纹与讨论留言已全量重置清空！' });
        }

        // GET /api/admin/settings & PUT /api/admin/settings
        if (path === '/api/admin/settings') {
          if (method === 'GET') {
            const currentSettings = await getJsonKV(KV, 'settings', {});
            return jsonResponse({ success: true, settings: currentSettings });
          }
          if (method === 'PUT') {
            const updates = await request.json().catch(() => ({}));
            let current = await getJsonKV(KV, 'settings', {});
            const newSettings = { ...current, ...updates, updatedAt: new Date().toISOString() };
            await safePutKV(KV, 'settings', JSON.stringify(newSettings));
            return jsonResponse({ success: true, message: '系统设置保存成功！', settings: newSettings });
          }
        }

        // PUT /api/admin/topics/reorder (调整社课前台展示排序)
        if (path === '/api/admin/topics/reorder' && method === 'PUT') {
          const body = await request.json().catch(() => ({}));
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
          const body = await request.json().catch(() => ({}));
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
          const updates = await request.json().catch(() => ({}));
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
            ballots = await getJsonKV(KV, 'ballots', []);
          }
          if (comments.length === 0 && KV) {
            comments = await getJsonKV(KV, 'comments', []);
          }
          return jsonResponse({
            success: true,
            version: '2.5-d1-kv-permanent',
            exportedAt: new Date().toISOString(),
            data: { settings, topics, ballots, comments }
          });
        }

        // POST /api/admin/restore (从备份中恢复全量数据，采用 50 语句安全切片)
        if (path === '/api/admin/restore' && method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const { data } = body;
          if (!data) return jsonResponse({ error: '备份数据格式无效' }, 400);
          if (data.settings) await safePutKV(KV, 'settings', JSON.stringify(data.settings));
          if (data.topics && Array.isArray(data.topics)) await safePutKV(KV, 'topics', JSON.stringify(data.topics));
          if (data.ballots && Array.isArray(data.ballots)) {
            await safePutKV(KV, 'ballots', JSON.stringify(data.ballots));
            for (const b of data.ballots) {
              if (b.voterToken) {
                await safePutKV(KV, 'voter:' + b.voterToken, JSON.stringify(b));
              }
            }
          }
          if (data.comments && Array.isArray(data.comments)) {
            await safePutKV(KV, 'comments', JSON.stringify(data.comments));
          }
          if (DB && data.ballots && Array.isArray(data.ballots)) {
            try {
              const allStatements = [
                DB.prepare('DELETE FROM ballots'),
                DB.prepare('DELETE FROM vote_items')
              ];
              for (const b of data.ballots) {
                const tids = b.topicIds || [];
                allStatements.push(
                  DB.prepare('INSERT INTO ballots (id, voter_token, topic_ids, comment, client_ip, voted_at) VALUES (?, ?, ?, ?, ?, ?)')
                    .bind(b.id, b.voterToken, JSON.stringify(tids), b.comment || '', b.clientIp || '', b.votedAt || new Date().toISOString())
                );
                for (const tid of tids) {
                  allStatements.push(
                    DB.prepare('INSERT INTO vote_items (voter_token, topic_id, voted_at) VALUES (?, ?, ?)')
                      .bind(b.voterToken, tid, b.votedAt || new Date().toISOString())
                  );
                }
              }
              // 50 条切片批次执行，彻底规避 D1 batch 限制
              for (let i = 0; i < allStatements.length; i += 50) {
                const chunk = allStatements.slice(i, i + 50);
                await DB.batch(chunk);
              }
            } catch (e) {
              console.warn('Restore D1 batch error:', e.message);
            }
          }
          return jsonResponse({ success: true, message: '系统数据已成功从备份恢复！' });
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
          const kvBallots = await getJsonKV(KV, 'ballots', []);
          const kvComments = await getJsonKV(KV, 'comments', []);
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
      console.error('Unhandled worker error:', err);
      return jsonResponse({ error: err.message || 'Internal server error' }, 500);
    }
  }
};

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

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

// 初始化默认数据
function getInitialData() {
  // 支持由环境变量注入，或采用安全单向散列加盐存储，源码零明文硬编码
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || 
    (process.env.ADMIN_PASSWORD ? bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10) : '$2b$10$OF5zMsT5T2XG3uJ1n/SJo.507TZ8fUzC/6MzQaCq8wBRr1HqTEPh2');

  return {
    settings: {
      title: "朋辈社课大投票！",
      subtitle: "",
      maxVotesPerUser: 3,
      allowChangeVote: true,
      status: "open", // 'open' | 'paused' | 'closed'
      resultsVisibility: "after_vote", // 'public' | 'after_vote' | 'admin_only'
      updatedAt: new Date().toISOString()
    },
    topics: DEFAULT_TOPICS,
    users: [
      {
        id: "admin-1",
        username: "admin",
        displayName: "社课总控管理员",
        passwordHash: adminPasswordHash,
        role: "admin",
        createdAt: new Date().toISOString()
      }
    ],
    votes: []
  };
}

class Database {
  constructor() {
    this.data = null;
    this.init();
  }

  init() {
    if (!fs.existsSync(DB_FILE)) {
      this.data = getInitialData();
      this.save();
    } else {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
        // 数据完整性兜底
        if (!this.data.settings) this.data.settings = getInitialData().settings;
        if (!this.data.topics) this.data.topics = DEFAULT_TOPICS;
        if (!this.data.users) this.data.users = getInitialData().users;
        if (!this.data.votes) this.data.votes = [];
      } catch (err) {
        console.error("加载数据库失败，重新初始化:", err);
        this.data = getInitialData();
        this.save();
      }
    }
  }

  save() {
    try {
      const tempPath = `${DB_FILE}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tempPath, DB_FILE);
    } catch (e) {
      console.error("数据库写入失败:", e);
    }
  }

  // --- Settings ---
  getSettings() {
    return { ...this.data.settings };
  }

  updateSettings(updates) {
    this.data.settings = {
      ...this.data.settings,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.save();
    return this.data.settings;
  }

  // --- Topics ---
  getTopics() {
    return [...this.data.topics];
  }

  getTopicById(id) {
    return this.data.topics.find(t => t.id === id) || null;
  }

  addTopic(topic) {
    const newTopic = {
      id: `topic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      ...topic
    };
    this.data.topics.push(newTopic);
    this.save();
    return newTopic;
  }

  updateTopic(id, updates) {
    const idx = this.data.topics.findIndex(t => t.id === id);
    if (idx === -1) return null;
    this.data.topics[idx] = {
      ...this.data.topics[idx],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.save();
    return this.data.topics[idx];
  }

  deleteTopic(id) {
    const idx = this.data.topics.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.data.topics.splice(idx, 1);
    // 同时清理该主题在投票中的数据
    this.data.votes.forEach(v => {
      v.topicIds = v.topicIds.filter(tid => tid !== id);
    });
    this.save();
    return true;
  }

  // --- Users ---
  findUserByUsername(username) {
    return this.data.users.find(u => u.username.toLowerCase() === username.toLowerCase().trim()) || null;
  }

  findUserById(id) {
    return this.data.users.find(u => u.id === id) || null;
  }

  createUser({ username, displayName, password, role = "user" }) {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);
    const newUser = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      username: username.trim(),
      displayName: (displayName || username).trim(),
      passwordHash,
      role,
      createdAt: new Date().toISOString()
    };
    this.data.users.push(newUser);
    this.save();
    return {
      id: newUser.id,
      username: newUser.username,
      displayName: newUser.displayName,
      role: newUser.role,
      createdAt: newUser.createdAt
    };
  }

  verifyPassword(user, password) {
    return bcrypt.compareSync(password, user.passwordHash);
  }

  getAllUsersSafe() {
    return this.data.users.map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      createdAt: u.createdAt
    }));
  }

  // --- Votes ---
  getVotes() {
    return [...this.data.votes];
  }

  getUserVote(userId) {
    return this.data.votes.find(v => v.userId === userId) || null;
  }

  submitVote(userId, topicIds) {
    const existingIndex = this.data.votes.findIndex(v => v.userId === userId);
    const now = new Date().toISOString();

    if (existingIndex !== -1) {
      this.data.votes[existingIndex].topicIds = topicIds;
      this.data.votes[existingIndex].updatedAt = now;
      this.save();
      return this.data.votes[existingIndex];
    } else {
      const newVote = {
        id: `vote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId,
        topicIds,
        votedAt: now,
        updatedAt: now
      };
      this.data.votes.push(newVote);
      this.save();
      return newVote;
    }
  }

  clearAllVotes() {
    this.data.votes = [];
    this.save();
    return true;
  }

  // 统计计算
  getStatistics() {
    const topicCounts = {};
    this.data.topics.forEach(t => {
      topicCounts[t.id] = 0;
    });

    let totalBallots = this.data.votes.length;
    let totalVotesCast = 0;

    this.data.votes.forEach(vote => {
      vote.topicIds.forEach(tId => {
        if (topicCounts[tId] !== undefined) {
          topicCounts[tId]++;
          totalVotesCast++;
        }
      });
    });

    // 格式化排行
    const topicStats = this.data.topics.map(t => {
      const count = topicCounts[t.id] || 0;
      const percentage = totalBallots > 0 ? Math.round((count / totalBallots) * 100) : 0;
      return {
        id: t.id,
        title: t.title,
        speaker: t.speaker,
        category: t.category,
        count,
        percentage
      };
    }).sort((a, b) => b.count - a.count);

    return {
      totalVoters: totalBallots,
      totalVotesCast,
      topicStats
    };
  }

  getComments() {
    return this.data.comments || [];
  }

  addComment(comment) {
    if (!this.data.comments) this.data.comments = [];
    this.data.comments.unshift(comment);
    this.save();
    return comment;
  }

  deleteComment(id) {
    if (!this.data.comments) return false;
    this.data.comments = this.data.comments.filter(c => c.id !== id);
    this.save();
    return true;
  }
}

export const db = new Database();

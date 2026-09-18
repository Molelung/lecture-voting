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
    "speaker": "朋辈社课组",
    "category": "向内",
    "tag": "自我疗愈",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "停止向内攻击与无谓苛责，允许脆弱，是对自己最深沉的关照。",
    "summary": "真正的爱自己并非消费主义层面的即时犒劳，而是建立在自我关怀（Self-Compassion）与无条件自我接纳之上的心智实践。本课围绕自我友善、普遍人性感知与正念觉察，探讨如何停止苛刻的“内在批判者”对话，在遭遇挫折与心理内耗时重构安全的内心据点，实现深层的自我疗愈与能量回流。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:01.000Z"
  },
  {
    "id": "topic-2",
    "title": "【向内】你想要怎样的人生？",
    "speaker": "朋辈社课组",
    "category": "向内",
    "tag": "自我认同",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "在外界喧嚣的期待中，找寻内心未曾磨灭的自我同一性与人生坐标。",
    "summary": "从埃里克森的自我同一性（Self-Identity）危机与马西亚的认同状态模型出发，审视我们是在追逐外界赋予的“应当”，还是在探索自我的本质。课程结合价值澄清（Values Clarification）与内在动机理论，引导大家厘清核心生命价值，在迷茫与不确定性中确立属于自己的秩序感与人生航向。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:02.000Z"
  },
  {
    "id": "topic-3",
    "title": "【向内】类型心理学",
    "speaker": "朋辈社课组",
    "category": "向内",
    "tag": "人格类型",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "标签不是禁锢心智的牢笼，而是理解认知偏好与心智运转的一扇窗。",
    "summary": "破除快餐文化中标签化的刻板印象，以荣格的心理类型论（Psychological Types）与现代大五人格模型（Big Five）为坐标轴，简明通透地剖析内倾与外倾、感觉与直觉等认知功能偏好。帮助大家建立清晰的自我心智画像，理解个体差异背后的机能运转，学会扬长避短并达成与他人的深度共情。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:03.000Z"
  },
  {
    "id": "topic-4",
    "title": "【向内】翻山越岭时",
    "speaker": "朋辈社课组",
    "category": "向内",
    "tag": "阿德勒心理学",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "决定我们的不是过去的经历，而是我们为这段经历赋予的目的与意义。",
    "summary": "基于阿尔弗雷德·阿德勒的个体心理学，打破“原因论”的宿命束缚，转向以目的论（Teleology）重新诠释当下的选择与困顿。深度解构课题分离（Separation of Tasks）与共同体感觉，帮助我们在复杂的人际期待与现实羁绊面前建立坚韧的心灵边界，汲取奔赴自我人生的主观勇气。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:04.000Z"
  },
  {
    "id": "topic-5",
    "title": "【向内】梦之迷思",
    "speaker": "朋辈社课组",
    "category": "向内",
    "tag": "精神分析",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "梦是白昼压抑的情绪与愿望，在黑夜披上隐喻的伪装。",
    "summary": "循着经典精神分析（Psychoanalysis）的深邃脉络，探索弗洛伊德笔下“通往潜意识的康庄大道”。深度解析显梦与隐意背后的凝缩、移置与象征等心理防御机制（Defense Mechanisms），并结合认知神经科学对快速眼动睡眠（REM）的研究，揭示梦境在情绪整合与自我整合层面的潜意识密码。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:05.000Z"
  },
  {
    "id": "topic-6",
    "title": "【向内】我们本为矛盾集合体",
    "speaker": "朋辈社课组",
    "category": "向内",
    "tag": "神经症结",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "直面内在的冲突与拉扯，接纳不完美的真实，心智才得以舒展。",
    "summary": "立足卡伦·霍妮的神经症人格理论，剖析我们在“亲近人、反抗人、回避人”三种基本态度间的摇摆与内心冲突。深度探讨理想化自我意象（Idealized Self-Image）与真实自我之间的剧烈撕裂，剖析内疚感、病态焦虑与强迫性追求的深层症结，学会接纳矛盾本性，走向真实的内在和谐。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:06.000Z"
  },
  {
    "id": "topic-7",
    "title": "【向内】考试在考些什么！",
    "speaker": "朋辈社课组",
    "category": "向内",
    "tag": "考试脑科学",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "考试不是记忆的死板搬运，而是大脑神经突触重构与高效调取的博弈。",
    "summary": "跳出死记硬背与盲目刷题的低效陷阱，从认知心理学与认知神经科学（Cognitive Neuroscience）的视角拆解学习本质。深度剖析海马体记忆编码、工作记忆容量限制与测试效应（Testing Effect），传授如何运用间隔检索与神经可塑性原理抵抗遗忘曲线，在高压考核中保持理性清醒与认知韧性。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:07.000Z"
  },
  {
    "id": "topic-8",
    "title": "【向内】当人生的丘比特",
    "speaker": "朋辈社课组",
    "category": "向内",
    "tag": "青春期与爱情",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "读懂心动背后的神经密码，学会在亲密的彼此连接中安放独立的灵魂。",
    "summary": "从斯滕伯格的爱情三元论（Triangular Theory of Love，涵盖亲密、激情、承诺）与依恋风格（Attachment Styles）展开，探讨青春期荷尔蒙、多巴胺奖赏回路与心智成长交织的情感萌动。理性剖析理想化投射、人际边界与依恋冲突，帮助大家理解心动的本质，掌握构建成熟、真诚且互相滋养的亲密关系心法。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:08.000Z"
  }
];

// 初始化默认数据
function getInitialData() {
  const salt = bcrypt.genSaltSync(10);
  const adminPasswordHash = bcrypt.hashSync('admin123', salt);

  return {
    settings: {
      title: "朋辈社课大投票！",
      subtitle: "",
      maxVotesPerUser: 3,
      allowChangeVote: true,
      status: "open", // 'open' | 'paused' | 'closed'
      resultsVisibility: "public", // 'public' | 'after_vote' | 'admin_only'
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

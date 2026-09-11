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
    id: "topic-1",
    title: "认知偏差与日常决策：为什么聪明人也会犯傻？",
    speaker: "学术研讨组 · 心理方向",
    category: "认知决策",
    tag: "热门推荐",
    duration: "45分钟 + 15分钟互动讨论",
    summary: "从卡尼曼《思考，快与慢》出发，剖析锚定效应、可得性偏差与损失厌恶，掌握一套在选课、消费与生涯选择中避免被直觉误导的思维工具箱。",
    outline: [
      "系统 1 与系统 2：直觉与理性的神经机制较量",
      "经典盲区：锚定效应、确认偏误与幸存者偏差拆解",
      "日常生活与人际决策中的“框架陷阱”与识破技巧",
      "思维去偏差化（De-biasing）四步实操练习"
    ],
    accentColor: "from-blue-500/20 to-cyan-500/20",
    createdAt: new Date().toISOString()
  },
  {
    id: "topic-2",
    title: "战胜拖延与精神内耗：神经科学与行为设计实操",
    speaker: "朋辈研习社 · 发展部",
    category: "自我效能",
    tag: "高票心声",
    duration: "40分钟 + 20分钟行动工作坊",
    summary: "为什么懂得那么多道理依然拖延？揭秘前额叶皮层与杏仁核的生理博弈，打破内耗循环，带走立即可落地的“微步启动法”。",
    outline: [
      "拖延不是态度问题，是情绪调节的生理防御机制",
      "多巴胺与及时反馈：现代社交媒体如何重塑注意力",
      "打破“全或无”完美主义内耗的认知重塑策略",
      "现场搭建：2分钟启动法、环境摩擦力设计与习惯回路"
    ],
    accentColor: "from-indigo-500/20 to-purple-500/20",
    createdAt: new Date().toISOString()
  },
  {
    id: "topic-3",
    title: "博弈论与人际合作：囚徒困境与生活中的最优策略",
    speaker: "朋辈通识组 · 交叉学科",
    category: "社会博弈",
    tag: "硬核有趣",
    duration: "50分钟 + 10分钟问答",
    summary: "用数学与演化博弈的眼光审视人际关系与合作竞争。从囚徒困境到重复博弈，理解为什么“善良且有底线”是演化中最优的长期策略。",
    outline: [
      "经典囚徒困境：个人理性为何容易导向集体悲剧？",
      "阿克塞尔罗德的电脑锦标赛：一报还一报（Tit-for-Tat）为何横扫全场？",
      "生活博弈：宿舍分工、团队合作与利益谈判中的策略制定",
      "在不确定的环境中，如何建立高信誉度的人际合作网络"
    ],
    accentColor: "from-emerald-500/20 to-teal-500/20",
    createdAt: new Date().toISOString()
  },
  {
    id: "topic-4",
    title: "亲密依恋与人际沟通：读懂彼此的情感连接模式",
    speaker: "心理咨询与辅导助理组",
    category: "人际情感",
    tag: "温暖治愈",
    duration: "45分钟 + 15分钟心声交流",
    summary: "了解安全型、焦虑型与回避型依恋在亲情、友情与恋爱中的投射。学会识别情绪暗语，运用非暴力沟通化解冲突、建立深层信任。",
    outline: [
      "依恋理论的前世今生：童年印记与成年后的人际投射",
      "焦虑型 vs 回避型：亲密关系中“追逃游戏”的破解钥匙",
      "非暴力沟通四要素：观察、感受、需要、请求的实操训练",
      "建立心理安全岛：自我接纳与健康人际边界的确立"
    ],
    accentColor: "from-rose-500/20 to-pink-500/20",
    createdAt: new Date().toISOString()
  },
  {
    id: "topic-5",
    title: "深度工作与心流探索：注意力经济时代的高效专注法",
    speaker: "效率研习社 · 朋辈导师",
    category: "认知提升",
    tag: "硬核干货",
    duration: "40分钟 + 15分钟演示",
    summary: "在碎片化与信息轰炸的时代，如何重新夺回注意力的主导权？深入心流通道理论，构建无干扰的深度工作系统与知识整理心法。",
    outline: [
      "心流通道条件：技能水平与挑战难度的精密匹配",
      "信息茧房与多巴胺剥夺实验：降低认知过载的数字极简主义",
      "构建个人深度工作仪式感与阻断干扰的物理屏障",
      "从被动刷屏到主动输出的知识内化模型"
    ],
    accentColor: "from-amber-500/20 to-orange-500/20",
    createdAt: new Date().toISOString()
  },
  {
    id: "topic-6",
    title: "批判性思维与信息甄别：在这个时代如何独立思考",
    speaker: "社课通识部 · 科学素养组",
    category: "思维素养",
    tag: "思辨必修",
    duration: "45分钟 + 15分钟辩难",
    summary: "网络信息泥沙俱下，如何辨识偷换概念、诉诸情感与虚假因果？掌握科学哲学检验法，做一个清醒独立、不随波逐流的思考者。",
    outline: [
      "常见逻辑谬误大赏：滑坡谬误、稻草人论证、虚假两难",
      "相关不等于因果：科学研究与媒体标题党的话术拆解",
      "信息源三级评级：从自媒体短视频到一手同行评审论文",
      "心智防御工事：面对热点事件时的反向思考与事实核查路径"
    ],
    accentColor: "from-violet-500/20 to-purple-500/20",
    createdAt: new Date().toISOString()
  }
];

// 初始化默认数据
function getInitialData() {
  const salt = bcrypt.genSaltSync(10);
  const adminPasswordHash = bcrypt.hashSync('admin123', salt);

  return {
    settings: {
      title: "【朋辈】社团学期公开社课投票",
      subtitle: "精选候选主题，由大家投票决定本期社课的开讲顺序与深度！每人可投 1~3 票。",
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
}

export const db = new Database();

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

const DEFAULT_TOPICS = [];

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

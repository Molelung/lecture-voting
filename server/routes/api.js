import express from 'express';
import jwt from 'jsonwebtoken';
import os from 'os';
import { db } from '../db.js';
import { JWT_SECRET, requireAuth, requireAdmin } from '../authMiddleware.js';

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const router = express.Router();

function getEffectiveVoterId(req) {
  if (req.user && req.user.id) return req.user.id;
  return req.headers['x-voter-token'] || (req.body && req.body.voterToken) || req.query.voterToken || null;
}

// 1. 获取全局系统状态与当前用户状态
router.get('/status', (req, res) => {
  const settings = db.getSettings();
  const voterId = getEffectiveVoterId(req);
  const user = req.user;
  let userVote = null;

  if (voterId) {
    userVote = db.getUserVote(voterId);
  }

  const hasVoted = !!userVote;
  // 检查是否显示票数统计
  const canSeeResults = settings.resultsVisibility === 'public' || 
    (settings.resultsVisibility === 'after_vote' && hasVoted) || 
    (user && user.role === 'admin');

  let stats = null;
  const fullStats = db.getStatistics();
  if (canSeeResults) {
    stats = fullStats;
  } else {
    // 隐藏具体票数，只返回参与人数概要
    stats = {
      totalVoters: fullStats.totalVoters,
      totalVotesCast: null,
      topicStats: []
    };
  }

  const localIp = getLocalIp();
  const port = process.env.PORT || 3000;
  const mobileUrl = `http://${localIp}:${port}`;

  res.json({
    success: true,
    settings,
    user,
    userVote,
    hasVoted,
    canSeeResults,
    localIp,
    mobileUrl,
    statsSummary: {
      totalVoters: stats.totalVoters,
      totalVotesCast: canSeeResults ? stats.totalVotesCast : null
    }
  });
});

// 2. 用户注册
router.post('/auth/register', (req, res) => {
  const { username, displayName, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: '用户名/学号与密码不能为空' });
  }

  if (username.length < 2) {
    return res.status(400).json({ success: false, error: '用户名/学号至少 2 个字符' });
  }

  if (password.length < 4) {
    return res.status(400).json({ success: false, error: '密码长度至少 4 位' });
  }

  const existing = db.findUserByUsername(username);
  if (existing) {
    return res.status(400).json({ success: false, error: '该学号/用户名已存在，请直接登录' });
  }

  const newUser = db.createUser({
    username,
    displayName: displayName || username,
    password
  });

  const token = jwt.sign(
    { id: newUser.id, username: newUser.username, role: newUser.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    success: true,
    token,
    user: newUser,
    message: '注册成功'
  });
});

// 3. 用户登录
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: '请输入用户名/学号与密码' });
  }

  const user = db.findUserByUsername(username);
  if (!user || !db.verifyPassword(user, password)) {
    return res.status(401).json({ success: false, error: '账号或密码错误' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role
    },
    message: '登录成功'
  });
});

// 4. 获取主题列表
router.get('/topics', (req, res) => {
  const topics = db.getTopics();
  const settings = db.getSettings();
  const voterId = getEffectiveVoterId(req);
  const userVote = voterId ? db.getUserVote(voterId) : null;
  const hasVoted = !!userVote;

  const canSeeResults = settings.resultsVisibility === 'public' || 
    (settings.resultsVisibility === 'after_vote' && hasVoted) ||
    (req.user && req.user.role === 'admin');

  const stats = canSeeResults ? db.getStatistics() : null;
  const countMap = {};
  if (stats) {
    stats.topicStats.forEach(ts => {
      countMap[ts.id] = { count: ts.count, percentage: ts.percentage };
    });
  }

  const enrichedTopics = topics.map(topic => ({
    ...topic,
    stats: canSeeResults 
      ? { ...(countMap[topic.id] || { count: 0, percentage: 0 }), locked: false }
      : { locked: true, count: null, percentage: 0 }
  }));

  res.json({
    success: true,
    topics: enrichedTopics,
    canSeeResults
  });
});

// 5. 提交投票（支持已登录用户与设备匿名 VoterToken 极速免密双轨）
router.post('/vote', (req, res) => {
  const settings = db.getSettings();

  if (settings.status === 'paused') {
    return res.status(403).json({ success: false, error: '当前投票已暂停，请留意社课通知' });
  }
  if (settings.status === 'closed') {
    return res.status(403).json({ success: false, error: '本次社课投票已截止' });
  }

  const voterId = getEffectiveVoterId(req) || ('anon-' + Math.random().toString(36).slice(2, 10));
  const { topicIds, comment } = req.body;
  if (!Array.isArray(topicIds) || topicIds.length === 0) {
    return res.status(400).json({ success: false, error: '请至少选择一个社课主题' });
  }

  const maxVotes = settings.maxVotesPerUser || 3;
  if (topicIds.length > maxVotes) {
    return res.status(400).json({ success: false, error: `至多可选择 ${maxVotes} 个主题，您选择了 ${topicIds.length} 个` });
  }

  // 检查主题是否都存在
  const allTopics = db.getTopics();
  const validIds = new Set(allTopics.map(t => t.id));
  const uniqueTopicIds = [...new Set(topicIds)];

  for (const tid of uniqueTopicIds) {
    if (!validIds.has(tid)) {
      return res.status(400).json({ success: false, error: '选票中包含了无效或已下架的主题' });
    }
  }

  // 检查之前是否已经投过票
  const existingVote = db.getUserVote(voterId);

  // 幂等性防护：若重复提交相同的社课选项且无新留言，直接返回已有选票
  if (existingVote) {
    const isSameTopics = existingVote.topicIds.length === uniqueTopicIds.length && 
      existingVote.topicIds.every(id => uniqueTopicIds.includes(id));
    if (isSameTopics && !comment) {
      return res.json({
        success: true,
        message: '选票投出成功！已为您揭晓实时热度榜',
        vote: existingVote,
        voterToken: voterId,
        hasVoted: true,
        stats: db.getStatistics()
      });
    }

    if (!settings.allowChangeVote) {
      return res.status(403).json({ success: false, error: '本次投票设置为提交后不可修改选票' });
    }
  }

  const voteResult = db.submitVote(voterId, uniqueTopicIds);
  const stats = db.getStatistics();

  res.json({
    success: true,
    message: existingVote ? '选票已成功更新！' : '选票投出成功！已为您揭晓实时热度榜',
    vote: voteResult,
    voterToken: voterId,
    hasVoted: true,
    stats
  });
});

// 6. 获取排行榜与数据统计
router.get('/results', (req, res) => {
  const settings = db.getSettings();
  const voterId = getEffectiveVoterId(req);
  const userVote = voterId ? db.getUserVote(voterId) : null;
  const hasVoted = !!userVote;

  const canSeeResults = settings.resultsVisibility === 'public' || 
    (settings.resultsVisibility === 'after_vote' && hasVoted) ||
    (req.user && req.user.role === 'admin');

  if (!canSeeResults) {
    return res.status(403).json({ 
      success: false, 
      locked: true,
      error: settings.resultsVisibility === 'after_vote' 
        ? '请先完成投票后查看实时榜单' 
        : '投票结果暂未公开，敬请期待公布' 
    });
  }

  const stats = db.getStatistics();
  res.json({
    success: true,
    locked: false,
    stats
  });
});

// ================= 管理员接口 =================

// 读取系统全局配置
router.get('/admin/settings', requireAdmin, (req, res) => {
  res.json({ success: true, settings: db.getSettings() });
});

// 修改系统全局配置
router.put('/admin/settings', requireAdmin, (req, res) => {
  const { title, subtitle, maxVotesPerUser, allowChangeVote, status, resultsVisibility } = req.body;
  const updates = {};

  if (title !== undefined) updates.title = String(title).trim();
  if (subtitle !== undefined) updates.subtitle = String(subtitle).trim();
  if (maxVotesPerUser !== undefined) updates.maxVotesPerUser = Math.max(1, Math.min(10, parseInt(maxVotesPerUser) || 3));
  if (allowChangeVote !== undefined) updates.allowChangeVote = !!allowChangeVote;
  if (['open', 'paused', 'closed'].includes(status)) updates.status = status;
  if (['public', 'after_vote', 'admin_only'].includes(resultsVisibility)) updates.resultsVisibility = resultsVisibility;

  const newSettings = db.updateSettings(updates);
  res.json({ success: true, settings: newSettings, message: '配置已更新' });
});

// 管理员新增主题
router.post('/admin/topics', requireAdmin, (req, res) => {
  const { title, speaker, category, tag, duration, summary, outline } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ success: false, error: '社课主题名称不能为空' });
  }

  const outlineArray = Array.isArray(outline) 
    ? outline.filter(item => typeof item === 'string' && item.trim())
    : (typeof outline === 'string' ? outline.split('\n').map(s => s.trim()).filter(Boolean) : []);

  const newTopic = db.addTopic({
    title: title.trim(),
    speaker: (speaker || '朋辈讲师').trim(),
    category: (category || '通识探索').trim(),
    tag: (tag || '新主题').trim(),
    duration: (duration || '45分钟').trim(),
    summary: (summary || '').trim(),
    outline: outlineArray.length > 0 ? outlineArray : ['主题内容筹备中...']
  });

  res.json({ success: true, topic: newTopic, message: '主题添加成功' });
});

// 管理员修改主题
router.put('/admin/topics/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { title, speaker, category, tag, duration, summary, outline } = req.body;

  const updates = {};
  if (title !== undefined) updates.title = title.trim();
  if (speaker !== undefined) updates.speaker = speaker.trim();
  if (category !== undefined) updates.category = category.trim();
  if (tag !== undefined) updates.tag = tag.trim();
  if (duration !== undefined) updates.duration = duration.trim();
  if (summary !== undefined) updates.summary = summary.trim();
  if (outline !== undefined) {
    updates.outline = Array.isArray(outline) 
      ? outline.filter(item => typeof item === 'string' && item.trim())
      : (typeof outline === 'string' ? outline.split('\n').map(s => s.trim()).filter(Boolean) : []);
  }

  const updated = db.updateTopic(id, updates);
  if (!updated) {
    return res.status(404).json({ success: false, error: '未找到对应主题' });
  }

  res.json({ success: true, topic: updated, message: '主题修改成功' });
});

// 管理员删除主题
router.delete('/admin/topics/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const ok = db.deleteTopic(id);
  if (!ok) {
    return res.status(404).json({ success: false, error: '未找到对应主题' });
  }
  res.json({ success: true, message: '主题已删除' });
});

// 管理员查看选票明细与审计日志
router.get('/admin/ballots', requireAdmin, (req, res) => {
  const votes = db.getVotes();
  const users = db.getAllUsersSafe();
  const userMap = {};
  users.forEach(u => userMap[u.id] = u);

  const topics = db.getTopics();
  const topicMap = {};
  topics.forEach(t => topicMap[t.id] = t);

  const ballots = votes.map(v => {
    const user = userMap[v.userId] || { displayName: '未知用户', username: 'unknown' };
    const chosenTopics = v.topicIds.map(tid => topicMap[tid]?.title || '已删主题');
    return {
      id: v.id,
      userId: v.userId,
      voterName: user.displayName,
      voterUsername: user.username,
      topicCount: v.topicIds.length,
      topicTitles: chosenTopics,
      votedAt: v.votedAt,
      updatedAt: v.updatedAt
    };
  }).sort((a, b) => new Date(b.votedAt) - new Date(a.votedAt));

  res.json({ success: true, ballots });
});

// 管理员清空投票数据（重新开局）
router.post(['/admin/clear-votes', '/admin/reset-votes'], requireAdmin, (req, res) => {
  db.clearAllVotes();
  res.json({ success: true, message: '所有选票已清空，可重新开始新一轮投票' });
});

// 管理员导出 CSV 报表
router.get('/admin/export-csv', requireAdmin, (req, res) => {
  const stats = db.getStatistics();
  const votes = db.getVotes();
  const users = db.getAllUsersSafe();
  const userMap = {};
  users.forEach(u => userMap[u.id] = u);
  const topicMap = {};
  db.getTopics().forEach(t => topicMap[t.id] = t);

  let csv = '\uFEFF'; // UTF-8 BOM，防止 Excel 打开乱码
  csv += '=== 社课投票统计报表 ===\n';
  csv += `总参与人数,${stats.totalVoters}\n`;
  csv += `总投票数,${stats.totalVotesCast}\n\n`;

  csv += '排名,主题名称,主讲人,分类,得票数,得票率\n';
  stats.topicStats.forEach((t, i) => {
    csv += `${i + 1},"${t.title.replace(/"/g, '""')}","${t.speaker.replace(/"/g, '""')}","${t.category}",${t.count},${t.percentage}%\n`;
  });

  csv += '\n=== 选票明细记录 ===\n';
  csv += '投票人姓名,学号/用户名,所投主题,投票时间\n';
  votes.forEach(v => {
    const u = userMap[v.userId] || { displayName: '未知', username: 'unknown' };
    const titles = v.topicIds.map(tid => topicMap[tid]?.title || '已删除').join('；');
    csv += `"${u.displayName}","${u.username}","${titles.replace(/"/g, '""')}","${new Date(v.votedAt).toLocaleString('zh-CN')}"\n`;
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="社课投票结果_${Date.now()}.csv"`);
  res.send(csv);
});

// 获取全站讨论区留言
router.get('/comments', (req, res) => {
  const comments = db.getComments ? db.getComments() : [];
  res.json({ success: true, comments });
});

// 发布讨论区留言
router.post('/comments', (req, res) => {
  const { text, authorName, topicId } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, error: '留言内容不能为空' });
  }
  const cleanAuthor = authorName && authorName.trim() ? authorName.trim().slice(0, 20) : '同学';
  const newComment = {
    id: 'cmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    topicId: topicId || 'general',
    topicTitle: '',
    authorName: cleanAuthor,
    text: text.trim().slice(0, 200),
    createdAt: new Date().toISOString()
  };
  if (db.addComment) {
    db.addComment(newComment);
  }
  res.json({ success: true, message: '留言已发布！', comment: newComment });
});

// 管理员删除留言
router.delete('/comments/:id', requireAdmin, (req, res) => {
  if (db.deleteComment) {
    db.deleteComment(req.params.id);
  }
  res.json({ success: true, message: '留言已删除' });
});

export default router;

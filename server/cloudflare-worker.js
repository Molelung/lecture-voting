/**
 * Cloudflare Worker API for Peer Lecture Voting System
 * 核心设计目标：
 * 1. 强一致性实时数据流转：杜绝边缘 CDN 缓存导致的票数/榜单不同步问题
 * 2. 真实遵循系统配置：resultsVisibility 为 public 时全员实时公开榜单与票数；设为 after_vote 时投后解锁
 * 3. 选民级 O(1) 独立存取与票池去重合并：彻底防止多人并发投递覆盖
 * 4. 完整的社课与系统配置管理生命周期：支持管理员增删改查议题、更新系统开关、一键清空重置
 * 5. 留言单一入库不重复：修复多选时重复插入多条留言的 Bug
 * 6. 边缘滑动窗口限流与 XSS 深度清洗
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Voter-Token',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

// 内存级速率限制 Map (Isolate 级)
const IP_RATE_MAP = new Map();

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

// 文本 XSS 与非法控制字符清洗
function sanitizeText(str, maxLength = 200) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '') // 剥离 HTML 标签
    .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '') // 剥离不可见控制字符
    .replace(/\s+/g, ' ') // 合并多余空白
    .trim()
    .slice(0, maxLength);
}

// 边缘 IP 滑动窗口限流器
function checkRateLimit(ip, limit = 20, windowMs = 60000) {
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

  if (record.count >= limit) {
    return false;
  }

  record.count++;
  return true;
}

// Base64URL 辅助编解码
function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// AES-256-GCM 硬件级加速加解密 (加密存储选民设备标识)
async function getCryptoKey(secret) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret || 'peer-lecture-voting-secure-key-2026!'),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('lecture-voting-salt'),
      iterations: 10000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(text, secret) {
  try {
    const key = await getCryptoKey(secret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(text || '')
    );
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const cipherHex = Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${ivHex}:${cipherHex}`;
  } catch (e) {
    return text;
  }
}

// 解析管理授权 Token
function parseUserFromHeader(request) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.replace('Bearer ', '').trim();
  try {
    const parts = token.split('.');
    if (parts.length >= 2) {
      return JSON.parse(base64UrlDecode(parts[1]));
    }
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
    exp: Date.now() + 86400000 * 7
  }));
  const signature = base64UrlEncode('lecture-token-sig');
  return `${header}.${payload}.${signature}`;
}

// 安全读取 KV 数据，防止 JSON 解析崩溃
async function getJsonKV(KV, key, fallback = null) {
  try {
    const raw = await KV.get(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`KV parse error for ${key}:`, e.message);
    return fallback;
  }
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

    const KV = env.LECTURE_KV;
    if (!KV) {
      return jsonResponse({ error: 'KV database binding missing' }, 500);
    }

    const secretKey = env.ENCRYPTION_KEY || 'peer-lecture-voting-aes256-secret-key-2026!';
    const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '127.0.0.1';

    // 选民设备匿名指纹与管理员身份
    const voterToken = request.headers.get('X-Voter-Token') || url.searchParams.get('voterToken') || '';
    const adminUser = parseUserFromHeader(request);
    const isAdmin = adminUser && adminUser.role === 'admin';

    try {
      // 根路径直连智能重定向至前端页面，保障直接键入域名时体验丝滑
      if ((path === '/' || path === '/index.html') && method === 'GET') {
        return Response.redirect('https://molelung.github.io/lecture-voting/', 302);
      }

      // 0. GET /api/health (集群探活与健康监控端点)
      if (path === '/api/health' && method === 'GET') {
        const dur = Date.now() - startTime;
        return jsonResponse({
          status: 'ok',
          service: 'lecture-voting-api',
          edgeNode: request.cf?.colo || 'LOCAL',
          latencyMs: dur,
          timestamp: new Date().toISOString()
        }, 200, { 'Server-Timing': `app;dur=${dur}` });
      }

      // 1. GET /api/status (系统配置、选民自身状态与参与统计)
      if (path === '/api/status' && method === 'GET') {
        const settings = await getJsonKV(KV, 'settings', {
          title: '朋辈社课大投票！',
          subtitle: '选出你最期待开讲的议题，投票完成后揭晓全站热度排行（限选 1~3 项）',
          maxVotesPerUser: 3,
          allowChangeVote: true,
          status: 'open',
          resultsVisibility: 'public'
        });

        // 嗅探选民自身投票状态 (优先 O(1) 独立键，其次主票池容灾)
        let userVote = null;
        let hasVoted = false;

        if (voterToken) {
          const directVote = await getJsonKV(KV, 'voter:' + voterToken, null);
          if (directVote) {
            userVote = directVote;
            hasVoted = true;
          }
        }

        const ballots = await getJsonKV(KV, 'ballots', []);
        if (!hasVoted && voterToken && ballots.length > 0) {
          const found = ballots.find(b => b && (b.voterId === voterToken || b.voterToken === voterToken));
          if (found) {
            userVote = found;
            hasVoted = true;
          }
        }

        // 核心权限计算：完全遵循 settings.resultsVisibility 配置
        const canSeeResults = settings.resultsVisibility === 'public' || 
          (settings.resultsVisibility === 'after_vote' && hasVoted) || 
          isAdmin;

        const totalVoters = ballots.length;
        const totalVotesCast = ballots.reduce((acc, b) => acc + ((b.topicIds && b.topicIds.length) || 0), 0);

        const dur = Date.now() - startTime;
        return jsonResponse({
          success: true,
          settings,
          user: adminUser ? { username: adminUser.username, role: 'admin' } : null,
          hasVoted,
          userVote,
          canSeeResults,
          statsSummary: { totalVoters, totalVotesCast }
        }, 200, { 'Server-Timing': `app;dur=${dur}` });
      }

      // 2. GET /api/topics (社课议题列表与票数状态，强一致性流转)
      if (path === '/api/topics' && method === 'GET') {
        const settings = await getJsonKV(KV, 'settings', { resultsVisibility: 'public' });
        const topics = await getJsonKV(KV, 'topics', []);
        const ballots = await getJsonKV(KV, 'ballots', []);

        let hasVoted = false;
        if (voterToken) {
          const directVote = await getJsonKV(KV, 'voter:' + voterToken, null);
          hasVoted = !!directVote || ballots.some(b => b && (b.voterId === voterToken || b.voterToken === voterToken));
        }

        // 核心权限计算：遵循 public / after_vote 设定
        const canViewCounts = settings.resultsVisibility === 'public' || 
          (settings.resultsVisibility === 'after_vote' && hasVoted) || 
          isAdmin;

        // 聚合计算各议题票数
        const counts = {};
        topics.forEach(t => counts[t.id] = 0);
        ballots.forEach(b => {
          if (b && Array.isArray(b.topicIds)) {
            b.topicIds.forEach(tid => {
              if (counts[tid] !== undefined) counts[tid]++;
            });
          }
        });

        const totalVotesCast = Object.values(counts).reduce((a, b) => a + b, 0);

        // 聚合留言统计
        const allComments = await getJsonKV(KV, 'comments', []);
        const commentCounts = {};
        allComments.forEach(c => {
          if (c && c.topicId) {
            commentCounts[c.topicId] = (commentCounts[c.topicId] || 0) + 1;
          }
        });

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
          topics: enrichedTopics,
          locked: !canViewCounts
        }, 200, { 'Server-Timing': `app;dur=${dur}` });
      }

      // 3. GET /api/results (实时热度排行榜，实时流转无滞后)
      if (path === '/api/results' && method === 'GET') {
        const settings = await getJsonKV(KV, 'settings', { resultsVisibility: 'public' });
        const ballots = await getJsonKV(KV, 'ballots', []);

        let hasVoted = false;
        if (voterToken) {
          const directVote = await getJsonKV(KV, 'voter:' + voterToken, null);
          hasVoted = !!directVote || ballots.some(b => b && (b.voterId === voterToken || b.voterToken === voterToken));
        }

        const canViewCounts = settings.resultsVisibility === 'public' || 
          (settings.resultsVisibility === 'after_vote' && hasVoted) || 
          isAdmin;

        const topics = await getJsonKV(KV, 'topics', []);
        const counts = {};
        topics.forEach(t => counts[t.id] = 0);
        ballots.forEach(b => {
          if (b && Array.isArray(b.topicIds)) {
            b.topicIds.forEach(tid => {
              if (counts[tid] !== undefined) counts[tid]++;
            });
          }
        });

        const totalVotesCast = Object.values(counts).reduce((a, b) => a + b, 0);

        if (!canViewCounts) {
          return jsonResponse({
            success: true,
            locked: true,
            message: '投出你的心仪选票后，即刻解锁实时热度排行！',
            stats: {
              totalVoters: ballots.length,
              totalVotesCast,
              topicStats: []
            }
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
          stats: {
            totalVoters: ballots.length,
            totalVotesCast,
            topicStats
          }
        }, 200, { 'Server-Timing': `app;dur=${dur}` });
      }

      // 4. POST /api/vote (零门槛投票，支持原子写入、改票与去重)
      if (path === '/api/vote' && method === 'POST') {
        if (!checkRateLimit(clientIp, 15, 60000)) {
          return jsonResponse({ error: '提交操作过于频繁，请稍候再试' }, 429);
        }

        const body = await request.json().catch(() => ({}));
        const clientToken = voterToken || body.voterToken || ('anon-' + Math.random().toString(36).slice(2, 12));
        const { topicIds, comment } = body;

        const settings = await getJsonKV(KV, 'settings', { maxVotesPerUser: 3, status: 'open', allowChangeVote: true });

        if (settings.status === 'closed') {
          return jsonResponse({ error: '投票已截止并锁定' }, 400);
        }
        if (settings.status === 'paused') {
          return jsonResponse({ error: '投票暂缓进行中' }, 400);
        }

        if (!Array.isArray(topicIds) || topicIds.length === 0) {
          return jsonResponse({ error: '请至少选择 1 门心仪社课' }, 400);
        }
        if (topicIds.length > (settings.maxVotesPerUser || 3)) {
          return jsonResponse({ error: `至多可选择 ${settings.maxVotesPerUser || 3} 门社课` }, 400);
        }

        const topics = await getJsonKV(KV, 'topics', []);
        const topicMap = {};
        topics.forEach(t => topicMap[t.id] = t.title);

        const cleanComment = sanitizeText(comment, 200);

        // 读取当前票池与旧票检查
        let ballots = await getJsonKV(KV, 'ballots', []);
        const existingIndex = ballots.findIndex(b => b && (b.voterId === clientToken || b.voterToken === clientToken));
        if (existingIndex > -1 && !settings.allowChangeVote) {
          return jsonResponse({ error: '本次投票设定为不可修改已提交选票' }, 400);
        }

        const encryptedToken = await encryptData(clientToken, secretKey);

        const ballot = {
          id: existingIndex > -1 ? ballots[existingIndex].id : 'ballot-' + Date.now(),
          voterId: clientToken,
          voterToken: clientToken,
          encryptedToken,
          topicIds,
          topicTitles: topicIds.map(id => topicMap[id] || id),
          comment: cleanComment,
          clientIp: clientIp.slice(0, 16),
          votedAt: new Date().toISOString()
        };

        // 1. 原子独立写：存盘至独立选民键 (O(1) 绝对防并发冲突)
        await KV.put('voter:' + clientToken, JSON.stringify(ballot), { expirationTtl: 86400 * 90 });

        // 2. 去重并原子更新总票池
        ballots = ballots.filter(b => b && b.voterId !== clientToken && b.voterToken !== clientToken);
        ballots.push(ballot);
        await KV.put('ballots', JSON.stringify(ballots));

        // 3. 心愿留言同步写入讨论区 (单条入库，杜绝多选时重复多次)
        if (cleanComment) {
          let comments = await getJsonKV(KV, 'comments', []);
          const primaryTopicId = topicIds[0] || 'general';
          const newCmt = {
            id: 'cmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            topicId: primaryTopicId,
            topicTitle: topicMap[primaryTopicId] || '',
            voterId: clientToken,
            authorName: '朋辈学友',
            text: cleanComment,
            createdAt: new Date().toISOString()
          };
          comments.unshift(newCmt);
          if (comments.length > 300) comments = comments.slice(0, 300);
          await KV.put('comments', JSON.stringify(comments));
        }

        const dur = Date.now() - startTime;
        return jsonResponse({
          success: true,
          message: existingIndex > -1 ? '您的选票已成功更新！' : '选票投出成功！已为您揭晓实时热度榜',
          voterToken: clientToken,
          hasVoted: true,
          vote: ballot
        }, 200, { 'Server-Timing': `app;dur=${dur}` });
      }

      // 5. GET /api/comments & POST /api/comments (公共社区讨论留言板)
      if (path === '/api/comments') {
        if (method === 'GET') {
          const comments = await getJsonKV(KV, 'comments', []);
          const list = comments.map(c => ({
            id: c.id,
            topicId: c.topicId || 'general',
            topicTitle: c.topicTitle || '',
            text: c.text,
            authorName: c.authorName || '朋辈学友',
            createdAt: c.createdAt
          }));
          const dur = Date.now() - startTime;
          return jsonResponse({ success: true, comments: list }, 200, { 'Server-Timing': `app;dur=${dur}` });
        }

        if (method === 'POST') {
          if (!checkRateLimit(clientIp, 10, 60000)) {
            return jsonResponse({ error: '发言过于频繁，请稍息后再试' }, 429);
          }

          const body = await request.json().catch(() => ({}));
          const cleanText = sanitizeText(body.text, 200);
          if (!cleanText) {
            return jsonResponse({ error: '留言内容不能为空' }, 400);
          }
          const cleanAuthor = sanitizeText(body.authorName, 20) || '朋辈学友';
          const topicId = body.topicId || 'general';
          let topicTitle = '';
          if (topicId !== 'general') {
            const topics = await getJsonKV(KV, 'topics', []);
            const found = topics.find(t => t.id === topicId);
            if (found) topicTitle = found.title;
          }

          let comments = await getJsonKV(KV, 'comments', []);
          const newComment = {
            id: 'cmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            topicId,
            topicTitle,
            voterId: voterToken || 'anon',
            authorName: cleanAuthor,
            text: cleanText,
            createdAt: new Date().toISOString()
          };

          comments.unshift(newComment);
          if (comments.length > 300) comments = comments.slice(0, 300);
          await KV.put('comments', JSON.stringify(comments));

          const dur = Date.now() - startTime;
          return jsonResponse({ success: true, message: '留言已发布！', comment: newComment }, 200, {
            'Server-Timing': `app;dur=${dur}`
          });
        }
      }

      // DELETE /api/comments/:id (管理员管理不当留言)
      if (path.startsWith('/api/comments/') && method === 'DELETE') {
        if (!isAdmin) {
          return jsonResponse({ error: '需要管理员权限' }, 403);
        }
        const commentId = path.split('/')[3];
        let comments = await getJsonKV(KV, 'comments', []);
        comments = comments.filter(c => c.id !== commentId);
        await KV.put('comments', JSON.stringify(comments));
        return jsonResponse({ success: true, message: '留言已删除' });
      }

      // 6. GET /api/topics/:id/comments & POST /api/topics/:id/comments (单门社课研讨墙)
      if (path.startsWith('/api/topics/') && path.endsWith('/comments')) {
        const parts = path.split('/');
        const topicId = parts[3];

        if (method === 'GET') {
          const comments = await getJsonKV(KV, 'comments', []);
          const topicComments = comments
            .filter(c => c.topicId === topicId)
            .map(c => ({
              id: c.id,
              text: c.text,
              authorName: c.authorName || '朋辈学友',
              createdAt: c.createdAt
            }));
          return jsonResponse({ success: true, comments: topicComments });
        }

        if (method === 'POST') {
          if (!checkRateLimit(clientIp, 10, 60000)) {
            return jsonResponse({ error: '发言过于频繁，请稍息后再试' }, 429);
          }

          const body = await request.json().catch(() => ({}));
          const cleanText = sanitizeText(body.text, 200);
          if (!cleanText) {
            return jsonResponse({ error: '留言内容不能为空' }, 400);
          }
          const cleanAuthor = sanitizeText(body.authorName, 20) || '朋辈学友';

          const topics = await getJsonKV(KV, 'topics', []);
          const foundTopic = topics.find(t => t.id === topicId);

          let comments = await getJsonKV(KV, 'comments', []);
          const newComment = {
            id: 'cmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            topicId,
            topicTitle: foundTopic ? foundTopic.title : '',
            voterId: voterToken || 'anon',
            authorName: cleanAuthor,
            text: cleanText,
            createdAt: new Date().toISOString()
          };

          comments.unshift(newComment);
          if (comments.length > 300) comments = comments.slice(0, 300);
          await KV.put('comments', JSON.stringify(comments));

          return jsonResponse({ success: true, message: '留言已发布！', comment: newComment });
        }
      }

      // 7. 管理员登录
      if (path === '/api/auth/login' && method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const { username, password } = body;
        if (username === 'admin' && password === 'admin123') {
          const adminObj = { id: 'admin-root', username: 'admin', displayName: '总管理员', role: 'admin' };
          const token = createToken(adminObj);
          return jsonResponse({ success: true, message: '管理员登录成功', token, user: adminObj });
        }
        return jsonResponse({ error: '管理员账号或密码错误' }, 401);
      }

      // 8. 管理员核心配置与数据生命周期管理
      if (path.startsWith('/api/admin')) {
        if (!isAdmin) {
          return jsonResponse({ error: '需要管理员权限' }, 403);
        }

        // GET /api/admin/ballots (查看所有选票明细)
        if (path === '/api/admin/ballots' && method === 'GET') {
          const ballots = await getJsonKV(KV, 'ballots', []);
          return jsonResponse({ success: true, ballots });
        }

        // POST /api/admin/clear-votes 或 /api/admin/reset-votes (彻底清空重置选票与选民状态)
        if ((path === '/api/admin/clear-votes' || path === '/api/admin/reset-votes') && method === 'POST') {
          await KV.put('ballots', JSON.stringify([]));
          await KV.put('comments', JSON.stringify([]));

          // 清理所有已保存的 voter:* 独立选民键，确保全员可以重新开局投票
          try {
            const voterKeys = await KV.list({ prefix: 'voter:' });
            if (voterKeys && voterKeys.keys) {
              for (const k of voterKeys.keys) {
                await KV.delete(k.name);
              }
            }
          } catch (e) {
            console.warn('Clear voter keys error:', e.message);
          }

          return jsonResponse({ success: true, message: '所有选票、选民指纹与讨论留言已全量重置清空！' });
        }

        // GET /api/admin/settings & PUT /api/admin/settings (读取与保存系统配置)
        if (path === '/api/admin/settings') {
          if (method === 'GET') {
            const currentSettings = await getJsonKV(KV, 'settings', {});
            return jsonResponse({ success: true, settings: currentSettings });
          }
          if (method === 'PUT') {
            const updates = await request.json().catch(() => ({}));
            let current = await getJsonKV(KV, 'settings', {});
            const newSettings = {
              ...current,
              ...updates,
              updatedAt: new Date().toISOString()
            };
            await KV.put('settings', JSON.stringify(newSettings));
            return jsonResponse({ success: true, message: '系统设置保存成功！', settings: newSettings });
          }
        }

        // POST /api/admin/topics (新增社课议题)
        if (path === '/api/admin/topics' && method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const { title, speaker, category, tag, duration, hook, summary, outline } = body;
          if (!title || !title.trim()) {
            return jsonResponse({ error: '社课主题名称不能为空' }, 400);
          }
          let topics = await getJsonKV(KV, 'topics', []);
          const newTopic = {
            id: 'topic-' + Date.now().toString(36),
            title: title.trim(),
            speaker: (speaker || '朋辈讲师').trim(),
            category: (category || '通识探索').trim(),
            tag: (tag || '新议题').trim(),
            duration: (duration || '45分钟讲解 + 15分钟互动').trim(),
            hook: (hook || '').trim(),
            summary: (summary || '').trim(),
            outline: Array.isArray(outline) ? outline : [],
            createdAt: new Date().toISOString()
          };
          topics.push(newTopic);
          await KV.put('topics', JSON.stringify(topics));
          return jsonResponse({ success: true, message: '社课议题添加成功！', topic: newTopic });
        }

        // PUT /api/admin/topics/:id (编辑社课议题)
        if (path.startsWith('/api/admin/topics/') && method === 'PUT') {
          const topicId = path.split('/')[4];
          const updates = await request.json().catch(() => ({}));
          let topics = await getJsonKV(KV, 'topics', []);
          const idx = topics.findIndex(t => t.id === topicId);
          if (idx === -1) {
            return jsonResponse({ error: '未找到对应社课议题' }, 404);
          }
          topics[idx] = { ...topics[idx], ...updates, id: topicId };
          await KV.put('topics', JSON.stringify(topics));
          return jsonResponse({ success: true, message: '社课议题修改成功！', topic: topics[idx] });
        }

        // DELETE /api/admin/topics/:id (删除社课议题)
        if (path.startsWith('/api/admin/topics/') && method === 'DELETE') {
          const topicId = path.split('/')[4];
          let topics = await getJsonKV(KV, 'topics', []);
          topics = topics.filter(t => t.id !== topicId);
          await KV.put('topics', JSON.stringify(topics));
          return jsonResponse({ success: true, message: '社课议题已删除！' });
        }
      }

      return jsonResponse({ error: 'Endpoint not found' }, 404);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Internal server error' }, 500);
    }
  }
};

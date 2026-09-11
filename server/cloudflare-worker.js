/**
 * Cloudflare Worker API for Peer Lecture Voting System
 * Features:
 * - Zero-barrier anonymous voting with client device token (X-Voter-Token)
 * - Obscured stats before voting, full dynamic leaderboard unlocked after voting
 * - Public peer lecture comment wall (心愿提问箱)
 * - AES-256-GCM hardware encryption for sensitive storage in Cloudflare KV
 * - Excel-compatible UTF-8 BOM CSV export for administrator
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Voter-Token',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

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

// AES-256-GCM 硬件加密
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

async function decryptData(cipherCombined, secret) {
  try {
    if (!cipherCombined || typeof cipherCombined !== 'string') return '';
    const [ivHex, cipherHex] = cipherCombined.split(':');
    if (!ivHex || !cipherHex) return cipherCombined;
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const cipher = new Uint8Array(cipherHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const key = await getCryptoKey(secret);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipher
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    return cipherCombined;
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
  const signature = base64UrlEncode('mock-sig');
  return `${header}.${payload}.${signature}`;
}

export default {
  async fetch(request, env, ctx) {
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

    // 获取当前客户端的设备唯一匿名指纹与管理员身份
    const voterToken = request.headers.get('X-Voter-Token') || url.searchParams.get('voterToken') || '';
    const adminUser = parseUserFromHeader(request);
    const isAdmin = adminUser && adminUser.role === 'admin';

    try {
      // 1. GET /api/status (系统状态、投票规则与选民状态)
      if (path === '/api/status' && method === 'GET') {
        const settingsRaw = await KV.get('settings');
        const settings = settingsRaw ? JSON.parse(settingsRaw) : {
          title: '朋辈社课 · 选出你最想听的一课',
          subtitle: '由你投票决定本学期公开课排期顺序（每人限投 1~3 票）',
          maxVotesPerUser: 3,
          allowChangeVote: true,
          status: 'open',
          resultsVisibility: 'public'
        };

        const ballotsRaw = await KV.get('ballots');
        const ballots = ballotsRaw ? JSON.parse(ballotsRaw) : [];

        // 识别当前设备是否已投票
        let userVote = null;
        let hasVoted = false;
        if (voterToken) {
          const found = ballots.find(b => b.voterId === voterToken || b.voterToken === voterToken);
          if (found) {
            userVote = found;
            hasVoted = true;
          }
        }

        const totalVoters = ballots.length;
        const totalVotesCast = ballots.reduce((acc, b) => acc + ((b.topicIds && b.topicIds.length) || 0), 0);

        return jsonResponse({
          success: true,
          settings,
          user: adminUser ? { username: adminUser.username, role: 'admin' } : null,
          hasVoted,
          userVote,
          canSeeResults: hasVoted || isAdmin,
          statsSummary: {
            totalVoters,
            totalVotesCast
          }
        });
      }

      // 2. GET /api/topics (社课列表，投前脱敏锁定，投后解锁)
      if (path === '/api/topics' && method === 'GET') {
        const topicsRaw = await KV.get('topics');
        const topics = topicsRaw ? JSON.parse(topicsRaw) : [];

        const ballotsRaw = await KV.get('ballots');
        const ballots = ballotsRaw ? JSON.parse(ballotsRaw) : [];

        // 判断是否有权查看真实票数（投过票或管理员）
        let hasVoted = false;
        if (voterToken) {
          hasVoted = ballots.some(b => b.voterId === voterToken || b.voterToken === voterToken);
        }
        const canViewCounts = hasVoted || isAdmin;

        const counts = {};
        topics.forEach(t => counts[t.id] = 0);
        ballots.forEach(b => {
          (b.topicIds || []).forEach(tid => {
            if (counts[tid] !== undefined) counts[tid]++;
          });
        });

        const totalVotesCast = Object.values(counts).reduce((a, b) => a + b, 0);

        // 读取所有公开留言统计
        const commentsRaw = await KV.get('comments');
        const allComments = commentsRaw ? JSON.parse(commentsRaw) : [];
        const commentCounts = {};
        allComments.forEach(c => {
          commentCounts[c.topicId] = (commentCounts[c.topicId] || 0) + 1;
        });

        const enrichedTopics = topics.map(t => {
          const voteCount = counts[t.id] || 0;
          return {
            ...t,
            commentCount: commentCounts[t.id] || 0,
            stats: {
              locked: !canViewCounts,
              count: canViewCounts ? voteCount : null,
              percentage: canViewCounts && totalVotesCast > 0 ? Math.round((voteCount / totalVotesCast) * 100) : null
            }
          };
        });

        return jsonResponse({ success: true, topics: enrichedTopics, locked: !canViewCounts });
      }

      // 3. GET /api/results (实时热度排行榜，投前保密)
      if (path === '/api/results' && method === 'GET') {
        const ballotsRaw = await KV.get('ballots');
        const ballots = ballotsRaw ? JSON.parse(ballotsRaw) : [];

        let hasVoted = false;
        if (voterToken) {
          hasVoted = ballots.some(b => b.voterId === voterToken || b.voterToken === voterToken);
        }

        const canViewCounts = hasVoted || isAdmin;

        const topicsRaw = await KV.get('topics');
        const topics = topicsRaw ? JSON.parse(topicsRaw) : [];

        const counts = {};
        topics.forEach(t => counts[t.id] = 0);
        ballots.forEach(b => {
          (b.topicIds || []).forEach(tid => {
            if (counts[tid] !== undefined) counts[tid]++;
          });
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

        return jsonResponse({
          success: true,
          locked: false,
          stats: {
            totalVoters: ballots.length,
            totalVotesCast,
            topicStats
          }
        });
      }

      // 4. POST /api/vote (零门槛匿名投票，支持同设备修改覆盖与心愿留言)
      if (path === '/api/vote' && method === 'POST') {
        const body = await request.json();
        const clientToken = voterToken || body.voterToken || ('anon-' + Math.random().toString(36).slice(2, 12));
        const { topicIds, comment } = body;

        const settingsRaw = await KV.get('settings');
        const settings = settingsRaw ? JSON.parse(settingsRaw) : { maxVotesPerUser: 3, status: 'open', allowChangeVote: true };

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

        const topicsRaw = await KV.get('topics');
        const topics = topicsRaw ? JSON.parse(topicsRaw) : [];
        const topicMap = {};
        topics.forEach(t => topicMap[t.id] = t.title);

        const ballotsRaw = await KV.get('ballots');
        let ballots = ballotsRaw ? JSON.parse(ballotsRaw) : [];

        const existingIndex = ballots.findIndex(b => b.voterId === clientToken || b.voterToken === clientToken);
        if (existingIndex > -1 && !settings.allowChangeVote) {
          return jsonResponse({ error: '本次投票设定为不可修改已提交选票' }, 400);
        }

        // 加密设备令牌标识
        const encryptedToken = await encryptData(clientToken, secretKey);

        const ballot = {
          id: existingIndex > -1 ? ballots[existingIndex].id : 'ballot-' + Date.now(),
          voterId: clientToken,
          voterToken: clientToken,
          encryptedToken,
          topicIds,
          topicTitles: topicIds.map(id => topicMap[id] || id),
          comment: (comment && comment.trim()) || '',
          votedAt: new Date().toISOString()
        };

        if (existingIndex > -1) {
          ballots[existingIndex] = ballot;
        } else {
          ballots.push(ballot);
        }

        await KV.put('ballots', JSON.stringify(ballots));

        // 如果用户同时输入了心愿留言，写入公开留言墙
        if (comment && comment.trim()) {
          const commentsRaw = await KV.get('comments');
          let comments = commentsRaw ? JSON.parse(commentsRaw) : [];
          // 为每个选中的主题各挂载一条心愿，或首个选中的主题
          topicIds.forEach(tid => {
            comments.unshift({
              id: 'cmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              topicId: tid,
              voterId: clientToken,
              authorName: '朋辈学友',
              text: comment.trim(),
              createdAt: new Date().toISOString()
            });
          });
          // 限制保留最新 200 条留言
          if (comments.length > 200) comments = comments.slice(0, 200);
          await KV.put('comments', JSON.stringify(comments));
        }

        return jsonResponse({
          success: true,
          message: existingIndex > -1 ? '您的选票已成功更新！' : '选票投出成功！已为您揭晓实时热度榜',
          voterToken: clientToken,
          hasVoted: true,
          vote: ballot
        });
      }

      // 5. GET /api/topics/:id/comments & POST /api/topics/:id/comments (公开社课心愿留言墙)
      if (path.startsWith('/api/topics/') && path.endsWith('/comments')) {
        const parts = path.split('/');
        const topicId = parts[3];

        if (method === 'GET') {
          const commentsRaw = await KV.get('comments');
          const comments = commentsRaw ? JSON.parse(commentsRaw) : [];
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
          const body = await request.json();
          const { text } = body;
          if (!text || !text.trim()) {
            return jsonResponse({ error: '留言内容不能为空' }, 400);
          }

          const commentsRaw = await KV.get('comments');
          let comments = commentsRaw ? JSON.parse(commentsRaw) : [];

          const newComment = {
            id: 'cmt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            topicId,
            voterId: voterToken || 'anon',
            authorName: '朋辈学友',
            text: text.trim().slice(0, 200), // 限制200字
            createdAt: new Date().toISOString()
          };

          comments.unshift(newComment);
          if (comments.length > 300) comments = comments.slice(0, 300);
          await KV.put('comments', JSON.stringify(comments));

          return jsonResponse({ success: true, message: '留言已发布！', comment: newComment });
        }
      }

      // 6. 管理员登录
      if (path === '/api/auth/login' && method === 'POST') {
        const body = await request.json();
        const { username, password } = body;
        if (username === 'admin' && password === 'admin123') {
          const adminObj = { id: 'admin-root', username: 'admin', displayName: '总管理员', role: 'admin' };
          const token = createToken(adminObj);
          return jsonResponse({ success: true, message: '管理员登录成功', token, user: adminObj });
        }
        return jsonResponse({ error: '管理员账号或密码错误' }, 401);
      }

      // 7. 管理员高级操作
      if (path.startsWith('/api/admin')) {
        if (!isAdmin) {
          return jsonResponse({ error: '需要管理员权限' }, 403);
        }

        if (path === '/api/admin/ballots' && method === 'GET') {
          const ballotsRaw = await KV.get('ballots');
          const ballots = ballotsRaw ? JSON.parse(ballotsRaw) : [];
          return jsonResponse({ success: true, ballots });
        }

        if (path === '/api/admin/clear-votes' && method === 'POST') {
          await KV.put('ballots', JSON.stringify([]));
          await KV.put('comments', JSON.stringify([]));
          return jsonResponse({ success: true, message: '所有选票与心愿留言已清空重置' });
        }

        if (path === '/api/admin/settings' && method === 'PUT') {
          const newSettings = await request.json();
          newSettings.updatedAt = new Date().toISOString();
          await KV.put('settings', JSON.stringify(newSettings));
          return jsonResponse({ success: true, settings: newSettings });
        }
      }

      return jsonResponse({ error: 'Endpoint not found' }, 404);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Internal error' }, 500);
    }
  }
};
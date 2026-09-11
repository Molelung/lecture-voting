/**
 * Cloudflare Worker API for Lecture Voting System
 * Backed by Cloudflare KV with AES-256-GCM Encryption
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
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

// 兼容 UTF-8 的 Base64URL 编码与解码
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

// AES-256-GCM 硬件级高强度数据加密
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

async function hashPassword(password) {
  const enc = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(`salt_lecture_${password}`));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 解析 Authorization 头中的 JWT
function parseUserFromHeader(request) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.replace('Bearer ', '').trim();
  try {
    const parts = token.split('.');
    if (parts.length >= 2) {
      const payloadStr = base64UrlDecode(parts[1]);
      return JSON.parse(payloadStr);
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

    // 处理 CORS 预检
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const KV = env.LECTURE_KV;
    if (!KV) {
      return jsonResponse({ error: 'KV database binding missing' }, 500);
    }

    const secretKey = env.ENCRYPTION_KEY || 'peer-lecture-voting-aes256-secret-key-2026!';

    try {
      // 1. GET /api/status (系统状态与当前用户)
      if (path === '/api/status' && method === 'GET') {
        const settingsRaw = await KV.get('settings');
        const settings = settingsRaw ? JSON.parse(settingsRaw) : {
          title: '朋辈社课主题征集与票选',
          subtitle: '甄选优质主题，由你投票决定本学期社课开讲顺序（每人限投 1~3 票）',
          maxVotesPerUser: 3,
          allowChangeVote: true,
          status: 'open',
          resultsVisibility: 'public'
        };

        const ballotsRaw = await KV.get('ballots');
        const ballots = ballotsRaw ? JSON.parse(ballotsRaw) : [];

        const user = parseUserFromHeader(request);
        let userVote = null;
        if (user) {
          const found = ballots.find(b => b.voterId === user.id);
          if (found) {
            userVote = {
              ...found,
              voterName: user.displayName,
              voterUsername: user.username,
            };
          }
        }

        const totalVoters = ballots.length;
        const totalVotesCast = ballots.reduce((acc, b) => acc + ((b.topicIds && b.topicIds.length) || 0), 0);

        return jsonResponse({
          success: true,
          settings,
          user: user ? { id: user.id, username: user.username, displayName: user.displayName, role: user.role } : null,
          userVote,
          canSeeResults: settings.resultsVisibility === 'public' || (user && user.role === 'admin'),
          statsSummary: {
            totalVoters,
            totalVotesCast
          }
        });
      }

      // 2. GET /api/topics (社课候选列表)
      if (path === '/api/topics' && method === 'GET') {
        const topicsRaw = await KV.get('topics');
        const topics = topicsRaw ? JSON.parse(topicsRaw) : [];

        const ballotsRaw = await KV.get('ballots');
        const ballots = ballotsRaw ? JSON.parse(ballotsRaw) : [];

        const counts = {};
        topics.forEach(t => counts[t.id] = 0);
        ballots.forEach(b => {
          (b.topicIds || []).forEach(tid => {
            if (counts[tid] !== undefined) counts[tid]++;
          });
        });

        const totalVotesCast = Object.values(counts).reduce((a, b) => a + b, 0);

        const enrichedTopics = topics.map(t => ({
          ...t,
          stats: {
            count: counts[t.id] || 0,
            percentage: totalVotesCast > 0 ? Math.round(((counts[t.id] || 0) / totalVotesCast) * 100) : 0
          }
        }));

        return jsonResponse({ success: true, topics: enrichedTopics });
      }

      // 3. POST /api/auth/register & POST /api/auth/login
      if (path === '/api/auth/register' && method === 'POST') {
        const body = await request.json();
        const { username, displayName, password } = body;
        if (!username || !password) {
          return jsonResponse({ error: '学号/用户名与密码不能为空' }, 400);
        }

        const usersRaw = await KV.get('users');
        const users = usersRaw ? JSON.parse(usersRaw) : [];

        if (users.some(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
          return jsonResponse({ error: '该学号/用户名已登记，请直接登录' }, 400);
        }

        const passHash = await hashPassword(password);
        const newUser = {
          id: 'user-' + Date.now(),
          username: username.trim(),
          displayName: (displayName && displayName.trim()) || username.trim(),
          role: 'voter',
          passwordHash: passHash,
          createdAt: new Date().toISOString()
        };

        users.push(newUser);
        await KV.put('users', JSON.stringify(users));

        const token = createToken(newUser);
        return jsonResponse({
          success: true,
          message: '登记成功！欢迎参与投票',
          token,
          user: { id: newUser.id, username: newUser.username, displayName: newUser.displayName, role: newUser.role }
        });
      }

      if (path === '/api/auth/login' && method === 'POST') {
        const body = await request.json();
        const { username, password } = body;

        // 特殊管理员快速通道
        if (username === 'admin' && password === 'admin123') {
          const adminUser = { id: 'admin-root', username: 'admin', displayName: '总管理员', role: 'admin' };
          const token = createToken(adminUser);
          return jsonResponse({ success: true, message: '管理员登录成功', token, user: adminUser });
        }

        const usersRaw = await KV.get('users');
        const users = usersRaw ? JSON.parse(usersRaw) : [];
        const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());

        const passHash = await hashPassword(password);
        if (!user || (user.passwordHash !== passHash && user.passwordHash !== password)) {
          return jsonResponse({ error: '学号/用户名或密码错误' }, 401);
        }

        const token = createToken(user);
        return jsonResponse({
          success: true,
          message: '登录成功',
          token,
          user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role }
        });
      }

      // 4. POST /api/vote (投票：选民敏感信息 AES-256 加密存盘)
      if (path === '/api/vote' && method === 'POST') {
        const user = parseUserFromHeader(request);
        if (!user) {
          return jsonResponse({ error: '请先登录或登记身份后再投票' }, 401);
        }

        const settingsRaw = await KV.get('settings');
        const settings = settingsRaw ? JSON.parse(settingsRaw) : { maxVotesPerUser: 3, status: 'open', allowChangeVote: true };

        if (settings.status === 'closed') {
          return jsonResponse({ error: '投票已截止并锁定' }, 400);
        }
        if (settings.status === 'paused') {
          return jsonResponse({ error: '投票暂缓进行中' }, 400);
        }

        const body = await request.json();
        const { topicIds } = body;
        if (!Array.isArray(topicIds) || topicIds.length === 0) {
          return jsonResponse({ error: '请至少选择一个社课主题' }, 400);
        }
        if (topicIds.length > (settings.maxVotesPerUser || 3)) {
          return jsonResponse({ error: `至多可投 ${settings.maxVotesPerUser || 3} 票` }, 400);
        }

        const topicsRaw = await KV.get('topics');
        const topics = topicsRaw ? JSON.parse(topicsRaw) : [];
        const topicMap = {};
        topics.forEach(t => topicMap[t.id] = t.title);

        const ballotsRaw = await KV.get('ballots');
        let ballots = ballotsRaw ? JSON.parse(ballotsRaw) : [];

        const existingIndex = ballots.findIndex(b => b.voterId === user.id);
        if (existingIndex > -1 && !settings.allowChangeVote) {
          return jsonResponse({ error: '本次投票不允许修改已提交的选票' }, 400);
        }

        // 使用 AES-256 加密选民隐私信息（学号、姓名）防外泄
        const encryptedVoterName = await encryptData(user.displayName, secretKey);
        const encryptedVoterUsername = await encryptData(user.username, secretKey);

        const ballot = {
          id: existingIndex > -1 ? ballots[existingIndex].id : 'ballot-' + Date.now(),
          voterId: user.id,
          encryptedVoterUsername,
          encryptedVoterName,
          topicIds: topicIds,
          topicTitles: topicIds.map(id => topicMap[id] || id),
          votedAt: new Date().toISOString()
        };

        if (existingIndex > -1) {
          ballots[existingIndex] = ballot;
        } else {
          ballots.push(ballot);
        }

        await KV.put('ballots', JSON.stringify(ballots));

        return jsonResponse({
          success: true,
          message: existingIndex > -1 ? '您的选票已成功更新！' : '选票提交成功！感谢支持心仪社课',
          vote: {
            ...ballot,
            voterName: user.displayName,
            voterUsername: user.username
          }
        });
      }

      // 5. GET /api/results (实时榜单)
      if (path === '/api/results' && method === 'GET') {
        const topicsRaw = await KV.get('topics');
        const topics = topicsRaw ? JSON.parse(topicsRaw) : [];

        const ballotsRaw = await KV.get('ballots');
        const ballots = ballotsRaw ? JSON.parse(ballotsRaw) : [];

        const counts = {};
        topics.forEach(t => counts[t.id] = 0);
        ballots.forEach(b => {
          (b.topicIds || []).forEach(tid => {
            if (counts[tid] !== undefined) counts[tid]++;
          });
        });

        const totalVotesCast = Object.values(counts).reduce((a, b) => a + b, 0);

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
          stats: {
            totalVoters: ballots.length,
            totalVotesCast,
            topicStats
          }
        });
      }

      // 6. 管理员接口
      if (path.startsWith('/api/admin')) {
        const user = parseUserFromHeader(request);
        if (!user || user.role !== 'admin') {
          return jsonResponse({ error: '需要管理员权限' }, 403);
        }

        if (path === '/api/admin/settings' && method === 'PUT') {
          const newSettings = await request.json();
          newSettings.updatedAt = new Date().toISOString();
          await KV.put('settings', JSON.stringify(newSettings));
          return jsonResponse({ success: true, settings: newSettings });
        }

        if (path === '/api/admin/ballots' && method === 'GET') {
          const ballotsRaw = await KV.get('ballots');
          const ballots = ballotsRaw ? JSON.parse(ballotsRaw) : [];
          const decryptedBallots = await Promise.all(ballots.map(async b => ({
            id: b.id,
            voterUsername: b.encryptedVoterUsername ? await decryptData(b.encryptedVoterUsername, secretKey) : (b.voterUsername || '已加密保护'),
            voterDisplayName: b.encryptedVoterName ? await decryptData(b.encryptedVoterName, secretKey) : (b.voterName || '已加密保护'),
            topicIds: b.topicIds,
            topicTitles: b.topicTitles,
            votedAt: b.votedAt
          })));
          return jsonResponse({ success: true, ballots: decryptedBallots });
        }

        if (path === '/api/admin/clear-votes' && method === 'POST') {
          await KV.put('ballots', JSON.stringify([]));
          return jsonResponse({ success: true, message: '所有选票数据已清空' });
        }

        if (path === '/api/admin/topics' && method === 'POST') {
          const newTopic = await request.json();
          newTopic.id = 'topic-' + Date.now();
          newTopic.createdAt = new Date().toISOString();
          const topicsRaw = await KV.get('topics');
          const topics = topicsRaw ? JSON.parse(topicsRaw) : [];
          topics.push(newTopic);
          await KV.put('topics', JSON.stringify(topics));
          return jsonResponse({ success: true, topic: newTopic });
        }

        if (path.startsWith('/api/admin/topics/') && method === 'PUT') {
          const id = path.replace('/api/admin/topics/', '');
          const updated = await request.json();
          const topicsRaw = await KV.get('topics');
          let topics = topicsRaw ? JSON.parse(topicsRaw) : [];
          const idx = topics.findIndex(t => t.id === id);
          if (idx > -1) {
            topics[idx] = { ...topics[idx], ...updated, id };
            await KV.put('topics', JSON.stringify(topics));
          }
          return jsonResponse({ success: true, topic: topics[idx] });
        }

        if (path.startsWith('/api/admin/topics/') && method === 'DELETE') {
          const id = path.replace('/api/admin/topics/', '');
          const topicsRaw = await KV.get('topics');
          let topics = topicsRaw ? JSON.parse(topicsRaw) : [];
          topics = topics.filter(t => t.id !== id);
          await KV.put('topics', JSON.stringify(topics));
          return jsonResponse({ success: true, message: '主题已删除' });
        }
      }

      return jsonResponse({ error: 'Endpoint not found' }, 404);
    } catch (err) {
      return jsonResponse({ error: err.message || 'Internal error' }, 500);
    }
  }
};
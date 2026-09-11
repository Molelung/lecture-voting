import jwt from 'jsonwebtoken';
import { db } from './db.js';

export const JWT_SECRET = 'lecture-voting-secret-key-2026-liquid-glass';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      req.user = null;
      return next();
    }
    const user = db.findUserById(decoded.id);
    req.user = user ? { id: user.id, username: user.username, displayName: user.displayName, role: user.role } : null;
    next();
  });
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: '请先登录后再进行操作' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: '需要管理员权限' });
  }
  next();
}

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRouter from './routes/api.js';
import { authenticateToken } from './authMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 全局解析 JWT Token
app.use(authenticateToken);

// 挂载 API
app.use('/api', apiRouter);

// 托管静态前端资源
app.use(express.static(PUBLIC_DIR));

// 前端路由 fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, error: 'API endpoint not found' });
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// 启动服务
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`社课投票网站服务已成功启动！`);
  console.log(`> 本地访问地址: http://localhost:${PORT}`);
  console.log(`> 局域网/手机扫码: http://<你的局域网IP>:${PORT}`);
  console.log(`> 默认管理员账号: admin（密码请通过环境变量 ADMIN_PASSWORD 设置或在管理后台修改）`);
  console.log(`====================================================`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，正在尝试 ${PORT + 1}...`);
    app.listen(PORT + 1, '0.0.0.0', () => {
      console.log(`社课投票服务已运行在: http://localhost:${PORT + 1}`);
    });
  } else {
    console.error('服务启动发生错误:', err);
  }
});

// 发布 Cloudflare Worker（lecture-voting-api）
// 用法：node deploy_worker.mjs
// 凭据来源（按顺序取第一个可用的）：
//   1. 环境变量 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
//   2. 仓库根目录的 .cf-token（JSON：{ "token": "...", "accountId": "..." }，已被 .gitignore 忽略）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(ROOT, 'server', 'cloudflare-worker.js');
const SCRIPT_NAME = 'lecture-voting-api';

function loadCredentials() {
  let token = process.env.CLOUDFLARE_API_TOKEN;
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const localFile = path.join(ROOT, '.cf-token');
  if ((!token || !accountId) && fs.existsSync(localFile)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(localFile, 'utf8'));
      token = token || cfg.token;
      accountId = accountId || cfg.accountId;
    } catch (e) {
      console.error('读取 .cf-token 失败：', e.message);
    }
  }
  if (!token || !accountId) {
    console.error('缺少凭据：请设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID，或创建 .cf-token 文件。');
    process.exit(1);
  }
  return { token, accountId };
}

const { token, accountId } = loadCredentials();
const code = fs.readFileSync(SCRIPT_PATH, 'utf8');

// KV 与 D1 绑定：换成自己账号下的命名空间/数据库 ID
const metadata = {
  main_module: 'worker.js',
  bindings: [
    { type: 'kv_namespace', name: 'VOTING_KV', namespace_id: '968caf0e79d7470a8e739e8225408080' },
    { type: 'd1', name: 'DB', id: '24a1b4fb-34c4-4ce0-8af3-147737897c6f' }
  ]
};

console.log(`发布 ${SCRIPT_NAME}，脚本 ${code.length} 字节…`);
const formData = new FormData();
formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
formData.append('worker.js', new Blob([code], { type: 'application/javascript+module' }), 'worker.js');

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${SCRIPT_NAME}`,
  { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: formData }
);
const data = await res.json();
if (data.success) {
  console.log('发布成功 ✅');
} else {
  console.error('发布失败 ❌', JSON.stringify(data.errors || data.result, null, 2));
  process.exit(1);
}

import assert from 'assert';
import { db } from './db.js';

console.log('--- 开始社课投票系统自动化测试 ---');

// 1. 测试数据库初始状态
const settings = db.getSettings();
assert.ok(settings.title, '设置标题应存在');
assert.strictEqual(settings.maxVotesPerUser, 3, '默认最大投票数应为 3');
console.log('✓ 默认系统配置检查通过');

// 2. 测试候选主题
const topics = db.getTopics();
assert.ok(topics.length >= 6, '应预置至少 6 个社课候选主题');
console.log(`✓ 预置候选主题检查通过，共 ${topics.length} 门社课`);

// 3. 测试用户注册与鉴权
const testUsername = `test_student_${Date.now()}`;
const newUser = db.createUser({
  username: testUsername,
  displayName: '测试同学A',
  password: 'password123'
});
assert.strictEqual(newUser.username, testUsername);
assert.strictEqual(newUser.displayName, '测试同学A');

const foundUser = db.findUserByUsername(testUsername);
assert.ok(foundUser);
assert.ok(db.verifyPassword(foundUser, 'password123'));
assert.ok(!db.verifyPassword(foundUser, 'wrongpassword'));
console.log('✓ 用户注册与密码哈希密码校验通过');

// 4. 测试投票流程
const chosenTopics = [topics[0].id, topics[1].id];
const voteRecord = db.submitVote(newUser.id, chosenTopics);
assert.strictEqual(voteRecord.userId, newUser.id);
assert.deepStrictEqual(voteRecord.topicIds, chosenTopics);

const userVote = db.getUserVote(newUser.id);
assert.ok(userVote);
assert.strictEqual(userVote.topicIds.length, 2);
console.log('✓ 用户选票提交与持久化检查通过');

// 5. 测试统计计算
const stats = db.getStatistics();
assert.ok(stats.totalVoters >= 1);
assert.ok(stats.totalVotesCast >= 2);
const firstTopicStats = stats.topicStats.find(t => t.id === topics[0].id);
assert.ok(firstTopicStats && firstTopicStats.count >= 1);
console.log(`✓ 数据统计与排行榜运算通过: 总参与人数 ${stats.totalVoters}, 总票数 ${stats.totalVotesCast}`);

// 6. 测试修改选票
const updatedTopics = [topics[0].id, topics[2].id, topics[3].id];
const updatedVote = db.submitVote(newUser.id, updatedTopics);
assert.strictEqual(updatedVote.topicIds.length, 3);
const afterUpdateVote = db.getUserVote(newUser.id);
assert.deepStrictEqual(afterUpdateVote.topicIds, updatedTopics);
console.log('✓ 选票修改与更新检查通过');

// 7. 测试主题增删改
const newTopic = db.addTopic({
  title: '测试新增社课',
  speaker: '测试讲师',
  category: '测试分类',
  tag: '测试',
  duration: '30分钟',
  summary: '测试简介',
  outline: ['第一点', '第二点']
});
assert.ok(newTopic.id);
const foundNewTopic = db.getTopicById(newTopic.id);
assert.strictEqual(foundNewTopic.title, '测试新增社课');

db.deleteTopic(newTopic.id);
assert.strictEqual(db.getTopicById(newTopic.id), null);
console.log('✓ 管理员主题增删检查通过');

console.log('--- 所有后端单元测试均已成功通过！ ---');

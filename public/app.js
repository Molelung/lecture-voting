const { createApp, ref, computed, onMounted, nextTick } = Vue;

createApp({
  setup() {
    // 安全读取与保存存储（防止 iOS 无痕模式或 Cookie 限制抛出异常导致整页白屏）
    const getSafeStorage = (key) => {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    };
    const setSafeStorage = (key, val) => {
      try { localStorage.setItem(key, val); } catch (e) {}
    };
    const getCookie = (name) => {
      try {
        const match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
        return match ? decodeURIComponent(match[3]) : null;
      } catch (e) { return null; }
    };
    const setCookie = (name, val, days = 365) => {
      try {
        const d = new Date();
        d.setTime(d.getTime() + (days * 86400000));
        document.cookie = `${name}=${encodeURIComponent(val)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
      } catch (e) {}
    };

    // 1. 设备匿名凭据（双轨 LocalStorage + Cookie 交叉恢复，防日期变更、防微信清理缓存）
    let storedToken = getSafeStorage('lecture_voter_token') || getCookie('lecture_voter_token');
    if (!storedToken) {
      storedToken = 'voter-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
    }
    setSafeStorage('lecture_voter_token', storedToken);
    setCookie('lecture_voter_token', storedToken, 365);
    const voterToken = ref(storedToken);

    // 本地持久化选票即时恢复（Instant Render，消除跨日访问与弱网加载时的空白跳闪）
    const cachedBallot = getSafeStorage('lecture_voter_ballot');
    let initialUserVote = null;
    let initialHasVoted = false;
    let initialSelectedTopicIds = [];
    let initialVotingComment = '';
    if (cachedBallot) {
      try {
        const parsed = JSON.parse(cachedBallot);
        if (parsed && (parsed.topicIds || parsed.votedAt)) {
          initialUserVote = parsed;
          initialHasVoted = true;
          initialSelectedTopicIds = Array.isArray(parsed.topicIds) ? [...parsed.topicIds] : [];
          initialVotingComment = parsed.comment || '';
        }
      } catch (e) {}
    }

    // 2. 状态管理
    const loading = ref(true);
    const hasVoted = ref(initialHasVoted);
    const userVote = ref(initialUserVote);
    const selectedTopicIds = ref(initialSelectedTopicIds);
    const votingComment = ref(initialVotingComment);
    const showConfirmModal = ref(false);
    const submittingVote = ref(false);

    // 管理员状态
    const adminToken = ref(localStorage.getItem('lecture_admin_token') || '');
    const isAdmin = ref(!!adminToken.value);
    const showAdminModal = ref(false);
    const adminActiveTab = ref('topics'); // 'topics' | 'settings' | 'ballots' | 'comments'
    const adminLoginForm = ref({ username: 'admin', password: '' });
    const adminPasswordForm = ref({ oldPassword: '', newPassword: '', confirmPassword: '' });
    const changingAdminPassword = ref(false);
    const ballots = ref([]);
    const ballotSearchQuery = ref('');
    const adminTopicSearchQuery = ref('');
    const adminExpandedTopicIds = ref([]);
    const adminCommentFilter = ref('all');
    const adminCommentSearch = ref('');
    const adminDiagnostics = ref(null);
    const adminReordering = ref(false);

    // 社课内容编辑与新增状态
    const showTopicEditModal = ref(false);
    const isEditingNewTopic = ref(false);
    const editingTopic = ref({
      id: '',
      title: '',
      speaker: '',
      category: '',
      tag: '',
      duration: '',
      hook: '',
      summary: '',
      outlineText: ''
    });
    const savingTopic = ref(false);

    // 管理员系统全局配置编辑表单
    const adminSettingsForm = ref({
      title: '朋辈社课大投票！',
      subtitle: '',
      maxVotesPerUser: 3,
      allowChangeVote: true,
      status: 'open',
      resultsVisibility: 'after_vote'
    });
    const savingSettings = ref(false);

    // 系统配置与本地缓存（优先秒级直读本地缓存，杜绝网络请求前后的文字跳闪）
    const getCachedJson = (key, fallback) => {
      try {
        const item = localStorage.getItem(key);
        if (!item) return fallback;
        const parsed = JSON.parse(item);
        if (Array.isArray(fallback) && Array.isArray(parsed)) {
          if (parsed.length < fallback.length) return fallback;
        }
        if (key === 'lecture_cached_settings' && parsed && fallback) {
          parsed.resultsVisibility = fallback.resultsVisibility;
        }
        return parsed;
      } catch (e) {
        return fallback;
      }
    };

    const DEFAULT_INITIAL_TOPICS = [
  {
    "id": "topic-1",
    "title": "【向内】爱自己",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "自我疗愈",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【自我疗愈】“奇怪的悖论在于，当我全然接纳真实的自己时，改变才会发生。” ——卡尔·罗杰斯",
    "summary": "真正的爱自己并非消费主义层面的即时犒劳，而是建立在自我关怀（Self-Compassion）与无条件自我接纳之上的心智实践。本课围绕自我友善、普遍人性感知与正念觉察，探讨如何停止苛刻的“内在批判者”对话，在遭遇挫折与心理内耗时重构安全的内心据点，实现深层的自我疗愈与能量回流。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:01.000Z"
  },
  {
    "id": "topic-2",
    "title": "【向内】你想要怎样的人生？",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "自我认同",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【自我认同】“知道为什么而活的人，便能承受任何一种生活。” ——弗里德里希·尼采",
    "summary": "从埃里克森的自我同一性（Self-Identity）危机与马西亚的认同状态模型出发，审视我们是在追逐外界赋予的“应当”，还是在探索自我的本质。课程结合价值澄清（Values Clarification）与内在动机理论，引导大家厘清核心生命价值，在迷茫与不确定性中确立属于自己的秩序感与人生航向。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:02.000Z"
  },
  {
    "id": "topic-3",
    "title": "【向内】类型心理学",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "类型心理学",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【类型心理学】“向外看的人在做梦，向内看的人方才清醒。” ——卡尔·荣格",
    "summary": "破除快餐文化中标签化的刻板印象，以荣格的心理类型论（Psychological Types）与现代大五人格模型（Big Five）为坐标轴，简明通透地剖析内倾与外倾、感觉与直觉等认知功能偏好。帮助大家建立清晰的自我心智画像，理解个体差异背后的机能运转，学会扬长避短并达成与他人的深度共情。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:03.000Z"
  },
  {
    "id": "topic-4",
    "title": "【向内】翻山越岭时",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "目的论与课题分离",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【目的论与课题分离】“决定我们的不是过去的经历，而是我们为经历赋予的意义。” ——阿尔弗雷德·阿德勒",
    "summary": "基于阿尔弗雷德·阿德勒的个体心理学，打破“原因论”的宿命束缚，转向以目的论（Teleology）重新诠释当下的选择与困顿。深度解构课题分离（Separation of Tasks）与共同体感觉，帮助我们在复杂的人际期待与现实羁绊面前建立坚韧的心灵边界，汲取奔赴自我人生的主观勇气。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:04.000Z"
  },
  {
    "id": "topic-5",
    "title": "【向内】梦之迷思",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "梦的解析与精神分析",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【梦的解析与精神分析】“对梦的解析，是通往潜意识知识的康庄大道。” ——西格蒙德·弗洛伊德",
    "summary": "循着经典精神分析（Psychoanalysis）的深邃脉络，探索弗洛伊德笔下“通往潜意识的康庄大道”。深度解析显梦与隐意背后的凝缩、移置与象征等心理防御机制（Defense Mechanisms），并结合认知神经科学对快速眼动睡眠（REM）的研究，揭示梦境在情绪整合与自我整合层面的潜意识密码。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:05.000Z"
  },
  {
    "id": "topic-6",
    "title": "【向内】我们本为矛盾集合体",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "神经症结",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【神经症结】“只要我们还活着，内心的冲突就不可避免；直面冲突，才是自由的开端。” ——卡伦·霍妮",
    "summary": "立足卡伦·霍妮的神经症人格理论，剖析我们在“亲近人、反抗人、回避人”三种基本态度间的摇摆与内心冲突。深度探讨理想化自我意象（Idealized Self-Image）与真实自我之间的剧烈撕裂，剖析内疚感、病态焦虑与强迫性追求的深层症结，学会接纳矛盾本性，走向真实的内在和谐。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:06.000Z"
  },
  {
    "id": "topic-7",
    "title": "【向内】考试在考些什么！",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "考试脑科学",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【考试脑科学】“欺骗海马体的秘诀，不是机械输入，而是高频次的主动提取与输出。” ——池谷裕二",
    "summary": "跳出死记硬背与盲目刷题的低效陷阱，从认知心理学与认知神经科学（Cognitive Neuroscience）的视角拆解学习本质。深度剖析海马体记忆编码、工作记忆容量限制与测试效应（Testing Effect），传授如何运用间隔检索与神经可塑性原理抵抗遗忘曲线，在高压考核中保持理性清醒与认知韧性。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:07.000Z"
  },
  {
    "id": "topic-8",
    "title": "【向内】当人生的丘比特",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "青春期与爱情",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【青春期与爱情】“不成熟的爱说‘因为我需要你，所以我爱你’；成熟的爱说‘因为我爱你，所以我需要你’。” ——埃里希·弗洛姆",
    "summary": "从斯滕伯格的爱情三元论（Triangular Theory of Love，涵盖亲密、激情、承诺）与依恋风格（Attachment Styles）展开，探讨青春期荷尔蒙、多巴胺奖赏回路与心智成长交织的情感萌动。理性剖析理想化投射、人际边界与依恋冲突，帮助大家理解心动的本质，掌握构建成熟、真诚且互相滋养的亲密关系心法。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:08.000Z"
  },
  {
    "id": "topic-9",
    "title": "【向内】完美只存于心",
    "speaker": "墨澜 & 诙谐",
    "category": "向内",
    "tag": "破解完美主义",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【破解完美主义】“万物皆有裂痕，那是光照进来的地方。” ——莱昂纳德·科恩",
    "summary": "破除‘必须做到尽善尽美’的认知枷锁，立足临床心理学与认知行为理论（CBT）对适应不良型完美主义（Maladaptive Perfectionism）的系统剖析。深度解构‘全或无’二分思维、冒充者综合征与对负面评价的恐惧（Fear of Negative Evaluation），探讨成就与自我价值（Self-Worth）的过度捆绑机制。结合接纳承诺疗法（ACT）与‘足够好’（Good Enough）原则，传授认知重构与行为暴露心法，学会在真实世界的瑕疵中安住身心，破解拖延与自我内耗，重获轻盈前行的心理弹性。",
    "outline": [],
    "createdAt": "2026-09-18T21:50:09.000Z"
  },
  {
    "id": "topic-10",
    "title": "【向外】爱河于爱意中流淌",
    "speaker": "墨澜 & 诙谐",
    "category": "向外",
    "tag": "亲密关系·爱情篇",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【亲密关系·爱情篇】“爱绝不是互相凝视，而是朝同一个方向并肩凝视。” ——安托万·德·圣-埃克苏佩里",
    "summary": "跳脱浪漫主义幻想的迷思，从社会心理学与人际吸引理论（Interpersonal Attraction）切入。深度探讨互惠性、自我表露（Self-Disclosure）与情感共鸣在亲密关系建立与维系中的核心作用。剖析爱情中的沟通归因偏差与承诺机制，学会如何在真实的亲密互动中跨越摩擦，让爱意在理解与尊重中持久流淌。",
    "outline": [],
    "createdAt": "2026-09-18T21:56:01.000Z"
  },
  {
    "id": "topic-11",
    "title": "【向外】友谊于真情中长存",
    "speaker": "墨澜 & 诙谐",
    "category": "向外",
    "tag": "亲密关系·友谊篇",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【亲密关系·友谊篇】“什么是朋友？那是寄居在两个身体里的同一个灵魂。” ——亚里士多德",
    "summary": "从人际交往的社会交换理论（Social Exchange Theory）与朋辈支持系统（Peer Support System）展开，探索友谊从浅层社交走向深层同盟的心智轨迹。聚焦共情理解、情感边界与人际信任的建立，探讨如何在快节奏与角色转换中应对友谊疏离，维系真诚、稳定且赋予彼此生命韧性的挚友情谊。",
    "outline": [],
    "createdAt": "2026-09-18T21:56:02.000Z"
  },
  {
    "id": "topic-12",
    "title": "【向外】脏话心理学",
    "speaker": "墨澜 & 诙谐",
    "category": "向外",
    "tag": "社会心理学",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【社会心理学】“在极度痛苦的时刻，脏话所能给予的情绪慰藉，是祈祷文所无法比拟的。” ——马克·吐温",
    "summary": "跳出刻板的道德评判，立足社会心理学与神经语言学（Neurolinguistics）视阈，透视脏话与禁忌语的心理成因。深入剖析情绪宣泄、低限度镇痛效应（Hypoalgesic Effect）以及在特定群体中的社会凝聚与身份认同功能；同时探讨如何建立言语元认知觉察（Metacognitive Awareness），在理解情绪冲动本源的同时掌握非攻击性的情感表达方式。",
    "outline": [],
    "createdAt": "2026-09-18T21:56:03.000Z"
  },
  {
    "id": "topic-13",
    "title": "【向下】心绪流淌",
    "speaker": "墨澜 & 诙谐",
    "category": "向下",
    "tag": "心流",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【心流】“全身心投入某件事，忘却时间的流逝与自我的存在，便是生命的最优体验。” ——米哈里·契克森米哈赖",
    "summary": "基于米哈里·契克森米哈赖的心流理论（Flow Theory），探讨注意力完全沉浸、自我意识暂歇的极致心智状态。剖析技能水平与挑战难度的精密动态平衡，解构清晰目标、即时反馈与前额叶短暂低激活（Hypofrontality）机制，帮助大家摆脱外界噪音干扰，在日常研习中主动搭建进入心流通道的高效心智脚手架。",
    "outline": [],
    "createdAt": "2026-09-18T21:58:01.000Z"
  },
  {
    "id": "topic-14",
    "title": "【向下】天赋赠予我",
    "speaker": "墨澜 & 诙谐",
    "category": "向下",
    "tag": "刻意练习",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【刻意练习】“所谓卓越，不是天赋的私相授受，而是心智走出舒适区后的持续重塑。” ——安德斯·埃里克森",
    "summary": "破除‘唯天赋论’的认知宿命，立足安德斯·埃里克森的刻意练习（Deliberate Practice）模型与脑神经可塑性原理。深度解析如何跳出无意识的机械重复与舒适区，建立高质量的心理表征（Mental Representations）；通过针对性微步拆解、即时纠偏反馈与长期髓鞘质沉淀机制，将模糊的潜能淬炼为稳定卓越的专业心智能力。",
    "outline": [],
    "createdAt": "2026-09-18T21:58:02.000Z"
  },
  {
    "id": "topic-15",
    "title": "【向下】锚定思绪",
    "speaker": "墨澜 & 诙谐",
    "category": "向下",
    "tag": "专注力",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【专注力】“信息的丰富导致了注意力的匮乏；心智的品质取决于专注的深度。” ——赫伯特·西蒙",
    "summary": "从认知心理学中的选择性注意（Selective Attention）与执行控制网络（Executive Control Network）切入，审视现代注意力经济对心智聚焦的瓦解。深度剖析任务切换损耗与注意力残留（Attention Residue）效应，传授基于环境摩擦力设计、认知负荷控制与无干扰深潜心法的专注力工程化落地路径，夺回大脑的主控权。",
    "outline": [],
    "createdAt": "2026-09-18T21:58:03.000Z"
  },
  {
    "id": "topic-16",
    "title": "【向下】遁入空灵",
    "speaker": "墨澜 & 诙谐",
    "category": "向下",
    "tag": "正念与移空",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【正念与移空】“正念就是有意识、不带评判地，将全部觉知安放于此时此刻。” ——乔·卡巴金",
    "summary": "立足正念减压疗法（MBSR）与认知解离（Cognitive Defusion）理论，探索如何平息大脑默认模式网络（Default Mode Network, DMN）的过度反刍。结合传统移空技术与现代具身觉察，学会在焦虑与执念升起时退后一步，以‘观察者自我’审视思绪的流动，体验心神澄澈、身心安顿的空灵境界。",
    "outline": [],
    "createdAt": "2026-09-18T21:58:04.000Z"
  },
  {
    "id": "topic-17",
    "title": "【向下】手指伸缩自如",
    "speaker": "墨澜 & 诙谐",
    "category": "向下",
    "tag": "自控力",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【自控力】“自控的关键不是压抑欲望的死撑，而是清晰洞悉自己内心深处真正想要什么。” ——凯利·麦格尼格尔",
    "summary": "颠覆‘靠死撑对抗诱惑’的误区，以自我损耗模型（Ego Depletion）的最新修正与前额叶抑制控制（Inhibitory Control）机制为依托。深度拆解多巴胺渴求回路与即时满足陷阱，传授冷热认知切换、执行意图（Implementation Intentions，若-则计划）与预先承诺策略，实现如‘手指伸缩自如’般游刃有余、不费力的自律实践。",
    "outline": [],
    "createdAt": "2026-09-18T21:58:05.000Z"
  },
  {
    "id": "topic-18",
    "title": "【向下】清醒的活",
    "speaker": "墨澜 & 诙谐",
    "category": "向下",
    "tag": "活在当下",
    "duration": "45分钟 + 15分钟研讨",
    "hook": "【活在当下】“你不是脑海中那个喋喋不休的声音，你是聆听那个声音的清醒觉知。” ——迈克·辛格",
    "summary": "深度汲取《清醒地活着》（The Untethered Soul）的心灵洞见，并与阿德勒个体心理学中‘人生如连续刹那的聚光灯舞台’哲学思想深度交融。跳脱对过去遗憾的反刍与对未来不确定性的灾难化预演，引导我们觉察内心永不停歇的‘独白者’，以超越性的觉知打破情绪内耗与认知纠缠；学会收束弥散的焦虑，将全部心力聚焦于此时此刻正在经历的‘点’，在踏实的行进中体验安顿、澄明与真实的生命力量。",
    "outline": [],
    "createdAt": "2026-09-18T21:58:06.000Z"
  }
];

    const initialSettings = getCachedJson('lecture_cached_settings', {
      title: '朋辈社课大投票！',
      subtitle: '',
      maxVotesPerUser: 3,
      allowChangeVote: true,
      status: 'open',
      resultsVisibility: 'after_vote'
    });

    const settings = ref(initialSettings);
    const topics = ref([]);
    const stats = ref({
      totalVoters: 0,
      totalVotesCast: 0,
      topicStats: []
    });
    const statsSummary = ref({
      totalVoters: 0,
      totalVotesCast: 0
    });

    // 交互与过滤状态
    const activeTab = ref('vote'); // 'vote' | 'results'
    const activeCategory = ref('全部');
    const searchQuery = ref('');
    const showSearchInput = ref(false);
    const showMobileSearch = ref(false);
    const showCategoryDrawer = ref(false);
    const categoryScrollContainer = ref(null);
    const mobileSearchInputRef = ref(null);
    const expandedTopicIds = ref([]);
    const topicComments = ref({});
    const newCommentTexts = ref({});

    // 公共社区讨论留言板状态 (随时自由留言，无需投票即可畅所欲言)
    const publicComments = ref([]);
    const publicCommentsLoading = ref(false);
    const commentFilter = ref('all'); // 'all' | 'general' | 'cat:向内' | 'cat:向外' | 'cat:向下' | 'topic-X'
    const commentFilterTopicId = commentFilter; // 保持兼容别名
    const newPublicComment = ref({
      authorName: '',
      topicId: 'general',
      text: ''
    });
    const submittingPublicComment = ref(false);

    // 手机分享
    const mobileUrl = ref(window.location.href.split('?')[0].split('#')[0]);
    const showQrModal = ref(false);

    // 触觉反馈 (Haptic)
    const triggerHaptic = (type = 'light') => {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          if (type === 'light') navigator.vibrate(12);
          else if (type === 'medium') navigator.vibrate(28);
          else if (type === 'success') navigator.vibrate([15, 60, 30]);
        } catch (e) {}
      }
    };

    // 消息提示 (Toast)
    const toast = ref({ show: false, message: '', type: 'info' });
    let toastTimer = null;
    const showToast = (message, type = 'info') => {
      if (toastTimer) clearTimeout(toastTimer);
      toast.value = { show: true, message, type };
      toastTimer = setTimeout(() => {
        toast.value.show = false;
      }, 3000);
    };

    // API 端点配置（优选国内极速直连域名，配置两组安全域名容灾）
    const PRIMARY_API = 'https://vote.molan.cc.cd';
    const FALLBACK_API = 'https://vote.listener.ccwu.cc';
    const IS_LOCAL = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    let activeApiBase = IS_LOCAL ? '' : PRIMARY_API;

    // API 请求封装（内置 10 秒超时中断、多通道凭据透传与主备双节点无感热切换）
    const api = async (url, options = {}) => {
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Voter-Token': voterToken.value,
        ...(adminToken.value ? { 'Authorization': `Bearer ${adminToken.value}` } : {}),
        ...options.headers
      };

      // 强化：请求体自动补充 voterToken，防止透明代理剥离自定义请求头
      let bodyData = options.body;
      if (bodyData && typeof bodyData === 'string' && options.method && options.method !== 'GET') {
        try {
          const parsed = JSON.parse(bodyData);
          if (parsed && typeof parsed === 'object' && !parsed.voterToken) {
            parsed.voterToken = voterToken.value;
            bodyData = JSON.stringify(parsed);
          }
        } catch (e) {}
      }

      // 强化：URL 自动附带 query voterToken 参数作为第三重备份
      let targetUrl = url;
      if (targetUrl.startsWith('/api') && !targetUrl.includes('voterToken=') && voterToken.value) {
        targetUrl += (targetUrl.includes('?') ? '&' : '?') + 'voterToken=' + encodeURIComponent(voterToken.value);
      }

      const doFetch = async (baseUrl) => {
        const fullUrl = targetUrl.startsWith('/api') && baseUrl ? `${baseUrl}${targetUrl}` : targetUrl;
        
        // 10 秒超时中断控制器，彻底解决弱网挂起卡住问题
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
          const res = await fetch(fullUrl, {
            ...options,
            body: bodyData,
            headers,
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          let data = {};
          try {
            data = await res.json();
          } catch (e) {
            data = { error: '返回数据解析异常' };
          }

          if (!res.ok) {
            const err = new Error(data.error || `请求服务异常 (${res.status})`);
            err.status = res.status;
            err.data = data;
            throw err;
          }

          // 如果响应中返回了确认的 voterToken，双向对齐保存
          if (data && data.voterToken && data.voterToken !== voterToken.value) {
            voterToken.value = data.voterToken;
            setSafeStorage('lecture_voter_token', data.voterToken);
            setCookie('lecture_voter_token', data.voterToken, 365);
          }

          return data;
        } catch (err) {
          clearTimeout(timeoutId);
          if (err.name === 'AbortError') {
            const timeoutErr = new Error('网络请求超时，请检查校园网/移动网络连接');
            timeoutErr.status = 408;
            throw timeoutErr;
          }
        }
      };

      const doFetchWithJitter = async (baseUrl) => {
        try {
          return await doFetch(baseUrl);
        } catch (err) {
          // 4xx 业务错误无需重试
          if (err.status && err.status >= 400 && err.status < 500) throw err;
          // 移动蜂窝基站/Wi-Fi 微抖动：等待 350ms 后原位极速重试 1 次
          await new Promise(r => setTimeout(r, 350));
          return await doFetch(baseUrl);
        }
      };

      try {
        return await doFetchWithJitter(activeApiBase);
      } catch (err) {
        // 如果是 HTTP 4xx 业务级错误（如参数不全、密码错误、达到最大投票数等），说明服务完全畅通，绝对不触发节点切换
        if (err.status && err.status >= 400 && err.status < 500) {
          showToast(err.message, 'warning');
          throw err;
        }

        // 仅在主域名出现断网/DNS解析失败/502网关异常/超时(408)时，无感热切换至对端节点
        if (!IS_LOCAL) {
          const alternateBase = activeApiBase === PRIMARY_API ? FALLBACK_API : PRIMARY_API;
          try {
            console.warn('当前接入点波动或超时，正在无感切换至对端备份节点...', alternateBase);
            const data = await doFetchWithJitter(alternateBase);
            activeApiBase = alternateBase;
            return data;
          } catch (fallbackErr) {
            showToast(fallbackErr.message || err.message, 'error');
            throw fallbackErr;
          }
        }
        showToast(err.message, 'error');
        throw err;
      }
    };

    // 初始化数据加载（双轨同步）
    const initData = async () => {
      loading.value = true;
      try {
        const res = await api('/api/status');
        if (res.settings) {
          settings.value = res.settings;
          try {
            localStorage.setItem('lecture_cached_settings', JSON.stringify(res.settings));
          } catch (e) {}
        }
        initAdminSettingsForm();
        hasVoted.value = res.hasVoted;
        userVote.value = res.userVote;
        statsSummary.value = res.statsSummary || { totalVoters: 0, totalVotesCast: null };

        // 同步本地持久化选票：若已投票则保存，若未投票（如被重置）则清理
        if (res.hasVoted && res.userVote) {
          setSafeStorage('lecture_voter_ballot', JSON.stringify(res.userVote));
        } else if (!res.hasVoted) {
          try { localStorage.removeItem('lecture_voter_ballot'); } catch (e) {}
        }

        // 如果用户本设备已投过票，回显之前选中的选项
        if (userVote.value && userVote.value.topicIds) {
          selectedTopicIds.value = [...userVote.value.topicIds];
          if (userVote.value.comment) {
            votingComment.value = userVote.value.comment;
          }
        }

        // 加载社课卡片
        await loadTopics();

        // 加载全站公共讨论区留言
        await loadPublicComments();

        // 加载榜单（始终加载标题，票数由前端按投票状态控制可见性）
        await loadResults();
      } catch (err) {
        console.error('初始化数据异常:', err);
        // 仅在真实网络离线时安全降级，保证离线可用
        if (topics.value.length === 0) {
          topics.value = DEFAULT_INITIAL_TOPICS;
        }
      } finally {
        loading.value = false;
      }
    };

    const loadTopics = async () => {
      try {
        const res = await api('/api/topics');
        if (res.topics && res.topics.length > 0) {
          topics.value = res.topics;
        }
      } catch (e) {
        if (topics.value.length === 0) {
          topics.value = DEFAULT_INITIAL_TOPICS;
        }
      }
    };

    const loadResults = async () => {
      try {
        const res = await api('/api/results');
        if (res.stats) {
          stats.value = res.stats;
        }
      } catch (e) {}
    };

    // 榜单可见性计算（前台学生端严格受投后与公开规则约束，管理员权限不外溢至学生投票主界面）
    const canSeeResults = computed(() => {
      if (settings.value && settings.value.resultsVisibility === 'public') return true;
      return hasVoted.value;
    });

    // 切换卡片折叠展开
    const toggleExpand = async (topicId) => {
      triggerHaptic('light');
      const idx = expandedTopicIds.value.indexOf(topicId);
      if (idx > -1) {
        expandedTopicIds.value.splice(idx, 1);
      } else {
        expandedTopicIds.value.push(topicId);
        // 拉取该课的留言
        await loadTopicComments(topicId);
      }
    };

    // 加载单门课留言
    const loadTopicComments = async (topicId) => {
      try {
        const res = await api(`/api/topics/${topicId}/comments`);
        topicComments.value[topicId] = res.comments;
      } catch (e) {}
    };

    // 快捷提交单课心愿留言
    const submitQuickComment = async (topicId) => {
      const text = (newCommentTexts.value[topicId] || '').trim();
      if (!text) {
        showToast('请输入留言内容', 'warning');
        return;
      }
      triggerHaptic('medium');
      try {
        const res = await api(`/api/topics/${topicId}/comments`, {
          method: 'POST',
          body: JSON.stringify({ text })
        });
        if (!topicComments.value[topicId]) {
          topicComments.value[topicId] = [];
        }
        topicComments.value[topicId].unshift(res.comment);
        newCommentTexts.value[topicId] = '';
        showToast('心愿留言已发布！', 'success');
        // 实时触发全站公共留言池静默同步
        loadPublicComments();
      } catch (e) {
        showToast(e.message, 'error');
      }
    };

    // 格式化时间（防御性容错）
    const formatTime = (isoString) => {
      if (!isoString) return '刚刚';
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '刚刚';
      const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
      if (diffMin < 2) return '刚刚';
      if (diffMin < 60) return `${diffMin}分钟前`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `${diffHour}小时前`;
      return `${d.getMonth() + 1}月${d.getDate()}日`;
    };

    // 计算各分类留言数量
    const commentCategoryCounts = computed(() => {
      const counts = {
        all: publicComments.value.length,
        general: 0,
        inward: 0,
        outward: 0,
        downward: 0
      };
      const topicCatMap = new Map(topics.value.map(t => [t.id, t.category]));
      for (const c of publicComments.value) {
        if (!c.topicId || c.topicId === 'general') {
          counts.general++;
        } else {
          const cat = topicCatMap.get(c.topicId);
          if (cat === '向内') counts.inward++;
          else if (cat === '向外') counts.outward++;
          else if (cat === '向下') counts.downward++;
        }
      }
      return counts;
    });

    // 留言区胶囊分类条（与顶部社课胶囊 100% 统一设计系统）
    const commentCategoryPills = computed(() => [
      { id: 'all', name: '全部', count: commentCategoryCounts.value.all },
      { id: 'general', name: '公共交流', count: commentCategoryCounts.value.general },
      { id: 'cat:向内', name: '向内', count: commentCategoryCounts.value.inward },
      { id: 'cat:向外', name: '向外', count: commentCategoryCounts.value.outward },
      { id: 'cat:向下', name: '向下', count: commentCategoryCounts.value.downward }
    ]);

    // 判断当前下拉选框是否处于具体社课选中态
    const isTopicSelectedInCommentFilter = computed(() => {
      return (commentFilter.value || '').startsWith('topic-');
    });

    // 切换留言筛选
    const setCommentFilter = (filterId) => {
      commentFilter.value = filterId || 'all';
      triggerHaptic('light');
    };

    // 筛选后展现的公共留言流
    const filteredPublicComments = computed(() => {
      const f = commentFilter.value;
      if (!f || f === 'all') return publicComments.value;
      if (f === 'general') {
        return publicComments.value.filter(c => !c.topicId || c.topicId === 'general');
      }
      if (f.startsWith('cat:')) {
        const cat = f.replace('cat:', '');
        const topicCatMap = new Map(topics.value.map(t => [t.id, t.category]));
        return publicComments.value.filter(c => c.topicId && topicCatMap.get(c.topicId) === cat);
      }
      return publicComments.value.filter(c => c.topicId === f);
    });

    // 获取议题简称
    const getTopicShortTitle = (tid) => {
      if (!tid || tid === 'general') return '公共留言';
      const found = topics.value.find(t => t.id === tid);
      if (found) {
        return found.title;
      }
      return '社课议题';
    };

    // 加载全站公共讨论区留言
    const loadPublicComments = async () => {
      publicCommentsLoading.value = true;
      try {
        const res = await api('/api/comments');
        publicComments.value = res.comments || [];
      } catch (e) {
        console.error('加载公共留言失败:', e);
      } finally {
        publicCommentsLoading.value = false;
      }
    };

    // 提交公共交流区留言（全员免投自由发言）
    const submitPublicComment = async () => {
      const text = (newPublicComment.value.text || '').trim();
      if (!text) {
        showToast('请输入留言内容', 'warning');
        return;
      }
      submittingPublicComment.value = true;
      triggerHaptic('medium');
      try {
        const res = await api('/api/comments', {
          method: 'POST',
          body: JSON.stringify({
            text,
            authorName: (newPublicComment.value.authorName || '').trim() || '同学',
            topicId: newPublicComment.value.topicId || 'general'
          })
        });
        publicComments.value.unshift(res.comment);

        // 如果关联了具体社课，同步更新单课大纲留言列表与议题留言数
        if (res.comment.topicId && res.comment.topicId !== 'general') {
          if (!topicComments.value[res.comment.topicId]) {
            topicComments.value[res.comment.topicId] = [];
          }
          topicComments.value[res.comment.topicId].unshift(res.comment);
          const t = topics.value.find(item => item.id === res.comment.topicId);
          if (t) t.commentCount = (t.commentCount || 0) + 1;
        }

        newPublicComment.value.text = '';
        showToast('留言已成功发布！', 'success');
      } catch (e) {
        showToast(e.message || '留言发布失败', 'error');
      } finally {
        submittingPublicComment.value = false;
      }
    };

    // 删除留言（管理员权限）
    const deleteComment = async (commentId) => {
      if (!confirm('确定删除该留言吗？此操作不可逆。')) return;
      try {
        await api(`/api/comments/${commentId}`, { method: 'DELETE' });
        publicComments.value = publicComments.value.filter(c => c.id !== commentId);
        Object.keys(topicComments.value).forEach(tid => {
          topicComments.value[tid] = (topicComments.value[tid] || []).filter(c => c.id !== commentId);
        });
        showToast('留言已删除', 'info');
      } catch (e) {
        showToast(e.message || '删除失败', 'error');
      }
    };

    // 分类胶囊样式
    const getCategoryClass = (category) => {
      if (!category) return 'amie-pill-neutral';
      if (category.includes('认知') || category.includes('决策')) return 'amie-pill-blue';
      if (category.includes('效能') || category.includes('成长') || category.includes('拖延')) return 'amie-pill-purple';
      if (category.includes('博弈') || category.includes('合作')) return 'amie-pill-emerald';
      if (category.includes('人际') || category.includes('沟通') || category.includes('亲密')) return 'amie-pill-rose';
      if (category.includes('思维') || category.includes('素养')) return 'amie-pill-amber';
      return 'amie-pill-neutral';
    };

    // 标题主副拆解（解决标题过长视觉混乱问题）
    const getTopicMainTitle = (title) => {
      if (!title) return '';
      if (title.includes('：')) return title.split('：')[0].trim();
      if (title.includes(': ')) return title.split(': ')[0].trim();
      return title;
    };

    const getTopicSubTitle = (title) => {
      if (!title) return '';
      if (title.includes('：')) return title.split('：').slice(1).join('：').trim();
      if (title.includes(': ')) return title.split(': ').slice(1).join(': ').trim();
      return '';
    };

    // 一句话简介抓手结构化拆分（提取开头的【主题】微标与正文）
    const getHookTag = (hook) => {
      if (!hook) return '';
      const match = hook.match(/^【(.*?)】/);
      return match ? `【${match[1]}】` : '';
    };

    const getHookText = (hook) => {
      if (!hook) return '';
      return hook.replace(/^【.*?】/, '').trim();
    };

    // 动态分类清单（包含统计数量）
    const categories = computed(() => {
      const counts = {};
      topics.value.forEach(t => {
        const cat = t.category || '通识';
        counts[cat] = (counts[cat] || 0) + 1;
      });
      const list = [{ name: '全部', count: topics.value.length }];
      Object.keys(counts).forEach(cat => {
        list.push({ name: cat, count: counts[cat] });
      });
      return list;
    });

    // 过滤后的社课
    const filteredTopics = computed(() => {
      return topics.value.filter(t => {
        const matchCategory = activeCategory.value === '全部' || t.category === activeCategory.value;
        const query = searchQuery.value.trim().toLowerCase();
        const matchSearch = !query || 
          t.title.toLowerCase().includes(query) || 
          (t.speaker && t.speaker.toLowerCase().includes(query)) || 
          (t.summary && t.summary.toLowerCase().includes(query));
        return matchCategory && matchSearch;
      });
    });

    const selectedTopics = computed(() => {
      return topics.value.filter(t => selectedTopicIds.value.includes(t.id));
    });

    const hasSelectionChanged = computed(() => {
      if (!userVote.value) return selectedTopicIds.value.length > 0;
      const orig = [...(userVote.value.topicIds || [])].sort().join(',');
      const curr = [...selectedTopicIds.value].sort().join(',');
      return orig !== curr;
    });

    // 勾选/取消勾选社课
    const toggleTopic = (topicId) => {
      triggerHaptic('light');
      if (settings.value.status === 'closed') {
        showToast('投票已截止并锁定', 'warning');
        return;
      }
      if (settings.value.status === 'paused') {
        showToast('投票暂缓进行中', 'warning');
        return;
      }

      const idx = selectedTopicIds.value.indexOf(topicId);
      if (idx > -1) {
        selectedTopicIds.value.splice(idx, 1);
      } else {
        const max = settings.value.maxVotesPerUser || 3;
        if (selectedTopicIds.value.length >= max) {
          triggerHaptic('medium');
          showToast(`每人至多投 ${max} 票，请先取消其他选项`, 'warning');
          return;
        }
        selectedTopicIds.value.push(topicId);
      }
    };

    // 点击提交按钮
    const handlePreSubmit = () => {
      triggerHaptic('medium');
      if (selectedTopicIds.value.length === 0) {
        showToast('请先挑选至少 1 门心仪社课', 'warning');
        return;
      }
      showConfirmModal.value = true;
    };

    // 确认投出选票（零门槛免密）
    const confirmSubmitVote = async () => {
      submittingVote.value = true;
      try {
        const res = await api('/api/vote', {
          method: 'POST',
          body: JSON.stringify({
            voterToken: voterToken.value,
            topicIds: selectedTopicIds.value,
            comment: votingComment.value
          })
        });

        triggerHaptic('success');
        showToast(res.message || '选票投出成功！已为您揭晓实时热度榜', 'success');
        if (window.fireAmieConfetti) {
          window.fireAmieConfetti();
        }

        hasVoted.value = true;
        userVote.value = res.vote;
        // 即时写入本地存储，确保离线、跨日访问毫秒级渲染
        if (res.vote) {
          setSafeStorage('lecture_voter_ballot', JSON.stringify(res.vote));
        }
        showConfirmModal.value = false;

        // 即刻解锁票数与热度排行榜及公共讨论区
        await loadTopics();
        await loadResults();
        await loadPublicComments();
      } catch (err) {
        console.error('投票失败:', err);
        // 如果是断网或网络超时无响应，自动保存至离线队列，网络恢复时自愈同步
        if (!err.status || err.status >= 500 || err.status === 408) {
          const pendingData = {
            voterToken: voterToken.value,
            topicIds: [...selectedTopicIds.value],
            comment: votingComment.value,
            timestamp: Date.now()
          };
          setSafeStorage('lecture_pending_vote', JSON.stringify(pendingData));
          showToast('当前网络连接中断，已为您安全暂存选票！网络恢复后将自动为您重试提交', 'info');
          showConfirmModal.value = false;
        }
      } finally {
        submittingVote.value = false;
      }
    };

    // 切换移动端搜索输入框
    const toggleMobileSearch = () => {
      showMobileSearch.value = !showMobileSearch.value;
      triggerHaptic('light');
      if (showMobileSearch.value) {
        nextTick(() => {
          if (mobileSearchInputRef.value) {
            mobileSearchInputRef.value.focus();
          }
        });
      }
    };

    // 选中分类并居中平滑滚动
    const selectCategory = (catName, event) => {
      activeCategory.value = catName;
      triggerHaptic('light');
      if (event && event.currentTarget) {
        event.currentTarget.scrollIntoView({
          behavior: 'smooth',
          inline: 'center',
          block: 'nearest'
        });
      }
    };

    // 从移动端底部抽屉选中分类
    const selectCategoryFromDrawer = (catName) => {
      activeCategory.value = catName;
      showCategoryDrawer.value = false;
      triggerHaptic('light');
      nextTick(() => {
        const container = categoryScrollContainer.value;
        if (container) {
          const buttons = container.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.includes(catName)) {
              btn.scrollIntoView({
                behavior: 'smooth',
                inline: 'center',
                block: 'nearest'
              });
              break;
            }
          }
        }
      });
    };

    // 重置全部筛选与搜索
    const resetFilter = () => {
      activeCategory.value = '全部';
      searchQuery.value = '';
      showMobileSearch.value = false;
      triggerHaptic('light');
    };

    // 清空搜索
    const clearSearch = () => {
      searchQuery.value = '';
      activeCategory.value = '全部';
      showSearchInput.value = false;
      showMobileSearch.value = false;
    };

    // 分享与复制
    const handleSmartShare = async () => {
      triggerHaptic('light');
      const url = mobileUrl.value;
      if (navigator.share && window.innerWidth < 768) {
        try {
          await navigator.share({
            title: settings.value.title || '朋辈社课主题投票',
            text: '选出你心仪的社课主题，一起来投票吧！',
            url
          });
          return;
        } catch (e) {}
      }
      showQrModal.value = true;
      Vue.nextTick(() => {
        const el = document.getElementById('qrcode');
        if (el) {
          el.innerHTML = '';
          if (window.QRCode) {
            new window.QRCode(el, {
              text: url,
              width: 160,
              height: 160,
              colorDark: '#18181b',
              colorLight: '#ffffff',
              correctLevel: window.QRCode.CorrectLevel.M
            });
          }
        }
      });
    };

    const copyMobileUrl = async () => {
      try {
        await navigator.clipboard.writeText(mobileUrl.value);
        showToast('投票系统专属链接已复制到剪贴板！', 'success');
      } catch (e) {
        showToast('复制失败，请手动长按复制地址', 'warning');
      }
    };

    // 选票搜索与过滤
    const filteredBallots = computed(() => {
      if (!ballotSearchQuery.value.trim()) return ballots.value;
      const q = ballotSearchQuery.value.trim().toLowerCase();
      return ballots.value.filter(b => {
        const idMatch = (b.id || '').toLowerCase().includes(q);
        const voterMatch = (b.voterId || b.voterToken || '').toLowerCase().includes(q);
        const topicMatch = (b.topicTitles || []).some(t => (t || '').toLowerCase().includes(q));
        const commentMatch = (b.comment || '').toLowerCase().includes(q);
        return idMatch || voterMatch || topicMatch || commentMatch;
      });
    });

    // 管理员社课列表筛选
    const filteredAdminTopics = computed(() => {
      if (!adminTopicSearchQuery.value.trim()) return topics.value;
      const q = adminTopicSearchQuery.value.trim().toLowerCase();
      return topics.value.filter(t => {
        return (t.title || '').toLowerCase().includes(q) ||
               (t.speaker || '').toLowerCase().includes(q) ||
               (t.category || '').toLowerCase().includes(q) ||
               (t.tag || '').toLowerCase().includes(q) ||
               (t.summary || '').toLowerCase().includes(q);
      });
    });

    // 展开/收起后台社课详情预览
    const toggleAdminTopicExpand = (id) => {
      const idx = adminExpandedTopicIds.value.indexOf(id);
      if (idx === -1) {
        adminExpandedTopicIds.value.push(id);
      } else {
        adminExpandedTopicIds.value.splice(idx, 1);
      }
    };

    // 调整社课排期顺序 (上移/下移)
    const moveTopic = async (topic, direction) => {
      const currentList = [...topics.value];
      const index = currentList.findIndex(t => t.id === topic.id);
      if (index === -1) return;
      if (direction === 'up' && index > 0) {
        const temp = currentList[index - 1];
        currentList[index - 1] = currentList[index];
        currentList[index] = temp;
      } else if (direction === 'down' && index < currentList.length - 1) {
        const temp = currentList[index + 1];
        currentList[index + 1] = currentList[index];
        currentList[index] = temp;
      } else {
        return;
      }

      adminReordering.value = true;
      try {
        const orderedIds = currentList.map(t => t.id);
        const res = await api('/api/admin/topics/reorder', {
          method: 'PUT',
          body: JSON.stringify({ orderedIds })
        });
        topics.value = res.topics || currentList;
        showToast('社课显示排序已即刻更新！', 'success');
      } catch (e) {
        showToast('排序更新失败: ' + e.message, 'error');
      } finally {
        adminReordering.value = false;
      }
    };

    // 克隆创建社课副本
    const duplicateTopic = (topic) => {
      isEditingNewTopic.value = true;
      const formattedOutline = Array.isArray(topic.outline)
        ? topic.outline.map(item => {
            if (typeof item === 'object' && item !== null) {
              if (item.tag && item.desc) return `${item.tag} · ${item.desc}`;
              return item.desc || item.tag || JSON.stringify(item);
            }
            return String(item);
          }).join('\n')
        : (topic.outline || '');

      editingTopic.value = {
        id: '',
        title: (topic.title || '') + ' (副本)',
        speaker: topic.speaker || '',
        category: topic.category || '',
        tag: topic.tag || '',
        duration: topic.duration || '',
        hook: topic.hook || '',
        summary: topic.summary || '',
        outlineText: formattedOutline
      };
      showTopicEditModal.value = true;
      showToast('已复制社课模板，修改后点击保存即可新增', 'info');
    };

    // 选票统计聚合概览
    const ballotStatsSummary = computed(() => {
      const totalVoters = ballots.value.length;
      let totalVotes = 0;
      let commentCount = 0;
      for (const b of ballots.value) {
        totalVotes += (b.topicIds && b.topicIds.length) || 0;
        if (b.comment && b.comment.trim()) commentCount++;
      }
      const avgVotes = totalVoters > 0 ? (totalVotes / totalVoters).toFixed(1) : '0.0';
      const commentRate = totalVoters > 0 ? Math.round((commentCount / totalVoters) * 100) : 0;
      return { totalVoters, totalVotes, avgVotes, commentRate };
    });

    // 管理员讨论治理筛选
    const filteredAdminComments = computed(() => {
      let list = publicComments.value;
      if (adminCommentFilter.value !== 'all') {
        if (adminCommentFilter.value === 'general') {
          list = list.filter(c => !c.topicId || c.topicId === 'general');
        } else {
          list = list.filter(c => c.topicId === adminCommentFilter.value);
        }
      }
      if (adminCommentSearch.value.trim()) {
        const q = adminCommentSearch.value.trim().toLowerCase();
        list = list.filter(c => {
          return (c.text || '').toLowerCase().includes(q) ||
                 (c.authorName || '').toLowerCase().includes(q) ||
                 (c.topicTitle || '').toLowerCase().includes(q);
        });
      }
      return list;
    });

    // 管理员相关操作
    const initAdminSettingsForm = () => {
      if (settings.value) {
        adminSettingsForm.value = {
          title: settings.value.title || '朋辈社课大投票！',
          subtitle: settings.value.subtitle || '',
          maxVotesPerUser: settings.value.maxVotesPerUser || 3,
          allowChangeVote: settings.value.allowChangeVote !== false,
          status: settings.value.status || 'open',
          resultsVisibility: settings.value.resultsVisibility || 'public'
        };
      }
    };

    const loadDiagnostics = async () => {
      try {
        const res = await api('/api/admin/diagnostics');
        adminDiagnostics.value = res;
      } catch (e) {}
    };

    const openAdminModal = () => {
      showAdminModal.value = true;
      initAdminSettingsForm();
      if (isAdmin.value) {
        loadBallots();
        loadPublicComments();
        loadDiagnostics();
      }
    };

    const handleAdminLogin = async () => {
      try {
        const res = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify(adminLoginForm.value)
        });
        adminToken.value = res.token;
        localStorage.setItem('lecture_admin_token', res.token);
        isAdmin.value = true;
        showToast('管理员凭据校验成功', 'success');
        initAdminSettingsForm();
        loadBallots();
        loadResults();
        loadPublicComments();
        loadDiagnostics();
      } catch (e) {
        showToast(e.message || '账号或密码错误', 'error');
      }
    };

    const handleAdminLogout = () => {
      adminToken.value = '';
      localStorage.removeItem('lecture_admin_token');
      isAdmin.value = false;
      showToast('已安全登出管理后台', 'info');
    };

    // 在线修改管理员密码（安全双重校验）
    const handleChangeAdminPassword = async () => {
      const { oldPassword, newPassword, confirmPassword } = adminPasswordForm.value;
      if (!oldPassword) {
        showToast('请输入当前原密码', 'warning');
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        showToast('新密码长度不能少于 6 个字符', 'warning');
        return;
      }
      if (newPassword !== confirmPassword) {
        showToast('两次输入的新密码不一致，请核对', 'warning');
        return;
      }

      changingAdminPassword.value = true;
      try {
        const res = await api('/api/admin/change-password', {
          method: 'POST',
          body: JSON.stringify({ oldPassword, newPassword })
        });
        if (res.token) {
          adminToken.value = res.token;
          localStorage.setItem('lecture_admin_token', res.token);
        }
        adminPasswordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' };
        showToast(res.message || '管理员密码修改成功！新凭据已即时生效', 'success');
      } catch (e) {
        showToast(e.message || '修改密码失败，请核对原密码', 'error');
      } finally {
        changingAdminPassword.value = false;
      }
    };

    const loadBallots = async () => {
      try {
        const res = await api('/api/admin/ballots');
        ballots.value = res.ballots || [];
      } catch (e) {
        showToast('读取计票详情失败: ' + e.message, 'error');
      }
    };

    // 保存系统设置
    const saveSettings = async () => {
      savingSettings.value = true;
      try {
        const res = await api('/api/admin/settings', {
          method: 'PUT',
          body: JSON.stringify(adminSettingsForm.value)
        });
        settings.value = { ...settings.value, ...res.settings };
        try {
          localStorage.setItem('lecture_cached_settings', JSON.stringify(settings.value));
        } catch (e) {}
        showToast('系统全局配置已即时更新生效！', 'success');
      } catch (e) {
        showToast('配置保存失败: ' + e.message, 'error');
      } finally {
        savingSettings.value = false;
      }
    };

    // 社课内容增删改
    const openAddTopicModal = () => {
      isEditingNewTopic.value = true;
      editingTopic.value = {
        id: '',
        title: '',
        speaker: '朋辈讲师',
        category: '通识探索',
        tag: '新议题',
        duration: '45分钟讲解 + 15分钟互动',
        hook: '',
        summary: '',
        outlineText: '直觉 vs 理性 · 剖析系统 1 与系统 2 的底层神经博弈机制\n三大盲区 · 拆解锚定效应、确认偏误与幸存者偏差的日常表征\n实战工具 · 掌握 4 步可落地的日常自检工具箱'
      };
      showTopicEditModal.value = true;
    };

    const openEditTopicModal = (t) => {
      isEditingNewTopic.value = false;
      const formattedOutline = Array.isArray(t.outline)
        ? t.outline.map(item => {
            if (typeof item === 'object' && item !== null) {
              if (item.tag && item.desc) return `${item.tag} · ${item.desc}`;
              return item.desc || item.tag || JSON.stringify(item);
            }
            return String(item);
          }).join('\n')
        : (t.outline || '');

      editingTopic.value = {
        id: t.id,
        title: t.title || '',
        speaker: t.speaker || '',
        category: t.category || '',
        tag: t.tag || '',
        duration: t.duration || '',
        hook: t.hook || '',
        summary: t.summary || '',
        outlineText: formattedOutline
      };
      showTopicEditModal.value = true;
    };

    const saveTopic = async () => {
      if (!editingTopic.value.title.trim()) {
        showToast('社课名称不能为空', 'warning');
        return;
      }
      savingTopic.value = true;
      try {
        const parsedOutline = editingTopic.value.outlineText
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean)
          .map(line => {
            if (line.includes(' · ')) {
              const [tag, ...rest] = line.split(' · ');
              return { tag: tag.trim(), desc: rest.join(' · ').trim() };
            }
            if (line.includes('：')) {
              const [tag, ...rest] = line.split('：');
              return { tag: tag.trim(), desc: rest.join('：').trim() };
            }
            if (line.includes(': ')) {
              const [tag, ...rest] = line.split(': ');
              return { tag: tag.trim(), desc: rest.join(': ').trim() };
            }
            return { tag: '核心要点', desc: line };
          });

        const payload = {
          title: editingTopic.value.title.trim(),
          speaker: editingTopic.value.speaker.trim(),
          category: editingTopic.value.category.trim(),
          tag: editingTopic.value.tag.trim(),
          duration: editingTopic.value.duration.trim(),
          hook: editingTopic.value.hook.trim(),
          summary: editingTopic.value.summary.trim(),
          outline: parsedOutline
        };

        if (isEditingNewTopic.value) {
          await api('/api/admin/topics', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          showToast('新增社课议题成功！', 'success');
        } else {
          await api(`/api/admin/topics/${editingTopic.value.id}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          showToast('社课内容修改已保存！', 'success');
        }
        showTopicEditModal.value = false;
        await loadTopics();
        if (canSeeResults.value) {
          await loadResults();
        }
      } catch (e) {
        showToast('保存社课失败: ' + e.message, 'error');
      } finally {
        savingTopic.value = false;
      }
    };

    const deleteTopic = async (topic) => {
      if (!confirm(`确定彻底删除社课《${topic.title}》吗？此操作不可撤销！`)) return;
      try {
        await api(`/api/admin/topics/${topic.id}`, { method: 'DELETE' });
        showToast('社课已成功删除', 'success');
        await loadTopics();
        if (canSeeResults.value) {
          await loadResults();
        }
      } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
      }
    };

    const adminDeleteComment = async (commentId) => {
      if (!confirm('确定删除此条讨论留言吗？')) return;
      try {
        await api(`/api/comments/${commentId}`, { method: 'DELETE' });
        showToast('留言已安全删除', 'success');
        await loadPublicComments();
      } catch (e) {
        showToast('删除留言失败: ' + e.message, 'error');
      }
    };

    const clearVotes = async () => {
      if (!confirm('【危险操作】确定清空所有投票记录和留言吗？此操作不可撤销！')) return;
      try {
        await api('/api/admin/reset-votes', { method: 'POST' });
        showToast('全量数据已安全重置！', 'success');
        ballots.value = [];
        await initData();
      } catch (e) {
        showToast('重置失败: ' + e.message, 'error');
      }
    };

    const exportCsv = () => {
      if (!ballots.value.length) {
        showToast('暂无投票记录可导出', 'warning');
        return;
      }
      const headers = ['选票ID', '设备指纹/标识', '所选社课', '附带留言', '投票时间'];
      const rows = ballots.value.map(b => [
        `"${b.id}"`,
        `"${b.voterId || b.voterToken || ''}"`,
        `"${(b.topicIds || []).map(id => {
          const t = topics.value.find(x => x.id === id);
          return t ? t.title : id;
        }).join('; ')}"`,
        `"${(b.comment || '').replace(/"/g, '""')}"`,
        `"${b.votedAt ? new Date(b.votedAt).toLocaleString('zh-CN') : ''}"`
      ]);
      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `朋辈社课投票明细_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('选票明细 CSV 导出成功！', 'success');
    };

    // 单张选票撤销删除
    const deleteBallot = async (ballot) => {
      if (!confirm(`确定撤销选票 #${ballot.id.slice(-8)} 吗？此操作将同步扣减对应社课的票数。`)) return;
      try {
        await api(`/api/admin/ballots/${ballot.id}`, { method: 'DELETE' });
        showToast('选票已成功撤销并扣减对应票数！', 'success');
        ballots.value = ballots.value.filter(b => b.id !== ballot.id);
        await loadTopics();
        if (canSeeResults.value) {
          await loadResults();
        }
      } catch (e) {
        showToast('撤销选票失败: ' + e.message, 'error');
      }
    };

    // 全量备份导出
    const downloadBackup = async () => {
      try {
        const res = await api('/api/admin/backup');
        const jsonStr = JSON.stringify(res.data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `社课投票全量备份_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('全量 JSON 备份已下载！', 'success');
      } catch (e) {
        showToast('导出备份失败: ' + e.message, 'error');
      }
    };

    // 从备份文件恢复
    const restoreFromJsonFile = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      if (!confirm(`确定导入备份文件《${file.name}》并全量覆盖当前数据吗？此操作不可撤销！`)) {
        event.target.value = '';
        return;
      }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await api('/api/admin/restore', {
          method: 'POST',
          body: JSON.stringify({ data })
        });
        showToast('系统数据已全量恢复！', 'success');
        await initData();
        await loadBallots();
        await loadPublicComments();
        await loadDiagnostics();
      } catch (e) {
        showToast('恢复数据失败: ' + (e.message || '文件格式错误'), 'error');
      } finally {
        event.target.value = '';
      }
    };

    // 静默无感实时同步（用户切回标签页或每 25 秒自动拉取最新投票数和公共讨论）
    const refreshLiveState = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        await loadTopics();
        await loadPublicComments();
        if (canSeeResults.value) {
          await loadResults();
        }
      } catch (e) {
        // 静默同步失败不打扰正常浏览
      }
    };

    // 离线暂存选票自动检查与自愈投递
    const checkAndSyncPendingVote = async () => {
      const raw = getSafeStorage('lecture_pending_vote');
      if (!raw) return;
      try {
        const pending = JSON.parse(raw);
        if (pending && pending.topicIds && pending.topicIds.length > 0) {
          const res = await api('/api/vote', {
            method: 'POST',
            body: JSON.stringify({
              voterToken: pending.voterToken || voterToken.value,
              topicIds: pending.topicIds,
              comment: pending.comment || ''
            })
          });
          try { localStorage.removeItem('lecture_pending_vote'); } catch (e) {}
          if (res && res.vote) {
            hasVoted.value = true;
            userVote.value = res.vote;
            setSafeStorage('lecture_voter_ballot', JSON.stringify(res.vote));
            showToast('网络已恢复，您的暂存选票已成功同步并入账！', 'success');
            await loadTopics();
            await loadResults();
            await loadPublicComments();
          }
        }
      } catch (e) {
        // 网络依然未就绪，保持暂存状态等待下一次联网触发
      }
    };

    onMounted(() => {
      initData();
      checkAndSyncPendingVote();
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => {
          checkAndSyncPendingVote();
          refreshLiveState();
        });
      }
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            refreshLiveState();
            checkAndSyncPendingVote();
          }
        });
      }
      setInterval(() => {
        refreshLiveState();
        checkAndSyncPendingVote();
      }, 25000);
    });

    return {
      loading,
      hasVoted,
      canSeeResults,
      userVote,
      selectedTopicIds,
      selectedTopics,
      hasSelectionChanged,
      votingComment,
      showConfirmModal,
      submittingVote,
      settings,
      topics,
      stats,
      statsSummary,
      activeTab,
      activeCategory,
      categories,
      filteredTopics,
      searchQuery,
      showSearchInput,
      showMobileSearch,
      showCategoryDrawer,
      categoryScrollContainer,
      mobileSearchInputRef,
      toggleMobileSearch,
      selectCategory,
      selectCategoryFromDrawer,
      resetFilter,
      expandedTopicIds,
      topicComments,
      newCommentTexts,
      publicComments,
      publicCommentsLoading,
      commentFilter,
      commentFilterTopicId,
      commentCategoryPills,
      isTopicSelectedInCommentFilter,
      setCommentFilter,
      filteredPublicComments,
      newPublicComment,
      submittingPublicComment,
      getTopicShortTitle,
      loadPublicComments,
      submitPublicComment,
      deleteComment,
      mobileUrl,
      showQrModal,
      toast,
      isAdmin,
      showAdminModal,
      adminActiveTab,
      adminLoginForm,
      ballots,
      ballotSearchQuery,
      filteredBallots,
      adminTopicSearchQuery,
      filteredAdminTopics,
      adminExpandedTopicIds,
      toggleAdminTopicExpand,
      moveTopic,
      duplicateTopic,
      deleteBallot,
      ballotStatsSummary,
      adminCommentFilter,
      adminCommentSearch,
      filteredAdminComments,
      adminDiagnostics,
      loadDiagnostics,
      downloadBackup,
      restoreFromJsonFile,
      adminReordering,
      showTopicEditModal,
      isEditingNewTopic,
      editingTopic,
      savingTopic,
      openAddTopicModal,
      openEditTopicModal,
      saveTopic,
      deleteTopic,
      adminSettingsForm,
      savingSettings,
      saveSettings,
      adminDeleteComment,
      toggleTopic,
      toggleExpand,
      loadTopicComments,
      submitQuickComment,
      formatTime,
      getCategoryClass,
      clearSearch,
      handlePreSubmit,
      confirmSubmitVote,
      handleSmartShare,
      copyMobileUrl,
      openAdminModal,
      handleAdminLogin,
      handleAdminLogout,
      adminPasswordForm,
      changingAdminPassword,
      handleChangeAdminPassword,
      loadBallots,
      clearVotes,
      exportCsv,
      loadResults,
      triggerHaptic,
      getTopicMainTitle,
      getTopicSubTitle,
      getHookTag,
      getHookText
    };
  }
}).mount('#app');
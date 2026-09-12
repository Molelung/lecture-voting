const { createApp, ref, computed, onMounted, nextTick } = Vue;

createApp({
  setup() {
    // 1. 设备匿名凭据（校园网友好，防刷防重复）
    let storedToken = localStorage.getItem('lecture_voter_token');
    if (!storedToken) {
      storedToken = 'voter-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
      localStorage.setItem('lecture_voter_token', storedToken);
    }
    const voterToken = ref(storedToken);

    // 2. 状态管理
    const loading = ref(true);
    const hasVoted = ref(false);
    const userVote = ref(null);
    const selectedTopicIds = ref([]);
    const votingComment = ref('');
    const showConfirmModal = ref(false);
    const submittingVote = ref(false);

    // 管理员状态
    const adminToken = ref(localStorage.getItem('lecture_admin_token') || '');
    const isAdmin = ref(!!adminToken.value);
    const showAdminModal = ref(false);
    const adminActiveTab = ref('topics'); // 'topics' | 'settings' | 'ballots' | 'comments'
    const adminLoginForm = ref({ username: 'admin', password: '' });
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
      resultsVisibility: 'public'
    });
    const savingSettings = ref(false);

    // 系统配置与本地缓存（优先秒级直读本地缓存，杜绝网络请求前后的文字跳闪）
    const getCachedJson = (key, fallback) => {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : fallback;
      } catch (e) {
        return fallback;
      }
    };

    const DEFAULT_INITIAL_TOPICS = [
      {
        id: "topic-1",
        title: "认知偏差与日常决策：为什么聪明人也会犯傻？",
        category: "认知决策",
        speaker: "认知心理学方向",
        tag: "思维模型",
        duration: "45分钟讲解 + 15分钟互动",
        hook: "为什么我们明明知道'沉没成本不是成本'，却依然舍不得放弃烂尾的人与事？",
        outline: [
          { tag: "直觉 vs 理性", desc: "剖析系统 1 与系统 2 的底层神经博弈机制" },
          { tag: "三大认知盲区", desc: "拆解锚定效应、确认偏误与幸存者偏差的日常表征" },
          { tag: "生活框架陷阱", desc: "破解消费营销与人际交流中的认知误导话术" },
          { tag: "思维自检工具", desc: "掌握 4 步可落地的日常去偏差化理性反思模型" }
        ],
        count: 0,
        stats: { locked: false, count: 0, percentage: 0 }
      },
      {
        id: "topic-2",
        title: "战胜拖延与精神内耗：神经科学与行为设计实践",
        category: "自我效能",
        speaker: "发展心理学与行为设计",
        tag: "行动科学",
        duration: "40分钟讲解 + 20分钟行动工作坊",
        hook: "为什么懂得那么多道理依然会拖延？明知 deadline 将至为何还是刷手机停不下来？",
        outline: [
          { tag: "生理机制解密", desc: "拖延并非态度懒惰，而是情绪负荷过载的脑区防御" },
          { tag: "多巴胺与注意力", desc: "算法时代短视频与即时反馈如何重塑大脑奖赏通路" },
          { tag: "打破完美主义", desc: "化解'全或无'思维引发的内耗与行动瘫痪" },
          { tag: "微步启动实操", desc: "现场落地 2 分钟启动法则与环境摩擦力微调方案" }
        ],
        count: 0,
        stats: { locked: false, count: 0, percentage: 0 }
      },
      {
        id: "topic-3",
        title: "博弈论与人际合作：囚徒困境与生活中的最优策略",
        category: "社会博弈",
        speaker: "交叉学科与博弈论",
        tag: "数理通识",
        duration: "50分钟讲解 + 10分钟现场模拟",
        hook: "做人太善良总吃亏，太精明又没人敢深交，人际交往究竟有没有最优解？",
        outline: [
          { tag: "经典囚徒困境", desc: "解析个体最优选择为何经常导向集体双输的死局" },
          { tag: "演化胜出法则", desc: "阿克塞尔罗德计算机模拟：以牙还牙策略为何胜出" },
          { tag: "寝室与团队协作", desc: "破解搭便车难题与利益博弈中的正向激励设计" },
          { tag: "长期合作网络", desc: "在不确定社交环境中建立高信誉度的人际护城河" }
        ],
        count: 0,
        stats: { locked: false, count: 0, percentage: 0 }
      },
      {
        id: "topic-4",
        title: "亲密关系与依恋模式：读懂彼此的隐秘防御",
        category: "人际情感",
        speaker: "人际沟通与亲密关系",
        tag: "深度心理",
        duration: "45分钟讲解 + 15分钟心声交流",
        hook: "为什么越在乎一个人，反而越容易用言语推开对方？我们是在爱Ta还是在弥补自己？",
        outline: [
          { tag: "心理防御投射", desc: "关系中的移情投射：我们在与现实的人恋爱还是心象" },
          { tag: "焦虑 vs 回避", desc: "亲密关系里的追逃游戏成因与打破死循环的钥匙" },
          { tag: "非暴力沟通", desc: "区分观察、感受、需要与请求的四步实操练习" },
          { tag: "重塑安全型自我", desc: "建立清晰的人际边界，在亲密与独立间从容自处" }
        ],
        count: 0,
        stats: { locked: false, count: 0, percentage: 0 }
      },
      {
        id: "topic-5",
        title: "深度工作与心流状态：数字时代的专注力重塑",
        category: "专注效能",
        speaker: "学习科学与专注力",
        tag: "高产体系",
        duration: "40分钟讲解 + 15分钟心流搭建",
        hook: "一天下来好像忙忙碌碌，晚上回想却什么像样的成果都没做出来？",
        outline: [
          { tag: "心流触发四要素", desc: "精准匹配技能与挑战，掌握进入无干扰心流的开关" },
          { tag: "深度时间箱", desc: "注意力残留理论剖析与抗干扰时间块的日常落地" },
          { tag: "数字极简主义", desc: "抵抗算法信息流诱惑，主动为日常信息输入降噪" },
          { tag: "个人输出系统", desc: "从被动碎片收藏转向高效内化与结构化实践" }
        ],
        count: 0,
        stats: { locked: false, count: 0, percentage: 0 }
      },
      {
        id: "topic-6",
        title: "批判性思维与信息甄别：在算法时代独立思考",
        category: "思维素养",
        speaker: "通识哲学与批判思考",
        tag: "深度认知",
        duration: "45分钟讲解 + 15分钟议题思辨",
        hook: "面对热搜反转反转再反转，我们该如何在信息洪流中保持清醒独立的理性？",
        outline: [
          { tag: "常见逻辑谬误", desc: "拆解稻草人谬误、滑坡谬误、假二分法等典型诡辩" },
          { tag: "信息茧房破局", desc: "透视算法回音室的过滤机制与认知同质化风险" },
          { tag: "事实核查工具", desc: "信源可靠度分级、交叉验证与第一手证据溯源" },
          { tag: "慢思考决策习惯", desc: "面对情绪化热点时抑制即刻反应，开启元认知审视" }
        ],
        count: 0,
        stats: { locked: false, count: 0, percentage: 0 }
      }
    ];

    const initialSettings = getCachedJson('lecture_cached_settings', {
      title: '朋辈社课大投票！',
      subtitle: '',
      maxVotesPerUser: 3,
      allowChangeVote: true,
      status: 'open',
      resultsVisibility: 'public'
    });

    const settings = ref(initialSettings);
    const initialTopics = getCachedJson('lecture_cached_topics', DEFAULT_INITIAL_TOPICS);
    const topics = ref(initialTopics);
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
    const commentFilterTopicId = ref('all'); // 'all' | 'general' | specific topicId
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

    // API 请求封装
    const api = async (url, options = {}) => {
      const headers = {
        'Content-Type': 'application/json',
        'X-Voter-Token': voterToken.value,
        ...(adminToken.value ? { 'Authorization': `Bearer ${adminToken.value}` } : {}),
        ...options.headers
      };

      const doFetch = async (baseUrl) => {
        const fullUrl = url.startsWith('/api') && baseUrl ? `${baseUrl}${url}` : url;
        const res = await fetch(fullUrl, { ...options, headers });
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
        return data;
      };

      try {
        return await doFetch(activeApiBase);
      } catch (err) {
        // 如果是 HTTP 4xx 业务级错误（如参数不全、密码错误、达到最大投票数等），说明服务完全畅通，绝对不触发节点切换
        if (err.status && err.status >= 400 && err.status < 500) {
          showToast(err.message, 'warning');
          throw err;
        }

        // 仅在主域名出现断网/DNS解析失败/502网关异常时，无感切换至备用直连域名
        if (!IS_LOCAL && activeApiBase === PRIMARY_API) {
          try {
            console.warn('主接入点网络波动，正在无感切换至备用节点...', err.message);
            const data = await doFetch(FALLBACK_API);
            activeApiBase = FALLBACK_API;
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

    // 初始化数据加载
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
        statsSummary.value = res.statsSummary || { totalVoters: 0, totalVotesCast: 0 };

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

        // 加载榜单（若已投票或管理员）
        if (canSeeResults.value) {
          await loadResults();
        }
      } catch (err) {
        console.error('初始化数据异常:', err);
      } finally {
        loading.value = false;
      }
    };

    const loadTopics = async () => {
      const res = await api('/api/topics');
      if (res.topics) {
        topics.value = res.topics;
        try {
          localStorage.setItem('lecture_cached_topics', JSON.stringify(res.topics));
        } catch (e) {}
      }
    };

    const loadResults = async () => {
      try {
        const res = await api('/api/results');
        stats.value = res.stats;
      } catch (e) {}
    };

    // 榜单可见性计算（严格遵循 settings.resultsVisibility 配置）
    const canSeeResults = computed(() => {
      if (isAdmin.value) return true;
      if (settings.value && settings.value.resultsVisibility === 'public') return true;
      if (settings.value && settings.value.resultsVisibility === 'after_vote') return hasVoted.value;
      return false;
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
      } catch (e) {
        showToast(e.message, 'error');
      }
    };

    // 格式化时间
    const formatTime = (isoString) => {
      if (!isoString) return '刚刚';
      const d = new Date(isoString);
      const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
      if (diffMin < 2) return '刚刚';
      if (diffMin < 60) return `${diffMin}分钟前`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `${diffHour}小时前`;
      return `${d.getMonth() + 1}月${d.getDate()}日`;
    };

    // 公共留言筛选计算
    const filteredPublicComments = computed(() => {
      if (commentFilterTopicId.value === 'all') {
        return publicComments.value;
      }
      return publicComments.value.filter(c => (c.topicId || 'general') === commentFilterTopicId.value);
    });

    // 获取议题简称
    const getTopicShortTitle = (tid) => {
      if (!tid || tid === 'general') return '公共留言';
      const found = topics.value.find(t => t.id === tid);
      if (found) {
        return found.title.length > 14 ? found.title.slice(0, 14) + '...' : found.title;
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
        showConfirmModal.value = false;

        // 即刻解锁票数与热度排行榜及公共讨论区
        await loadTopics();
        await loadResults();
        await loadPublicComments();
      } catch (err) {
        console.error('投票失败:', err);
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

    onMounted(() => {
      initData();
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            refreshLiveState();
          }
        });
      }
      setInterval(refreshLiveState, 25000);
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
      commentFilterTopicId,
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
      loadBallots,
      clearVotes,
      exportCsv,
      loadResults,
      triggerHaptic,
      getTopicMainTitle,
      getTopicSubTitle
    };
  }
}).mount('#app');
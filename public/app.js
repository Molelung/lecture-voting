const { createApp, ref, computed, onMounted } = Vue;

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

    // 系统配置与候选选题
    const settings = ref({
      title: '朋辈社课 · 选出你最想听的一课',
      subtitle: '由你投票决定本学期公开课排期顺序（每人限投 1~3 票）',
      maxVotesPerUser: 3,
      allowChangeVote: true,
      status: 'open',
      resultsVisibility: 'public'
    });
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
        settings.value = res.settings;
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
      topics.value = res.topics;
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
            authorName: (newPublicComment.value.authorName || '').trim() || '朋辈学友',
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

    // 动态分类清单
    const categories = computed(() => {
      const set = new Set();
      topics.value.forEach(t => {
        if (t.category) set.add(t.category);
      });
      return ['全部', ...Array.from(set)];
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

    // 清空搜索
    const clearSearch = () => {
      searchQuery.value = '';
      activeCategory.value = '全部';
      showSearchInput.value = false;
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

    const openAdminModal = () => {
      showAdminModal.value = true;
      initAdminSettingsForm();
      if (isAdmin.value) {
        loadBallots();
        loadPublicComments();
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
        outlineText: '一、背景与核心议题\n二、关键机制与典型案例\n三、生活实战与实践启发'
      };
      showTopicEditModal.value = true;
    };

    const openEditTopicModal = (t) => {
      isEditingNewTopic.value = false;
      editingTopic.value = {
        id: t.id,
        title: t.title || '',
        speaker: t.speaker || '',
        category: t.category || '',
        tag: t.tag || '',
        duration: t.duration || '',
        hook: t.hook || '',
        summary: t.summary || '',
        outlineText: Array.isArray(t.outline) ? t.outline.join('\n') : (t.outline || '')
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
        const payload = {
          title: editingTopic.value.title.trim(),
          speaker: editingTopic.value.speaker.trim(),
          category: editingTopic.value.category.trim(),
          tag: editingTopic.value.tag.trim(),
          duration: editingTopic.value.duration.trim(),
          hook: editingTopic.value.hook.trim(),
          summary: editingTopic.value.summary.trim(),
          outline: editingTopic.value.outlineText.split('\n').map(s => s.trim()).filter(Boolean)
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
      triggerHaptic
    };
  }
}).mount('#app');
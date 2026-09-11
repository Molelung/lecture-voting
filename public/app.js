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
    const adminActiveTab = ref('topics'); // 'topics' | 'ballots'
    const adminLoginForm = ref({ username: 'admin', password: '' });
    const ballots = ref([]);

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

    // API 端点配置 (优先国内直连域名 vote.molan.cc.cd，并支持两级容灾回退)
    const PRIMARY_API = 'https://vote.molan.cc.cd';
    const FALLBACK_API = 'https://vote.listener.ccwu.cc';
    const SECONDARY_FALLBACK = 'https://lecture-voting-api.mokelin-studio.workers.dev';
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
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || '请求服务失败');
        }
        return data;
      };

      try {
        return await doFetch(activeApiBase);
      } catch (err) {
        if (!IS_LOCAL && activeApiBase === PRIMARY_API) {
          try {
            console.warn('主域名网络波动，正在自动切换备用服务节点...', err);
            const data = await doFetch(FALLBACK_API);
            activeApiBase = FALLBACK_API;
            return data;
          } catch (fallbackErr) {
            try {
              const data2 = await doFetch(SECONDARY_FALLBACK);
              activeApiBase = SECONDARY_FALLBACK;
              return data2;
            } catch (secErr) {
              showToast(secErr.message || fallbackErr.message || err.message, 'error');
              throw secErr;
            }
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

    // 榜单可见性计算
    const canSeeResults = computed(() => {
      return hasVoted.value || isAdmin.value;
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

        // 即刻解锁票数与热度排行榜
        await loadTopics();
        await loadResults();
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
      triggerHaptic('light');
      const url = mobileUrl.value;
      try {
        await navigator.clipboard.writeText(url);
        showToast('投票链接已复制到剪贴板！', 'success');
      } catch (e) {
        showToast(`链接: ${url}`, 'info');
      }
    };

    // 管理员登录与登出
    const openAdminModal = () => {
      showAdminModal.value = true;
      if (isAdmin.value) {
        loadBallots();
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
        showToast('管理员登录成功', 'success');
        adminLoginForm.value = { username: 'admin', password: '' };
        await loadTopics();
        await loadResults();
        await loadBallots();
      } catch (e) {
        showToast(e.message, 'error');
      }
    };

    const handleAdminLogout = () => {
      adminToken.value = '';
      localStorage.removeItem('lecture_admin_token');
      isAdmin.value = false;
      showToast('已退出管理后台', 'info');
    };

    const loadBallots = async () => {
      try {
        const res = await api('/api/admin/ballots');
        ballots.value = res.ballots;
      } catch (e) {}
    };

    const clearVotes = async () => {
      if (!confirm('确定要清空所有已提交的选票和留言吗？此操作无法撤销。')) return;
      try {
        await api('/api/admin/clear-votes', { method: 'POST' });
        showToast('选票已重置清空', 'success');
        selectedTopicIds.value = [];
        hasVoted.value = false;
        userVote.value = null;
        await loadTopics();
        await loadResults();
        await loadBallots();
      } catch (e) {}
    };

    // 导出 Excel 兼容 CSV (带 UTF-8 BOM)
    const exportCsv = () => {
      if (!ballots.value || ballots.value.length === 0) {
        showToast('暂无已提交的选票可供导出', 'warning');
        return;
      }
      const headers = ['选票ID', '所投社课主题', '附带心愿/提问留言', '投票时间'];
      const rows = ballots.value.map(b => [
        `"${b.id || ''}"`,
        `"${(b.topicTitles || []).join('；')}"`,
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

    onMounted(() => {
      initData();
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
      mobileUrl,
      showQrModal,
      toast,
      isAdmin,
      showAdminModal,
      adminActiveTab,
      adminLoginForm,
      ballots,
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
const { createApp, ref, computed, onMounted } = Vue;

createApp({
  setup() {
    // 状态管理
    const loading = ref(true);
    const user = ref(null);
    const token = ref(localStorage.getItem('lecture_vote_token') || '');
    const settings = ref({
      title: '社课主题投票',
      subtitle: '选出你最感兴趣的社课主题',
      maxVotesPerUser: 3,
      allowChangeVote: true,
      status: 'open',
      resultsVisibility: 'public'
    });
    const topics = ref([]);
    const userVote = ref(null);
    const selectedTopicIds = ref([]);
    const stats = ref({
      totalVoters: 0,
      totalVotesCast: 0,
      topicStats: []
    });

    // 界面控制状态
    const activeTab = ref('vote'); // 'vote' | 'results'
    const activeCategory = ref('全部');
    const searchQuery = ref('');
    const showDetailModal = ref(null);
    const showConfirmModal = ref(false);
    const showAuthModal = ref(false);
    const authMode = ref('login'); // 'login' | 'register'
    const authForm = ref({ username: '', displayName: '', password: '' });
    const authError = ref('');
    const submittingVote = ref(false);

    // 手机端扫码与局域网分享状态
    const mobileUrl = ref('');
    const showQrModal = ref(false);

    // 触觉反馈工具函数 (Haptic Feedback)
    const triggerHaptic = (type = 'light') => {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          if (type === 'light') navigator.vibrate(10);
          else if (type === 'medium') navigator.vibrate(25);
          else if (type === 'success') navigator.vibrate([15, 60, 25]);
        } catch (e) {}
      }
    };

    const openQrModal = () => {
      showQrModal.value = true;
      Vue.nextTick(() => {
        const el = document.getElementById('qrcode');
        if (el) {
          el.innerHTML = '';
          if (window.QRCode) {
            new window.QRCode(el, {
              text: mobileUrl.value || window.location.href,
              width: 180,
              height: 180,
              colorDark: '#1e293b',
              colorLight: '#ffffff',
              correctLevel: window.QRCode.CorrectLevel.M
            });
          }
        }
      });
    };

    // 智能分享：手机端唤起原生系统分享卡片，电脑端弹出二维码
    const handleSmartShare = async () => {
      triggerHaptic('light');
      const url = mobileUrl.value || window.location.href;
      if (navigator.share && window.innerWidth < 768) {
        try {
          await navigator.share({
            title: settings.value.title || '社课主题投票',
            text: '快来为你心仪的朋辈社课投上一票！',
            url
          });
          return;
        } catch (e) {
          if (e.name !== 'AbortError') {
            openQrModal();
          }
        }
      } else {
        openQrModal();
      }
    };

    const copyMobileUrl = async () => {
      triggerHaptic('light');
      const url = mobileUrl.value || window.location.href;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          const input = document.createElement('input');
          input.value = url;
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          document.body.removeChild(input);
        }
        showToast('已成功复制投票链接！', 'success');
      } catch (e) {
        showToast(`链接: ${url}`, 'info');
      }
    };

    // 管理后台状态
    const showAdminModal = ref(false);
    const adminActiveTab = ref('topics'); // 'topics' | 'settings' | 'ballots'
    const adminSettingsForm = ref({});
    const ballots = ref([]);
    const showTopicFormModal = ref(false);
    const topicForm = ref({
      id: '',
      title: '',
      speaker: '',
      category: '',
      tag: '',
      duration: '',
      summary: '',
      outlineText: ''
    });

    // 简易 Toast 通知
    const toast = ref({ show: false, message: '', type: 'info' });
    let toastTimer = null;
    const showToast = (message, type = 'info') => {
      if (toastTimer) clearTimeout(toastTimer);
      toast.value = { show: true, message, type };
      toastTimer = setTimeout(() => {
        toast.value.show = false;
      }, 3000);
    };

    // API 端点配置 (优先使用已配置解析的国内直连域名 vote.molan.cc.cd，并支持自动容灾)
    const PRIMARY_API = 'https://vote.molan.cc.cd';
    const FALLBACK_API = 'https://vote.listener.ccwu.cc';
    const SECONDARY_FALLBACK = 'https://lecture-voting-api.mokelin-studio.workers.dev';
    const IS_LOCAL = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    let activeApiBase = IS_LOCAL ? '' : PRIMARY_API;

    // API 请求封装
    const api = async (url, options = {}) => {
      const headers = {
        'Content-Type': 'application/json',
        ...(token.value ? { 'Authorization': `Bearer ${token.value}` } : {}),
        ...options.headers
      };

      const doFetch = async (baseUrl) => {
        const fullUrl = url.startsWith('/api') && baseUrl ? `${baseUrl}${url}` : url;
        const res = await fetch(fullUrl, { ...options, headers });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || '请求出错');
        }
        return data;
      };

      try {
        return await doFetch(activeApiBase);
      } catch (err) {
        // 如果主域名遇到网络波动，自动降级切换至备用节点
        if (!IS_LOCAL && activeApiBase === PRIMARY_API) {
          try {
            console.warn('主域名连接重试中，正在自动切换备用服务节点...', err);
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

    // 初始化加载
    const initData = async () => {
      loading.value = true;
      try {
        const res = await api('/api/status');
        settings.value = res.settings;
        user.value = res.user;
        userVote.value = res.userVote;
        mobileUrl.value = window.location.href.split('?')[0].split('#')[0];
        
        // 如果用户之前已投票，默认带出其历史选票
        if (userVote.value && userVote.value.topicIds) {
          selectedTopicIds.value = [...userVote.value.topicIds];
        }

        // 加载社课候选
        await loadTopics();

        // 加载统计
        if (res.canSeeResults) {
          await loadResults();
        }
      } catch (err) {
        console.error('初始化数据失败:', err);
      } finally {
        loading.value = false;
      }
    };

    const loadTopics = async () => {
      const res = await api('/api/topics');
      topics.value = res.topics;
    };

    // Amie 风格分类标签配色
    const getCategoryClass = (category) => {
      if (!category) return 'amie-pill-neutral';
      if (category.includes('认知') || category.includes('决策')) return 'amie-pill-blue';
      if (category.includes('效能') || category.includes('成长') || category.includes('提升')) return 'amie-pill-purple';
      if (category.includes('博弈') || category.includes('社会')) return 'amie-pill-emerald';
      if (category.includes('情感') || category.includes('关系') || category.includes('沟通')) return 'amie-pill-rose';
      if (category.includes('思维') || category.includes('通识')) return 'amie-pill-amber';
      return 'amie-pill-neutral';
    };

    const isRefreshingResults = ref(false);
    const loadResults = async () => {
      isRefreshingResults.value = true;
      try {
        const res = await api('/api/results');
        stats.value = res.stats;
      } catch (e) {
        // 忽略未开放权限时的错误提示
      } finally {
        setTimeout(() => {
          isRefreshingResults.value = false;
        }, 400);
      }
    };

    // 剩余可选票数计算
    const remainingVotes = computed(() => {
      const max = settings.value.maxVotesPerUser || 3;
      return Math.max(0, max - selectedTopicIds.value.length);
    });

    const clearSearch = () => {
      triggerHaptic('light');
      searchQuery.value = '';
      activeCategory.value = '全部';
    };

    // 分类筛选列表
    const categories = computed(() => {
      const set = new Set();
      topics.value.forEach(t => {
        if (t.category) set.add(t.category);
      });
      return ['全部', ...Array.from(set)];
    });

    // 过滤后的社课主题
    const filteredTopics = computed(() => {
      return topics.value.filter(t => {
        const matchCategory = activeCategory.value === '全部' || t.category === activeCategory.value;
        const query = searchQuery.value.trim().toLowerCase();
        const matchSearch = !query || 
          t.title.toLowerCase().includes(query) || 
          t.speaker.toLowerCase().includes(query) || 
          t.summary.toLowerCase().includes(query) ||
          (t.tag && t.tag.toLowerCase().includes(query));
        return matchCategory && matchSearch;
      });
    });

    // 已选择的社课对象集合
    const selectedTopics = computed(() => {
      return topics.value.filter(t => selectedTopicIds.value.includes(t.id));
    });

    // 是否已经修改了之前的选票
    const hasSelectionChanged = computed(() => {
      if (!userVote.value) return selectedTopicIds.value.length > 0;
      const original = [...userVote.value.topicIds].sort().join(',');
      const current = [...selectedTopicIds.value].sort().join(',');
      return original !== current;
    });

    // 动效状态
    const badgeBouncing = ref(false);
    const triggerBadgeBounce = () => {
      badgeBouncing.value = false;
      setTimeout(() => {
        badgeBouncing.value = true;
        setTimeout(() => { badgeBouncing.value = false; }, 400);
      }, 10);
    };

    const expandedTopicIds = ref([]);
    const toggleExpand = (topicId) => {
      const idx = expandedTopicIds.value.indexOf(topicId);
      if (idx > -1) {
        expandedTopicIds.value.splice(idx, 1);
      } else {
        expandedTopicIds.value.push(topicId);
      }
    };

    // 切换社课选中状态
    const toggleTopic = (topicId) => {
      triggerHaptic('light');
      if (settings.value.status === 'closed') {
        showToast('本次投票已截止', 'warning');
        return;
      }
      if (settings.value.status === 'paused') {
        showToast('投票暂缓进行中', 'warning');
        return;
      }
      if (userVote.value && !settings.value.allowChangeVote) {
        showToast('本次投票不允许修改已提交的选票', 'warning');
        return;
      }

      const idx = selectedTopicIds.value.indexOf(topicId);
      if (idx > -1) {
        // 取消选择
        selectedTopicIds.value.splice(idx, 1);
        triggerBadgeBounce();
      } else {
        // 增加选择
        const max = settings.value.maxVotesPerUser || 3;
        if (selectedTopicIds.value.length >= max) {
          triggerHaptic('medium');
          showToast(`每人至多投 ${max} 票，请先取消其他选项后再选择`, 'warning');
          return;
        }
        selectedTopicIds.value.push(topicId);
        triggerBadgeBounce();
      }
    };

    // 确认提交选票
    const handlePreSubmit = () => {
      triggerHaptic('medium');
      if (selectedTopicIds.value.length === 0) {
        showToast('请至少选择一个感兴趣的社课主题', 'warning');
        return;
      }
      if (!user.value) {
        authMode.value = 'register';
        showAuthModal.value = true;
        showToast('请先登录或登记身份，即可完成投票', 'info');
        return;
      }
      showConfirmModal.value = true;
    };

    const confirmSubmitVote = async () => {
      submittingVote.value = true;
      try {
        const res = await api('/api/vote', {
          method: 'POST',
          body: JSON.stringify({ topicIds: selectedTopicIds.value })
        });
        triggerHaptic('success');
        showToast(res.message, 'success');
        if (window.fireAmieConfetti) {
          window.fireAmieConfetti();
        }
        userVote.value = res.vote;
        showConfirmModal.value = false;
        // 重新刷新统计与主题
        await loadTopics();
        await loadResults();
      } catch (err) {
        console.error('投票失败:', err);
      } finally {
        submittingVote.value = false;
      }
    };

    // 移动端弹窗打开时禁止底层页面滚动
    const isAnyModalOpen = computed(() => {
      return !!(showDetailModal.value || showConfirmModal.value || showAuthModal.value || showAdminModal.value || showTopicFormModal.value || showQrModal.value);
    });

    Vue.watch(isAnyModalOpen, (val) => {
      if (typeof document !== 'undefined' && document.body) {
        if (val) {
          document.body.style.overflow = 'hidden';
          document.body.style.touchAction = 'none';
        } else {
          document.body.style.overflow = '';
          document.body.style.touchAction = '';
        }
      }
    });

    // 用户认证
    const handleAuthSubmit = async () => {
      authError.value = '';
      const endpoint = authMode.value === 'login' ? '/api/auth/login' : '/api/auth/register';
      try {
        const res = await api(endpoint, {
          method: 'POST',
          body: JSON.stringify(authForm.value)
        });
        token.value = res.token;
        localStorage.setItem('lecture_vote_token', res.token);
        user.value = res.user;
        showToast(res.message, 'success');
        showAuthModal.value = false;
        authForm.value = { username: '', displayName: '', password: '' };

        // 刷新状态获取此用户以前的选票
        const statusRes = await api('/api/status');
        userVote.value = statusRes.userVote;
        if (userVote.value && userVote.value.topicIds) {
          selectedTopicIds.value = [...userVote.value.topicIds];
        }

        // 如果用户在未登录时已经勾选了社课，且此时还未正式投过票，自动弹出确认框
        if (!userVote.value && selectedTopicIds.value.length > 0) {
          showConfirmModal.value = true;
        }
      } catch (err) {
        authError.value = err.message;
      }
    };

    const handleLogout = () => {
      token.value = '';
      localStorage.removeItem('lecture_vote_token');
      user.value = null;
      userVote.value = null;
      selectedTopicIds.value = [];
      showToast('已安全退出登录', 'info');
    };

    // 打开管理后台
    const openAdminModal = async () => {
      if (!user.value || user.value.role !== 'admin') {
        // 如果尚未登录管理员，弹窗登录
        authMode.value = 'login';
        authForm.value.username = 'admin';
        showAuthModal.value = true;
        showToast('管理后台需要管理员登录 (默认 admin / admin123)', 'info');
        return;
      }
      adminSettingsForm.value = { ...settings.value };
      showAdminModal.value = true;
      if (adminActiveTab.value === 'ballots') {
        await loadBallots();
      }
    };

    // 保存全局设置
    const saveAdminSettings = async () => {
      try {
        const res = await api('/api/admin/settings', {
          method: 'PUT',
          body: JSON.stringify(adminSettingsForm.value)
        });
        settings.value = res.settings;
        showToast('系统设置已成功更新！', 'success');
      } catch (e) {}
    };

    // 打开添加/编辑主题弹窗
    const openAddTopicModal = () => {
      topicForm.value = {
        id: '',
        title: '',
        speaker: '朋辈讲师',
        category: '通识探索',
        tag: '新提案',
        duration: '45分钟 + 15分钟研讨',
        summary: '',
        outlineText: ''
      };
      showTopicFormModal.value = true;
    };

    const openEditTopicModal = (topic) => {
      topicForm.value = {
        id: topic.id,
        title: topic.title,
        speaker: topic.speaker,
        category: topic.category,
        tag: topic.tag || '',
        duration: topic.duration || '',
        summary: topic.summary || '',
        outlineText: (topic.outline || []).join('\n')
      };
      showTopicFormModal.value = true;
    };

    const saveTopic = async () => {
      if (!topicForm.value.title.trim()) {
        showToast('请输入社课主题名称', 'warning');
        return;
      }
      const payload = {
        ...topicForm.value,
        outline: topicForm.value.outlineText.split('\n').map(s => s.trim()).filter(Boolean)
      };

      try {
        if (topicForm.value.id) {
          // 编辑
          await api(`/api/admin/topics/${topicForm.value.id}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          showToast('主题修改成功', 'success');
        } else {
          // 新增
          await api('/api/admin/topics', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          showToast('新主题添加成功', 'success');
        }
        showTopicFormModal.value = false;
        await loadTopics();
      } catch (e) {}
    };

    const deleteTopic = async (topicId) => {
      if (!confirm('确定要删除该社课主题吗？该主题的已有投票记录也将被移除。')) return;
      try {
        await api(`/api/admin/topics/${topicId}`, { method: 'DELETE' });
        showToast('主题已删除', 'success');
        await loadTopics();
      } catch (e) {}
    };

    // 加载所有选票明细
    const loadBallots = async () => {
      try {
        const res = await api('/api/admin/ballots');
        ballots.value = res.ballots;
      } catch (e) {}
    };

    // 清空选票
    const clearVotes = async () => {
      if (!confirm('警告：确定要清空所有人的投票数据吗？此操作不可逆！')) return;
      try {
        await api('/api/admin/clear-votes', { method: 'POST' });
        showToast('选票已全部清空，可以重新开局', 'success');
        userVote.value = null;
        selectedTopicIds.value = [];
        await loadTopics();
        await loadResults();
        await loadBallots();
      } catch (e) {}
    };

    // 导出 CSV (支持前端本地安全导出，支持 Excel UTF-8 BOM)
    const exportCsv = () => {
      if (!ballots.value || ballots.value.length === 0) {
        showToast('暂无已提交的选票数据可供导出', 'warning');
        return;
      }
      const headers = ['选票ID', '选民学号/用户名', '选民姓名', '投票主题', '投票时间'];
      const rows = ballots.value.map(b => [
        `"${b.id || ''}"`,
        `"${b.voterUsername || ''}"`,
        `"${b.voterDisplayName || ''}"`,
        `"${(b.topicTitles || []).join('；')}"`,
        `"${b.votedAt ? new Date(b.votedAt).toLocaleString() : ''}"`
      ]);
      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `朋辈社课投票明细_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('选票明细 CSV 已成功导出！', 'success');
    };

    onMounted(() => {
      initData();
    });

    return {
      loading,
      user,
      settings,
      topics,
      userVote,
      selectedTopicIds,
      selectedTopics,
      hasSelectionChanged,
      stats,
      activeTab,
      activeCategory,
      categories,
      filteredTopics,
      searchQuery,
      showDetailModal,
      showConfirmModal,
      showAuthModal,
      authMode,
      authForm,
      authError,
      submittingVote,
      toast,
      showAdminModal,
      adminActiveTab,
      adminSettingsForm,
      ballots,
      showTopicFormModal,
      topicForm,
      toggleTopic,
      handlePreSubmit,
      confirmSubmitVote,
      handleAuthSubmit,
      handleLogout,
      openAdminModal,
      saveAdminSettings,
      openAddTopicModal,
      openEditTopicModal,
      saveTopic,
      deleteTopic,
      loadBallots,
      clearVotes,
      exportCsv,
      mobileUrl,
      showQrModal,
      openQrModal,
      copyMobileUrl,
      getCategoryClass,
      badgeBouncing,
      expandedTopicIds,
      toggleExpand,
      handleSmartShare,
      triggerHaptic,
      remainingVotes,
      clearSearch,
      isRefreshingResults,
      loadResults,
      loadTopics
    };
  }
}).mount('#app');

/* ============================================================
   初初的错题集 - 应用逻辑
   功能：错题录入（拍照）、错题本列表、题目详情、
        强化复习（间隔重复）、学习统计、数据备份/导入
   ============================================================ */

(function () {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;

  /* ---------- 题型分类 ---------- */
  var CATEGORIES = {
    '语文': ['拼音', '识字写字', '词语句子', '阅读理解', '看图写话', '古诗词', '其他'],
    '数学': ['口算/计算', '认识图形', '应用题', '人民币/钟表', '找规律', '其他']
  };

  /* ---------- 鼓励语 ---------- */
  var PRAISE = [
    '初初真棒！🌟', '太厉害啦！🎉', '答对啦，真聪明！⭐',
    '好棒呀，继续加油！💪', '满分小达人！🏅', '你记得真牢！🧠'
  ];
  var ENCOURAGE = [
    '没关系，再记一次就记住啦！💪', '错题就是用来打败的！🔥',
    '别灰心，下次一定行！🌱', '再想一想，很快就能掌握！🌈'
  ];

  /* ---------- 全局状态 ---------- */
  var questions = [];          // 全部错题（已规范化）
  var filter = '全部';
  var search = '';
  var editingId = null;
  var addState = { subject: '语文', category: null, image: null, answerImage: null };
  var review = { queue: [], index: 0, correct: 0, wrong: 0, revealed: false, finished: false, mode: 'due' };

  var toastTimer = null;

  /* ---------- DOM 引用 ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var listContainer = $('list-container');
  var listSummary = $('list-summary');
  var searchInput = $('search-input');
  var btnReview = $('btn-review');
  var addTitle = $('add-title');
  var addForm = $('add-form');
  var fileImage = $('file-image');
  var fileAnswerImage = $('file-answer-image');
  var inputTitle = $('input-title');
  var inputAnswer = $('input-answer');
  var inputNote = $('input-note');
  var detailBody = $('detail-body');
  var reviewBody = $('review-body');
  var reviewProgressText = $('review-progress-text');
  var reviewProgressFill = $('review-progress-fill');
  var statsBody = $('stats-body');
  var fileImport = $('file-import');
  var lightbox = $('lightbox');
  var lightboxImg = $('lightbox-img');

  /* ============================================================
     工具函数
     ============================================================ */
  function uid() {
    return 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }
  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function getQ(id) { return questions.find(function (q) { return q.id === id; }); }

  function normalizeQuestion(q) {
    var now = Date.now();
    return {
      id: q.id || uid(),
      subject: q.subject === '数学' ? '数学' : '语文',
      category: q.category || '',
      title: q.title || '',
      answerText: q.answerText || '',
      note: q.note || '',
      image: q.image || null,
      answerImage: q.answerImage || null,
      createdAt: q.createdAt || now,
      mastery: num(q.mastery, 1),
      interval: num(q.interval, 1),
      ease: num(q.ease, 2.5),
      reps: num(q.reps, 0),
      lapses: num(q.lapses, 0),
      due: q.due || now,
      lastReview: q.lastReview || null,
      correctCount: num(q.correctCount, 0),
      wrongCount: num(q.wrongCount, 0)
    };
  }

  function masteryInfo(q) {
    if (q.mastery <= 1) return { text: '需加强', cls: 'mastery-weak' };
    if (q.mastery <= 3) return { text: '一般', cls: 'mastery-mid' };
    return { text: '已掌握', cls: 'mastery-strong' };
  }

  function dueLabel(q) {
    var diff = q.due - Date.now();
    if (diff <= 0) return { text: '该复习了', cls: 'overdue' };
    var days = Math.ceil(diff / DAY_MS);
    if (days <= 1) return { text: '今天复习', cls: 'today' };
    if (days <= 7) return { text: days + ' 天后复习', cls: '' };
    return { text: fmtDate(q.due) + ' 复习', cls: '' };
  }

  function qTitle(q) {
    if (q.title) return q.title;
    if (q.category) return q.category;
    return q.subject + '错题';
  }

  function countDue() {
    var now = Date.now();
    return questions.filter(function (q) { return q.due <= now; }).length;
  }

  function filteredQuestions() {
    var list = questions.slice();
    if (filter !== '全部') list = list.filter(function (q) { return q.subject === filter; });
    if (search) {
      var s = search.toLowerCase();
      list = list.filter(function (q) {
        return (q.title + ' ' + q.category + ' ' + q.note + ' ' + q.answerText).toLowerCase().indexOf(s) >= 0;
      });
    }
    var now = Date.now();
    list.sort(function (a, b) {
      var aOver = a.due <= now ? 0 : 1;
      var bOver = b.due <= now ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      return b.createdAt - a.createdAt;
    });
    return list;
  }

  /* ---------- 图片压缩（缩小到最长边 1600px，转 JPEG） ---------- */
  function compressImage(file, maxDim, quality) {
    maxDim = maxDim || 1600;
    quality = quality || 0.78;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          URL.revokeObjectURL(url);
          var isPng = file.type === 'image/png';
          var mime = isPng ? 'image/png' : 'image/jpeg';
          resolve(canvas.toDataURL(mime, isPng ? undefined : quality));
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  /* ============================================================
     页面切换
     ============================================================ */
  var SCREENS = ['screen-home', 'screen-add', 'screen-detail', 'screen-review', 'screen-stats', 'screen-settings'];
  function showScreen(id) {
    SCREENS.forEach(function (s) { $(s).classList.toggle('active', s === id); });
    window.scrollTo(0, 0);
  }
  function goHome() {
    filter = '全部'; search = '';
    searchInput.value = '';
    renderHome();
    showScreen('screen-home');
  }

  /* ============================================================
     数据加载
     ============================================================ */
  function load() {
    return Store.getAll().then(function (list) {
      questions = list.map(normalizeQuestion);
      renderHome();
    });
  }

  /* ============================================================
     首页 / 错题本列表
     ============================================================ */
  function cardHtml(q) {
    var m = masteryInfo(q);
    var d = dueLabel(q);
    var subj = q.subject === '数学' ? 'math' : 'cn';
    var thumb = q.image ? '<img src="' + q.image + '" alt="">' : (q.subject === '数学' ? '🧮' : '📖');
    return '<div class="q-card" data-id="' + q.id + '">' +
      '<div class="q-card-top">' +
        '<div class="q-thumb">' + thumb + '</div>' +
        '<div class="q-info">' +
          '<div class="q-title">' + escapeHtml(qTitle(q)) + '</div>' +
          '<div class="q-meta">' +
            '<span class="badge subject-' + subj + '">' + q.subject + '</span>' +
            (q.category ? '<span class="badge cat">' + escapeHtml(q.category) + '</span>' : '') +
            '<span class="badge ' + m.cls + '">' + m.text + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="q-foot">' +
        '<span>📅 ' + fmtDate(q.createdAt) + '</span>' +
        '<span class="q-due ' + d.cls + '">⏰ ' + d.text + '</span>' +
      '</div>' +
    '</div>';
  }

  function renderHome() {
    var list = filteredQuestions();
    var total = questions.length;
    var cn = questions.filter(function (q) { return q.subject === '语文'; }).length;
    var math = total - cn;

    if (filter === '全部' && !search) {
      listSummary.textContent = '共 ' + total + ' 道错题 · 语文 ' + cn + ' · 数学 ' + math;
    } else if (list.length > 0) {
      listSummary.textContent = '筛选出 ' + list.length + ' 道题';
    } else {
      listSummary.textContent = '';
    }

    if (list.length === 0) {
      listContainer.innerHTML = '<div class="empty">' +
        '<span class="empty-emoji">' + (questions.length === 0 ? '📚' : '🔍') + '</span>' +
        '<p>' + (questions.length === 0 ? '还没有错题，点击「录入错题」开始吧！' : '没有找到匹配的题目～') + '</p>' +
      '</div>';
    } else {
      listContainer.innerHTML = list.map(cardHtml).join('');
      listContainer.querySelectorAll('.q-card').forEach(function (card, i) {
        card.onclick = function () { openDetail(list[i].id); };
      });
    }
    updateReviewBadge();
  }

  function updateReviewBadge() {
    var due = countDue();
    var badge = btnReview.querySelector('.due-badge');
    if (due > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'due-badge';
        btnReview.appendChild(badge);
      }
      badge.textContent = due + ' 待复习';
    } else if (badge) {
      badge.remove();
    }
  }

  /* ============================================================
     录入 / 编辑错题
     ============================================================ */
  function renderSubjectToggle() {
    document.querySelectorAll('#subject-toggle .subject-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.subject === addState.subject);
    });
  }

  function renderCategories() {
    var group = $('category-group');
    var cats = CATEGORIES[addState.subject];
    group.innerHTML = cats.map(function (c) {
      return '<button type="button" class="chip' + (addState.category === c ? ' active' : '') + '" data-cat="' + escapeHtml(c) + '">' + escapeHtml(c) + '</button>';
    }).join('');
    group.querySelectorAll('.chip').forEach(function (chip) {
      chip.onclick = function () {
        addState.category = chip.dataset.cat;
        renderCategories();
      };
    });
  }

  function renderPhotoSlots() {
    var slot = $('photo-slot');
    if (addState.image) {
      slot.innerHTML = '<div class="photo-preview">' +
        '<img src="' + addState.image + '" alt="题目照片">' +
        '<div class="photo-actions">' +
          '<button type="button" class="photo-change" id="change-photo">🔄 重拍</button>' +
          '<button type="button" class="photo-remove" id="remove-photo">🗑️ 移除</button>' +
        '</div></div>';
      $('change-photo').onclick = function () { fileImage.click(); };
      $('remove-photo').onclick = function () { addState.image = null; renderPhotoSlots(); };
    } else {
      slot.innerHTML = '<button type="button" class="photo-btn" id="btn-photo">📷 拍照 / 从相册选</button>';
      $('btn-photo').onclick = function () { fileImage.click(); };
    }

    var aslot = $('answer-photo-slot');
    if (addState.answerImage) {
      aslot.innerHTML = '<div class="photo-preview">' +
        '<img src="' + addState.answerImage + '" alt="答案照片">' +
        '<div class="photo-actions">' +
          '<button type="button" class="photo-change" id="change-answer-photo">🔄 重拍</button>' +
          '<button type="button" class="photo-remove" id="remove-answer-photo">🗑️ 移除</button>' +
        '</div></div>';
      $('change-answer-photo').onclick = function () { fileAnswerImage.click(); };
      $('remove-answer-photo').onclick = function () { addState.answerImage = null; renderPhotoSlots(); };
    } else {
      aslot.innerHTML = '<button type="button" class="photo-btn" id="btn-answer-photo">📷 拍答案</button>';
      $('btn-answer-photo').onclick = function () { fileAnswerImage.click(); };
    }
  }

  function resetAddForm() {
    editingId = null;
    addState = { subject: '语文', category: null, image: null, answerImage: null };
    inputTitle.value = '';
    inputAnswer.value = '';
    inputNote.value = '';
    addTitle.textContent = '📷 录入错题';
    renderSubjectToggle();
    renderCategories();
    renderPhotoSlots();
  }

  function openAdd() {
    resetAddForm();
    showScreen('screen-add');
  }

  function openEdit(q) {
    editingId = q.id;
    addState.subject = q.subject;
    addState.category = q.category || null;
    addState.image = q.image;
    addState.answerImage = q.answerImage;
    inputTitle.value = q.title || '';
    inputAnswer.value = q.answerText || '';
    inputNote.value = q.note || '';
    addTitle.textContent = '✏️ 编辑错题';
    renderSubjectToggle();
    renderCategories();
    renderPhotoSlots();
    showScreen('screen-add');
  }

  function saveQuestion(e) {
    e.preventDefault();
    if (!addState.image) { toast('请先拍摄或选择题目照片 📷'); return; }
    var title = inputTitle.value.trim();
    var answerText = inputAnswer.value.trim();
    var note = inputNote.value.trim();
    var now = Date.now();

    if (editingId) {
      var q = getQ(editingId);
      if (!q) { toast('⚠️ 未找到该题'); return; }
      q.subject = addState.subject;
      q.category = addState.category || '';
      q.title = title;
      q.answerText = answerText;
      q.note = note;
      q.image = addState.image;
      q.answerImage = addState.answerImage;
      Store.put(q).then(function () {
        finishSave('已更新 ✏️');
      });
    } else {
      var item = {
        id: uid(), subject: addState.subject, category: addState.category || '',
        title: title, answerText: answerText, note: note,
        image: addState.image, answerImage: addState.answerImage,
        createdAt: now, mastery: 1, interval: 1, ease: 2.5,
        reps: 0, lapses: 0, due: now, lastReview: null,
        correctCount: 0, wrongCount: 0
      };
      Store.put(item).then(function () {
        finishSave('已保存 ✅');
      });
    }
  }

  function finishSave(msg) {
    return load().then(function () {
      toast(msg);
      showScreen('screen-home');
    });
  }

  /* ============================================================
     题目详情
     ============================================================ */
  function openDetail(id) {
    var q = getQ(id);
    if (!q) return;
    renderDetail(q);
    showScreen('screen-detail');
  }

  function renderDetail(q) {
    var m = masteryInfo(q);
    var subj = q.subject === '数学' ? 'math' : 'cn';
    var html = '';
    html += '<div class="detail-img-wrap" id="detail-img">' +
      (q.image ? '<img src="' + q.image + '" alt="题目">' : '<div class="detail-img-placeholder">📖</div>') +
      '</div>';

    html += '<div class="detail-block"><div class="detail-meta-row">' +
      '<span class="badge subject-' + subj + '">' + q.subject + '</span>' +
      (q.category ? '<span class="badge cat">' + escapeHtml(q.category) + '</span>' : '') +
      '<span class="badge ' + m.cls + '">掌握度：' + m.text + '</span>' +
      '</div></div>';

    if (q.title) {
      html += '<div class="detail-block"><h4>题目简述</h4><div class="detail-text">' + escapeHtml(q.title) + '</div></div>';
    }

    html += '<div class="detail-block"><h4>正确答案</h4>' +
      '<div class="detail-text">' + (q.answerText ? escapeHtml(q.answerText) : '（未填写）') + '</div>' +
      (q.answerImage ? '<img src="' + q.answerImage + '" alt="答案照片" style="margin-top:10px;border-radius:12px;cursor:zoom-in;background:#fff" id="detail-answer-img">' : '') +
      '</div>';

    if (q.note) {
      html += '<div class="detail-block"><h4>知识点 / 备注</h4><div class="detail-text">' + escapeHtml(q.note) + '</div></div>';
    }

    html += '<div class="detail-block"><h4>复习记录</h4>' +
      '<div class="detail-text" style="font-size:14px;color:var(--muted)">' +
        '已复习 ' + (q.reps + q.lapses) + ' 次 · 答对 ' + q.correctCount + ' · 需加强 ' + q.wrongCount + '<br>' +
        (q.lastReview ? '上次复习：' + fmtDate(q.lastReview) + '　' : '还没有复习过　') + '下次：' + dueLabel(q).text +
      '</div></div>';

    html += '<div class="detail-actions">' +
      '<button class="big-btn ghost" id="btn-edit">✏️ 编辑</button>' +
      '<button class="big-btn danger" id="btn-delete">🗑️ 删除</button>' +
      '</div>';

    detailBody.innerHTML = html;

    var imgWrap = $('detail-img');
    if (q.image) imgWrap.onclick = function () { openLightbox(q.image); };
    var ansImg = $('detail-answer-img');
    if (ansImg) ansImg.onclick = function () { openLightbox(q.answerImage); };
    $('btn-edit').onclick = function () { openEdit(q); };
    $('btn-delete').onclick = function () { deleteQuestion(q); };
  }

  function deleteQuestion(q) {
    confirmDialog('删除错题', '确定删除这道错题吗？删除后无法恢复。', '删除', true, function () {
      Store.remove(q.id).then(function () {
        return load();
      }).then(function () {
        toast('已删除 🗑️');
        showScreen('screen-home');
      });
    });
  }

  /* ============================================================
     强化复习（间隔重复）
     ============================================================ */
  function buildQueue(mode) {
    var now = Date.now();
    if (mode === 'due') {
      var due = questions.filter(function (q) { return q.due <= now; });
      due.sort(function (a, b) { return (a.due - b.due) || (a.mastery - b.mastery); });
      return due.map(function (q) { return q.id; });
    }
    // weak：全部题，按掌握度从低到高
    var all = questions.slice().sort(function (a, b) {
      return (a.mastery - b.mastery) || (a.due - b.due);
    });
    return all.map(function (q) { return q.id; });
  }

  function startReview(mode) {
    var ids = buildQueue(mode);
    review = { queue: ids, index: 0, correct: 0, wrong: 0, revealed: false, finished: false, mode: mode };
    showScreen('screen-review');
    if (ids.length === 0) {
      review.finished = true;
      reviewProgressText.textContent = '';
      reviewProgressFill.style.width = '0%';
      reviewBody.innerHTML = '<div class="review-done">' +
        '<div class="done-emoji">🎈</div>' +
        '<h3>今天没有需要复习的题目啦！</h3>' +
        '<p style="color:var(--muted)">真棒，都复习过了～</p>' +
        '<div class="done-btns">' +
          '<button class="big-btn review" id="btn-weak-review">📚 提前复习全部</button>' +
          '<button class="big-btn ghost" id="btn-empty-home">🏠 返回首页</button>' +
        '</div></div>';
      $('btn-weak-review').onclick = function () { startReview('weak'); };
      $('btn-empty-home').onclick = goHome;
      return;
    }
    renderReviewCard();
  }

  function answerContentHtml(q) {
    var html = '';
    if (q.answerText) html += '<div class="answer-text">' + escapeHtml(q.answerText) + '</div>';
    if (q.answerImage) html += '<img src="' + q.answerImage + '" alt="答案">';
    if (!html) html = '<div class="answer-text" style="color:#c78a00">这道题还没有填写答案～</div>';
    return html;
  }

  function reviewCardHtml(q) {
    var m = masteryInfo(q);
    var subj = q.subject === '数学' ? 'math' : 'cn';
    var img = q.image
      ? '<div class="review-img-wrap" id="review-img"><img src="' + q.image + '" alt="题目"><span class="tap-hint">点击放大</span></div>'
      : '';
    var title = q.title ? '<div class="review-title">' + escapeHtml(q.title) + '</div>' : '';
    return '<div class="review-card">' +
      '<div class="review-card-head"><span class="badges">' +
        '<span class="badge subject-' + subj + '">' + q.subject + '</span>' +
        (q.category ? '<span class="badge cat">' + escapeHtml(q.category) + '</span>' : '') +
        '<span class="badge ' + m.cls + '">' + m.text + '</span>' +
      '</span></div>' +
      img + title +
      '<div class="answer-zone">' +
        '<button class="answer-toggle" id="btn-reveal">🙈 看答案</button>' +
        '<div class="answer-panel" id="answer-panel" hidden></div>' +
      '</div>' +
    '</div>' +
    '<div class="review-actions">' +
      '<button class="judge-btn wrong-btn" id="btn-wrong">❌ 我不会</button>' +
      '<button class="judge-btn right-btn" id="btn-right">✅ 我会了</button>' +
    '</div>' +
    '<div class="feedback" id="review-feedback" hidden></div>';
  }

  function renderReviewCard() {
    var q = getQ(review.queue[review.index]);
    if (!q) { renderReviewDone(); return; }
    var done = review.index;
    var total = review.queue.length;
    review.revealed = false;
    reviewProgressText.textContent = '第 ' + (done + 1) + ' / ' + total + ' 题';
    reviewProgressFill.style.width = (done / total * 100) + '%';
    reviewBody.innerHTML = reviewCardHtml(q);

    var imgWrap = $('review-img');
    if (imgWrap) imgWrap.onclick = function () { openLightbox(q.image); };
    $('btn-reveal').onclick = revealAnswer;
    $('btn-wrong').onclick = function () { judge(false); };
    $('btn-right').onclick = function () { judge(true); };
  }

  function revealAnswer() {
    var q = getQ(review.queue[review.index]);
    var panel = $('answer-panel');
    var btn = $('btn-reveal');
    if (panel.hidden) {
      panel.innerHTML = answerContentHtml(q);
      panel.hidden = false;
      btn.textContent = '🙉 收起答案';
    } else {
      panel.hidden = true;
      btn.textContent = '🙈 看答案';
    }
  }

  function judge(correct) {
    if (review.finished) return;
    var q = getQ(review.queue[review.index]);
    if (!q) return;
    var now = Date.now();

    if (correct) {
      q.reps++;
      q.correctCount++;
      if (q.reps === 1) q.interval = 1;
      else if (q.reps === 2) q.interval = 3;
      else q.interval = Math.round(q.interval * q.ease);
      q.ease = Math.min(3.0, q.ease + 0.1);
      q.mastery = Math.min(5, q.mastery + 1);
      review.correct++;
    } else {
      q.lapses++;
      q.wrongCount++;
      q.interval = 1;
      q.ease = Math.max(1.3, q.ease - 0.2);
      q.mastery = Math.max(0, q.mastery - 1);
      review.wrong++;
    }
    q.lastReview = now;
    q.due = now + q.interval * DAY_MS;
    Store.put(q).catch(function () {});

    // 自动展示答案，帮助对照
    var panel = $('answer-panel');
    if (panel && panel.hidden) {
      panel.innerHTML = answerContentHtml(q);
      panel.hidden = false;
      var btn = $('btn-reveal');
      if (btn) btn.textContent = '🙉 收起答案';
    }

    // 反馈
    var fb = $('review-feedback');
    if (correct) {
      fb.textContent = pick(PRAISE);
      fb.className = 'feedback correct';
    } else {
      fb.textContent = pick(ENCOURAGE);
      fb.className = 'feedback wrong';
    }
    fb.hidden = false;

    var wrongBtn = $('btn-wrong'), rightBtn = $('btn-right');
    wrongBtn.disabled = true; rightBtn.disabled = true;
    wrongBtn.style.opacity = '0.5'; rightBtn.style.opacity = '0.5';

    setTimeout(function () {
      review.index++;
      if (review.index >= review.queue.length) {
        renderReviewDone();
      } else {
        renderReviewCard();
      }
    }, 1100);
  }

  function renderReviewDone() {
    review.finished = true;
    var total = review.correct + review.wrong;
    reviewProgressText.textContent = '完成啦 🎉';
    reviewProgressFill.style.width = '100%';

    var praise;
    if (total === 0) praise = '今天没有题目，明天再来吧！';
    else if (review.wrong === 0) praise = '全部答对，初初太棒了！🌟';
    else if (review.correct >= review.wrong) praise = '进步很大，继续加油！💪';
    else praise = '坚持就是胜利，下次一定更棒！🌱';

    reviewBody.innerHTML = '<div class="review-done">' +
      '<div class="done-emoji">🎉</div>' +
      '<h3>' + praise + '</h3>' +
      (total > 0 ? '<div class="done-stats">共复习 <b>' + total + '</b> 题<br>答对 <b style="color:#2a9455">' + review.correct + '</b> 题 · 需加强 <b style="color:#f0554f">' + review.wrong + '</b> 题</div>' : '') +
      '<div class="done-btns">' +
        '<button class="big-btn review" id="btn-again">🔁 再复习一轮</button>' +
        '<button class="big-btn ghost" id="btn-done-home">🏠 返回首页</button>' +
      '</div></div>';
    $('btn-again').onclick = function () { startReview('weak'); };
    $('btn-done-home').onclick = goHome;
  }

  /* ============================================================
     学习统计
     ============================================================ */
  function renderStats() {
    var total = questions.length;
    var cn = questions.filter(function (q) { return q.subject === '语文'; }).length;
    var math = total - cn;
    var weak = questions.filter(function (q) { return q.mastery <= 1; }).length;
    var mid = questions.filter(function (q) { return q.mastery >= 2 && q.mastery <= 3; }).length;
    var strong = questions.filter(function (q) { return q.mastery >= 4; }).length;
    var due = countDue();
    var pct = function (n) { return total ? Math.round(n / total * 100) : 0; };

    statsBody.innerHTML =
      '<div class="stat-grid">' +
        '<div class="stat-card"><div class="stat-num">' + total + '</div><div class="stat-label">全部错题</div></div>' +
        '<div class="stat-card red"><div class="stat-num">' + due + '</div><div class="stat-label">待复习</div></div>' +
        '<div class="stat-card green"><div class="stat-num">' + strong + '</div><div class="stat-label">已掌握</div></div>' +
        '<div class="stat-card blue"><div class="stat-num">' + cn + ' / ' + math + '</div><div class="stat-label">语文 / 数学</div></div>' +
      '</div>' +
      '<div class="settings-card"><h3>📈 掌握情况</h3>' +
        '<div class="mastery-bar-list">' +
          '<div class="mastery-row"><span class="m-label">需加强</span><div class="m-track"><div class="m-fill weak" style="width:' + pct(weak) + '%"></div></div><span class="m-count">' + weak + '</span></div>' +
          '<div class="mastery-row"><span class="m-label">一般</span><div class="m-track"><div class="m-fill mid" style="width:' + pct(mid) + '%"></div></div><span class="m-count">' + mid + '</span></div>' +
          '<div class="mastery-row"><span class="m-label">已掌握</span><div class="m-track"><div class="m-fill strong" style="width:' + pct(strong) + '%"></div></div><span class="m-count">' + strong + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="settings-card"><h3>💡 小贴士</h3>' +
        '<p class="hint">' + (total === 0
          ? '还没有错题。先点击「录入错题」，把初初做错的题目拍下来吧！'
          : (due > 0 ? '今天有 ' + due + ' 道题该复习了，记得提醒初初完成哦～' : '今天的复习都完成啦，初初真棒！🌟')) +
        '</p></div>';
  }

  /* ============================================================
     设置与备份
     ============================================================ */
  function exportData() {
    var data = {
      app: 'chuchu-cuoti',
      version: 1,
      exportedAt: new Date().toISOString(),
      questions: questions
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    a.href = url;
    a.download = '初初错题集备份-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    toast('✅ 备份已导出');
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var list = Array.isArray(data) ? data : (data.questions || []);
        if (!Array.isArray(list) || list.length === 0) throw new Error('empty');
        var valid = list.filter(function (q) { return q && q.id; }).map(normalizeQuestion);
        if (valid.length === 0) throw new Error('invalid');
        var map = {};
        questions.forEach(function (q) { map[q.id] = q; });
        valid.forEach(function (q) { map[q.id] = q; });
        questions = Object.keys(map).map(function (k) { return map[k]; });
        Store.putMany(questions).then(function () {
          return load();
        }).then(function () {
          toast('✅ 已导入 ' + valid.length + ' 道题');
        });
      } catch (e) {
        toast('⚠️ 备份文件格式不正确');
      }
    };
    reader.onerror = function () { toast('⚠️ 文件读取失败'); };
    reader.readAsText(file);
  }

  function clearAll() {
    confirmDialog('清空数据', '确定清空所有错题吗？此操作无法恢复，建议先导出备份。', '清空', true, function () {
      Store.clear().then(function () {
        return load();
      }).then(function () {
        toast('已清空 🗑️');
      });
    });
  }

  /* ============================================================
     通用 UI：弹窗 / 提示 / 图片放大
     ============================================================ */
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function confirmDialog(title, message, okText, isDanger, onOk) {
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = '<div class="modal">' +
      '<h3>' + escapeHtml(title) + '</h3>' +
      '<p>' + escapeHtml(message) + '</p>' +
      '<div class="modal-actions">' +
        '<button class="modal-cancel" id="m-cancel">取消</button>' +
        '<button class="modal-ok ' + (isDanger ? 'danger' : '') + '" id="m-ok">' + escapeHtml(okText) + '</button>' +
      '</div></div>';
    document.body.appendChild(mask);
    mask.querySelector('#m-cancel').onclick = function () { mask.remove(); };
    mask.querySelector('#m-ok').onclick = function () { mask.remove(); if (onOk) onOk(); };
    mask.onclick = function (e) { if (e.target === mask) mask.remove(); };
  }

  function openLightbox(src) {
    if (!src) return;
    lightboxImg.src = src;
    lightbox.classList.remove('hidden');
  }

  /* ============================================================
     事件绑定
     ============================================================ */
  function bindEvents() {
    // 顶部按钮
    $('btn-stats').onclick = function () { renderStats(); showScreen('screen-stats'); };
    $('btn-settings').onclick = function () { showScreen('screen-settings'); };

    // 首页
    $('btn-add').onclick = openAdd;
    btnReview.onclick = function () {
      if (questions.length === 0) { toast('还没有错题，先去录入吧 📷'); return; }
      startReview(countDue() > 0 ? 'due' : 'weak');
    };

    // 标签页
    document.querySelectorAll('#tabs .tab').forEach(function (tab) {
      tab.onclick = function () {
        document.querySelectorAll('#tabs .tab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        filter = tab.dataset.filter;
        renderHome();
      };
    });

    // 搜索
    searchInput.addEventListener('input', function () {
      search = searchInput.value.trim();
      renderHome();
    });

    // 返回按钮
    $('add-back').onclick = goHome;
    $('detail-back').onclick = goHome;
    $('review-back').onclick = goHome;
    $('stats-back').onclick = goHome;
    $('settings-back').onclick = goHome;

    // 录入表单
    document.querySelectorAll('#subject-toggle .subject-btn').forEach(function (btn) {
      btn.onclick = function () {
        addState.subject = btn.dataset.subject;
        addState.category = null;
        renderSubjectToggle();
        renderCategories();
      };
    });

    fileImage.onchange = function (e) {
      var f = e.target.files[0];
      if (!f) return;
      toast('🖼️ 正在处理照片…');
      compressImage(f).then(function (dataUrl) {
        addState.image = dataUrl;
        renderPhotoSlots();
      }).catch(function () {
        toast('⚠️ 照片处理失败，请重试');
      });
      e.target.value = '';
    };

    fileAnswerImage.onchange = function (e) {
      var f = e.target.files[0];
      if (!f) return;
      toast('🖼️ 正在处理照片…');
      compressImage(f).then(function (dataUrl) {
        addState.answerImage = dataUrl;
        renderPhotoSlots();
      }).catch(function () {
        toast('⚠️ 照片处理失败，请重试');
      });
      e.target.value = '';
    };

    addForm.onsubmit = saveQuestion;

    // 设置
    $('btn-export').onclick = exportData;
    $('btn-import').onclick = function () { fileImport.click(); };
    fileImport.onchange = function (e) {
      var f = e.target.files[0];
      if (f) importData(f);
      e.target.value = '';
    };
    $('btn-clear').onclick = clearAll;

    // 图片放大
    $('lightbox-close').onclick = function () { lightbox.classList.add('hidden'); };
    lightbox.onclick = function (e) { if (e.target === lightbox) lightbox.classList.add('hidden'); };
  }

  /* ============================================================
     启动
     ============================================================ */
  function init() {
    bindEvents();
    resetAddForm();
    Store.init().then(function () {
      return load();
    }).catch(function () {
      questions = [];
      renderHome();
    });

    // 注册 Service Worker（需 http/https，file:// 下自动跳过）
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

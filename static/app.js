let state = {
  projects: [],
  currentProjectId: null,
  currentProject: null,
  config: { has_deepseek_key: false },
  busy: false,
  busyText: "",
  busyStatusId: "",
  activePage: "project",
  fullReviews: null,
  fullAtomic: null,
  jobPollTimer: null,
  backups: [],
};

const $ = (id) => document.getElementById(id);

const FLOW_LABELS = [
  ["api", "0", "访问保护"],
  ["project", "1", "建项目"],
  ["upload", "2", "导入 Review"],
  ["atomic", "3", "最小语义"],
  ["draft", "4", "维度草案"],
  ["lock", "5", "锁定规则"],
  ["final", "6", "最终打标"],
  ["analysis", "7", "细分洞察"],
  ["export", "8", "导出 Excel"],
];

const PAGE_LABELS = [
  ["project", "1 建项目"],
  ["upload", "2 导入 Review"],
  ["atomic", "3 最小语义"],
  ["draft", "4 维度草案"],
  ["lock", "5 锁定规则"],
  ["final", "6 最终打标"],
  ["analysis", "7 细分洞察"],
];

const BACKUP_DB_NAME = "voc_project_backups_v1";
const BACKUP_STORE = "projects";

const CONTEXT_PRESETS = {
  "年龄段": {
    definition_zh: "判断买家或实际使用者的年龄段，必须有明确年龄或人生阶段证据。",
    evidence_required_zh: "原文明确提到年龄、年级、老人、孩子等可判断年龄段的信息。",
    boundary_zh: "推荐给某年龄段但无法判断买家/使用者属于该人群时，不打。",
    analysis_use_zh: "用于判断核心使用人群年龄分布和信息表达重点。",
  },
  "角色/身份": {
    definition_zh: "判断买家或实际使用者是谁，必须有职业、身份或关系证据。",
    evidence_required_zh: "原文明确提到学生、老师、程序员、金融从业者、父母、孩子等身份。",
    boundary_zh: "只推荐某类人购买，不代表买家本人就是该角色。",
    analysis_use_zh: "用于识别人群画像和 Listing 场景表达。",
  },
  "用户特征": {
    definition_zh: "判断用户自身习惯、身体条件、经验水平或生态背景。",
    evidence_required_zh: "原文明确说明小手、手部问题、技术熟练、Mac 生态、长期键盘经验等用户自身特征。",
    boundary_zh: "设备兼容或产品表现本身不放这里，除非它描述的是用户背景。",
    analysis_use_zh: "用于理解特殊偏好和适配人群。",
  },
  "使用场景": {
    definition_zh: "判断键盘在哪里、和什么设备环境或桌面组合一起使用。",
    evidence_required_zh: "原文明确提到办公室、家里、旅行、桌面、电脑/平板/手机组合等环境。",
    boundary_zh: "长期任务放长期用途；设备能否兼容放产品决策维度。",
    analysis_use_zh: "用于构建场景图、设备组合图和使用环境说明。",
  },
  "长期用途": {
    definition_zh: "判断用户长期用产品做什么任务或工作流。",
    evidence_required_zh: "原文明确提到写作、办公、交易、咨询、表格、编程、学习等持续性任务。",
    boundary_zh: "临时触发原因放购买触发；单次试用不算长期用途。",
    analysis_use_zh: "用于判断核心任务场景和卖点排序。",
  },
  "使用频率/强度": {
    definition_zh: "判断使用频率、每日时长或使用强度。",
    evidence_required_zh: "原文明确提到每天使用、每周使用、一天 8 小时、重度使用等。",
    boundary_zh: "用了几个月/一年是使用周期，不是频率；除非同时说明每天或高频使用。",
    analysis_use_zh: "用于判断耐用、续航、舒适度评价的强度背景。",
  },
  "替换/复购路径": {
    definition_zh: "判断是否替换旧产品、复购本品，或改用其他替代方案。",
    evidence_required_zh: "原文明确提到旧键盘、再次购买同款、改回有线键盘、换别的品牌等。",
    boundary_zh: "售后换新不算复购；没有产生二次购买或替代选择时不打复购。",
    analysis_use_zh: "用于理解流失、复购和替代竞争关系。",
  },
  "价格价值": {
    definition_zh: "判断是否提到价格、价值、性价比、值不值。",
    evidence_required_zh: "原文明确出现价格、value、worth、cheap、expensive、deal 等价值判断。",
    boundary_zh: "单纯好评不等于价格价值；必须与价格或值不值有关。",
    analysis_use_zh: "用于判断定价感知和促销沟通。",
  },
  "购买触发": {
    definition_zh: "判断用户为什么现在购买。",
    evidence_required_zh: "原文明确提到旧产品坏了、新设备、工作变化、搬家、旅行、突然需求等即时触发。",
    boundary_zh: "长期用途不是购买触发；必须有当下购买原因。",
    analysis_use_zh: "用于理解转化入口和广告/Listing 场景钩子。",
  },
  "使用阻碍": {
    definition_zh: "判断上手、设置、连接、学习、操作是否构成阻碍。",
    evidence_required_zh: "原文明确提到设置难、配对难、学习成本、操作不便、找不到开关等。",
    boundary_zh: "产品性能失败归决策维度；这里强调使用过程中的阻碍。",
    analysis_use_zh: "用于优化说明书、FAQ、主图提示和客服预防。",
  },
};

function apiKey() {
  return localStorage.getItem("deepseek_api_key") || "";
}

function clientApiKey() {
  return state.config?.has_deepseek_key ? "" : apiKey();
}

function setApiKey(value) {
  localStorage.setItem("deepseek_api_key", value || "");
  renderApiKeyStatus();
  renderWorkflow(state.currentProject);
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(options.json ? { "Content-Type": "application/json" } : {}),
    },
    body: options.json ? JSON.stringify(options.json) : options.body,
  });
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    if (typeof data === "string" && data.trim()) {
      message = data.trim();
    } else if (data && typeof data === "object") {
      message = data.detail || data.error || data.message || JSON.stringify(data, null, 2);
    }
    throw new Error(message);
  }
  return data;
}

function openBackupDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("当前浏览器不支持本机备份"));
      return;
    }
    const req = indexedDB.open(BACKUP_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BACKUP_STORE)) db.createObjectStore(BACKUP_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("打开本机备份失败"));
  });
}

async function backupTx(mode, fn) {
  const db = await openBackupDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE, mode);
      const store = tx.objectStore(BACKUP_STORE);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("本机备份操作失败"));
      tx.onerror = () => reject(tx.error || new Error("本机备份事务失败"));
    });
  } finally {
    db.close();
  }
}

async function saveProjectBackup(snapshot) {
  const project = snapshot?.project || {};
  if (!project.id) return;
  const stats = snapshot.stats || project.stats || {};
  const record = {
    id: project.id,
    name: project.name || "未命名项目",
    category: project.category || "",
    stage: project.stage || "",
    updated_at: project.updated_at || "",
    stats,
    saved_at: new Date().toLocaleString("zh-CN"),
    snapshot,
  };
  await backupTx("readwrite", (store) => store.put(record));
  await loadBackups();
}

async function listProjectBackups() {
  try {
    const rows = await backupTx("readonly", (store) => store.getAll());
    return (rows || []).sort((a, b) => String(b.saved_at || "").localeCompare(String(a.saved_at || "")));
  } catch (err) {
    console.warn(err);
    return [];
  }
}

async function getProjectBackup(id) {
  return backupTx("readonly", (store) => store.get(id));
}

async function deleteProjectBackup(id) {
  await backupTx("readwrite", (store) => store.delete(id));
  await loadBackups();
}

async function loadBackups() {
  state.backups = await listProjectBackups();
  renderBackupList();
}

function backupStatusText(item) {
  const stats = item.stats || {};
  return `${item.category || "未填写品类"} · ${formatNum(stats.reviews)} 条评论 · 已打标 ${formatNum(stats.final_labeled)} · ${item.stage || "未知阶段"}`;
}

function renderBackupList() {
  const box = $("backupList");
  if (!box) return;
  if (!state.backups.length) {
    box.innerHTML = `<div class="hint">暂无本机备份。选择项目后会自动生成。</div>`;
    return;
  }
  const onlineIds = new Set((state.projects || []).map((p) => p.id));
  box.innerHTML = state.backups
    .map((item) => {
      const online = onlineIds.has(item.id);
      return `
        <div class="project-item backup-item">
          <div class="backup-info">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(backupStatusText(item))}</span>
            <small>本机备份：${escapeHtml(item.saved_at || "")}${online ? " · 当前在线项目已存在" : ""}</small>
          </div>
          <div class="backup-actions">
            <button class="backup-restore" data-id="${escapeHtml(item.id)}">${online ? "覆盖恢复" : "恢复"}</button>
            <button class="backup-delete" data-id="${escapeHtml(item.id)}">移除备份</button>
          </div>
        </div>`;
    })
    .join("");
  box.querySelectorAll(".backup-restore").forEach((btn) => {
    btn.addEventListener("click", () => restoreProjectBackup(btn.dataset.id).catch(showLog));
  });
  box.querySelectorAll(".backup-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (window.confirm("确认移除这个本机备份吗？这不会删除线上项目。")) deleteProjectBackup(btn.dataset.id).catch(showLog);
    });
  });
}

async function backupProjectFromServer(id) {
  if (!id) return;
  try {
    const snapshot = await request(`/api/projects/${id}/snapshot`);
    await saveProjectBackup(snapshot);
  } catch (err) {
    console.warn("项目自动备份失败", err);
  }
}

async function restoreProjectBackup(id) {
  const backup = await getProjectBackup(id);
  if (!backup?.snapshot) throw new Error("没有找到这个本机备份");
  const ok = window.confirm(`确认把「${backup.name || id}」从本机备份恢复到线上服务吗？\n\n恢复后可继续从上次结果往后做，不需要重新跑已完成步骤。`);
  if (!ok) return;
  await withBusy("正在从本机备份恢复项目...", async () => {
    const data = await request("/api/projects/import-snapshot", { method: "POST", json: { snapshot: backup.snapshot } });
    state.currentProjectId = data.project.id;
    state.activePage = "project";
    await loadProjects();
    showLog("项目已从本机备份恢复。你可以继续后续步骤，不需要重跑已完成的 API 任务。");
  });
}

function safeFilePart(value) {
  return String(value || "VOC项目")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadCurrentProjectBackup() {
  if (!state.currentProjectId) throw new Error("请先选择一个项目");
  await withBusy("正在生成项目备份文件...", async () => {
    const snapshot = await request(`/api/projects/${state.currentProjectId}/snapshot`);
    await saveProjectBackup(snapshot);
    const project = snapshot.project || {};
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    downloadJsonFile(`VOC项目备份-${safeFilePart(project.name)}-${project.id}-${date}.json`, snapshot);
    showLog("项目备份文件已下载。下次 Render 历史丢失时，点“上传备份恢复”选择这个 JSON 文件即可继续。");
  });
}

async function restoreProjectSnapshotFile(file) {
  if (!file) return;
  const text = await file.text();
  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch (err) {
    throw new Error("这个文件不是有效的项目备份 JSON");
  }
  if (snapshot?.schema !== "voc-project-snapshot-v1") {
    throw new Error("这个 JSON 不是 VOC 项目备份文件");
  }
  const ok = window.confirm(`确认恢复备份项目「${snapshot.project?.name || snapshot.project?.id || "未命名项目"}」吗？\n\n恢复后会出现在左侧项目列表，可以从已完成步骤继续。`);
  if (!ok) return;
  await withBusy("正在上传备份并恢复项目...", async () => {
    const data = await request("/api/projects/import-snapshot", { method: "POST", json: { snapshot } });
    state.currentProjectId = data.project.id;
    state.activePage = "project";
    await loadProjects();
    showLog("备份项目已恢复。");
  });
}

function updateBackupActionState() {
  const btn = $("downloadBackupBtn");
  if (btn) btn.disabled = !state.currentProjectId || state.busy;
}

function showLog(value) {
  if (value instanceof Error) {
    $("logText").textContent = value.message || "发生未知错误";
  } else if (typeof value === "string") {
    $("logText").textContent = value;
  } else {
    $("logText").textContent = JSON.stringify(value, null, 2);
  }
  $("logDialog").showModal();
}

function formatNum(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function setBusy(text = "", statusId = "") {
  state.busy = Boolean(text);
  state.busyText = text;
  state.busyStatusId = statusId;
  const el = $("runStatus");
  if (el) {
    el.textContent = text || "当前没有后台任务运行";
    el.className = `run-status ${text ? "running" : "idle"}`;
  }
  document.querySelectorAll(".local-run-status").forEach((node) => {
    node.textContent = "当前未处理";
    node.className = "local-run-status idle";
  });
  if (text && statusId && $(statusId)) {
    $(statusId).textContent = text;
    $(statusId).className = "local-run-status running";
  }
  const ids = [
    "createProjectBtn",
    "uploadBtn",
    "loadReviewRowsBtn",
    "loadAtomicRowsBtn",
    "runCalibrationAtomicBtn",
    "runAllAtomicBtn",
    "proposeDimensionsBtn",
    "saveDimensionsBtn",
    "unlockDimensionsBtn",
    "runAllFinalBtn",
    "generateAnalysisBtn",
    "downloadBackupBtn",
    "restoreBackupFileBtn",
  ];
  ids.forEach((id) => {
    const node = $(id);
    if (node) node.disabled = Boolean(text);
  });
  document.querySelectorAll(".run-batch, .final-batch, .project-delete, .subtab").forEach((btn) => {
    btn.disabled = Boolean(text);
  });
  updateBackupActionState();
}

async function withBusy(text, task, statusId = "") {
  if (state.busy) throw new Error("当前已有任务正在处理中，请等待完成后再操作，避免重复消耗 API。");
  setBusy(text, statusId);
  try {
    return await task();
  } finally {
    setBusy("");
  }
}

function isBackgroundJobRunning(job) {
  return Boolean(job && ["starting", "running"].includes(job.status));
}

function backendStatusText(job) {
  if (!job || !job.status) return "当前未处理";
  const done = Number(job.completed_batches || 0);
  const total = Number(job.total_batches || 0);
  const failed = Number(job.failed_batches || 0);
  if (isBackgroundJobRunning(job)) {
    return `后台处理中：${done}/${total} 批完成${failed ? `，${failed} 批失败` : ""}${job.current_batch ? `，当前 ${job.current_batch}` : ""}`;
  }
  if (job.status === "done") return `后台任务完成：${done}/${total} 批已完成`;
  if (job.status === "done_with_errors") return `后台任务完成但有失败：${done}/${total} 批完成，${failed} 批失败`;
  if (job.status === "failed") return `后台任务失败：${job.error || "未知错误"}`;
  return `后台状态：${job.status}`;
}

function renderJobStatus(job) {
  const isRunning = isBackgroundJobRunning(job);
  const targetId = job?.kind === "final" ? "finalStatus" : "atomicStatus";
  const target = $(targetId);
  if (target && job?.kind) {
    target.textContent = backendStatusText(job);
    target.className = `local-run-status ${isRunning ? "running" : "idle"}`;
  }
  ["runCalibrationAtomicBtn", "runAllAtomicBtn", "runAllFinalBtn"].forEach((id) => {
    const node = $(id);
    if (node) node.disabled = isRunning;
  });
  if (isRunning) startJobPolling();
}

function startJobPolling() {
  if (state.jobPollTimer || !state.currentProjectId) return;
  state.jobPollTimer = setInterval(() => {
    refreshJobStatus().catch(() => {});
  }, 5000);
}

function stopJobPolling() {
  if (state.jobPollTimer) clearInterval(state.jobPollTimer);
  state.jobPollTimer = null;
}

async function refreshJobStatus() {
  if (!state.currentProjectId) {
    stopJobPolling();
    return;
  }
  const data = await request(`/api/projects/${state.currentProjectId}/job-status`);
  renderJobStatus(data.job_status || {});
  if (!isBackgroundJobRunning(data.job_status)) {
    stopJobPolling();
    await loadProject(state.currentProjectId);
  }
}

function renderPageTabs() {
  const box = $("pageTabs");
  if (!box) return;
  box.innerHTML = PAGE_LABELS.map(([key, label]) => `
    <button class="page-tab ${state.activePage === key ? "active" : ""}" data-page-tab="${key}">${label}</button>
  `).join("");
  box.querySelectorAll(".page-tab").forEach((btn) => {
    btn.addEventListener("click", () => showPage(btn.dataset.pageTab));
  });
}

function showPage(key) {
  state.activePage = key || "project";
  document.querySelectorAll(".workspace-page").forEach((page) => {
    page.classList.toggle("active", page.dataset.page === state.activePage);
  });
  renderPageTabs();
  const active = document.querySelector(`.workspace-page[data-page="${state.activePage}"]`);
  if (active) active.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindSubTabs(root = document) {
  root.querySelectorAll(".subtabs").forEach((group) => {
    group.querySelectorAll(".subtab").forEach((btn) => {
      btn.onclick = () => {
        const target = btn.dataset.subtabTarget;
        group.querySelectorAll(".subtab").forEach((x) => x.classList.toggle("active", x === btn));
        const parent = group.parentElement;
        parent?.querySelectorAll(".subtab-pane").forEach((pane) => {
          pane.classList.toggle("active", pane.id === target);
        });
      };
    });
  });
}

async function loadProjects() {
  state.config = await request("/api/config");
  const data = await request("/api/projects");
  state.projects = data.projects || [];
  renderProjectList();
  await loadBackups();
  renderPageTabs();
  if (!state.currentProjectId && state.projects[0]) {
    state.currentProjectId = state.projects[0].id;
  }
  if (state.currentProjectId) {
    await loadProject(state.currentProjectId);
  } else {
    renderEmpty();
  }
}

async function loadProject(id) {
  const data = await request(`/api/projects/${id}`);
  state.currentProjectId = id;
  state.currentProject = data;
  renderProjectList();
  renderProject(data);
  backupProjectFromServer(id);
}

function renderProjectList() {
  const box = $("projectList");
  if (!state.projects.length) {
    box.innerHTML = `<div class="hint">暂无线上项目。若下方有本机备份，可点“恢复”找回历史结果。</div>`;
    return;
  }
  box.innerHTML = state.projects
    .map((p) => {
      const active = p.id === state.currentProjectId ? "active" : "";
      const stats = p.stats || {};
      return `
        <div class="project-item ${active}" data-id="${p.id}">
          <button class="project-select" data-id="${p.id}">
            <strong>${escapeHtml(p.name)}</strong>
            <span>${escapeHtml(p.category || "未填写品类")} · ${formatNum(stats.reviews)} 条评论 · ${escapeHtml(p.stage)}</span>
          </button>
          <button class="project-delete" data-id="${p.id}" data-name="${escapeHtml(p.name)}">删除</button>
        </div>`;
    })
    .join("");
  box.querySelectorAll(".project-select").forEach((el) => {
    el.addEventListener("click", () => loadProject(el.dataset.id));
  });
  box.querySelectorAll(".project-delete").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteProject(btn.dataset.id, btn.dataset.name).catch(showLog);
    });
  });
  if (state.busy) setBusy(state.busyText);
  renderBackupList();
}

function renderEmpty() {
  $("projectTitle").textContent = "请选择或新建项目";
  $("projectSubtitle").textContent = "从左侧开始：确认访问保护 → 建项目 → 上传 Review → 按顺序点击每一步。";
  renderMetrics({});
  renderWorkflow(null);
  setStepState("sProject", false, "未完成");
  setStepState("sUpload", false, "未完成");
  setStepState("sAtomic", false, "未完成");
  setStepState("sDraft", false, "未完成");
  setStepState("sLock", false, "未完成");
  setStepState("sFinal", false, "未完成");
  setStepState("sAnalysis", false, "未完成");
  $("batchTable").innerHTML = "";
  $("productPool").innerHTML = "";
  $("contextPool").innerHTML = "";
  $("dimensionCards").innerHTML = `<div class="empty-box">完成最小语义标签后，再生成维度草案。</div>`;
  $("atomicPreview").innerHTML = "";
  $("atomicRowsTable").innerHTML = "";
  $("reviewRowsTable").innerHTML = "";
  $("ruleEditor").innerHTML = "";
  $("atomicNeedReviewPanel").innerHTML = "";
  $("finalNeedReviewPanel").innerHTML = "";
  $("analysisPreview").innerHTML = "";
  $("dimensionJson").value = "";
  $("exportLink").classList.add("disabled");
  $("exportLinkBottom").classList.add("disabled");
  updateBackupActionState();
  stopJobPolling();
  showPage(state.activePage || "project");
}

function renderProject(data) {
  const p = data.project;
  const stats = p.stats || {};
  $("projectTitle").textContent = p.name;
  $("projectSubtitle").textContent = `${p.category || "未填写品类"} · ${p.stage} · 更新于 ${p.updated_at}`;
  renderMetrics(stats);
  $("exportLink").href = `/api/projects/${p.id}/export`;
  $("exportLink").classList.toggle("disabled", !(stats.final_labeled > 0));
  $("exportLinkBottom").href = `/api/projects/${p.id}/export`;
  $("exportLinkBottom").classList.toggle("disabled", !(stats.final_labeled > 0));
  renderWorkflow(data);
  renderBatches(data.batches || []);
  renderDimensionEditor(data);
  renderDimensionCards(data);
  renderDimensionPool(data.dimension_candidates || {});
  renderAtomicPreview(data.atomic_results || []);
  renderNeedReviewPanels(data.need_review_items || []);
  renderReviewRows(data.reviews || [], true);
  renderAnalysisPreview(data.analysis_summary || {});
  renderJobStatus(data.job_status || {});
  bindSubTabs();
  updateBackupActionState();
  showPage(state.activePage || "project");
  if (state.busy) setBusy(state.busyText, state.busyStatusId);
}

function renderMetrics(stats) {
  $("mReviews").textContent = formatNum(stats.reviews);
  $("mBatches").textContent = formatNum(stats.batches);
  $("mAtomic").textContent = formatNum(stats.atomic_records);
  $("mLocked").textContent = formatNum((stats.locked_decision_dimensions || 0) + (stats.locked_context_fields || 0));
  $("mFinal").textContent = formatNum(stats.final_labeled);
  $("mNeedReview").textContent = formatNum(stats.need_review);
}

function hasApiReady() {
  return Boolean(state.config?.has_deepseek_key) || Boolean(apiKey()) || Boolean($("mockRun")?.checked);
}

function renderApiKeyStatus() {
  const ready = hasApiReady();
  const el = $("apiKeyStatus");
  if (!el) return;
  if (state.config?.has_deepseek_key && apiKey()) {
    localStorage.removeItem("deepseek_api_key");
    $("apiKey").value = "";
  }
  $("apiKey").disabled = Boolean(state.config?.has_deepseek_key);
  el.textContent = state.config?.has_deepseek_key ? "访问码保护 + 服务端 API 已启用" : ready ? "已填写临时 Key" : "未接入 API";
  el.className = `step-state ${ready ? "done" : "wait"}`;
}

function stepState(data) {
  const stats = data?.project?.stats || {};
  const hasDraft = Boolean((data?.dimension_model?.decision_dimensions || []).length || (data?.dimension_model?.context_fields || []).length);
  const hasLocked = Boolean((data?.locked_dimensions?.decision_dimensions || []).length || (data?.locked_dimensions?.context_fields || []).length);
  const reviewCount = stats.reviews || 0;
  const finalCount = stats.final_labeled || 0;
  const hasAnalysis = Boolean(stats.analysis_ready);
  return {
    api: hasApiReady(),
    project: Boolean(data?.project),
    upload: reviewCount > 0,
    atomic: (stats.atomic_records || 0) > 0,
    draft: hasDraft,
    lock: hasLocked,
    final: reviewCount > 0 && finalCount >= reviewCount,
    analysis: hasAnalysis,
    export: reviewCount > 0 && finalCount > 0,
  };
}

function renderWorkflow(data) {
  renderApiKeyStatus();
  const stateMap = stepState(data);
  const firstOpen = FLOW_LABELS.find(([key]) => !stateMap[key]);
  $("flowSteps").innerHTML = FLOW_LABELS.map(([key, no, label]) => {
    const done = stateMap[key];
    const active = firstOpen && firstOpen[0] === key;
    return `
      <div class="flow-step ${done ? "done" : ""} ${active ? "active" : ""}">
        <span>${no}</span>
        <strong>${label}</strong>
      </div>
    `;
  }).join("");
  const nextText = nextActionText(firstOpen?.[0], data);
  $("nextAction").textContent = nextText;

  setStepState("sProject", stateMap.project, stateMap.project ? "已创建" : "未完成", firstOpen?.[0] === "project");
  setStepState("sUpload", stateMap.upload, stateMap.upload ? `已导入 ${formatNum(data?.project?.stats?.reviews)} 条` : "未完成", firstOpen?.[0] === "upload");
  setStepState("sAtomic", stateMap.atomic, stateMap.atomic ? `已提取 ${formatNum(data?.project?.stats?.atomic_records)} 个` : "未完成", firstOpen?.[0] === "atomic");
  setStepState("sDraft", stateMap.draft, stateMap.draft ? "已有草案" : "未完成", firstOpen?.[0] === "draft");
  setStepState("sLock", stateMap.lock, stateMap.lock ? "已锁定" : "未完成", firstOpen?.[0] === "lock");
  setStepState("sFinal", stateMap.final, stateMap.final ? "已完成" : (data?.project?.stats?.final_labeled ? `已打 ${formatNum(data.project.stats.final_labeled)} 条` : "未完成"), firstOpen?.[0] === "final");
  setStepState("sAnalysis", stateMap.analysis, stateMap.analysis ? "已生成" : "未完成", firstOpen?.[0] === "analysis");
}

function nextActionText(key) {
  const map = {
    api: "下一步：确认访问保护和服务端 API",
    project: "下一步：创建项目",
    upload: "下一步：上传 Review 文件",
    atomic: "下一步：提取最小语义标签",
    draft: "下一步：生成维度草案",
    lock: "下一步：检查草案并锁定规则",
    final: "下一步：最终打标全部待处理批次",
    analysis: "下一步：生成细分维度与优化切入口",
    export: "下一步：下载最终 Excel",
  };
  return key ? map[key] : "全部步骤已完成，可以下载最终 Excel";
}

function setStepState(id, done, text, active = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = `step-state ${done ? "done" : active ? "active" : "wait"}`;
}

function renderBatches(batches) {
  if (!state.currentProjectId) {
    $("batchTable").innerHTML = `<div class="hint">请先创建项目。</div>`;
    return;
  }
  if (!batches.length) {
    $("batchTable").innerHTML = `<div class="hint" style="padding:12px">还没有后台处理批次。上传 Review 后系统会自动生成。</div>`;
    return;
  }
  $("batchTable").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>后台批次</th><th>序号范围</th><th>评论数</th><th>状态</th><th>模型</th><th>错误/提示</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${batches.map((b) => `
          <tr>
            <td>${b.id}</td>
            <td>${b.start_seq}-${b.end_seq}</td>
            <td>${b.review_count}</td>
            <td><span class="status ${b.status}">${b.status}</span></td>
            <td>${escapeHtml(b.model || "")}</td>
            <td>${escapeHtml(b.error || "")}</td>
            <td>
              <button data-batch="${b.id}" class="run-batch">单批最小语义提取</button>
              <button data-batch="${b.id}" class="final-batch">单批最终打标</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>`;
  document.querySelectorAll(".run-batch").forEach((btn) => {
    btn.addEventListener("click", () => withBusy(`正在提取 ${btn.dataset.batch} 的最小语义标签...`, () => runBatch(btn.dataset.batch), "atomicStatus").catch(showLog));
  });
  document.querySelectorAll(".final-batch").forEach((btn) => {
    btn.addEventListener("click", () => withBusy(`正在最终打标 ${btn.dataset.batch}...`, () => runFinalBatch(btn.dataset.batch), "finalStatus").catch(showLog));
  });
}

function renderDimensionEditor(data) {
  const locked = data.locked_dimensions || {};
  const draft = data.dimension_model || {};
  const source =
    (locked.decision_dimensions || locked.context_fields) ? locked :
    (draft.decision_dimensions || draft.context_fields) ? draft :
    null;
  if (!source) {
    $("dimensionJson").value = "";
    $("ruleEditor").innerHTML = `<div class="empty-box">生成维度草案后，这里会出现可直接修改的规则表单。</div>`;
    return;
  }
  $("dimensionJson").value = JSON.stringify(
    {
      decision_dimensions: source.decision_dimensions || [],
      context_fields: source.context_fields || [],
      overflow_or_other: source.overflow_or_other || [],
      need_human_decisions: source.need_human_decisions || [],
    },
    null,
    2
  );
  renderRuleEditor(source);
}

function atomicRowsForEvidence() {
  return state.fullAtomic || state.currentProject?.atomic_results || [];
}

function normalizeSourceTags(value) {
  if (Array.isArray(value)) return value.map((x) => String(x || "").trim()).filter(Boolean);
  if (typeof value === "string") return lines(value);
  return [];
}

function sourceEvidenceItems(sourceTags = [], limit = 6) {
  const wanted = new Set(normalizeSourceTags(sourceTags));
  if (!wanted.size) return [];
  const rows = atomicRowsForEvidence();
  const items = [];
  for (const row of rows || []) {
    for (const tag of row.atomic_tags || []) {
      if (!wanted.has(tag.atomic_tag_zh)) continue;
      items.push({ row, tag });
      if (items.length >= limit) return items;
    }
  }
  return items;
}

function sourceEvidenceInner(sourceTags = [], limit = 6) {
  const tags = normalizeSourceTags(sourceTags);
  if (!tags.length) return `<div class="hint">暂无来源标签。可以先新增/修改“来源最小语义标签”，再保存。</div>`;
  const items = sourceEvidenceItems(tags, limit);
  if (!items.length) {
    return `
      <div class="source-tags">${tags.slice(0, 12).map((x) => `<span>${escapeHtml(x)}</span>`).join("")}</div>
      <div class="hint">当前只加载了部分结果，可能看不到完整来源证据。点击“加载完整来源证据”后再判断。</div>
    `;
  }
  return `
    <div class="source-tags">${tags.slice(0, 12).map((x) => `<span>${escapeHtml(x)}</span>`).join("")}</div>
    ${items.map(({ row, tag }) => `
      <div class="source-evidence-row">
        <strong>${escapeHtml(row.review_id || "")}</strong>
        <span>${escapeHtml(usageLabel(tag.usage_marks || []))} · ${escapeHtml(tag.sentiment || "")}</span>
        <div>${escapeHtml(tag.evidence_zh || tag.atomic_tag_zh || "")}</div>
        <small>${escapeHtml(tag.evidence_original || "")}</small>
      </div>
    `).join("")}
  `;
}

function refreshSourceEvidenceBlocks() {
  document.querySelectorAll(".rule-card").forEach((card) => {
    const target = card.querySelector(".source-evidence");
    if (!target) return;
    target.innerHTML = sourceEvidenceInner(lines(fieldValue(card, "source_atomic_tags")));
  });
}

function renderRuleEditor(source) {
  const decision = source.decision_dimensions || [];
  const context = source.context_fields || [];
  $("ruleEditor").innerHTML = `
    <div class="rule-toolbar">
      <button id="addDecisionRule" class="ghost">新增购买决策维度</button>
      <button id="addContextRule" class="ghost">新增 Context 字段</button>
      <button id="loadSourceEvidenceBtn" class="ghost">加载完整来源证据</button>
      <span class="hint">先看来源证据再改规则；改完后点“确认无误，保存为锁定规则”。</span>
    </div>
    <div class="dimension-section-title">可编辑：购买决策维度</div>
    <div id="decisionRuleList" class="rule-list">
      ${decision.map((item) => ruleEditCard(item, "decision")).join("") || `<div class="hint">暂无购买决策维度。</div>`}
    </div>
    <div class="dimension-section-title">可编辑：Context 字段</div>
    <div id="contextRuleList" class="rule-list">
      ${context.map((item) => ruleEditCard(item, "context")).join("") || `<div class="hint">暂无 Context 字段。</div>`}
    </div>
  `;
  $("addDecisionRule").addEventListener("click", () => appendRuleCard("decision"));
  $("addContextRule").addEventListener("click", () => appendRuleCard("context"));
  $("loadSourceEvidenceBtn").addEventListener("click", () => withBusy("正在加载完整来源证据...", loadFullAtomicRows, "lockStatus").catch(showLog));
  bindRuleDeleteButtons();
}

function ruleEditCard(item, type) {
  const isDecision = type === "decision";
  const sourceTags = normalizeSourceTags(item.source_atomic_tags || []).join("\n");
  return `
    <article class="rule-card" data-rule-type="${type}">
      <div class="rule-card-head">
        <strong>${isDecision ? "购买决策维度" : "Context 字段"}</strong>
        <button class="rule-delete ghost" type="button">删除这个${isDecision ? "维度" : "字段"}</button>
      </div>
      <div class="form-grid two">
        <label>名称<input data-field="name_zh" value="${escapeHtml(item.name_zh || "")}" placeholder="${isDecision ? "例如：无线稳定性" : "例如：使用场景"}" /></label>
        <label>运营用途<input data-field="${isDecision ? "listing_use_zh" : "analysis_use_zh"}" value="${escapeHtml(isDecision ? item.listing_use_zh || "" : item.analysis_use_zh || "")}" /></label>
      </div>
      ${isDecision ? "" : `
        <label>常用 Context 模板
          <select class="context-preset">
            <option value="">选择一个模板自动填充，也可以自己手填</option>
            ${Object.keys(CONTEXT_PRESETS).map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
          </select>
        </label>
      `}
      <label>定义<textarea data-field="definition_zh" rows="2">${escapeHtml(item.definition_zh || "")}</textarea></label>
      ${isDecision ? `
        <div class="form-grid two">
          <label>正向 P 规则<textarea data-field="p_rule_zh" rows="2">${escapeHtml(item.p_rule_zh || "")}</textarea></label>
          <label>负向 N 规则<textarea data-field="n_rule_zh" rows="2">${escapeHtml(item.n_rule_zh || "")}</textarea></label>
        </div>
        <div class="form-grid two">
          <label>中性 M 规则<textarea data-field="m_rule_zh" rows="2">${escapeHtml(item.m_rule_zh || "")}</textarea></label>
          <label>未提及 0 规则<textarea data-field="zero_rule_zh" rows="2">${escapeHtml(item.zero_rule_zh || "")}</textarea></label>
        </div>
        <label>决策问题<input data-field="decision_question_zh" value="${escapeHtml(item.decision_question_zh || "")}" /></label>
      ` : `
        <label>需要什么证据才能打这个 Context<textarea data-field="evidence_required_zh" rows="2">${escapeHtml(item.evidence_required_zh || "")}</textarea></label>
      `}
      <label>边界：什么该进，什么不该进<textarea data-field="boundary_zh" rows="2">${escapeHtml(item.boundary_zh || "")}</textarea></label>
      <label>来源最小语义标签（每行一个，用于追溯；可不改）<textarea data-field="source_atomic_tags" rows="3">${escapeHtml(sourceTags)}</textarea></label>
      <div class="source-evidence">${sourceEvidenceInner(item.source_atomic_tags || [])}</div>
    </article>
  `;
}

function appendRuleCard(type) {
  const list = type === "decision" ? $("decisionRuleList") : $("contextRuleList");
  if (!list) return;
  const placeholder = list.querySelector(".hint");
  if (placeholder) placeholder.remove();
  const wrapper = document.createElement("div");
  wrapper.innerHTML = ruleEditCard({ name_zh: "", definition_zh: "", source_atomic_tags: [] }, type);
  list.appendChild(wrapper.firstElementChild);
  bindRuleDeleteButtons();
}

function bindRuleDeleteButtons() {
  document.querySelectorAll(".rule-delete").forEach((btn) => {
    btn.onclick = () => btn.closest(".rule-card")?.remove();
  });
  document.querySelectorAll(".context-preset").forEach((select) => {
    select.onchange = () => {
      const preset = CONTEXT_PRESETS[select.value];
      const card = select.closest(".rule-card");
      if (!preset || !card) return;
      card.querySelector('[data-field="name_zh"]').value = select.value;
      card.querySelector('[data-field="definition_zh"]').value = preset.definition_zh;
      card.querySelector('[data-field="evidence_required_zh"]').value = preset.evidence_required_zh;
      card.querySelector('[data-field="boundary_zh"]').value = preset.boundary_zh;
      card.querySelector('[data-field="analysis_use_zh"]').value = preset.analysis_use_zh;
    };
  });
  document.querySelectorAll('[data-field="source_atomic_tags"]').forEach((textarea) => {
    textarea.onchange = refreshSourceEvidenceBlocks;
  });
}

function fieldValue(card, name) {
  return (card.querySelector(`[data-field="${name}"]`)?.value || "").trim();
}

function lines(value) {
  return value.split(/\n|；|;/).map((x) => x.trim()).filter(Boolean);
}

function collectRulesFromEditor() {
  const decision = Array.from(document.querySelectorAll('.rule-card[data-rule-type="decision"]')).map((card) => ({
    name_zh: fieldValue(card, "name_zh"),
    definition_zh: fieldValue(card, "definition_zh"),
    decision_question_zh: fieldValue(card, "decision_question_zh"),
    p_rule_zh: fieldValue(card, "p_rule_zh"),
    n_rule_zh: fieldValue(card, "n_rule_zh"),
    m_rule_zh: fieldValue(card, "m_rule_zh"),
    zero_rule_zh: fieldValue(card, "zero_rule_zh"),
    boundary_zh: fieldValue(card, "boundary_zh"),
    source_atomic_tags: lines(fieldValue(card, "source_atomic_tags")),
    listing_use_zh: fieldValue(card, "listing_use_zh"),
  })).filter((x) => x.name_zh);
  const context = Array.from(document.querySelectorAll('.rule-card[data-rule-type="context"]')).map((card) => ({
    name_zh: fieldValue(card, "name_zh"),
    definition_zh: fieldValue(card, "definition_zh"),
    evidence_required_zh: fieldValue(card, "evidence_required_zh"),
    boundary_zh: fieldValue(card, "boundary_zh"),
    source_atomic_tags: lines(fieldValue(card, "source_atomic_tags")),
    analysis_use_zh: fieldValue(card, "analysis_use_zh"),
  })).filter((x) => x.name_zh);
  return {
    decision_dimensions: decision,
    context_fields: context,
    overflow_or_other: [],
    need_human_decisions: [],
  };
}

function renderDimensionCards(data) {
  const locked = data.locked_dimensions || {};
  const draft = data.dimension_model || {};
  const lockedReady = Boolean((locked.decision_dimensions || []).length || (locked.context_fields || []).length);
  const source = lockedReady ? locked : draft;
  const statSource = chooseDimensionStats(data.dimension_stats);
  const decisionStats = statsMap(statSource.decision || []);
  const contextStats = statsMap(statSource.context || []);
  const decision = sortByStats(source.decision_dimensions || [], decisionStats);
  const context = sortByStats(source.context_fields || [], contextStats);
  const questions = source.need_human_decisions || [];
  if (!decision.length && !context.length) {
    $("dimensionCards").innerHTML = `<div class="empty-box">还没有维度草案。先完成最小语义标签，再点击“生成维度草案”。</div>`;
    return;
  }
  $("dimensionCards").innerHTML = `
    <div class="dimension-toolbar">
      <span class="step-state ${lockedReady ? "done" : "active"}">${lockedReady ? "当前为锁定规则" : "当前为草案，需人工确认"}</span>
      <span class="hint">购买决策维度 ${decision.length} 个 · Context 字段 ${context.length} 个</span>
      <span class="hint">${escapeHtml(statSource.sort_basis || "按提及 Review 数降序展示")}</span>
    </div>
    <div class="dimension-section-title">购买决策维度</div>
    <div class="dimension-grid">
      ${decision.map((item) => dimensionCard(item, "decision", decisionStats[item.name_zh || ""])).join("")}
    </div>
    <div class="dimension-section-title">Context 字段</div>
    <div class="dimension-grid">
      ${context.map((item) => dimensionCard(item, "context", contextStats[item.name_zh || ""])).join("")}
    </div>
    ${questions.length ? `<div class="review-questions"><strong>AI 提醒你重点检查：</strong>${questions.map((x) => `<span>${escapeHtml(x)}</span>`).join("")}<div class="hint">判断方法：到下方“可编辑规则表单”里检查相关维度名称、定义、P/N/M/0 和边界；不认可就直接改，改完再锁定。</div></div>` : ""}
  `;
}

function chooseDimensionStats(allStats = {}) {
  const finalDecision = allStats.final?.decision || [];
  const finalContext = allStats.final?.context || [];
  const hasFinal = finalDecision.some((x) => x.mention_count > 0) || finalContext.some((x) => x.mention_count > 0);
  const block = hasFinal ? allStats.final : allStats.source || {};
  const sampleRows = [...(block.decision || []), ...(block.context || [])];
  const sample = sampleRows[0] || {};
  return { ...block, sort_basis: sample.sort_basis || (hasFinal ? "按最终打标提及 Review 数降序" : "按来源最小语义标签覆盖 Review 数降序") };
}

function statsMap(rows) {
  return Object.fromEntries((rows || []).map((x) => [x.name_zh || "", x]));
}

function sortByStats(items, map) {
  return [...items].sort((a, b) => {
    const aa = map[a.name_zh || ""]?.mention_count || 0;
    const bb = map[b.name_zh || ""]?.mention_count || 0;
    return bb - aa || String(a.name_zh || "").localeCompare(String(b.name_zh || ""), "zh-CN");
  });
}

function formatRate(value) {
  return `${((Number(value) || 0) * 100).toFixed(1)}%`;
}

function dimensionCard(item, type, stat = {}) {
  const title = item.name_zh || "未命名";
  const definition = item.definition_zh || "";
  const pOrEvidence = type === "decision" ? item.p_rule_zh : item.evidence_required_zh;
  const listingUse = type === "decision" ? item.listing_use_zh : item.analysis_use_zh;
  const pmn = type === "decision" && (stat.p_count || stat.n_count || stat.m_count)
    ? `<span>P ${formatNum(stat.p_count)}</span><span>N ${formatNum(stat.n_count)}</span><span>M ${formatNum(stat.m_count)}</span>`
    : "";
  return `
    <article class="dimension-card">
      <h4>${escapeHtml(title)}</h4>
      <div class="stat-strip">
        <span>提及 ${formatNum(stat.mention_count)} 条</span>
        <span>提及率 ${formatRate(stat.mention_rate)}</span>
        ${pmn}
      </div>
      <p>${escapeHtml(definition)}</p>
      <dl>
        <dt>${type === "decision" ? "正向规则" : "需要证据"}</dt>
        <dd>${escapeHtml(pOrEvidence || "未填写")}</dd>
        ${type === "decision" ? `<dt>负向规则</dt><dd>${escapeHtml(item.n_rule_zh || "未填写")}</dd>` : ""}
        <dt>边界</dt>
        <dd>${escapeHtml(item.boundary_zh || "未填写")}</dd>
        <dt>运营用途</dt>
        <dd>${escapeHtml(listingUse || "未填写")}</dd>
      </dl>
      <div class="source-evidence mini">
        <strong>来源证据样例</strong>
        ${sourceEvidenceInner(item.source_atomic_tags || [], 4)}
      </div>
    </article>
  `;
}

function renderDimensionPool(pool) {
  const product = pool.product_atomic_pool || [];
  const context = pool.context_atomic_pool || [];
  if (!product.length && !context.length) {
    $("productPool").innerHTML = `<div class="hint">完成至少一个批次后会出现产品表现信号。</div>`;
    $("contextPool").innerHTML = `<div class="hint">完成至少一个批次后会出现背景信号。</div>`;
    return;
  }
  $("productPool").innerHTML = product.slice(0, 40)
    .map((x) => `<div class="tag-row"><strong>${escapeHtml(x.atomic_tag)}</strong><small>提及 ${x.count}</small></div>`)
    .join("") || `<div class="hint">暂无产品表现信号。</div>`;
  $("contextPool").innerHTML = context.slice(0, 40)
    .map((x) => `<div class="tag-row"><strong>${escapeHtml(x.atomic_tag)}</strong><small>提及 ${x.count}</small></div>`)
    .join("") || `<div class="hint">暂无背景信号。</div>`;
}

function renderReviewRows(rows, partial = false) {
  const box = $("reviewRowsTable");
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = `<div class="hint" style="padding:12px">暂无 Review 行数据。</div>`;
    return;
  }
  box.innerHTML = `
    ${partial ? `<div class="table-note">当前先显示前 ${rows.length} 行；点击“加载/刷新全量 Review 表”可看全部。</div>` : ""}
    <table>
      <thead><tr><th>序号</th><th>ReviewID</th><th>星级</th><th>型号</th><th>英文原文</th><th>中文翻译</th></tr></thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td>${escapeHtml(r.seq || "")}</td>
            <td>${escapeHtml(r.review_id || "")}</td>
            <td>${escapeHtml(r.star || "")}</td>
            <td>${escapeHtml(r.model || "")}</td>
            <td class="long-cell">${escapeHtml(r.review_original || "")}</td>
            <td class="long-cell">${escapeHtml(r.review_translation_zh || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function usageLabel(marks = []) {
  const set = new Set(marks || []);
  const hasProduct = set.has("产品表现");
  const hasContext = ["用户/关系", "场景/目的", "使用工具/搭配对象", "购买行为/态度"].some((x) => set.has(x));
  if (hasProduct && hasContext) return "产品表现 + 用户背景/Context";
  if (hasProduct) return "产品表现";
  if (hasContext) return "用户背景/Context";
  return (marks || []).join("、") || "未归属";
}

function renderAtomicRows(rows) {
  const box = $("atomicRowsTable");
  if (!box) return;
  if (!(rows || []).length) {
    box.innerHTML = `<div class="hint" style="padding:12px">暂无最小语义标签行数据。</div>`;
    return;
  }
  const body = [];
  for (const row of rows || []) {
    const tags = row.atomic_tags || [];
    body.push(`
      <tr class="review-group-row">
        <td colspan="10">
          <strong>${escapeHtml(row.review_id || "")}</strong>
          <span>标签数：${formatNum(tags.length)}</span>
          <span>批次：${escapeHtml(row.batch_id || "")}</span>
          ${row.need_review ? `<span class="status done_with_warnings">NeedReview</span>` : ""}
          <div class="review-translation">${escapeHtml(row.review_translation_zh || "暂无全文中文翻译")}</div>
        </td>
      </tr>
    `);
    if (!tags.length) {
      body.push(`
        <tr>
          <td>${escapeHtml(row.review_id || "")}</td>
          <td>${formatNum(tags.length)}</td>
          <td>${escapeHtml(row.batch_id || "")}</td>
          <td colspan="7" class="hint">这条 Review 未拆出可用最小语义标签。${escapeHtml((row.review_flags || []).join("；"))}</td>
        </tr>
      `);
      continue;
    }
    tags.forEach((tag, index) => {
      body.push(`
        <tr>
          <td>${escapeHtml(row.review_id || "")}</td>
          <td>${formatNum(tags.length)}</td>
          <td>${escapeHtml(row.batch_id || "")}</td>
          <td>${index + 1}</td>
          <td>${escapeHtml(tag.atomic_tag_zh || "")}</td>
          <td class="long-cell">${escapeHtml(tag.evidence_zh || "")}</td>
          <td class="long-cell">${escapeHtml(tag.evidence_original || "")}</td>
          <td>${escapeHtml(usageLabel(tag.usage_marks || []))}</td>
          <td>${escapeHtml(tag.sentiment || "")}</td>
          <td>${row.need_review ? "是" : "否"}</td>
        </tr>
      `);
    });
  }
  box.innerHTML = `
    <table>
      <thead><tr><th>ReviewID</th><th>标签数</th><th>批次</th><th>标签序号</th><th>最小语义标签</th><th>证据中文翻译</th><th>原文证据</th><th>归属</th><th>倾向</th><th>NeedReview</th></tr></thead>
      <tbody>${body.join("")}</tbody>
    </table>
  `;
}

function renderAtomicPreview(rows) {
  if (!rows.length) {
    $("atomicPreview").innerHTML = `<div class="hint">暂无最小语义标签结果。</div>`;
    return;
  }
  const html = [`<div class="hint">这里只预览最近结果，不展示 1000 条全量明细；全量会参与后续维度草案和导出。</div>`];
  for (const row of rows.slice(0, 30)) {
    html.push(`<div class="tag-review-head"><strong>${escapeHtml(row.review_id || "")}</strong><span>标签数：${formatNum((row.atomic_tags || []).length)}</span></div>`);
    for (const tag of row.atomic_tags || []) {
      html.push(`
        <div class="tag-row">
          <strong>${escapeHtml(tag.atomic_tag_zh || "")}</strong>
          <small>${escapeHtml(tag.sentiment || "")} · ${escapeHtml(usageLabel(tag.usage_marks || []))}</small>
          <div class="hint">证据译文：${escapeHtml(tag.evidence_zh || "")}</div>
          <div class="hint">原文证据：${escapeHtml(tag.evidence_original || "")}</div>
        </div>
      `);
    }
  }
  $("atomicPreview").innerHTML = html.join("") || `<div class="hint">批次完成但没有最小语义标签。</div>`;
}

function renderNeedReviewPanels(items) {
  const atomic = (items || []).filter((x) => x.stage === "最小语义标签");
  const final = (items || []).filter((x) => x.stage === "最终打标");
  renderNeedReviewPanel("atomicNeedReviewPanel", atomic, "当前没有最小语义阶段 NeedReview。");
  renderNeedReviewPanel("finalNeedReviewPanel", final, "当前没有最终打标 NeedReview。");
}

function renderNeedReviewPanel(targetId, items, emptyText) {
  const target = $(targetId);
  if (!target) return;
  if (!items.length) {
    target.innerHTML = `<div class="hint">${emptyText}</div>`;
    return;
  }
  target.innerHTML = `
    <div class="review-queue-head">
      <strong>${items.length} 条需复核</strong>
      <span class="hint">你只需要判断：证据是否支持、归属是否正确、规则是否要改。</span>
    </div>
    ${items.slice(0, 50).map((item) => `
      <details class="review-item">
        <summary>
          <span class="status ${item.stage === "最终打标" ? "final_done_with_warnings" : "done_with_warnings"}">${escapeHtml(item.stage)}</span>
          <strong>${escapeHtml(item.review_id || "")}</strong>
          <span>${escapeHtml(item.reason || "")}</span>
        </summary>
        <div class="review-decision-box">
          <strong>怎么判断</strong>
          <span>1. 原文是否真的表达了这个含义。</span>
          <span>2. 如果表达了，看它应该进产品表现、Context，还是其他。</span>
          <span>3. 如果 AI 的边界不对，到第 5 步直接改对应规则，再重新跑最终打标。</span>
        </div>
        <div class="hint">证据：${escapeHtml(item.evidence || "无")}</div>
        <div class="raw-review">${escapeHtml((item.review_original || "").slice(0, 700))}</div>
      </details>
    `).join("")}
    ${items.length > 50 ? `<div class="hint">页面先展示前 50 条，完整复核清单会进入导出 Excel。</div>` : ""}
  `;
}

function renderAnalysisPreview(summary) {
  if (!summary.generated_at) {
    $("analysisPreview").innerHTML = `<div class="hint">完成最终打标后，点击按钮生成细分维度和优化切入口。</div>`;
    return;
  }
  const decision = summary.decision_subdimensions || [];
  const context = summary.context_subdimensions || [];
  $("analysisPreview").innerHTML = `
    <div class="hint">已生成：${escapeHtml(summary.generated_at)}。${escapeHtml(summary.basis || "")}</div>
    <div class="analysis-grid">
      <div>
        <h4>购买决策细分 Top 10</h4>
        ${decision.slice(0, 10).map((x) => `
          <div class="analysis-row">
            <strong>${escapeHtml(x.parent_dimension)}｜${escapeHtml(x.subdimension_zh)}</strong>
            <small>提及 ${formatNum(x.mention_count)} 条 · ${formatRate(x.mention_rate)} · P ${formatNum(x.p_count)} / N ${formatNum(x.n_count)} / M ${formatNum(x.m_count)}</small>
            <div>${escapeHtml(x.optimization_entry_zh || "")}</div>
          </div>
        `).join("") || `<div class="hint">暂无决策细分。</div>`}
      </div>
      <div>
        <h4>Context 细分 Top 10</h4>
        ${context.slice(0, 10).map((x) => `
          <div class="analysis-row">
            <strong>${escapeHtml(x.context_field)}｜${escapeHtml(x.subdimension_zh)}</strong>
            <small>提及 ${formatNum(x.mention_count)} 条 · ${formatRate(x.mention_rate)}</small>
            <div>${escapeHtml(x.analysis_use_zh || "")}</div>
          </div>
        `).join("") || `<div class="hint">暂无 Context 细分。</div>`}
      </div>
    </div>
  `;
}

async function createProject() {
  const payload = {
    name: $("projectName").value.trim() || "未命名VOC项目",
    category: $("projectCategory").value.trim(),
    description: $("projectDescription").value.trim(),
    batch_size: Number($("batchSize").value || 25),
    fast_model: $("fastModel").value.trim(),
    accurate_model: $("accurateModel").value.trim(),
  };
  const data = await request("/api/projects", { method: "POST", json: payload });
  state.currentProjectId = data.project.id;
  state.activePage = "upload";
  await loadProjects();
}

async function deleteProject(projectId, name) {
  if (!projectId) return;
  const ok = window.confirm(`确认删除项目「${name || projectId}」吗？\n\n删除只会移除线上项目；本机备份会保留，可在左侧“本机自动备份”里恢复。`);
  if (!ok) return;
  await withBusy("正在删除项目...", async () => {
    await request(`/api/projects/${projectId}`, { method: "DELETE" });
    if (state.currentProjectId === projectId) {
      state.currentProjectId = null;
      state.currentProject = null;
    }
    await loadProjects();
  });
}

async function uploadReviews() {
  if (!state.currentProjectId) throw new Error("请先创建或选择项目");
  const file = $("reviewFile").files[0];
  if (!file) throw new Error("请选择 .xlsx 或 .csv 文件");
  const form = new FormData();
  form.append("file", file);
  const data = await request(`/api/projects/${state.currentProjectId}/reviews`, { method: "POST", body: form });
  const parseInfoHtml = formatParseInfo(data.parse_info);
  $("uploadPreview").innerHTML = `
    <div class="hint">已导入 ${formatNum(data.stats.reviews)} 条评论。下方只预览前 ${formatNum((data.sample || []).length)} 条，完整数据已保存并会参与后续处理。</div>
    ${parseInfoHtml}
    <details class="details-box" open>
      <summary>Review 预览</summary>
      ${(data.sample || []).map((r) => `<div class="tag-row"><strong>${escapeHtml(r.review_id)}</strong><small>${escapeHtml((r.review_original || "").slice(0, 220))}</small></div>`).join("")}
    </details>
  `;
  await request(`/api/projects/${state.currentProjectId}/batches`, { method: "POST", json: { batch_size: Number($("batchSize").value || 25) } });
  state.activePage = "atomic";
  await loadProjects();
}

function formatParseInfo(info) {
  if (!info) return "";
  const source = [
    info.sheet ? `工作表：${info.sheet}` : "",
    info.header_row ? `表头行：第 ${info.header_row} 行` : "",
    info.body_column_was_inferred ? "正文列：按内容自动推断" : "",
  ].filter(Boolean).join("；");
  const labels = {
    review_id: "序号/ID",
    title: "标题",
    body: "正文",
    translation_zh: "中文翻译",
    star: "星级",
    asin: "ASIN",
    model: "型号/变体",
    link: "链接",
  };
  const columns = Object.entries(info.detected_columns || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${labels[key] || key}: ${value}`)
    .join("；");
  return `
    <div class="hint">识别信息：${escapeHtml(source || "未返回")}</div>
    ${columns ? `<div class="hint">识别列：${escapeHtml(columns)}</div>` : ""}
  `;
}

async function makeBatches(options = {}) {
  if (!state.currentProjectId) throw new Error("请先选择项目");
  const size = Number($("batchSize").value || 25);
  await request(`/api/projects/${state.currentProjectId}/batches`, { method: "POST", json: { batch_size: size } });
  await loadProject(state.currentProjectId);
  if (!options.silent) document.getElementById("stepAtomic").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadFullReviews() {
  if (!state.currentProjectId) throw new Error("请先选择项目");
  const data = await request(`/api/projects/${state.currentProjectId}/reviews`);
  state.fullReviews = data.reviews || [];
  renderReviewRows(state.fullReviews, false);
}

async function loadFullAtomicRows() {
  if (!state.currentProjectId) throw new Error("请先选择项目");
  const data = await request(`/api/projects/${state.currentProjectId}/atomic-results`);
  state.fullAtomic = data.atomic_results || [];
  renderAtomicRows(state.fullAtomic);
  if (state.currentProject) renderDimensionCards(state.currentProject);
  refreshSourceEvidenceBlocks();
}

async function runBatch(batchId, options = {}) {
  if (!state.currentProjectId) throw new Error("请先选择项目");
  const key = clientApiKey();
  const mock = $("mockRun").checked;
  if (!mock && !key && !state.config?.has_deepseek_key) throw new Error("服务端还没有接入 DeepSeek API Key。线上版需要先在服务端配置 Key。");
  const btn = document.querySelector(`.run-batch[data-batch="${batchId}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "运行中";
  }
  try {
    const data = await request(`/api/projects/${state.currentProjectId}/batches/${batchId}/extract-atomic`, {
      method: "POST",
      json: { model: $("fastModel").value.trim() || "deepseek-v4-flash", mock },
      headers: key ? { "X-DeepSeek-Key": key } : {},
    });
    if (!options.silent) showLog(data);
    return data;
  } finally {
    await loadProject(state.currentProjectId);
  }
}

async function runFinalBatch(batchId, options = {}) {
  if (!state.currentProjectId) throw new Error("请先选择项目");
  const key = clientApiKey();
  const mock = $("mockRun").checked;
  if (!mock && !key && !state.config?.has_deepseek_key) throw new Error("服务端还没有接入 DeepSeek API Key。线上版需要先在服务端配置 Key。");
  const btn = document.querySelector(`.final-batch[data-batch="${batchId}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "打标中";
  }
  try {
    const data = await request(`/api/projects/${state.currentProjectId}/batches/${batchId}/label-final`, {
      method: "POST",
      json: { model: $("fastModel").value.trim() || "deepseek-v4-flash", mock },
      headers: key ? { "X-DeepSeek-Key": key } : {},
    });
    if (!options.silent) showLog(data);
    return data;
  } finally {
    await loadProject(state.currentProjectId);
  }
}

async function proposeDimensions() {
  if (!state.currentProjectId) throw new Error("请先选择项目");
  const count = state.currentProject?.project?.stats?.atomic_records || 0;
  if (!count) throw new Error("请先完成第 3 步：提取最小语义标签。没有最小语义标签时，无法生成维度草案。");
  const key = clientApiKey();
  const mock = $("mockRun").checked;
  if (!mock && !key && !state.config?.has_deepseek_key) throw new Error("服务端还没有接入 DeepSeek API Key。线上版需要先在服务端配置 Key。");
  const data = await request(`/api/projects/${state.currentProjectId}/propose-dimensions`, {
    method: "POST",
    json: { model: $("accurateModel").value.trim() || "deepseek-v4-pro", mock },
    headers: key ? { "X-DeepSeek-Key": key } : {},
  });
  startJobPolling();
  await loadProject(state.currentProjectId);
  state.activePage = "draft";
  showPage("draft");
  showLog(data.job_status ? "维度草案已进入后台生成。完成后再进入“锁定规则”页检查和修改。" : data);
}

async function saveDimensions() {
  if (!state.currentProjectId) throw new Error("请先选择项目");
  let payload = collectRulesFromEditor();
  if (!payload.decision_dimensions.length && !payload.context_fields.length) {
    try {
      payload = JSON.parse($("dimensionJson").value || "{}");
    } catch (err) {
      throw new Error("没有可保存的规则。请先生成维度草案，或在可编辑表单中新增维度。");
    }
  }
  const data = await request(`/api/projects/${state.currentProjectId}/dimensions`, {
    method: "POST",
    json: { dimensions: payload },
  });
  await loadProject(state.currentProjectId);
  showLog("规则已锁定。现在可以进入第 6 步最终打标。");
  showPage("final");
}

async function unlockDimensions() {
  if (!state.currentProjectId) throw new Error("请先选择项目");
  const data = await request(`/api/projects/${state.currentProjectId}/unlock-dimensions`, { method: "POST", json: {} });
  await loadProject(state.currentProjectId);
  showLog(data.message || data);
  showPage("lock");
}

async function generateAnalysis() {
  if (!state.currentProjectId) throw new Error("请先选择项目");
  const data = await request(`/api/projects/${state.currentProjectId}/analysis`, { method: "POST", json: {} });
  await loadProject(state.currentProjectId);
  showLog("已生成细分维度与优化切入口，下载 Excel 时会一起带出。");
  showPage("analysis");
}

async function runAllAtomic() {
  await startProjectJob("atomic", "all", $("fastModel").value.trim() || "deepseek-v4-flash", "atomicStatus");
}

async function runCalibrationAtomic() {
  await startProjectJob("atomic", "calibration", $("fastModel").value.trim() || "deepseek-v4-flash", "atomicStatus");
}

async function runAllFinal() {
  await startProjectJob("final", "all", $("fastModel").value.trim() || "deepseek-v4-flash", "finalStatus");
}

async function startProjectJob(kind, scope, model, statusId) {
  if (!state.currentProjectId) throw new Error("请先选择项目");
  const key = clientApiKey();
  const mock = $("mockRun").checked;
  if (!mock && !key && !state.config?.has_deepseek_key) throw new Error("服务端还没有接入 DeepSeek API Key。线上版需要先在服务端配置 Key。");
  const data = await request(`/api/projects/${state.currentProjectId}/jobs`, {
    method: "POST",
    json: { kind, scope, model, mock },
    headers: key ? { "X-DeepSeek-Key": key } : {},
  });
  const job = data.job_status || {};
  renderJobStatus(job);
  if (statusId && $(statusId)) {
    $(statusId).textContent = backendStatusText(job);
    $(statusId).className = "local-run-status running";
  }
  startJobPolling();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bindEvents() {
  $("apiKey").value = apiKey();
  $("apiKey").addEventListener("input", (e) => setApiKey(e.target.value));
  $("mockRun").addEventListener("change", () => {
    renderApiKeyStatus();
    renderWorkflow(state.currentProject);
  });
  renderPageTabs();
  bindSubTabs();
  $("newProjectBtn").addEventListener("click", () => {
    state.currentProjectId = null;
    state.currentProject = null;
    state.activePage = "project";
    renderEmpty();
    $("projectName").focus();
  });
  $("refreshBtn").addEventListener("click", () => loadProjects().catch(showLog));
  $("downloadBackupBtn").addEventListener("click", () => downloadCurrentProjectBackup().catch(showLog));
  $("restoreBackupFileBtn").addEventListener("click", () => $("restoreBackupInput").click());
  $("restoreBackupInput").addEventListener("change", (event) => {
    restoreProjectSnapshotFile(event.target.files?.[0]).catch(showLog).finally(() => {
      event.target.value = "";
    });
  });
  $("createProjectBtn").addEventListener("click", () => withBusy("正在创建项目...", createProject, "projectStatus").catch(showLog));
  $("uploadBtn").addEventListener("click", () => withBusy("正在上传并识别 Review...", uploadReviews, "uploadStatus").catch(showLog));
  $("loadReviewRowsBtn").addEventListener("click", () => withBusy("正在加载全量 Review 表...", loadFullReviews, "uploadStatus").catch(showLog));
  $("loadAtomicRowsBtn").addEventListener("click", () => withBusy("正在加载全量最小语义表...", loadFullAtomicRows, "atomicStatus").catch(showLog));
  if ($("makeBatchesBtn")) $("makeBatchesBtn").addEventListener("click", () => makeBatches().catch(showLog));
  $("runCalibrationAtomicBtn").addEventListener("click", () => withBusy("正在提取校准批次，请不要重复点击...", runCalibrationAtomic, "atomicStatus").catch(showLog));
  $("runAllAtomicBtn").addEventListener("click", () => withBusy("正在逐批提取最小语义标签，请不要重复点击...", runAllAtomic, "atomicStatus").catch(showLog));
  $("runAllFinalBtn").addEventListener("click", () => withBusy("正在逐批最终打标，请不要重复点击...", runAllFinal, "finalStatus").catch(showLog));
  $("proposeDimensionsBtn").addEventListener("click", () => withBusy("正在生成维度草案，请等待结果...", proposeDimensions, "draftStatus").catch(showLog));
  $("saveDimensionsBtn").addEventListener("click", () => withBusy("正在保存并锁定规则...", saveDimensions, "lockStatus").catch(showLog));
  $("unlockDimensionsBtn").addEventListener("click", () => withBusy("正在解除锁定并回到草案...", unlockDimensions, "lockStatus").catch(showLog));
  $("generateAnalysisBtn").addEventListener("click", () => withBusy("正在生成细分维度和优化切入口...", generateAnalysis, "analysisStatus").catch(showLog));
}

if (location.protocol === "file:") {
  location.replace("https://voc-semantic-labeler.onrender.com/");
} else {
  bindEvents();
  loadProjects().catch(showLog);
}

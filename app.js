import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, push, update, remove, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyBANvp_Se4n59yHcT9JvXyE-KN7cRIz_Go",
    authDomain: "sd-asset-manager.firebaseapp.com",
    databaseURL: "https://sd-asset-manager-default-rtdb.firebaseio.com",
    projectId: "sd-asset-manager",
    storageBucket: "sd-asset-manager.firebasestorage.app",
    messagingSenderId: "568250820087",
    appId: "1:568250820087:web:8f6dd508ec9421b1673af2"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const calendarRef = ref(db, 's2_team_calendar');
const membersRef = ref(db, 's2_team_members');
const groupsRef = ref(db, 's2_team_groups');

let calendar;
let teamMembers = [];
let teamGroups = [];
let rawCalendarData = null;
let holidayDatesSet = new Set();
let isInitialLoad = true;

let editingMemberId = null;
let editingGroupId = null;
let selectedGroupColor = '#059669';

let selectedMembers = new Set();
let showLeaveEvent = false;
let lastBackupData = null;

let lockedEventId = localStorage.getItem('s2_locked_event_id') || null;
let lockTimer = null;
let lockTimeoutMinutes = parseInt(localStorage.getItem('s2_lock_timeout_min') || '5', 10);
let contextTargetEventId = null;
let contextTargetDateStr = null;

let isGithubPanelVisibleForNormal = localStorage.getItem('s2_github_panel_visible') === 'true';
let searchDebounceTimer;

let isArchiveMode = false;
let archiveDataCache = null;

const offsetRef = ref(db, '.info/serverTimeOffset');
onValue(offsetRef, (snap) => {
    window.serverTimeOffset = snap.val() || 0;
});

function formatYMD(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return formatYMD(date);
}

const hardcodedHolidays = {
    '2024-01-01': '신정', '2024-02-09': '설연휴', '2024-02-10': '설날', '2024-02-11': '설연휴', '2024-02-12': '대체공휴일', '2024-03-01': '삼일절', '2024-05-05': '어린이날', '2024-05-06': '대체공휴일', '2024-05-15': '부처님오신날', '2024-06-06': '현충일', '2024-08-15': '광복절', '2024-09-16': '추석연휴', '2024-09-17': '추석', '2024-09-18': '추석연휴', '2024-10-03': '개천절', '2024-10-09': '한글날', '2024-12-25': '기독탄신일',
    '2025-01-01': '신정', '2025-01-28': '설연휴', '2025-01-29': '설날', '2025-01-30': '설연휴', '2025-03-03': '대체공휴일', '2025-05-05': '어린이날', '2025-05-06': '부처님오신날', '2025-06-06': '현충일', '2025-08-15': '광복절', '2025-10-03': '개천절', '2025-10-06': '추석연휴', '2025-10-07': '추석연휴', '2025-10-08': '대체공휴일', '2025-10-09': '한글날', '2025-12-25': '기독탄신일',
    '2026-01-01': '신정', '2026-02-16': '설연휴', '2026-02-17': '설날', '2026-02-18': '설연휴', '2026-03-02': '대체공휴일', '2026-05-05': '어린이날', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일', '2026-06-06': '현충일', '2026-08-15': '광복절', '2026-09-24': '추석연휴', '2026-09-25': '추석', '2026-09-26': '추석연휴', '2026-10-03': '개천절', '2026-10-09': '한글날', '2026-12-25': '기독탄신일',
    '2027-01-01': '신정', '2027-02-06': '설연휴', '2027-02-07': '설날', '2027-02-08': '설연휴', '2027-02-09': '대체공휴일', '2027-03-01': '삼일절', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날', '2027-06-06': '현충일', '2027-06-07': '대체공휴일', '2027-08-15': '광복절', '2027-08-16': '대체공휴일', '2027-09-14': '추석연휴', '2027-09-15': '추석', '2027-09-16': '추석연휴', '2027-10-03': '개천절', '2027-10-04': '대체공휴일', '2027-10-09': '한글날', '2027-10-11': '대체공휴일', '2027-12-25': '기독탄신일'
};

async function checkAndArchiveOldData(data) {
    if (!data) return;
    const currentYear = new Date().getFullYear();
    const thresholdYear = currentYear - 2;
    const updates = {};
    let archiveCount = 0;
    
    Object.entries(data).forEach(([key, item]) => {
        if (item.start) {
            const evtYear = parseInt(item.start.split('-')[0], 10);
            if (evtYear <= thresholdYear) {
                updates[`s2_team_archive/${evtYear}/${key}`] = item;
                updates[`s2_team_calendar/${key}`] = null;
                archiveCount++;
            }
        }
    });

    if (archiveCount > 0) {
        try {
            await update(ref(db), updates);
        } catch(e) {}
    }
}

window.openArchiveModal = async function() {
    try {
        const snapshot = await get(ref(db, 's2_team_archive'));
        const archiveData = snapshot.val();
        if (!archiveData) {
            showToast('보관된 과거 기록이 없습니다.', 'info');
            return;
        }
        const years = Object.keys(archiveData).sort((a, b) => b - a);
        const select = document.getElementById('archive-year-select');
        if (!select) return;
        select.innerHTML = '';
        years.forEach(y => {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = `${y}년 기록`;
            select.appendChild(opt);
        });
        document.getElementById('archive-modal').classList.remove('hidden');
    } catch (e) {
        showToast('과거 기록 조회 불가', 'error');
    }
};

window.closeArchiveModal = function() { document.getElementById('archive-modal').classList.add('hidden'); };

window.loadArchiveData = async function() {
    const year = document.getElementById('archive-year-select').value;
    if (!year) return;
    try {
        const snapshot = await get(ref(db, `s2_team_archive/${year}`));
        const data = snapshot.val();
        if (data) {
            isArchiveMode = true;
            archiveDataCache = data;
            document.getElementById('archive-banner').classList.remove('hidden');
            document.getElementById('archive-banner-text').innerText = `${year}년 과거 기록 조회 모드`;
            closeArchiveModal();
            calendar.gotoDate(new Date(year, 0, 1));
            calendar.setOption('editable', false);
            renderCalendarData();
            showToast(`${year}년 기록 로드 완료 (조회 전용)`, 'success');
        }
    } catch (e) {
        showToast('오류 발생', 'error');
    }
};

window.exitArchiveMode = function() {
    isArchiveMode = false;
    archiveDataCache = null;
    document.getElementById('archive-banner').classList.add('hidden');
    calendar.setOption('editable', true);
    calendar.today();
    renderCalendarData();
    showToast('실시간 달력 복귀', 'success');
};

window.debouncedRender = function() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => { renderCalendarData(); }, 300);
};
window.debouncedMemberFilter = function() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => { filterMemberCheckboxes(); }, 300);
};

function applyGithubPanelState(isAdmin) {
    const sidebar = document.getElementById('github-sidebar');
    if (!sidebar) return;
    if (isAdmin || isGithubPanelVisibleForNormal) {
        sidebar.classList.remove('hidden');
        sidebar.classList.add('flex');
    } else {
        sidebar.classList.add('hidden');
        sidebar.classList.remove('flex');
    }
}

window.updateGithubVisibilitySetting = function(show) {
    isGithubPanelVisibleForNormal = show;
    localStorage.setItem('s2_github_panel_visible', show);
    const adminDiv = document.getElementById('hidden-admin-buttons');
    const isAdmin = adminDiv && !adminDiv.classList.contains('hidden');
    applyGithubPanelState(isAdmin);
    showToast(show ? '일반 모드 깃허브 노출 ON' : '일반 모드 깃허브 노출 OFF', 'success');
};

async function fetchGitHubRepos() {
    const listContainer = document.getElementById('github-repo-list');
    if (!listContainer) return; // 👈 철저한 안전장치 적용
    try {
        const response = await fetch('https://api.github.com/users/johnorpark123-ship-it/repos?sort=updated');
        const repos = await response.json();
        listContainer.innerHTML = ''; 
        repos.forEach(repo => {
            const a = document.createElement('a');
            a.href = `https://johnorpark123-ship-it.github.io/${repo.name}/`;
            a.target = '_blank';
            a.className = 'flex items-center space-x-2 p-2.5 hover:bg-slate-100 rounded-lg transition text-sm text-slate-700 font-medium';
            a.innerHTML = `<img src="https://github.githubassets.com/favicons/favicon.svg" class="w-4 h-4 rounded-full bg-white p-0.5 shadow-sm border border-slate-200"><span class="truncate">${repo.name}</span>`;
            listContainer.appendChild(a);
        });
    } catch (error) {
        listContainer.innerHTML = '<div class="p-2 text-xs text-rose-400 text-center">목록 로드 실패</div>';
    }
}

window.showToast = function(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-emerald-600' : (type === 'error' ? 'bg-rose-500' : 'bg-slate-800');
    const icon = type === 'success' ? 'fa-check-circle' : (type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info');
    toast.className = `${bgColor} text-white px-4 py-3 rounded-xl shadow-lg text-[13px] font-semibold flex items-center space-x-2 opacity-0 transform translate-y-2 transition-all duration-300 pointer-events-auto`;
    toast.innerHTML = `<i class="fa-solid ${icon} text-sm"></i><span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.remove('opacity-0', 'translate-y-2'); }, 10);
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

window.showConfirm = function(msg) {
    return new Promise(resolve => {
        const modal = document.getElementById('custom-confirm-modal');
        const msgEl = document.getElementById('custom-confirm-msg');
        if (!modal || !msgEl) { resolve(confirm(msg)); return; }
        msgEl.innerText = msg;
        modal.classList.remove('hidden');

        const btnOk = document.getElementById('custom-confirm-ok');
        const btnCancel = document.getElementById('custom-confirm-cancel');

        const newOk = btnOk.cloneNode(true);
        const newCancel = btnCancel.cloneNode(true);
        btnOk.parentNode.replaceChild(newOk, btnOk);
        btnCancel.parentNode.replaceChild(newCancel, btnCancel);

        const cleanup = (result) => {
            modal.classList.add('hidden');
            resolve(result);
        };

        document.getElementById('custom-confirm-ok').onclick = () => cleanup(true);
        document.getElementById('custom-confirm-cancel').onclick = () => cleanup(false);
    });
};

window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text).then(() => showToast('복사 완료', 'success')).catch(() => showToast('복사 실패', 'error'));
};

window.handleHiddenTrigger = function(e) {
    if (e.ctrlKey && e.altKey && e.shiftKey) {
        const modal = document.getElementById('admin-login-modal');
        const pwInput = document.getElementById('admin-pw-input');
        if (modal && pwInput) {
            modal.classList.remove('hidden');
            pwInput.value = '';
            setTimeout(() => pwInput.focus(), 100);
        }
    }
};

window.closeAdminLoginModal = function() { document.getElementById('admin-login-modal').classList.add('hidden'); };

window.handleAdminLoginSubmit = function(e) {
    e.preventDefault();
    const id = document.getElementById('admin-id-input').value.trim();
    const pw = document.getElementById('admin-pw-input').value.trim();

    if (id === 'admin' && pw === 'admin') {
        closeAdminLoginModal();
        const adminDiv = document.getElementById('hidden-admin-buttons');
        adminDiv.classList.remove('hidden');
        adminDiv.classList.add('flex');
        document.getElementById('admin-github-toggle').checked = isGithubPanelVisibleForNormal;
        applyGithubPanelState(true);
        showToast('관리자 인증 완료', 'success');
    } else {
        showToast('비밀번호 불일치', 'error');
        document.getElementById('admin-pw-input').value = '';
        document.getElementById('admin-pw-input').focus();
    }
};

window.hideAdminMenu = function() {
    const adminDiv = document.getElementById('hidden-admin-buttons');
    if (!adminDiv) return;
    adminDiv.classList.remove('flex');
    adminDiv.classList.add('hidden');
    applyGithubPanelState(false);
    showToast('관리자 메뉴 숨김', 'info');
};

window.changeLockTimeoutSetting = function() {
    const currentMin = lockTimeoutMinutes;
    const input = prompt(`미리보기 고정 유지 시간(분):\n현재 설정: ${currentMin}분`, currentMin);
    if (input !== null) {
        const val = parseInt(input.trim(), 10);
        if (!isNaN(val) && val > 0) {
            lockTimeoutMinutes = val;
            localStorage.setItem('s2_lock_timeout_min', val);
            showToast(`고정 시간 ${val}분 설정`, 'success');
            if (lockedEventId && calendar) {
                const evt = calendar.getEventById(lockedEventId);
                if (evt) renderPreviewBox(evt);
            }
        } else showToast('숫자를 입력하세요.', 'error');
    }
};

function startLiveClock() {
    const updateClock = () => {
        const estimatedServerTimeMs = Date.now() + (window.serverTimeOffset || 0);
        const now = new Date(estimatedServerTimeMs);
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        const dayStr = days[now.getDay()];
        const clockTextEl = document.getElementById('live-clock-text');
        if (clockTextEl) clockTextEl.innerText = `${year}.${month}.${day} (${dayStr}) ${hours}:${minutes}:${seconds}`;
    };
    updateClock();
    setInterval(updateClock, 1000);
}

const defaultMembers = [
    { name: '박문기', isResigned: false }, { name: '해진', isResigned: false },
    { name: '조성진', isResigned: false }, { name: 'Ami Vyas', isResigned: false },
    { name: '딥샤', isResigned: false }, { name: '기타', isResigned: false }
];

function isLeaveEvent(item) {
    if (item.category === '휴가' || item.category === '연차/반차') return true;
    if (item.title) {
        const t = item.title.replace(/\s+/g, '');
        return t.includes('연차') || t.includes('반차');
    }
    return false;
}

function initDatePickerOptions() {
    const yearSelect = document.getElementById('picker-year');
    if (!yearSelect) return;
    yearSelect.innerHTML = '';
    const currentYear = new Date().getFullYear();
    for (let y = currentYear - 5; y <= currentYear + 5; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = `${y}년`;
        yearSelect.appendChild(opt);
    }
}

window.openDatePickerModal = function() {
    initDatePickerOptions();
    if (calendar) {
        const currentDate = calendar.getDate();
        const ySel = document.getElementById('picker-year');
        const mSel = document.getElementById('picker-month');
        if (ySel) ySel.value = currentDate.getFullYear();
        if (mSel) mSel.value = currentDate.getMonth();
    }
    const modal = document.getElementById('date-picker-modal');
    if (modal) modal.classList.remove('hidden');
};
window.closeDatePickerModal = function() { document.getElementById('date-picker-modal').classList.add('hidden'); };
window.applyDatePicker = function() {
    const y = parseInt(document.getElementById('picker-year').value);
    const m = parseInt(document.getElementById('picker-month').value);
    if (calendar) calendar.gotoDate(new Date(y, m, 1));
    closeDatePickerModal();
};

window.handleExcelUpload = async function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(event) {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

        const partColorMap = {
            'All(전체 인원)': '#10b981', 'Cloud Potal': '#2563eb', 'OnCloud': '#059669',
            'Health Pro': '#7c3aed', 'OnCAFE': '#ea580c'
        };

        const headers = rows[0]; 
        let currentPart = null;
        let memberPartMap = {};
        let newMembersSet = new Set();
        let newGroupsSet = new Set();
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const p = row[0];
            const m = row[1];
            if (p && String(p).trim() !== '') {
                currentPart = String(p).trim();
                newGroupsSet.add(currentPart);
            }
            if (m && String(m).trim() !== '' && m !== '공휴일 목록' && !String(m).startsWith('2026')) {
                const mName = String(m).trim();
                memberPartMap[mName] = currentPart || '기타';
                newMembersSet.add(mName);
            }
        }

        newMembersSet.forEach(name => {
            if(!teamMembers.some(tm => tm.name === name)) push(membersRef, { name: name, isResigned: false });
        });

        newGroupsSet.forEach(gName => {
            if(!teamGroups.some(tg => tg.name === gName)) {
                const assignedColor = partColorMap[gName] || '#059669';
                push(groupsRef, { name: gName, color: assignedColor, members: [] });
            }
        });

        const existingEventMap = new Map();
        if (rawCalendarData) {
            Object.entries(rawCalendarData).forEach(([key, item]) => {
                const sig = `${item.start}_${item.member}_${item.title}`.trim();
                existingEventMap.set(sig, key);
            });
        }

        const individualEvents = [];
        const groupedEvents = {};

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const m = row[1];
            if (!m || String(m).trim() === '' || m === '공휴일 목록' || String(m).startsWith('2026')) continue;

            const name = String(m).trim();
            const part = memberPartMap[name] || '기타';
            const matchedGroupObj = teamGroups.find(g => g.name === part);
            const groupColor = matchedGroupObj ? matchedGroupObj.color : (partColorMap[part] || '#059669');

            for (let c = 2; c < headers.length; c++) {
                const val = row[c];
                if (val && String(val).trim() !== '') {
                    let dateStr = null;
                    const headerVal = headers[c];

                    if (typeof headerVal === 'number') {
                        const d = XLSX.SSF.parse_date_code(headerVal);
                        dateStr = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
                    } else if (typeof headerVal === 'string') {
                        const match = headerVal.match(/(\d+)\/(\d+)/);
                        if (match) dateStr = `2026-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
                        else if (headerVal.includes('-')) dateStr = headerVal.split(' ')[0];
                    }

                    if (dateStr) {
                        const title = String(val).trim();
                        let endDateStr = addDays(dateStr, 1);
                        
                        const tempItem = { title: title };
                        if (isLeaveEvent(tempItem)) {
                            individualEvents.push({
                                member: name, title: title, start: dateStr, end: endDateStr,
                                category: '휴가', color: '#475569', comment: '엑셀 휴가 등록', url: '', subMembers: [],
                                groupId: 'grp_excel_' + Math.random().toString(36).substr(2, 5)
                            });
                        } else {
                            const key = `${dateStr}_${title}_${part}`; 
                            if (!groupedEvents[key]) {
                                groupedEvents[key] = {
                                    start: dateStr, end: endDateStr, title: title, part: part, color: groupColor,
                                    members: new Set()
                                };
                            }
                            groupedEvents[key].members.add(name);
                        }
                    }
                }
            }
        }

        const updates = {};
        let processedCount = 0;
        const batchGroupId = 'grp_' + Date.now();

        Object.values(groupedEvents).forEach(evt => {
            const membersArr = Array.from(evt.members);
            let assignMember = evt.part === 'All' ? 'All(전체 인원)' : evt.part;
            let subMembers = [];
            let commentTxt = "👥 엑셀 자동 등록";
            
            if (membersArr.length > 1) {
                subMembers = membersArr; 
                commentTxt = `👥 엑셀 파싱: 총 ${membersArr.length}명 공통 일정`;
            }

            const sig = `${evt.start}_${assignMember}_${evt.title}`.trim();
            const eventData = {
                member: assignMember, title: evt.title, start: evt.start, end: evt.end,
                category: '일반 업무', color: evt.color, comment: commentTxt, url: "", subMembers: subMembers,
                groupId: batchGroupId
            };

            let targetKey = existingEventMap.get(sig);
            if (!targetKey) targetKey = push(calendarRef).key;
            updates['s2_team_calendar/' + targetKey] = eventData;
            processedCount++;
        });

        individualEvents.forEach(evt => {
            const sig = `${evt.start}_${evt.member}_${evt.title}`.trim();
            let targetKey = existingEventMap.get(sig);
            if (!targetKey) targetKey = push(calendarRef).key;
            updates['s2_team_calendar/' + targetKey] = evt;
            processedCount++;
        });

        if (processedCount > 0) {
            if (await showConfirm(`엑셀 파일에서 총 ${processedCount}건 파싱. 반영하시겠습니까?`)) {
                lastBackupData = rawCalendarData ? JSON.parse(JSON.stringify(rawCalendarData)) : {};
                const undoBtn = document.getElementById('undo-btn');
                if (undoBtn) undoBtn.removeAttribute('disabled');
                update(ref(db), updates).then(() => {
                    e.target.value = ''; showToast('엑셀 반영 완료', 'success');
                }).catch(() => showToast('반영 오류', 'error'));
            } else e.target.value = '';
        } else {
            showToast('파싱된 일정 없음', 'error'); e.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
};

window.undoExcelUpload = async function() {
    if (!lastBackupData) return showToast('되돌릴 기록 없음', 'error');
    if (await showConfirm('직전 업로드 전 상태로 되돌리시겠습니까?')) {
        set(calendarRef, lastBackupData).then(() => {
            lastBackupData = null; 
            const undoBtn = document.getElementById('undo-btn');
            if (undoBtn) undoBtn.setAttribute('disabled', 'true');
            showToast('되돌리기 완료', 'success');
        }).catch(() => showToast('오류 발생', 'error'));
    }
};

window.resetCalendarData = async function() {
    if (await showConfirm('모든 일정을 초기화하시겠습니까? (공휴일만 남음)')) {
        set(calendarRef, null).then(() => {
            lastBackupData = null; 
            const undoBtn = document.getElementById('undo-btn');
            if (undoBtn) undoBtn.setAttribute('disabled', 'true');
            showToast('일정 초기화 완료', 'success');
        }).catch(() => showToast('오류 발생', 'error'));
    }
};

document.addEventListener('click', (event) => {
    const filterContainer = document.getElementById('filter-container');
    const dropdown = document.getElementById('filter-dropdown');
    if (filterContainer && dropdown && !filterContainer.contains(event.target)) dropdown.classList.add('hidden');
    const ctxMenu = document.getElementById('custom-context-menu');
    if (ctxMenu) ctxMenu.classList.add('hidden');
    const memberSearch = document.getElementById('f-member-search');
    const memberList = document.getElementById('f-member-list');
    if (memberSearch && memberList && event.target !== memberSearch && !memberList.contains(event.target)) memberList.classList.add('hidden');
});

window.toggleFilterDropdown = function(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('filter-dropdown');
    if (dropdown) dropdown.classList.toggle('hidden');
};

document.addEventListener('DOMContentLoaded', function() {
    startLiveClock(); fetchGitHubRepos(); applyGithubPanelState(false); 

    onValue(groupsRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            teamGroups = Object.keys(data).map(key => {
                let gName = data[key].name;
                if (gName === 'All') gName = 'All(전체 인원)';
                return { id: key, name: gName, color: data[key].color, members: data[key].members || [] };
            });
        } else teamGroups = [];
        checkAndCreateAllGroup(); renderMemberSelect(); renderMemberList(); renderGroupList(); renderFilterCheckboxes();
    });

    onValue(membersRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            teamMembers = Object.keys(data).map(key => ({ id: key, name: data[key].name, isResigned: data[key].isResigned || false }));
        } else {
            const updates = {};
            defaultMembers.forEach((m, i) => { updates[`member_default_${i}`] = { name: m.name, isResigned: m.isResigned }; });
            update(membersRef, updates); return; 
        }
        teamMembers.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        checkAndCreateAllGroup(); renderMemberSelect(); renderMemberList(); renderGroupMemberCheckboxes(); renderFilterCheckboxes();
    });

    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth', locale: 'ko',
        customButtons: {
            myToday: {
                text: '오늘',
                click: function() {
                    calendar.today();
                    setTimeout(() => {
                        const todayEl = document.querySelector('.fc-day-today');
                        if (todayEl) todayEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                }
            }
        },
        displayEventTime: false, allDayText: '', 
        headerToolbar: { left: 'prev,next myToday', center: 'title', right: 'dayGridMonth,dayGridWeek,listMonth' },
        buttonText: { month: '월', week: '주', list: '목록' }, height: '100%',
        selectable: false, editable: true,
        datesSet: function() {
            setTimeout(() => {
                const titleEl = document.querySelector('.fc-toolbar-title');
                if (titleEl && !titleEl.hasAttribute('data-click-bound')) {
                    titleEl.setAttribute('data-click-bound', 'true'); titleEl.title = "클릭하여 연도/월 선택 이동";
                    titleEl.addEventListener('click', () => { openDatePickerModal(); });
                }
            }, 50);
        },
        eventOrder: function(a, b) {
            const getScore = (evt) => {
                if (evt.source && evt.source.id === 'korea-holidays') return 0;
                const title = evt.extendedProps.rawTitle || evt.title;
                const cat = evt.extendedProps.category;
                if (cat === '휴가' || title.includes('연차') || title.includes('반차')) return 3; 
                if (teamGroups.some(g => g.name === evt.extendedProps.member)) return 1; 
                return 2; 
            };
            const scoreA = getScore(a); const scoreB = getScore(b);
            if (scoreA !== scoreB) return scoreA - scoreB;
            return (a.extendedProps.rawTitle || a.title).localeCompare(b.extendedProps.rawTitle || b.title, 'ko');
        },
        eventSources: [{
            id: 'korea-holidays',
            events: function(info, successCallback) {
                let holidays = [];
                holidayDatesSet.clear();
                for (let d = new Date(info.start); d <= info.end; d.setDate(d.getDate() + 1)) {
                    const dateStr = formatYMD(d);
                    if (hardcodedHolidays[dateStr]) {
                        holidayDatesSet.add(dateStr);
                        holidays.push({
                            title: hardcodedHolidays[dateStr],
                            start: dateStr, allDay: true,
                            color: '#fee2e2', textColor: '#dc2626', borderColor: '#fca5a5',
                            editable: false, classNames: ['holiday-event', 'cursor-default']
                        });
                    }
                }
                successCallback(holidays);
            }
        }],
        eventClick: function(info) {
            const evt = info.event;
            if (evt.source && evt.source.id === 'korea-holidays') return;
            lockedEventId = evt.id; localStorage.setItem('s2_locked_event_id', evt.id);
            renderPreviewBox(evt); startLockTimer();
        },
        eventDidMount: function(info) {
            if (info.event.source && info.event.source.id === 'korea-holidays') return;
            info.el.addEventListener('contextmenu', function(e) {
                e.preventDefault(); e.stopPropagation();
                if (isArchiveMode) return;
                contextTargetEventId = info.event.id;
                contextTargetDateStr = info.event.startStr.split('T')[0];
                const menu = document.getElementById('custom-context-menu');
                if (!menu) return;
                document.getElementById('ctx-add-btn').classList.remove('hidden');
                document.getElementById('ctx-edit-btn').classList.remove('hidden');
                document.getElementById('ctx-delete-btn').classList.remove('hidden');
                menu.style.top = `${e.pageY}px`; menu.style.left = `${e.pageX}px`; menu.classList.remove('hidden');
            });
            info.el.addEventListener('dblclick', function(e) {
                e.preventDefault(); e.stopPropagation(); 
                if (isArchiveMode) return;
                editEventFromPreview(info.event.id);
            });
        },
        eventMouseEnter: function(info) { if (lockedEventId) return; renderPreviewBox(info.event); },
        eventMouseLeave: function() { if (lockedEventId) return; resetPreviewBoxToDefault(); },
        eventDrop: function(info) { updateEventDates(info.event); },
        eventResize: function(info) { updateEventDates(info.event); }
    });
    calendar.render();

    calendarEl.addEventListener('contextmenu', function(e) {
        const dayCell = e.target.closest('.fc-daygrid-day');
        if (dayCell && !e.target.closest('.fc-event')) {
            e.preventDefault();
            if (isArchiveMode) return;
            const dateStr = dayCell.getAttribute('data-date');
            if (dateStr) {
                contextTargetEventId = null; contextTargetDateStr = dateStr;
                const menu = document.getElementById('custom-context-menu');
                if (!menu) return;
                document.getElementById('ctx-add-btn').classList.remove('hidden');
                document.getElementById('ctx-edit-btn').classList.add('hidden');
                document.getElementById('ctx-delete-btn').classList.add('hidden');
                menu.style.top = `${e.pageY}px`; menu.style.left = `${e.pageX}px`; menu.classList.remove('hidden');
            }
        }
    });

    calendarEl.addEventListener('dblclick', function(e) {
        const dayCell = e.target.closest('.fc-daygrid-day');
        if (dayCell && !e.target.closest('.fc-event')) {
            if (isArchiveMode) return;
            const dateStr = dayCell.getAttribute('data-date');
            if (dateStr) {
                openEventModal();
                document.getElementById('f-start').value = dateStr; document.getElementById('f-end').value = dateStr;
                onStartDateChange();
            }
        }
    });

    onValue(calendarRef, (snapshot) => {
        rawCalendarData = snapshot.val() || {};
        const spinner = document.getElementById('loading-spinner');
        if (spinner) spinner.classList.add('hidden');
        
        if (isInitialLoad) {
            isInitialLoad = false;
            checkAndArchiveOldData(rawCalendarData);
        }

        if (!isArchiveMode) {
            renderCalendarData();
        }

        if (lockedEventId && calendar) {
            setTimeout(() => {
                const lockedEvt = calendar.getEventById(lockedEventId);
                if (lockedEvt) { renderPreviewBox(lockedEvt); startLockTimer(); } 
                else { unlockPreview(); }
            }, 500);
        }
    });
});

window.handleContextAdd = function() {
    if(isArchiveMode) return showToast('조회 모드에서는 수정 불가', 'error');
    document.getElementById('custom-context-menu').classList.add('hidden');
    openEventModal();
    if (contextTargetDateStr) {
        document.getElementById('f-start').value = contextTargetDateStr; document.getElementById('f-end').value = contextTargetDateStr;
        onStartDateChange();
    }
};

window.handleContextEdit = function() {
    if(isArchiveMode) return showToast('조회 모드에서는 수정 불가', 'error');
    document.getElementById('custom-context-menu').classList.add('hidden');
    if (contextTargetEventId) editEventFromPreview(contextTargetEventId);
};

window.handleContextDelete = function() {
    if(isArchiveMode) return showToast('조회 모드에서는 수정 불가', 'error');
    document.getElementById('custom-context-menu').classList.add('hidden');
    if (contextTargetEventId) {
        document.getElementById('event-id').value = contextTargetEventId; handleEventDelete();
    }
};

function startLockTimer() {
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = setTimeout(() => { unlockPreview(); }, lockTimeoutMinutes * 60 * 1000);
}

window.unlockPreview = function() {
    if (lockTimer) clearTimeout(lockTimer);
    lockedEventId = null; localStorage.removeItem('s2_locked_event_id');
    resetPreviewBoxToDefault();
};

function resetPreviewBoxToDefault() {
    if (lockedEventId) return;
    const titleEl = document.getElementById('left-panel-header-title');
    const indicatorEl = document.getElementById('panel-indicator');
    const unlockBtn = document.getElementById('left-panel-unlock-btn');
    if (titleEl) titleEl.innerText = "일정 실시간 미리보기";
    if (indicatorEl) indicatorEl.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
    if (unlockBtn) unlockBtn.classList.add('hidden');
    const previewContainer = document.getElementById('preview-container');
    if (!previewContainer) return;
    previewContainer.className = "flex-1 flex flex-col justify-center items-center text-center p-6 text-slate-400 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200 overflow-y-auto";
    previewContainer.innerHTML = `<i class="fa-regular fa-hand-pointer text-2xl mb-2 text-slate-300"></i><p>캘린더의 일정에 마우스를 올리면 미리보기가 표시되며,<br><b>클릭하면 해당 미리보기가 고정</b>됩니다.</p>`;
}

function isWebUrl(str) {
    if (!str) return false;
    let u = str.trim().toLowerCase();
    return u.startsWith('http://') || u.startsWith('https://') || u.startsWith('www.');
}

function formatWebUrl(rawUrl) {
    if (!rawUrl) return '#';
    let u = rawUrl.trim();
    if (u.startsWith('www.')) return 'http://' + u;
    return u;
}

function getMemberLeavesForDateRange(startDateStr, endDateStr, memberName) {
    const dataSource = isArchiveMode ? archiveDataCache : rawCalendarData;
    if (!dataSource) return [];
    let leaves = [];
    const [sY, sM, sD] = startDateStr.split('-').map(Number); const sDate = new Date(sY, sM - 1, sD);
    const [eY, eM, eD] = endDateStr.split('-').map(Number); const eDate = new Date(eY, eM - 1, eD);

    Object.values(dataSource).forEach(item => {
        if (item.member === memberName && isLeaveEvent(item)) {
            const [evSY, evSM, evSD] = item.start.split('-').map(Number); const evStart = new Date(evSY, evSM - 1, evSD);
            const evEndRaw = item.end ? item.end : item.start;
            const [evEY, evEM, evED] = evEndRaw.split('-').map(Number); const evEnd = new Date(evEY, evEM - 1, evED);
            evEnd.setDate(evEnd.getDate() - 1);
            if (sDate <= evEnd && eDate >= evStart) leaves.push(item.title);
        }
    });
    return leaves;
}

function getMemberGroupEventsForDateRange(startDateStr, endDateStr, memberName) {
    const dataSource = isArchiveMode ? archiveDataCache : rawCalendarData;
    if (!dataSource) return [];
    let groupEvents = [];
    const [sY, sM, sD] = startDateStr.split('-').map(Number); const sDate = new Date(sY, sM - 1, sD);
    const [eY, eM, eD] = endDateStr.split('-').map(Number); const eDate = new Date(eY, eM - 1, eD);

    Object.values(dataSource).forEach(item => {
        const isGrp = teamGroups.some(g => g.name === item.member);
        if (isGrp && item.subMembers && item.subMembers.includes(memberName)) {
            const [evSY, evSM, evSD] = item.start.split('-').map(Number); const evStart = new Date(evSY, evSM - 1, evSD);
            const evEndRaw = item.end ? item.end : item.start;
            const [evEY, evEM, evED] = evEndRaw.split('-').map(Number); const evEnd = new Date(evEY, evEM - 1, evED);
            evEnd.setDate(evEnd.getDate() - 1);
            if (sDate <= evEnd && eDate >= evStart) groupEvents.push({ title: item.title, groupName: item.member });
        }
    });
    return groupEvents;
}

function renderPreviewBox(evt) {
    const previewContainer = document.getElementById('preview-container');
    if (!previewContainer) return;

    const isHoliday = (evt.source && evt.source.id === 'korea-holidays');
    let title = evt.extendedProps.rawTitle || evt.title;
    const category = evt.extendedProps.category || '일반 업무';
    const member = evt.extendedProps.member || (isHoliday ? '공휴일' : '박문기');
    const startStr = evt.startStr.split('T')[0];
    
    let endStr = startStr;
    if (evt.end) {
        const endDate = new Date(evt.endStr); endDate.setDate(endDate.getDate() - 1);
        endStr = endDate.toISOString().split('T')[0];
        if (endStr < startStr) endStr = startStr;
    }

    const isGroup = teamGroups.some(g => g.name === member);
    const isLeave = isLeaveEvent({ category, title });

    let combinedTitle = title; let groupAssociationHtml = '';
    if (!isGroup && !isHoliday && isLeave) {
        const associatedGroups = getMemberGroupEventsForDateRange(startStr, endStr, member);
        if (associatedGroups.length > 0) {
            const groupNames = associatedGroups.map(g => `${g.groupName}의 [${g.title}]`).join(', ');
            combinedTitle = `${title} + (${groupNames})`;
            groupAssociationHtml = `<div class="mt-2 pt-2 border-t border-slate-100"><span class="font-semibold text-slate-500 block mb-1">관련 그룹 일정</span><p class="text-slate-700 text-[11px]">${groupNames}</p></div>`;
        }
    }

    const comment = evt.extendedProps.comment || '코멘트 없음';
    const urlData = evt.extendedProps.url || '';
    const subMembers = evt.extendedProps.subMembers || [];

    let subListHtml = '';
    if (isGroup && subMembers.length > 0) {
        const formattedSubMembers = subMembers.map(mName => {
            const leaves = getMemberLeavesForDateRange(startStr, endStr, mName);
            if (leaves.length > 0) return `${mName} (${[...new Set(leaves)].join(', ')})`;
            return mName;
        });
        subListHtml = `<div class="mt-2 pt-2 border-t border-slate-100"><span class="font-semibold text-slate-500 block mb-1">참여 인원 (${subMembers.length}명)</span><p class="text-slate-700 text-[11px] leading-relaxed">${formattedSubMembers.join(', ')}</p></div>`;
    } else if (!isGroup && !isHoliday) {
        subListHtml = `<div class="mt-2 pt-2 border-t border-slate-100"><span class="font-semibold text-slate-500 block mb-1">담당자</span><p class="text-slate-700 text-[11px]">${member}</p></div>`;
    }

    let urlHtml = '';
    if (urlData) {
        const lines = urlData.split('\n').map(l => l.trim()).filter(l => l !== '');
        if (lines.length > 0) {
            urlHtml = `<div class="mt-2 pt-2 border-t border-slate-100 space-y-1.5"><span class="font-semibold text-slate-500 block">관련 링크</span>`;
            lines.forEach((line) => {
                let linkTitle = "링크"; let linkVal = line;
                if (line.includes('|')) { const parts = line.split('|'); linkTitle = parts[0].trim(); linkVal = parts[1].trim(); }
                if (isWebUrl(linkVal)) {
                    const safeHref = formatWebUrl(linkVal);
                    urlHtml += `<a href="${safeHref}" target="_blank" class="block bg-blue-50/60 hover:bg-blue-100/60 border border-blue-100 p-2 rounded-lg transition text-[11px]"><div class="font-bold text-blue-800 flex items-center space-x-1"><i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i><span>${linkTitle}</span></div><div class="text-blue-600 truncate mt-0.5">${linkVal}</div></a>`;
                } else {
                    const escapedVal = linkVal.replace(/\\/g, '\\\\');
                    urlHtml += `<div class="bg-slate-50 border border-slate-200 p-2 rounded-lg flex items-center justify-between text-[11px] gap-2"><div class="overflow-hidden flex-1"><div class="font-bold text-slate-700">${linkTitle}</div><div class="text-slate-500 truncate mt-0.5 select-all">${linkVal}</div></div><button type="button" onclick="copyToClipboard('${escapedVal}')" class="shrink-0 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 w-7 h-7 rounded flex items-center justify-center transition" title="경로 복사"><i class="fa-regular fa-copy"></i></button></div>`;
                }
            });
            urlHtml += `</div>`;
        }
    }

    if (lockedEventId === evt.id) {
        const titleEl = document.getElementById('left-panel-header-title');
        const indicatorEl = document.getElementById('panel-indicator');
        const unlockBtn = document.getElementById('left-panel-unlock-btn');
        if (titleEl) titleEl.innerText = "고정된 일정 정보";
        if (indicatorEl) indicatorEl.className = "w-2 h-2 rounded-full bg-purple-500 animate-ping";
        if (unlockBtn) unlockBtn.classList.remove('hidden');
    }

    let badgeHtml = `<span class="px-2 py-0.5 rounded text-[10px] font-bold text-white shadow-sm" style="background-color: ${evt.backgroundColor || '#059669'};">${member}</span>`;
    if (!isHoliday && category) {
        badgeHtml = `<div class="flex items-center space-x-1.5">${badgeHtml}<span class="text-[10px] text-slate-500 font-semibold bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">${category}</span></div>`;
    }

    previewContainer.className = "flex-1 flex flex-col justify-between items-stretch text-left p-4 text-xs bg-white rounded-xl border border-emerald-300 shadow-sm transition-all";
    previewContainer.innerHTML = `
        <div class="w-full space-y-2 overflow-y-auto pr-1">
            <div class="flex items-center justify-between">
                ${badgeHtml}
                <span class="text-[10px] text-slate-400 shrink-0 ml-2">${startStr}${startStr !== endStr ? ' ~ ' + endStr : ''}</span>
            </div>
            <h3 class="font-bold text-slate-900 text-sm leading-snug">${combinedTitle}</h3>
            <p class="text-slate-600 text-[11px] bg-slate-50 p-2.5 rounded-lg border border-slate-100 whitespace-pre-line">${comment}</p>
            ${subListHtml}
            ${groupAssociationHtml}
            ${urlHtml}
        </div>
        ${(!isHoliday && !isArchiveMode) ? `
        <div class="pt-3 mt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
            <button onclick="editEventFromPreview('${evt.id}')" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg shadow-sm transition flex items-center space-x-1">
                <i class="fa-solid fa-pen text-[10px]"></i> <span>수정</span>
            </button>
            <button onclick="deleteEventFromPreview('${evt.id}')" class="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 font-semibold rounded-lg transition flex items-center space-x-1">
                <i class="fa-solid fa-trash text-[10px]"></i> <span>삭제</span>
            </button>
        </div>` : ''}
    `;
}

window.editEventFromPreview = function(eventId) {
    const evt = calendar.getEventById(eventId);
    if (!evt) return;

    document.getElementById('modal-title').innerText = "일정 수정"; 
    document.getElementById('event-id').value = evt.id;
    let catValue = evt.extendedProps.category;
    if (!catValue) {
        if(evt.extendedProps.rawTitle && (evt.extendedProps.rawTitle.includes('연차') || evt.extendedProps.rawTitle.includes('반차'))) catValue = '휴가';
        else catValue = '일반 업무';
    }
    document.getElementById('f-category').value = catValue;
    
    const titleVal = evt.extendedProps.rawTitle || evt.title;
    document.getElementById('f-title').value = titleVal;
    
    if (catValue === '휴가') {
        document.getElementById('leave-type-section').classList.remove('hidden');
        const cleanTitle = titleVal.replace(/\s+/g, '');
        document.querySelectorAll('input[name="leave-type"]').forEach(r => {
            if (r.value === '오전 반차' && cleanTitle.includes('오전반차')) r.checked = true;
            else if (r.value === '오후 반차' && cleanTitle.includes('오후반차')) r.checked = true;
            else if (r.value === '연차' && cleanTitle.includes('연차')) r.checked = true;
            else r.checked = false;
        });
    } else {
        document.getElementById('leave-type-section').classList.add('hidden');
        document.querySelectorAll('input[name="leave-type"]').forEach(r => r.checked = false);
    }

    const assignedEntity = evt.extendedProps.member || '박문기';
    document.getElementById('f-member-search').value = assignedEntity; 
    document.getElementById('f-member').value = assignedEntity;
    document.getElementById('f-start').value = evt.startStr.split('T')[0];
    
    if (evt.end) {
        const endDate = new Date(evt.endStr); endDate.setDate(endDate.getDate() - 1);
        const calculatedEndStr = endDate.toISOString().split('T')[0]; const startStr = evt.startStr.split('T')[0];
        document.getElementById('f-end').value = (calculatedEndStr < startStr) ? startStr : calculatedEndStr;
    } else document.getElementById('f-end').value = evt.startStr.split('T')[0];

    onStartDateChange(); 
    const subMembers = evt.extendedProps.subMembers || [];
    document.querySelectorAll('.sub-member-cb').forEach(cb => { cb.checked = subMembers.includes(cb.value); });
    document.getElementById('f-comment').value = evt.extendedProps.comment || '';
    
    const urlData = evt.extendedProps.url || ''; const linkItems = [];
    if (urlData) {
        urlData.split('\n').forEach(line => {
            if (line.includes('|')) { const parts = line.split('|'); linkItems.push({ title: parts[0].trim(), url: parts[1].trim() }); }
            else if (line.trim() !== '') linkItems.push({ title: '관련 링크', url: line.trim() });
        });
    }
    renderUrlFields(linkItems.length > 0 ? linkItems : [{ title: '', url: '' }]);

    document.getElementById('modal-delete-btn').classList.remove('hidden'); 
    document.getElementById('event-modal').classList.remove('hidden');
};

window.deleteEventFromPreview = function(eventId) { document.getElementById('event-id').value = eventId; handleEventDelete(); };

window.renderUrlFields = function(items) {
    const container = document.getElementById('url-fields-container');
    if (!container) return;
    container.innerHTML = ''; const totalCount = items.length;
    items.forEach((item) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'flex flex-col sm:flex-row items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-2 w-full bg-slate-50/50 p-2 sm:p-0 rounded-lg sm:bg-transparent';
        wrapper.innerHTML = `<input type="text" value="${item.title || ''}" placeholder="링크 제목" class="url-title-input w-full sm:w-1/3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"><div class="flex w-full flex-1 space-x-2"><input type="text" value="${item.url || ''}" placeholder="URL 또는 C:\\ 경로" class="url-input-item w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">${totalCount > 1 ? `<button type="button" onclick="removeUrlField(this)" class="bg-rose-50 hover:bg-rose-100 text-rose-500 px-3 py-2 rounded-xl transition text-xs shrink-0 flex items-center justify-center"><i class="fa-solid fa-xmark"></i></button>` : ''}</div>`;
        container.appendChild(wrapper);
    });
};

window.addUrlField = function() {
    const container = document.getElementById('url-fields-container');
    if (!container) return;
    const currentItems = Array.from(container.children).map(row => ({ title: row.querySelector('.url-title-input').value, url: row.querySelector('.url-input-item').value }));
    currentItems.push({ title: '', url: '' }); renderUrlFields(currentItems);
};

window.removeUrlField = function(btn) {
    const wrapper = btn.closest('.flex-col'); const container = document.getElementById('url-fields-container');
    if (container && container.children.length > 1) {
        wrapper.remove();
        const currentItems = Array.from(container.children).map(row => ({ title: row.querySelector('.url-title-input').value, url: row.querySelector('.url-input-item').value }));
        renderUrlFields(currentItems);
    }
};

function checkAndCreateAllGroup() {
    if (teamMembers.length === 0) return;
    const activeMemberNames = teamMembers.filter(m => !m.isResigned).map(m => m.name);
    const allGroup = teamGroups.find(g => g.name === 'All(전체 인원)' || g.name === 'All');
    if (!allGroup) {
        push(groupsRef, { name: 'All(전체 인원)', color: '#10b981', members: activeMemberNames });
    } else {
        const currentMembersSet = new Set(allGroup.members || []);
        const isDifferent = activeMemberNames.length !== currentMembersSet.size || activeMemberNames.some(name => !currentMembersSet.has(name));
        if (isDifferent) update(ref(db, 's2_team_groups/' + allGroup.id), { members: activeMemberNames });
    }
}

window.onStartDateChange = function() {
    const startInput = document.getElementById('f-start'); const endInput = document.getElementById('f-end');
    if (!startInput || !endInput) return;
    endInput.min = startInput.value;
    if (endInput.value < startInput.value) endInput.value = startInput.value;
    onEntityChange();
};

window.autoFillLeaveTitle = function(radioElem) { 
    const titleInput = document.getElementById('f-title');
    if (titleInput) titleInput.value = radioElem.value; 
};

function renderMemberSelect() {
    const listContainer = document.getElementById('f-member-list'); 
    if (!listContainer) return;
    
    listContainer.innerHTML = '';
    const allEntities = [];
    const sortedGroups = [...teamGroups].sort((a, b) => {
        if (a.name.includes('All')) return -1; 
        if (b.name.includes('All')) return 1;
        return a.name.localeCompare(b.name, 'ko');
    });
    sortedGroups.forEach(g => allEntities.push({ name: g.name, color: g.color, type: '그룹' }));
    teamMembers.filter(m => !m.isResigned).forEach(m => allEntities.push({ name: m.name, color: '#059669', type: '개인' }));

    allEntities.forEach(entity => {
        const div = document.createElement('div');
        div.className = 'px-3 py-2 text-sm text-slate-700 hover:bg-emerald-50 cursor-pointer member-option border-b border-slate-50 last:border-0';
        div.dataset.value = entity.name;
        div.innerHTML = `<span class="text-[10px] text-slate-400 mr-1.5">[${entity.type}]</span>${entity.name}`;
        div.onclick = function() {
            document.getElementById('f-member-search').value = entity.name;
            const hiddenInput = document.getElementById('f-member'); hiddenInput.value = entity.name;
            hiddenInput.dispatchEvent(new Event('change'));
            document.getElementById('f-member-list').classList.add('hidden'); onEntityChange();
        };
        listContainer.appendChild(div);
    });
    onEntityChange();
}

window.filterMemberDropdown = function() {
    const searchInput = document.getElementById('f-member-search');
    const memberList = document.getElementById('f-member-list');
    if (!searchInput || !memberList) return;
    const keyword = searchInput.value.toLowerCase();
    memberList.classList.remove('hidden');
    document.querySelectorAll('.member-option').forEach(opt => {
        opt.style.display = opt.dataset.value.toLowerCase().includes(keyword) ? 'block' : 'none';
    });
    const hiddenMember = document.getElementById('f-member');
    if (hiddenMember) hiddenMember.value = '';
};

window.handleMemberSearchKeydown = function(e) {
    if (e.key === 'Enter') {
        e.preventDefault(); 
        const list = document.getElementById('f-member-list');
        if (list && !list.classList.contains('hidden')) {
            const visibleOptions = Array.from(document.querySelectorAll('.member-option')).filter(opt => opt.style.display !== 'none');
            if (visibleOptions.length > 0) {
                const entityName = visibleOptions[0].dataset.value;
                document.getElementById('f-member-search').value = entityName;
                const hiddenInput = document.getElementById('f-member'); hiddenInput.value = entityName;
                hiddenInput.dispatchEvent(new Event('change'));
                list.classList.add('hidden'); onEntityChange();
            }
        }
    } else if (e.key === 'Escape') {
        const list = document.getElementById('f-member-list');
        if (list) list.classList.add('hidden');
    }
};

window.onEntityChange = function() {
    const memberInput = document.getElementById('f-member');
    const categoryInput = document.getElementById('f-category');
    if (!memberInput || !categoryInput) return;

    const selectedVal = memberInput.value; 
    const categoryVal = categoryInput.value;
    const subSection = document.getElementById('sub-members-section'); 
    const container = document.getElementById('sub-members-checkboxes');
    const leaveSection = document.getElementById('leave-type-section');

    if (!leaveSection || !subSection || !container) return;

    if (categoryVal === '휴가') leaveSection.classList.remove('hidden');
    else { leaveSection.classList.add('hidden'); document.querySelectorAll('input[name="leave-type"]').forEach(r => r.checked = false); }

    container.innerHTML = '';
    const matchedGroup = teamGroups.find(g => g.name === selectedVal);
    if (matchedGroup && matchedGroup.members && matchedGroup.members.length > 0) {
        subSection.classList.remove('hidden');
        const startStr = document.getElementById('f-start').value; 
        const endStr = document.getElementById('f-end').value;
        const currentEditingId = document.getElementById('event-id').value;

        let membersWithConflict = new Set();
        const dataSource = isArchiveMode ? archiveDataCache : rawCalendarData;
        if (dataSource && startStr && endStr) {
            const [sY, sM, sD] = startStr.split('-').map(Number); const sDate = new Date(sY, sM - 1, sD);
            const [eY, eM, eD] = endStr.split('-').map(Number); const eDate = new Date(eY, eM - 1, eD);

            Object.keys(dataSource).forEach(key => {
                if (key === currentEditingId) return;
                const evt = dataSource[key];
                if (evt.member === selectedVal) return; 

                const [evSY, evSM, evSD] = evt.start.split('-').map(Number); const evStart = new Date(evSY, evSM - 1, evSD);
                const evEndRaw = evt.end ? evt.end : evt.start;
                const [evEY, evEM, evED] = evEndRaw.split('-').map(Number); const evEnd = new Date(evEY, evEM - 1, evED);
                evEnd.setDate(evEnd.getDate() - 1);

                if (sDate <= evEnd && eDate >= evStart) {
                    if (teamMembers.some(m => m.name === evt.member)) membersWithConflict.add(evt.member);
                    if (evt.subMembers && Array.isArray(evt.subMembers)) evt.subMembers.forEach(sm => membersWithConflict.add(sm));
                }
            });
        }

        matchedGroup.members.forEach(mName => {
            const hasConflict = membersWithConflict.has(mName); 
            const lbl = document.createElement('label');
            lbl.className = `flex items-center space-x-1 px-2 py-1 rounded border text-xs cursor-pointer transition ${hasConflict ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-white border-slate-200 hover:bg-slate-100 text-slate-700'}`;
            lbl.innerHTML = `<input type="checkbox" value="${mName}" ${!hasConflict ? 'checked' : ''} class="sub-member-cb rounded text-emerald-600 focus:ring-emerald-500"><span class="font-medium">${mName} ${hasConflict ? '(타 일정 있음)' : ''}</span>`;
            container.appendChild(lbl);
        });
    } else subSection.classList.add('hidden');
};

window.toggleSubMembers = function(check) { document.querySelectorAll('.sub-member-cb').forEach(cb => cb.checked = check); };

function renderFilterCheckboxes() {
    const leaveContainer = document.getElementById('filter-leave-checkboxes'); 
    if (!leaveContainer) return;
    leaveContainer.innerHTML = '';
    const leaveLbl = document.createElement('label');
    leaveLbl.className = 'flex items-center space-x-2 cursor-pointer hover:bg-slate-100 p-2 rounded transition';
    leaveLbl.innerHTML = `<input type="checkbox" ${showLeaveEvent ? 'checked' : ''} onchange="handleLeaveFilterChange(this)" class="rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 w-4 h-4"><span class="font-medium text-slate-700 text-xs">휴가 일정 표시 (연차/반차)</span>`;
    leaveContainer.appendChild(leaveLbl); filterMemberCheckboxes();
}

window.filterMemberCheckboxes = function() {
    const memberContainer = document.getElementById('filter-member-checkboxes'); 
    if (!memberContainer) return;
    const keyword = document.getElementById('filter-search-input')?.value.trim().toLowerCase() || '';
    memberContainer.innerHTML = '';
    const allEntities = [...teamGroups.map(g=>g.name), ...teamMembers.filter(m => !m.isResigned).map(m=>m.name)];
    const filteredEntities = allEntities.filter(name => name.toLowerCase().includes(keyword));

    if (filteredEntities.length === 0) memberContainer.innerHTML = '<div class="text-xs text-slate-400 py-3 text-center">검색 결과가 없습니다.</div>';
    else {
        filteredEntities.forEach(name => {
            const isChecked = selectedMembers.has(name); 
            const lbl = document.createElement('label');
            lbl.className = 'flex items-center space-x-2 cursor-pointer hover:bg-slate-100 p-2 rounded transition';
            lbl.innerHTML = `<input type="checkbox" value="${name}" ${isChecked ? 'checked' : ''} onchange="handleMemberFilterChange(this)" class="rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 w-4 h-4"><span class="font-medium text-slate-700 text-xs">${name}</span>`;
            memberContainer.appendChild(lbl);
        });
    }
    renderCalendarData();
};

window.handleMemberFilterChange = function(cb) {
    if(cb.checked) selectedMembers.add(cb.value); else selectedMembers.delete(cb.value);
    renderCalendarData();
};

window.handleLeaveFilterChange = function(cb) { showLeaveEvent = cb.checked; renderCalendarData(); };

window.selectAllFilters = function(type, check) {
    if (type === 'member') {
        const allEntities = [...teamGroups.map(g=>g.name), ...teamMembers.filter(m => !m.isResigned).map(m=>m.name)];
        if(check) allEntities.forEach(e => selectedMembers.add(e)); else selectedMembers.clear();
    } else showLeaveEvent = check;
    renderFilterCheckboxes();
};

window.renderCalendarData = function() {
    if (!calendar) return;
    const targetData = isArchiveMode ? archiveDataCache : rawCalendarData;

    if (targetData) {
        const titleKeyword = document.getElementById('filter-title-input')?.value.trim().toLowerCase() || '';
        const anyMemberSelected = selectedMembers.size > 0;
        const eventsToAdd = [];
        
        Object.keys(targetData).forEach(key => {
            const item = targetData[key];
            const isLeave = isLeaveEvent(item);
            if (titleKeyword && (!item.title || !item.title.toLowerCase().includes(titleKeyword))) return;
            if (!anyMemberSelected && !showLeaveEvent) { eventsToAdd.push(createCalendarEventObject(key, item)); return; }

            let match = false;
            if (showLeaveEvent && isLeave) match = true;
            if (anyMemberSelected) {
                if (selectedMembers.has(item.member)) match = true;
                if (item.subMembers && Array.isArray(item.subMembers) && item.subMembers.some(sm => selectedMembers.has(sm))) match = true;
            }
            if (match) eventsToAdd.push(createCalendarEventObject(key, item));
        });
        
        calendar.batchRendering(() => {
            calendar.getEvents().filter(e => !e.source || e.source.id !== 'korea-holidays').forEach(e => e.remove());
            eventsToAdd.forEach(e => calendar.addEvent(e));
        });
    } else {
        calendar.batchRendering(() => {
            calendar.getEvents().filter(e => !e.source || e.source.id !== 'korea-holidays').forEach(e => e.remove());
        });
    }
};

function createCalendarEventObject(key, item) {
    const isLeave = isLeaveEvent(item);
    let assignedCategory = item.category || '일반 업무';
    if (isLeave) assignedCategory = '휴가';

    if (assignedCategory === '팀 공휴일') {
        return {
            id: key, title: item.title, start: item.start, 
            end: item.start === item.end ? addDays(item.start, 1) : item.end,
            allDay: true, backgroundColor: '#fee2e2', borderColor: '#fca5a5', textColor: '#dc2626',
            classNames: ['holiday-event'],
            extendedProps: { member: '전체', rawTitle: item.title, category: '팀 공휴일' }
        };
    }

    let eventColor = item.color || '#059669';
    if (assignedCategory === '휴가') eventColor = '#475569';
    else {
        const matchedGroup = teamGroups.find(g => g.name === item.member);
        if (matchedGroup) eventColor = matchedGroup.color;
    }

    let validEnd = item.end;
    if (item.start === item.end) validEnd = addDays(item.start, 1);

    return {
        id: key, title: `[${item.member}] ${item.title}`, start: item.start, end: validEnd, allDay: true,
        backgroundColor: eventColor, borderColor: eventColor,
        extendedProps: { 
            member: item.member, rawTitle: item.title, category: assignedCategory, 
            comment: item.comment || '', url: item.url || '', 
            subMembers: item.subMembers || [], groupId: item.groupId || null 
        }
    };
}

window.switchTab = function(tab) {
    const btnMem = document.getElementById('tab-member'); const btnGrp = document.getElementById('tab-group');
    const secMem = document.getElementById('sec-member'); const secGrp = document.getElementById('sec-group');
    if (!btnMem || !btnGrp || !secMem || !secGrp) return;
    if (tab === 'member') {
        secMem.classList.remove('hidden'); secGrp.classList.add('hidden');
        btnMem.className = 'flex-1 pb-2.5 border-b-2 border-emerald-600 text-emerald-600 font-bold text-sm transition'; btnGrp.className = 'flex-1 pb-2.5 border-b-2 border-transparent text-slate-500 hover:text-slate-700 font-semibold text-sm transition';
    } else {
        secGrp.classList.remove('hidden'); secMem.classList.add('hidden');
        btnGrp.className = 'flex-1 pb-2.5 border-b-2 border-emerald-600 text-emerald-600 font-bold text-sm transition'; btnMem.className = 'flex-1 pb-2.5 border-b-2 border-transparent text-slate-500 hover:text-slate-700 font-semibold text-sm transition';
    }
};

window.selectColor = function(color, btnElem) {
    selectedGroupColor = color; 
    document.querySelectorAll('#group-color-palette .color-btn').forEach(b => b.classList.remove('ring-2', 'ring-offset-2', 'ring-slate-400'));
    if(btnElem) btnElem.classList.add('ring-2', 'ring-offset-2', 'ring-slate-400');
};

window.openMemberModal = function() { cancelEditMember(); cancelEditGroup(); document.getElementById('member-modal').classList.remove('hidden'); };
window.closeMemberModal = function() { document.getElementById('member-modal').classList.add('hidden'); };

window.toggleResignedSection = function() {
    const list = document.getElementById('resigned-list-container'); const arrow = document.getElementById('resigned-arrow');
    if (!list || !arrow) return;
    list.classList.toggle('hidden'); arrow.classList.toggle('fa-chevron-down'); arrow.classList.toggle('fa-chevron-up');
};

function renderMemberList() {
    const container = document.getElementById('member-list-container');
    const resignedContainer = document.getElementById('resigned-list-container');
    if (!container || !resignedContainer) return;
    container.innerHTML = ''; resignedContainer.innerHTML = '';

    teamMembers.forEach(m => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs';
        div.innerHTML = `<span class="font-bold text-slate-700">${m.name}</span><div class="space-x-1"><button onclick="editMember('${m.id}', '${m.name}', ${m.isResigned})" class="text-blue-600 hover:underline px-2 py-1">수정</button><button onclick="deleteMember('${m.id}')" class="text-rose-500 hover:underline px-2 py-1">삭제</button></div>`;
        if (m.isResigned) resignedContainer.appendChild(div);
        else container.appendChild(div);
    });
}

window.editMember = function(id, name) {
    editingMemberId = id;
    const titleEl = document.getElementById('member-form-title');
    const nameInput = document.getElementById('new-member-name');
    const cancelBtn = document.getElementById('cancel-member-edit-btn');
    if (titleEl) titleEl.innerText = "팀원 수정";
    if (nameInput) nameInput.value = name;
    if (cancelBtn) cancelBtn.classList.remove('hidden');
};

window.cancelEditMember = function() {
    editingMemberId = null;
    const titleEl = document.getElementById('member-form-title');
    const nameInput = document.getElementById('new-member-name');
    const cancelBtn = document.getElementById('cancel-member-edit-btn');
    if (titleEl) titleEl.innerText = "새 팀원 추가";
    if (nameInput) nameInput.value = '';
    if (cancelBtn) cancelBtn.classList.add('hidden');
};

window.saveMember = function() {
    const nameInput = document.getElementById('new-member-name');
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) return showToast('팀원 이름을 입력하세요.', 'error');
    if (editingMemberId) {
        update(ref(db, 's2_team_members/' + editingMemberId), { name }).then(() => {
            showToast('팀원 수정 완료', 'success'); cancelEditMember();
        });
    } else {
        push(membersRef, { name, isResigned: false }).then(() => {
            showToast('팀원 추가 완료', 'success'); nameInput.value = '';
        });
    }
};

window.deleteMember = async function(id) {
    if (await showConfirm('이 팀원을 삭제하시겠습니까?')) {
        remove(ref(db, 's2_team_members/' + id)).then(() => showToast('삭제 완료', 'success'));
    }
};

function renderGroupList() {
    const container = document.getElementById('group-list-container');
    if (!container) return;
    container.innerHTML = '';
    teamGroups.forEach(g => {
        const div = document.createElement('div');
        div.className = 'p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5';
        div.innerHTML = `<div class="flex items-center justify-between"><div class="flex items-center space-x-2"><span class="w-3 h-3 rounded-full" style="background-color: ${g.color};"></span><span class="font-bold text-slate-800">${g.name}</span></div><div class="space-x-1"><button onclick="editGroup('${g.id}', '${g.name}', '${g.color}')" class="text-blue-600 hover:underline px-1.5 py-0.5">수정</button><button onclick="deleteGroup('${g.id}')" class="text-rose-500 hover:underline px-1.5 py-0.5">삭제</button></div></div><div class="text-[11px] text-slate-500 truncate">소속 멤버: ${g.members && g.members.length > 0 ? g.members.join(', ') : '없음'}</div>`;
        container.appendChild(div);
    });
}

function renderGroupMemberCheckboxes() {
    const container = document.getElementById('group-members-checkboxes');
    if (!container) return;
    container.innerHTML = '';
    teamMembers.filter(m => !m.isResigned).forEach(m => {
        const lbl = document.createElement('label');
        lbl.className = 'flex items-center space-x-1 bg-slate-50 hover:bg-slate-100 px-2 py-1 rounded border border-slate-200 text-xs cursor-pointer';
        lbl.innerHTML = `<input type="checkbox" value="${m.name}" class="group-member-cb rounded text-emerald-600 focus:ring-emerald-500"><span class="font-medium text-slate-700">${m.name}</span>`;
        container.appendChild(lbl);
    });
}

window.toggleGroupAllMembers = function(check) {
    document.querySelectorAll('.group-member-cb').forEach(cb => cb.checked = check);
};

window.editGroup = function(id, name, color) {
    editingGroupId = id;
    const titleEl = document.getElementById('group-form-title');
    const nameInput = document.getElementById('new-group-name');
    const cancelBtn = document.getElementById('cancel-group-edit-btn');
    if (titleEl) titleEl.innerText = "그룹 수정";
    if (nameInput) nameInput.value = name;
    selectedGroupColor = color;
    if (cancelBtn) cancelBtn.classList.remove('hidden');
    const groupObj = teamGroups.find(g => g.id === id);
    const members = groupObj ? groupObj.members || [] : [];
    document.querySelectorAll('.group-member-cb').forEach(cb => {
        cb.checked = members.includes(cb.value);
    });
};

window.cancelEditGroup = function() {
    editingGroupId = null;
    const titleEl = document.getElementById('group-form-title');
    const nameInput = document.getElementById('new-group-name');
    const cancelBtn = document.getElementById('cancel-group-edit-btn');
    if (titleEl) titleEl.innerText = "새 파트 그룹 추가";
    if (nameInput) nameInput.value = '';
    if (cancelBtn) cancelBtn.classList.add('hidden');
    document.querySelectorAll('.group-member-cb').forEach(cb => cb.checked = false);
};

window.saveGroup = function() {
    const nameInput = document.getElementById('new-group-name');
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) return showToast('그룹명을 입력하세요.', 'error');
    const members = Array.from(document.querySelectorAll('.group-member-cb:checked')).map(cb => cb.value);

    if (editingGroupId) {
        update(ref(db, 's2_team_groups/' + editingGroupId), { name, color: selectedGroupColor, members }).then(() => {
            showToast('그룹 수정 완료', 'success'); cancelEditGroup();
        });
    } else {
        push(groupsRef, { name, color: selectedGroupColor, members }).then(() => {
            showToast('그룹 추가 완료', 'success'); nameInput.value = '';
            document.querySelectorAll('.group-member-cb').forEach(cb => cb.checked = false);
        });
    }
};

window.deleteGroup = async function(id) {
    if (await showConfirm('이 파트 그룹을 삭제하시겠습니까?')) {
        remove(ref(db, 's2_team_groups/' + id)).then(() => showToast('삭제 완료', 'success'));
    }
};

function updateEventDates(event) {
    const dbRef = ref(db, 's2_team_calendar/' + event.id);
    const endDate = event.end ? event.endStr.split('T')[0] : event.startStr.split('T')[0];
    update(dbRef, { start: event.startStr.split('T')[0], end: endDate });
}

window.openEventModal = function() {
    if(isArchiveMode) return showToast('조회 모드에서는 등록 불가', 'error');
    const modalTitle = document.getElementById('modal-title');
    const eventIdInput = document.getElementById('event-id');
    const titleInput = document.getElementById('f-title');
    const commentInput = document.getElementById('f-comment');
    const categorySelect = document.getElementById('f-category');
    const memberSearch = document.getElementById('f-member-search');
    const memberHidden = document.getElementById('f-member');
    const startInput = document.getElementById('f-start');
    const endInput = document.getElementById('f-end');
    const deleteBtn = document.getElementById('modal-delete-btn');
    const eventModal = document.getElementById('event-modal');

    if (modalTitle) modalTitle.innerText = "일정 등록"; 
    if (eventIdInput) eventIdInput.value = "";
    if (titleInput) titleInput.value = ""; 
    if (commentInput) commentInput.value = ""; 
    if (categorySelect) categorySelect.value = "일반 업무";
    renderUrlFields([{ title: '', url: '' }]); 
    if (memberSearch) memberSearch.value = ""; 
    if (memberHidden) memberHidden.value = "";
    
    const today = formatYMD(new Date());
    if (startInput) startInput.value = today; 
    if (endInput) endInput.value = today; 
    onStartDateChange();
    
    if (deleteBtn) deleteBtn.classList.add('hidden'); 
    if (eventModal) eventModal.classList.remove('hidden');
};

window.closeEventModal = function() { 
    const modal = document.getElementById('event-modal');
    if (modal) modal.classList.add('hidden'); 
};

window.handleEventSubmit = async function(e) {
    e.preventDefault();
    const idInput = document.getElementById('event-id');
    const memberInput = document.getElementById('f-member');
    const categoryInput = document.getElementById('f-category');
    const titleInput = document.getElementById('f-title');
    const commentInput = document.getElementById('f-comment');
    const startInput = document.getElementById('f-start');
    const endInput = document.getElementById('f-end');

    if (!memberInput || !categoryInput || !titleInput || !startInput || !endInput) return;

    const id = idInput ? idInput.value : ''; 
    const member = memberInput.value;
    if(!member) return showToast('담당 주체를 정확히 선택하세요.', 'error');
    
    const category = categoryInput.value; 
    const title = titleInput.value;
    let color = '#059669';
    if (category === '휴가') color = '#475569'; 
    else if (category === '팀 공휴일') color = '#fee2e2';
    else { const matchedGroup = teamGroups.find(g => g.name === member); if (matchedGroup) color = matchedGroup.color; }

    const comment = commentInput ? commentInput.value : ''; 
    const rows = document.querySelectorAll('#url-fields-container .flex-col'); 
    const urlLines = [];
    rows.forEach(row => {
        const tVal = row.querySelector('.url-title-input')?.value.trim() || ''; 
        const uVal = row.querySelector('.url-input-item')?.value.trim() || '';
        if (uVal !== '') urlLines.push(`${tVal !== '' ? tVal : '링크'}|${uVal}`);
    });
    const url = urlLines.join('\n');
    const startStr = startInput.value; 
    const endInputStr = endInput.value;
    const subMembers = Array.from(document.querySelectorAll('.sub-member-cb:checked')).map(cb => cb.value);

    let currDate = new Date(startStr); const lastDate = new Date(endInputStr);

    if (id) {
        const existingEvt = rawCalendarData ? rawCalendarData[id] : null;
        const existingGroupId = existingEvt && existingEvt.groupId ? existingEvt.groupId : ('grp_' + Date.now());
        let siblingKeys = [];
        if (existingEvt && existingEvt.groupId && rawCalendarData) siblingKeys = Object.keys(rawCalendarData).filter(k => rawCalendarData[k].groupId === existingEvt.groupId);
        const origStart = existingEvt ? existingEvt.start.split('T')[0] : startStr;
        const origEndRaw = existingEvt && existingEvt.end ? addDays(existingEvt.end, -1) : origStart;
        const isExtended = (startStr !== origStart) || (endInputStr !== origEndRaw);

        if (siblingKeys.length > 1 || isExtended) {
            const updates = {};
            if (siblingKeys.length > 1) siblingKeys.forEach(k => { updates['s2_team_calendar/' + k] = null; });
            else updates['s2_team_calendar/' + id] = null;

            while (currDate <= lastDate) {
                const dateString = formatYMD(currDate);
                const dayOfWeek = currDate.getDay();
                if ((dayOfWeek !== 0 && dayOfWeek !== 6) || category === '팀 공휴일') {
                    const nextDayStr = addDays(dateString, 1);
                    const newRef = push(calendarRef);
                    updates['s2_team_calendar/' + newRef.key] = { member, title, category, comment, url, start: dateString, end: nextDayStr, color, subMembers, groupId: existingGroupId };
                }
                currDate.setDate(currDate.getDate() + 1);
            }
            update(ref(db), updates).then(() => { showToast('연속 일정 수정 완료', 'success'); closeEventModal(); });
            return;
        }

        const end = addDays(endInputStr, 1);
        const eventData = { member, title, category, comment, url, start: startStr, end, color, subMembers, groupId: existingGroupId };
        update(ref(db, 's2_team_calendar/' + id), eventData).then(() => { showToast('일정 수정 완료', 'success'); });
        closeEventModal(); return;
    }
    
    let createdCount = 0; const updates = {}; const groupId = 'grp_' + Date.now();
    while (currDate <= lastDate) {
        const dateString = formatYMD(currDate);
        const dayOfWeek = currDate.getDay();
        if ((dayOfWeek !== 0 && dayOfWeek !== 6) || category === '팀 공휴일') {
            const nextDayStr = addDays(dateString, 1);
            const newRef = push(calendarRef);
            updates[newRef.key] = { member, title, category, comment, url, start: dateString, end: nextDayStr, color, subMembers, groupId };
            createdCount++;
        }
        currDate.setDate(currDate.getDate() + 1);
    }

    if (createdCount === 0) return showToast('기간 내 평일이 없어 생성할 수 없습니다.', 'error');
    update(calendarRef, updates).then(() => { showToast(`총 ${createdCount}건 등록 완료`, 'success'); closeEventModal(); }).catch(() => showToast('등록 오류', 'error'));
};

window.handleEventDelete = async function() {
    const eventIdInput = document.getElementById('event-id');
    if (!eventIdInput) return;
    const id = eventIdInput.value; 
    if (!id) return;
    closeEventModal(); await new Promise(r => setTimeout(r, 100));
    const confirmed = await showConfirm('이 일정을 삭제하시겠습니까?'); if (!confirmed) return;
    
    const evtData = rawCalendarData ? rawCalendarData[id] : null; let deleteKeys = [id];
    if (evtData && evtData.groupId) {
        const siblings = Object.keys(rawCalendarData).filter(k => rawCalendarData[k].groupId === evtData.groupId && k !== id);
        if (siblings.length > 0 && await showConfirm(`연결된 나머지 ${siblings.length}개 일정도 함께 삭제하시겠습니까?`)) {
            deleteKeys = deleteKeys.concat(siblings);
        }
    }
    const updates = {}; deleteKeys.forEach(k => updates['s2_team_calendar/' + k] = null);
    update(ref(db), updates).then(() => {
        showToast('일정 삭제 완료', 'success');
        if (lockedEventId && deleteKeys.includes(lockedEventId)) unlockPreview();
    });
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, push, update, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// 🔐 [보안 필수]: GitHub 업로드 후 Google Cloud Console에서 해당 API 키에 대해 리퍼러 제한을 설정하세요.
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

let lockedEventId = localStorage.getItem('s2_locked_event_id') || null;
let lockTimer = null;
let lockTimeoutMinutes = parseInt(localStorage.getItem('s2_lock_timeout_min') || '5', 10);
let contextTargetEventId = null;
let contextTargetDateStr = null;

let isGithubPanelVisibleForNormal = localStorage.getItem('s2_github_panel_visible') === 'true';
let searchDebounceTimer;

// 🌟 아카이브 관련 상태 변수
let isArchiveMode = false;
let archiveDataCache = null;

const offsetRef = ref(db, '.info/serverTimeOffset');
onValue(offsetRef, (snap) => {
    window.serverTimeOffset = snap.val() || 0;
});

// 🛠️ 날짜 포맷 유틸리티 함수
function formatYMD(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return formatYMD(date);
}

// 🇰🇷 향후 5년치 공휴일 내장 (외부 API 장애 원천 차단)
const hardcodedHolidays = {
    '2024-01-01': '신정', '2024-02-09': '설연휴', '2024-02-10': '설날', '2024-02-11': '설연휴', '2024-02-12': '대체공휴일', '2024-03-01': '삼일절', '2024-05-05': '어린이날', '2024-05-06': '대체공휴일', '2024-05-15': '부처님오신날', '2024-06-06': '현충일', '2024-08-15': '광복절', '2024-09-16': '추석연휴', '2024-09-17': '추석', '2024-09-18': '추석연휴', '2024-10-03': '개천절', '2024-10-09': '한글날', '2024-12-25': '기독탄신일',
    '2025-01-01': '신정', '2025-01-28': '설연휴', '2025-01-29': '설날', '2025-01-30': '설연휴', '2025-03-03': '대체공휴일', '2025-05-05': '어린이날', '2025-05-06': '부처님오신날', '2025-06-06': '현충일', '2025-08-15': '광복절', '2025-10-03': '개천절', '2025-10-06': '추석연휴', '2025-10-07': '추석연휴', '2025-10-08': '대체공휴일', '2025-10-09': '한글날', '2025-12-25': '기독탄신일',
    '2026-01-01': '신정', '2026-02-16': '설연휴', '2026-02-17': '설날', '2026-02-18': '설연휴', '2026-03-02': '대체공휴일', '2026-05-05': '어린이날', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일', '2026-06-06': '현충일', '2026-08-15': '광복절', '2026-09-24': '추석연휴', '2026-09-25': '추석', '2026-09-26': '추석연휴', '2026-10-03': '개천절', '2026-10-09': '한글날', '2026-12-25': '기독탄신일',
    '2027-01-01': '신정', '2027-02-06': '설연휴', '2027-02-07': '설날', '2027-02-08': '설연휴', '2027-02-09': '대체공휴일', '2027-03-01': '삼일절', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날', '2027-06-06': '현충일', '2027-06-07': '대체공휴일', '2027-08-15': '광복절', '2027-08-16': '대체공휴일', '2027-09-14': '추석연휴', '2027-09-15': '추석', '2027-09-16': '추석연휴', '2027-10-03': '개천절', '2027-10-04': '대체공휴일', '2027-10-09': '한글날', '2027-10-11': '대체공휴일', '2027-12-25': '기독탄신일'
};

// 🌟 2년 전 데이터 백그라운드 자동 아카이빙 로직
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
            console.log(`[Auto-Archive] 오래된 데이터 ${archiveCount}건이 ${thresholdYear}년 보관함으로 자동 압축 이동되었습니다.`);
        } catch(e) {
            console.error('Archive Error:', e);
        }
    }
}

// 🌟 과거 기록 불러오기 모달 제어 함수들
window.openArchiveModal = async function() {
    try {
        const snapshot = await get(ref(db, 's2_team_archive'));
        const archiveData = snapshot.val();
        if (!archiveData) {
            showToast('보관된 과거 기록(로그)이 존재하지 않습니다.', 'info');
            return;
        }
        
        const years = Object.keys(archiveData).sort((a, b) => b - a);
        const select = document.getElementById('archive-year-select');
        select.innerHTML = '';
        
        years.forEach(y => {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = `${y}년 기록`;
            select.appendChild(opt);
        });
        
        document.getElementById('archive-modal').classList.remove('hidden');
    } catch (e) {
        showToast('과거 기록을 조회할 수 없습니다.', 'error');
    }
};

window.closeArchiveModal = function() {
    document.getElementById('archive-modal').classList.add('hidden');
};

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
            showToast(`${year}년 기록을 불러왔습니다. (조회 전용)`, 'success');
        }
    } catch (e) {
        showToast('기록을 불러오는 중 오류가 발생했습니다.', 'error');
    }
};

window.exitArchiveMode = function() {
    isArchiveMode = false;
    archiveDataCache = null;
    document.getElementById('archive-banner').classList.add('hidden');
    calendar.setOption('editable', true);
    calendar.today();
    renderCalendarData();
    showToast('실시간 달력으로 복귀했습니다.', 'success');
};

// ... (나머지 캘린더 이벤트 핸들러, 엑셀 파싱, UI 컨트롤 함수들은 이전 최종 버전과 동일하게 작동)
// ============================================================
// FocusTimer PWA — app.js
// ============================================================

// --- Storage helpers ---
function loadSessions() {
    return JSON.parse(localStorage.getItem('ft_sessions') || '[]');
}
function saveSessions(sessions) {
    localStorage.setItem('ft_sessions', JSON.stringify(sessions));
}
function loadCategories() {
    let cats = JSON.parse(localStorage.getItem('ft_categories') || 'null');
    if (!cats) {
        cats = [
            { id: 'c1', nombre: 'Estudio',   colorHex: '#4A90D9', predefinida: true },
            { id: 'c2', nombre: 'Trabajo',    colorHex: '#E67E22', predefinida: true },
            { id: 'c3', nombre: 'Ejercicio',  colorHex: '#27AE60', predefinida: true },
            { id: 'c4', nombre: 'Lectura',    colorHex: '#8E44AD', predefinida: true },
            { id: 'c5', nombre: 'Personal',   colorHex: '#E74C3C', predefinida: true },
        ];
        saveCategories(cats);
    }
    return cats;
}
function saveCategories(cats) {
    localStorage.setItem('ft_categories', JSON.stringify(cats));
}
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function formatDuration(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// --- State ---
const state = {
    mode: 'pomodoro', // 'pomodoro' | 'libre'
    timerState: 'idle', // 'idle' | 'running' | 'paused'
    pomodoroPhase: 'trabajo', // 'trabajo' | 'descanso' | 'descansoLargo'
    pomodorosCompleted: 0,
    secondsRemaining: 25 * 60,
    secondsElapsed: 0,
    selectedCategory: null,
    sessionStart: null,
    interval: null,
    backgroundTime: null,
    // Calendar
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    // Stats
    statsPeriod: 'hoy',
    // Tasks
    tasks: [], // { id, text, done }
    pendingSession: null, // session waiting for mood rating
};

const WORK = 25 * 60;
const SHORT_BREAK = 5 * 60;
const LONG_BREAK = 15 * 60;
const RING_CIRCUMFERENCE = 2 * Math.PI * 88; // ~553

// --- DOM refs ---
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const els = {
    timerTime: $('#timer-time'),
    timerLabel: $('#timer-label'),
    ringProgress: $('#ring-progress'),
    ringBg: $('.ring-bg'),
    dots: $$('.dot'),
    btnPlay: $('#btn-play'),
    btnStop: $('#btn-stop'),
    btnReset: $('#btn-reset'),
    iconPlay: $('#icon-play'),
    iconPause: $('#icon-pause'),
    catDot: $('#cat-dot'),
    catName: $('#cat-name'),
    btnCategory: $('#btn-category'),
    pomDots: $('#pomodoro-dots'),
    timerDisplay: $('#timer-display'),
};

// ============================================================
// TABS
// ============================================================
$$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        $$('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        $$('.tab-content').forEach(c => c.classList.remove('active'));
        $(`#tab-${tab.dataset.tab}`).classList.add('active');
        if (tab.dataset.tab === 'calendar') renderCalendar();
        if (tab.dataset.tab === 'stats') renderStats();
    });
});

// ============================================================
// MODE TOGGLE
// ============================================================
$$('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (state.timerState !== 'idle') return;
        $$('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.dataset.mode;
        resetTimer();
        updateTimerUI();
    });
});

// ============================================================
// TIMER LOGIC
// ============================================================
function getPhaseDuration() {
    if (state.pomodoroPhase === 'trabajo') return WORK;
    if (state.pomodoroPhase === 'descanso') return SHORT_BREAK;
    return LONG_BREAK;
}

function startTimer() {
    if (state.timerState === 'idle') {
        state.sessionStart = Date.now();
        if (state.mode === 'pomodoro') {
            state.secondsRemaining = getPhaseDuration();
        } else {
            state.secondsElapsed = 0;
        }
    }
    state.timerState = 'running';
    state.interval = setInterval(tick, 1000);
    updateTimerUI();
}

function pauseTimer() {
    state.timerState = 'paused';
    clearInterval(state.interval);
    state.interval = null;
    updateTimerUI();
}

function resetTimer() {
    clearInterval(state.interval);
    state.interval = null;
    state.timerState = 'idle';
    state.sessionStart = null;
    if (state.mode === 'pomodoro') {
        state.secondsRemaining = getPhaseDuration();
    } else {
        state.secondsElapsed = 0;
    }
    updateTimerUI();
}

function stopTimer() {
    clearInterval(state.interval);
    state.interval = null;

    // Build session if meaningful
    if (state.sessionStart) {
        let duration;
        if (state.mode === 'pomodoro') {
            duration = getPhaseDuration() - state.secondsRemaining;
        } else {
            duration = state.secondsElapsed;
        }

        const isWork = state.mode === 'libre' || state.pomodoroPhase === 'trabajo';
        if (duration >= 30 && isWork) {
            const session = {
                id: uid(),
                inicio: state.sessionStart,
                fin: Date.now(),
                duracion: duration,
                modo: state.mode === 'pomodoro' ? 'pomodoro' : 'libre',
                categoriaId: state.selectedCategory ? state.selectedCategory.id : null,
                tareas: state.tasks.map(t => ({ text: t.text, done: t.done })),
                animo: null,
            };
            state.pendingSession = session;
            showMoodModal();
        }
    }

    state.timerState = 'idle';
    state.sessionStart = null;
    state.pomodorosCompleted = 0;
    state.pomodoroPhase = 'trabajo';
    state.secondsRemaining = WORK;
    state.secondsElapsed = 0;
    updateTimerUI();
}

function tick() {
    if (state.timerState !== 'running') return;

    if (state.mode === 'pomodoro') {
        if (state.secondsRemaining > 0) {
            state.secondsRemaining--;
        }
        if (state.secondsRemaining === 0) {
            completeSegment();
        }
    } else {
        state.secondsElapsed++;
    }
    updateTimerUI();
}

function completeSegment() {
    clearInterval(state.interval);
    state.interval = null;

    // Save work session — show mood modal
    if (state.pomodoroPhase === 'trabajo' && state.sessionStart) {
        const session = {
            id: uid(),
            inicio: state.sessionStart,
            fin: Date.now(),
            duracion: getPhaseDuration(),
            modo: 'pomodoro',
            categoriaId: state.selectedCategory ? state.selectedCategory.id : null,
            tareas: state.tasks.map(t => ({ text: t.text, done: t.done })),
            animo: null,
        };
        state.pendingSession = session;
        showMoodModal();
    }

    if (state.pomodoroPhase === 'trabajo') {
        state.pomodorosCompleted++;
        state.pomodoroPhase = (state.pomodorosCompleted % 4 === 0) ? 'descansoLargo' : 'descanso';
    } else {
        state.pomodoroPhase = 'trabajo';
    }

    state.secondsRemaining = getPhaseDuration();
    state.timerState = 'idle';
    state.sessionStart = null;
    updateTimerUI();
}

// --- Background handling ---
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        state.backgroundTime = Date.now();
    } else if (state.backgroundTime && state.timerState === 'running') {
        const elapsed = Math.floor((Date.now() - state.backgroundTime) / 1000);
        state.backgroundTime = null;
        if (state.mode === 'pomodoro') {
            state.secondsRemaining = Math.max(0, state.secondsRemaining - elapsed);
            if (state.secondsRemaining === 0) completeSegment();
        } else {
            state.secondsElapsed += elapsed;
        }
        updateTimerUI();
    }
});

// ============================================================
// TIMER UI
// ============================================================
function updateTimerUI() {
    const color = state.selectedCategory ? state.selectedCategory.colorHex : '#4A90D9';

    // Time display
    if (state.mode === 'pomodoro') {
        els.timerTime.textContent = formatTime(state.secondsRemaining);
        const total = getPhaseDuration();
        const progress = total > 0 ? 1 - (state.secondsRemaining / total) : 0;
        els.ringProgress.setAttribute('stroke-dashoffset', RING_CIRCUMFERENCE * (1 - progress));
    } else {
        els.timerTime.textContent = formatTime(state.secondsElapsed);
        els.ringProgress.setAttribute('stroke-dashoffset', RING_CIRCUMFERENCE);
    }

    // Ring color
    els.ringProgress.style.stroke = color;
    document.querySelector('.ctrl-primary').style.background = color;

    // Label
    if (state.timerState === 'idle') {
        els.timerLabel.textContent = 'Listo';
    } else if (state.timerState === 'paused') {
        els.timerLabel.textContent = 'Pausado';
    } else {
        if (state.mode === 'pomodoro') {
            const labels = { trabajo: 'Trabajo', descanso: 'Descanso', descansoLargo: 'Descanso largo' };
            els.timerLabel.textContent = labels[state.pomodoroPhase];
        } else {
            els.timerLabel.textContent = 'En curso';
        }
    }

    // Play/pause icons
    els.iconPlay.classList.toggle('hidden', state.timerState === 'running');
    els.iconPause.classList.toggle('hidden', state.timerState !== 'running');

    // Stop/reset buttons
    els.btnStop.classList.toggle('hidden', state.timerState === 'idle');
    els.btnReset.classList.toggle('hidden', state.timerState === 'idle');

    // Pomodoro dots
    els.pomDots.classList.toggle('hidden', state.mode !== 'pomodoro');
    els.dots.forEach((dot, i) => {
        dot.classList.toggle('filled', i < (state.pomodorosCompleted % 4));
        dot.style.background = i < (state.pomodorosCompleted % 4) ? color : '';
    });

    // Category
    els.catDot.style.background = color;
    els.catName.textContent = state.selectedCategory ? state.selectedCategory.nombre : 'Sin categoría';
}

// --- Timer button events ---
els.btnPlay.addEventListener('click', () => {
    if (state.timerState === 'running') pauseTimer();
    else startTimer();
});
els.btnStop.addEventListener('click', stopTimer);
els.btnReset.addEventListener('click', resetTimer);

// ============================================================
// CATEGORY PICKER
// ============================================================
els.btnCategory.addEventListener('click', () => {
    if (state.timerState !== 'idle') return;
    renderCatPicker();
    $('#cat-modal').classList.remove('hidden');
});
$('#cat-modal-close').addEventListener('click', () => $('#cat-modal').classList.add('hidden'));
$('#cat-modal').addEventListener('click', (e) => {
    if (e.target === $('#cat-modal')) $('#cat-modal').classList.add('hidden');
});

function renderCatPicker() {
    const cats = loadCategories();
    const list = $('#cat-list');
    list.innerHTML = '';
    cats.forEach(cat => {
        const div = document.createElement('div');
        div.className = 'cat-item';
        div.innerHTML = `
            <span class="ci-dot" style="background:${cat.colorHex}"></span>
            <span class="ci-name">${cat.nombre}</span>
            ${state.selectedCategory && state.selectedCategory.id === cat.id ? '<span class="ci-check">✓</span>' : ''}
        `;
        div.addEventListener('click', () => {
            state.selectedCategory = cat;
            updateTimerUI();
            $('#cat-modal').classList.add('hidden');
        });
        list.appendChild(div);
    });
}

// ============================================================
// CATEGORY MANAGER
// ============================================================
$('#btn-manage-cats').addEventListener('click', () => {
    renderCatManager();
    $('#cat-manager-modal').classList.remove('hidden');
});
$('#cat-manager-close').addEventListener('click', () => $('#cat-manager-modal').classList.add('hidden'));
$('#cat-manager-modal').addEventListener('click', (e) => {
    if (e.target === $('#cat-manager-modal')) $('#cat-manager-modal').classList.add('hidden');
});

function renderCatManager() {
    const cats = loadCategories();
    const list = $('#cat-manager-list');
    list.innerHTML = '';
    cats.forEach(cat => {
        const div = document.createElement('div');
        div.className = 'cat-item';
        div.innerHTML = `
            <span class="ci-dot" style="background:${cat.colorHex}"></span>
            <span class="ci-name">${cat.nombre}</span>
            ${cat.predefinida ? '<span class="ci-badge">Predefinida</span>' : '<button class="ci-delete" data-id="' + cat.id + '">&times;</button>'}
        `;
        list.appendChild(div);
    });

    list.querySelectorAll('.ci-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const updated = loadCategories().filter(c => c.id !== id);
            saveCategories(updated);
            if (state.selectedCategory && state.selectedCategory.id === id) {
                state.selectedCategory = null;
                updateTimerUI();
            }
            renderCatManager();
        });
    });
}

$('#cat-edit-save').addEventListener('click', () => {
    const name = $('#cat-edit-name').value.trim();
    if (!name) return;
    const color = $('#cat-edit-color').value;
    const cats = loadCategories();
    cats.push({ id: uid(), nombre: name, colorHex: color, predefinida: false });
    saveCategories(cats);
    $('#cat-edit-name').value = '';
    renderCatManager();
});

// ============================================================
// CALENDAR
// ============================================================
const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

$('#cal-prev').addEventListener('click', () => {
    state.calMonth--;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
    renderCalendar();
});
$('#cal-next').addEventListener('click', () => {
    state.calMonth++;
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
    renderCalendar();
});

function renderCalendar() {
    $('#cal-month').textContent = `${MONTH_NAMES[state.calMonth]} ${state.calYear}`;
    const grid = $('#cal-grid');
    grid.innerHTML = '';

    const firstDay = new Date(state.calYear, state.calMonth, 1);
    const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    const startWeekday = (firstDay.getDay() + 6) % 7; // Monday = 0

    const sessions = loadSessions();
    const cats = loadCategories();
    const catMap = {};
    cats.forEach(c => catMap[c.id] = c);

    const today = new Date();

    // Group sessions by day
    const dayData = {};
    sessions.forEach(s => {
        const d = new Date(s.inicio);
        if (d.getFullYear() === state.calYear && d.getMonth() === state.calMonth) {
            const key = d.getDate();
            if (!dayData[key]) dayData[key] = { total: 0, catIds: new Set() };
            dayData[key].total += s.duracion;
            if (s.categoriaId) dayData[key].catIds.add(s.categoriaId);
        }
    });

    // Empty cells before first day
    for (let i = 0; i < startWeekday; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-cell';
        grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        cell.className = 'cal-cell';

        const isToday = today.getFullYear() === state.calYear && today.getMonth() === state.calMonth && today.getDate() === day;
        if (isToday) cell.classList.add('today');

        const data = dayData[day];
        if (data && data.total > 0) {
            cell.classList.add('has-data');
            const mins = Math.floor(data.total / 60);
            let opacity = 0.15;
            if (mins >= 30) opacity = 0.3;
            if (mins >= 120) opacity = 0.5;

            const catIds = [...data.catIds];
            if (catIds.length > 0 && catMap[catIds[0]]) {
                cell.style.background = catMap[catIds[0]].colorHex + Math.round(opacity * 255).toString(16).padStart(2, '0');
            }

            // Dots
            const dotsDiv = document.createElement('div');
            dotsDiv.className = 'cal-cell-dots';
            catIds.slice(0, 3).forEach(id => {
                const dot = document.createElement('span');
                dot.style.background = catMap[id] ? catMap[id].colorHex : '#888';
                dotsDiv.appendChild(dot);
            });
            cell.innerHTML = `<span>${day}</span>`;
            cell.appendChild(dotsDiv);
        } else {
            cell.textContent = day;
        }

        cell.addEventListener('click', () => showDayDetail(day));
        grid.appendChild(cell);
    }
}

function showDayDetail(day) {
    const sessions = loadSessions();
    const cats = loadCategories();
    const catMap = {};
    cats.forEach(c => catMap[c.id] = c);

    const daySessions = sessions.filter(s => {
        const d = new Date(s.inicio);
        return d.getFullYear() === state.calYear && d.getMonth() === state.calMonth && d.getDate() === day;
    });

    const dateStr = `${day} de ${MONTH_NAMES[state.calMonth]} ${state.calYear}`;
    $('#modal-date').textContent = dateStr;

    const total = daySessions.reduce((sum, s) => sum + s.duracion, 0);
    $('#modal-summary').innerHTML = `
        <div><span class="val">${formatDuration(total)}</span><span class="lbl">Tiempo total</span></div>
        <div><span class="val">${daySessions.length}</span><span class="lbl">Sesiones</span></div>
    `;

    const container = $('#modal-sessions');
    container.innerHTML = '';
    if (daySessions.length === 0) {
        container.innerHTML = '<div class="empty-msg">Sin sesiones este día</div>';
    } else {
        daySessions.forEach(s => {
            const cat = s.categoriaId ? catMap[s.categoriaId] : null;
            const row = document.createElement('div');
            row.className = 'session-row';
            row.style.flexWrap = 'wrap';

            let moodStr = '';
            if (s.animo != null) moodStr = `<span class="s-mood">Ánimo: ${s.animo}/10</span>`;

            let tasksStr = '';
            if (s.tareas && s.tareas.length > 0) {
                const items = s.tareas.map(t =>
                    `<li class="${t.done ? 'task-done' : 'task-pending'}">${t.text}</li>`
                ).join('');
                tasksStr = `<ul class="s-tasks">${items}</ul>`;
            }

            row.innerHTML = `
                <span class="s-dot" style="background:${cat ? cat.colorHex : '#888'}"></span>
                <span class="s-name">${cat ? cat.nombre : 'Sin categoría'}</span>
                <span class="s-info">
                    ${formatDuration(s.duracion)}
                    <span class="s-mode">${s.modo === 'pomodoro' ? 'Pomodoro' : 'Libre'}</span>
                    ${moodStr}
                </span>
                ${tasksStr}
            `;
            container.appendChild(row);
        });
    }

    $('#day-modal').classList.remove('hidden');
}

$('#modal-close').addEventListener('click', () => $('#day-modal').classList.add('hidden'));
$('#day-modal').addEventListener('click', (e) => {
    if (e.target === $('#day-modal')) $('#day-modal').classList.add('hidden');
});

// ============================================================
// STATS
// ============================================================
$$('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.statsPeriod = btn.dataset.period;
        renderStats();
    });
});

function renderStats() {
    const sessions = loadSessions();
    const cats = loadCategories();
    const catMap = {};
    cats.forEach(c => catMap[c.id] = c);

    const now = new Date();
    let start, end;

    if (state.statsPeriod === 'hoy') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(start); end.setDate(end.getDate() + 1);
    } else if (state.statsPeriod === 'semana') {
        const dayOfWeek = (now.getDay() + 6) % 7; // Monday = 0
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
        end = new Date(start); end.setDate(end.getDate() + 7);
    } else {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }

    const startMs = start.getTime();
    const endMs = end.getTime();
    const filtered = sessions.filter(s => s.inicio >= startMs && s.inicio < endMs);

    const totalSecs = filtered.reduce((sum, s) => sum + s.duracion, 0);
    $('#stat-time').textContent = formatDuration(totalSecs);
    $('#stat-sessions').textContent = filtered.length;

    // Average mood
    const withMood = filtered.filter(s => s.animo != null);
    if (withMood.length > 0) {
        const avg = withMood.reduce((sum, s) => sum + s.animo, 0) / withMood.length;
        $('#stat-mood').textContent = avg.toFixed(1);
    } else {
        $('#stat-mood').textContent = '—';
    }

    // Breakdown by category
    const breakdown = {};
    filtered.forEach(s => {
        const key = s.categoriaId || '__none';
        if (!breakdown[key]) breakdown[key] = { secs: 0, count: 0 };
        breakdown[key].secs += s.duracion;
        breakdown[key].count++;
    });

    const sorted = Object.entries(breakdown).sort((a, b) => b[1].secs - a[1].secs);
    const maxSecs = sorted.length > 0 ? sorted[0][1].secs : 1;

    const container = $('#stats-breakdown');
    container.innerHTML = '';

    if (sorted.length === 0) {
        container.innerHTML = '<div class="empty-msg">Sin datos para este periodo</div>';
        return;
    }

    sorted.forEach(([key, data]) => {
        const cat = catMap[key];
        const color = cat ? cat.colorHex : '#888';
        const name = cat ? cat.nombre : 'Sin categoría';
        const pct = (data.secs / maxSecs) * 100;

        const row = document.createElement('div');
        row.className = 'bar-row';
        row.innerHTML = `
            <div class="bar-header">
                <span class="b-dot" style="background:${color}"></span>
                <span class="b-name">${name}</span>
                <span class="b-time">${formatDuration(data.secs)}</span>
                <span class="b-count">(${data.count})</span>
            </div>
            <div class="bar-track">
                <div class="bar-fill" style="width:${pct}%;background:${color}"></div>
            </div>
        `;
        container.appendChild(row);
    });
}

// ============================================================
// EXPORT / IMPORT
// ============================================================
$('#btn-export').addEventListener('click', () => {
    const data = {
        sessions: loadSessions(),
        categories: loadCategories(),
        exportDate: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focustimer-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

$('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            if (data.sessions) {
                const existing = loadSessions();
                const existingIds = new Set(existing.map(s => s.id));
                const nuevas = data.sessions.filter(s => !existingIds.has(s.id));
                saveSessions([...existing, ...nuevas]);
            }
            if (data.categories) {
                const existing = loadCategories();
                const existingIds = new Set(existing.map(c => c.id));
                const nuevas = data.categories.filter(c => !existingIds.has(c.id));
                saveCategories([...existing, ...nuevas]);
            }
            alert(`Importados: ${data.sessions?.length || 0} sesiones`);
            renderStats();
        } catch {
            alert('Error al leer el archivo');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
});

// ============================================================
// TASK CHECKLIST
// ============================================================
$('#btn-toggle-tasks').addEventListener('click', () => {
    const row = $('#tasks-input-row');
    row.classList.toggle('hidden');
    if (!row.classList.contains('hidden')) $('#task-input').focus();
});

$('#btn-add-task').addEventListener('click', addTask);
$('#task-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
});

function addTask() {
    const input = $('#task-input');
    const text = input.value.trim();
    if (!text) return;
    state.tasks.push({ id: uid(), text, done: false });
    input.value = '';
    renderTasks();
}

function renderTasks() {
    const list = $('#task-list');
    list.innerHTML = '';
    state.tasks.forEach(task => {
        const li = document.createElement('li');
        li.className = 'task-item' + (task.done ? ' done' : '');
        li.innerHTML = `
            <button class="task-check" data-id="${task.id}">${task.done ? '✓' : ''}</button>
            <span class="task-text">${task.text}</span>
            <button class="task-delete" data-id="${task.id}">&times;</button>
        `;
        list.appendChild(li);
    });

    list.querySelectorAll('.task-check').forEach(btn => {
        btn.addEventListener('click', () => {
            const t = state.tasks.find(t => t.id === btn.dataset.id);
            if (t) { t.done = !t.done; renderTasks(); }
        });
    });
    list.querySelectorAll('.task-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            state.tasks = state.tasks.filter(t => t.id !== btn.dataset.id);
            renderTasks();
        });
    });
}

// ============================================================
// MOOD RATING
// ============================================================
function showMoodModal() {
    $$('.mood-btn').forEach(b => b.classList.remove('selected'));
    $('#mood-modal').classList.remove('hidden');
}

function saveSessionWithMood(mood) {
    if (!state.pendingSession) return;
    state.pendingSession.animo = mood;
    const sessions = loadSessions();
    sessions.push(state.pendingSession);
    saveSessions(sessions);
    state.pendingSession = null;
    state.tasks = [];
    renderTasks();
    $('#mood-modal').classList.add('hidden');
}

$$('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        saveSessionWithMood(parseInt(btn.dataset.mood));
    });
});

$('#mood-skip').addEventListener('click', () => {
    saveSessionWithMood(null);
});

// ============================================================
// INIT
// ============================================================
function init() {
    // Load first category as default
    const cats = loadCategories();
    if (cats.length > 0) {
        state.selectedCategory = cats[0];
    }
    updateTimerUI();

    // Register service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
}

init();

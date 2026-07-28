// ScraperX Frontend SPA Engine

const API_BASE = window.location.origin;
const WS_BASE = window.location.protocol === 'https:' ? `wss://${window.location.host}` : `ws://${window.location.host}`;

// State
let allJobs = [];
let currentJobId = null;
let socket = null;

let allRobots = [];
let currentRobotId = null;
let robotSocket = null;

// DOM Elements
const loginView = document.getElementById('login-view');
const workspaceView = document.getElementById('workspace-view');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('login-error');

const logoutBtn = document.getElementById('logout-btn');
const createNewJobBtn = document.getElementById('create-new-job-btn');
const jobsListContainer = document.getElementById('jobs-list-container');

// Subviews
const dashboardSubview = document.getElementById('dashboard-subview');
const jobBuilderSubview = document.getElementById('job-builder-subview');
const scrapeMonitorSubview = document.getElementById('scrape-monitor-subview');
const dataPreviewSubview = document.getElementById('data-preview-subview');

// Stats
const statTotalJobs = document.getElementById('stat-total-jobs');
const statActiveScrapes = document.getElementById('stat-active-scrapes');

// Import Config
const importConfigBtn = document.getElementById('import-config-btn');
const importFileInput = document.getElementById('import-file-input');

// Builder Elements
const builderTitle = document.getElementById('builder-title');
const builderJobId = document.getElementById('builder-job-id');
const jobNameInput = document.getElementById('job-name');
const jobDescInput = document.getElementById('job-desc');
const jobUrlInput = document.getElementById('job-url');
const urlValidationStatus = document.getElementById('url-validation-status');
const jobDelayInput = document.getElementById('job-delay');
const jobTimeoutInput = document.getElementById('job-timeout');
const jobMaxPagesInput = document.getElementById('job-max-pages');
const jobWaitConditionSelect = document.getElementById('job-wait-condition');
const jobUserAgentInput = document.getElementById('job-user-agent');
const jobPaginationTypeSelect = document.getElementById('job-pagination-type');
const paginationNextBtnGroup = document.getElementById('pagination-next-btn-group');
const paginationUrlPatternGroup = document.getElementById('pagination-url-pattern-group');
const jobNextSelectorInput = document.getElementById('job-next-selector');
const jobUrlPatternInput = document.getElementById('job-url-pattern');
const jobLoginUrlInput = document.getElementById('job-login-url');
const jobLoginUserSelectorInput = document.getElementById('job-login-user-selector');
const jobLoginUserValueInput = document.getElementById('job-login-user-value');
const jobLoginPassSelectorInput = document.getElementById('job-login-pass-selector');
const jobLoginPassValueInput = document.getElementById('job-login-pass-value');
const jobLoginSubmitSelectorInput = document.getElementById('job-login-submit-selector');
const addFieldBtn = document.getElementById('add-field-btn');
const builderFieldsContainer = document.getElementById('builder-fields-container');
const saveJobBtn = document.getElementById('save-job-btn');
const builderBackBtn = document.getElementById('builder-back-btn');

// Monitor Elements
const monitorJobName = document.getElementById('monitor-job-name');
const monitorJobDesc = document.getElementById('monitor-job-desc');
const monitorStatusBadge = document.getElementById('monitor-status-badge');
const monitorStatusText = document.getElementById('monitor-status-text');
const monitorProgressBar = document.getElementById('monitor-progress-bar');
const consoleLogsContainer = document.getElementById('console-logs-container');
const stopScrapeBtn = document.getElementById('stop-scrape-btn');
const monitorBackBtn = document.getElementById('monitor-back-btn');
const downloadExcelBtn = document.getElementById('download-excel-btn');
const showPreviewBtn = document.getElementById('show-preview-btn');
const monitorScrapedRows = document.getElementById('monitor-scraped-rows');

// Preview Elements
const previewCloseBtn = document.getElementById('preview-close-btn');
const previewDownloadExcelBtn = document.getElementById('preview-download-excel-btn');
const previewTableHead = document.getElementById('preview-table-head');
const previewTableBody = document.getElementById('preview-table-body');

// Initialize SPA
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    checkAuth();
    setupEventHandlers();
});

// Authentication handlers
function checkAuth() {
    const token = localStorage.getItem('token');
    if (token) {
        showView('workspace-view');
        loadJobs();
    } else {
        showView('login-view');
    }
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hide');

    const username = usernameInput.value;
    const password = passwordInput.value;

    try {
        const response = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('token', data.token);
            showView('workspace-view');
            loadJobs();
        } else {
            loginError.classList.remove('hide');
        }
    } catch (err) {
        loginError.innerText = "Connection error to API backend.";
        loginError.classList.remove('hide');
    }
});

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    showView('login-view');
});

// View Navigation Helpers
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
    document.getElementById(viewId).classList.add('active-view');
}

function showSubview(subviewId) {
    document.querySelectorAll('.subview').forEach(sv => sv.classList.remove('active-subview'));
    document.getElementById(subviewId).classList.add('active-subview');
}

// Event handlers registration
function setupEventHandlers() {
    // Tab switching for Scraper vs Robot
    const tabScraperBtn = document.getElementById('tab-scraper-btn');
    const tabRobotBtn = document.getElementById('tab-robot-btn');
    const sideScraperPanel = document.getElementById('side-scraper-panel');
    const sideRobotPanel = document.getElementById('side-robot-panel');
    
    tabScraperBtn.addEventListener('click', () => {
        tabScraperBtn.className = 'btn btn-sm btn-primary';
        tabRobotBtn.className = 'btn btn-sm btn-secondary';
        sideScraperPanel.classList.remove('hide');
        sideRobotPanel.classList.add('hide');
        showSubview('dashboard-subview');
    });
    
    tabRobotBtn.addEventListener('click', () => {
        tabScraperBtn.className = 'btn btn-sm btn-secondary';
        tabRobotBtn.className = 'btn btn-sm btn-primary';
        sideScraperPanel.classList.add('hide');
        sideRobotPanel.classList.remove('hide');
        showSubview('dashboard-subview');
        loadRobots();
    });
    
    // Robot actions
    const createNewRobotBtn = document.getElementById('create-new-robot-btn');
    createNewRobotBtn.addEventListener('click', () => openRobotBuilder());
    
    const robotBuilderBackBtn = document.getElementById('robot-builder-back-btn');
    robotBuilderBackBtn.addEventListener('click', () => showSubview('dashboard-subview'));
    
    const robotMonitorBackBtn = document.getElementById('robot-monitor-back-btn');
    robotMonitorBackBtn.addEventListener('click', () => showSubview('dashboard-subview'));
    
    const saveRobotBtn = document.getElementById('save-robot-btn');
    saveRobotBtn.addEventListener('click', saveRobot);
    
    const runRobotBtn = document.getElementById('run-robot-btn');
    runRobotBtn.addEventListener('click', startRobotExecution);

    // Sidebar actions
    createNewJobBtn.addEventListener('click', () => openJobBuilder());
    builderBackBtn.addEventListener('click', () => showSubview('dashboard-subview'));
    monitorBackBtn.addEventListener('click', () => showSubview('dashboard-subview'));
    previewCloseBtn.addEventListener('click', () => showSubview('scrape-monitor-subview'));

    // Dynamic Pagination Inputs trigger
    jobPaginationTypeSelect.addEventListener('change', (e) => {
        const type = e.target.value;
        paginationNextBtnGroup.classList.add('hide');
        paginationUrlPatternGroup.classList.add('hide');

        if (type === 'next_button') {
            paginationNextBtnGroup.classList.remove('hide');
        } else if (type === 'url_pattern') {
            paginationUrlPatternGroup.classList.remove('hide');
        }
    });

    // URL live validation
    jobUrlInput.addEventListener('input', () => {
        const url = jobUrlInput.value;
        const pattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
        if (pattern.test(url)) {
            urlValidationStatus.className = 'url-validation-badge valid';
            urlValidationStatus.innerHTML = '<i data-lucide="check-circle"></i>';
        } else {
            urlValidationStatus.className = 'url-validation-badge invalid';
            urlValidationStatus.innerHTML = '<i data-lucide="alert-circle"></i>';
        }
        lucide.createIcons();
    });

    // Add Field row in Builder
    addFieldBtn.addEventListener('click', () => addFieldRow());

    // Save Job Config
    saveJobBtn.addEventListener('click', saveJob);

    // Scraping actions
    stopScrapeBtn.addEventListener('click', stopScraping);
    downloadExcelBtn.addEventListener('click', () => downloadExcel(currentJobId));
    previewDownloadExcelBtn.addEventListener('click', () => downloadExcel(currentJobId));
    showPreviewBtn.addEventListener('click', () => openPreviewTable(currentJobId));

    // Import Config triggers
    importConfigBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', importConfig);
}

// Jobs CRUD & Loaders
async function loadJobs() {
    try {
        const response = await fetch(`${API_BASE}/api/jobs`);
        if (response.ok) {
            allJobs = await response.json();
            renderJobsList();
            updateDashboardStats();
        }
    } catch (err) {
        console.error("Failed to load jobs", err);
    }
}

function updateDashboardStats() {
    statTotalJobs.innerText = allJobs.length;

    // Compute running jobs if any
    let active = 0;
    allJobs.forEach(job => {
        // Just mock check if active states exist in local tracker
        if (job.status === 'running') active++;
    });
    statActiveScrapes.innerText = active;
}

function renderJobsList() {
    jobsListContainer.innerHTML = '';
    if (allJobs.length === 0) {
        jobsListContainer.innerHTML = '<div class="no-jobs-text">No scraping jobs yet. Create one!</div>';
        return;
    }

    allJobs.forEach(job => {
        const item = document.createElement('div');
        item.className = 'job-item';
        item.dataset.id = job.id;

        item.innerHTML = `
            <div class="job-item-info">
                <span class="job-item-name">${escapeHTML(job.name)}</span>
                <span class="job-item-url">${escapeHTML(job.url)}</span>
            </div>
            <div class="job-item-actions">
                <button class="job-item-btn play-btn" title="Run Scraping">
                    <i data-lucide="play"></i>
                </button>
                <button class="job-item-btn duplicate-btn" title="Duplicate Job">
                    <i data-lucide="copy"></i>
                </button>
                <button class="job-item-btn delete-btn" title="Delete Job">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;

        // Event Listeners for actions
        item.querySelector('.play-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            startScrapeFlow(job.id, false);
        });


        item.querySelector('.duplicate-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            duplicateJob(job);
        });

        item.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteJob(job.id);
        });

        item.addEventListener('click', () => {
            document.querySelectorAll('.job-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            openJobBuilder(job);
        });

        jobsListContainer.appendChild(item);
    });
    lucide.createIcons();
}

// Job Builder operations
function openJobBuilder(job = null) {
    showSubview('job-builder-subview');
    builderFieldsContainer.innerHTML = '';

    if (job) {
        builderTitle.innerText = "Edit Scrape Job";
        builderJobId.value = job.id;
        jobNameInput.value = job.name || '';
        jobDescInput.value = job.description || '';
        jobUrlInput.value = job.url || '';
        jobDelayInput.value = job.delay ?? 1000;
        jobTimeoutInput.value = job.timeout ?? 30000;
        jobMaxPagesInput.value = job.max_pages ?? 5;
        jobWaitConditionSelect.value = job.wait_condition || 'domcontentloaded';
        jobUserAgentInput.value = job.user_agent || '';
        jobPaginationTypeSelect.value = job.pagination_type || 'none';
        jobNextSelectorInput.value = job.next_button_selector || '';
        jobUrlPatternInput.value = job.url_pattern || '';
        jobLoginUrlInput.value = job.login_url || '';
        jobLoginUserSelectorInput.value = job.login_username_selector || '';
        jobLoginUserValueInput.value = job.login_username_value || '';
        jobLoginPassSelectorInput.value = job.login_password_selector || '';
        jobLoginPassValueInput.value = job.login_password_value || '';
        jobLoginSubmitSelectorInput.value = job.login_submit_selector || '';

        // Trigger select change logic manually
        jobPaginationTypeSelect.dispatchEvent(new Event('change'));

        if (job.fields && job.fields.length > 0) {
            job.fields.forEach(f => addFieldRow(f));
        } else {
            addFieldRow();
        }
    } else {
        builderTitle.innerText = "Create Scrape Job";
        builderJobId.value = "";
        jobNameInput.value = "";
        jobDescInput.value = "";
        jobUrlInput.value = "";
        jobDelayInput.value = 1000;
        jobTimeoutInput.value = 30000;
        jobMaxPagesInput.value = 5;
        jobWaitConditionSelect.value = 'domcontentloaded';
        jobUserAgentInput.value = '';
        jobPaginationTypeSelect.value = 'none';
        jobNextSelectorInput.value = '';
        jobUrlPatternInput.value = '';
        jobLoginUrlInput.value = '';
        jobLoginUserSelectorInput.value = '';
        jobLoginUserValueInput.value = '';
        jobLoginPassSelectorInput.value = '';
        jobLoginPassValueInput.value = '';
        jobLoginSubmitSelectorInput.value = '';

        jobPaginationTypeSelect.dispatchEvent(new Event('change'));
        addFieldRow();
    }
    jobUrlInput.dispatchEvent(new Event('input'));
}

function addFieldRow(field = null) {
    const row = document.createElement('div');
    row.className = 'field-config-row';

    const isAttr = field && field.extract_target === 'attribute';

    row.innerHTML = `
        <input type="text" class="field-name" placeholder="Column Name" value="${field ? escapeHTML(field.name) : ''}">
        <select class="field-type">
            <option value="css" ${field && field.selector_type === 'css' ? 'selected' : ''}>CSS</option>
            <option value="xpath" ${field && field.selector_type === 'xpath' ? 'selected' : ''}>XPath</option>
        </select>
        <input type="text" class="field-selector" placeholder="Selector" value="${field ? escapeHTML(field.selector) : ''}">
        <select class="field-target">
            <option value="text" ${!isAttr ? 'selected' : ''}>Text</option>
            <option value="attribute" ${isAttr ? 'selected' : ''}>Attr</option>
        </select>
        <input type="text" class="field-attr-name" placeholder="Attribute (e.g. title)" value="${field && field.attribute_name ? escapeHTML(field.attribute_name) : ''}" style="${isAttr ? '' : 'display: none;'}">
        <div class="checkbox-label-wrapper">
            <input type="checkbox" class="field-list" ${field && field.is_list ? 'checked' : ''}>
            <label>List?</label>
        </div>
        <button class="field-delete-btn" title="Remove Field">
            <i data-lucide="trash-2"></i>
        </button>
    `;

    const targetSelect = row.querySelector('.field-target');
    const attrInput = row.querySelector('.field-attr-name');

    targetSelect.addEventListener('change', (e) => {
        if (e.target.value === 'attribute') {
            attrInput.style.display = '';
        } else {
            attrInput.style.display = 'none';
            attrInput.value = '';
        }
    });

    row.querySelector('.field-delete-btn').addEventListener('click', () => {
        row.remove();
    });

    builderFieldsContainer.appendChild(row);
    lucide.createIcons();
}

async function saveJob() {
    const id = builderJobId.value || null;
    const name = jobNameInput.value;
    const url = jobUrlInput.value;

    if (!name || !url) {
        alert("Job Name and Target URL are required!");
        return;
    }

    // Gather fields
    const fields = [];
    let validFields = true;
    builderFieldsContainer.querySelectorAll('.field-config-row').forEach(row => {
        const fieldName = row.querySelector('.field-name').value;
        const selector = row.querySelector('.field-selector').value;
        const selectorType = row.querySelector('.field-type').value;
        const isList = row.querySelector('.field-list').checked;
        const extractTarget = row.querySelector('.field-target').value;
        const attributeName = row.querySelector('.field-attr-name').value;

        if (fieldName && selector) {
            fields.push({
                name: fieldName,
                selector: selector,
                selector_type: selectorType,
                is_list: isList,
                extract_target: extractTarget,
                attribute_name: attributeName
            });
        } else {
            validFields = false;
        }
    });

    if (!validFields || fields.length === 0) {
        alert("Please specify at least one field with Name and Selector value!");
        return;
    }

    const payload = {
        name,
        description: jobDescInput.value,
        url,
        fields,
        delay: parseInt(jobDelayInput.value) || 0,
        timeout: parseInt(jobTimeoutInput.value) || 30000,
        max_pages: parseInt(jobMaxPagesInput.value) || 5,
        wait_condition: jobWaitConditionSelect.value,
        user_agent: jobUserAgentInput.value,
        pagination_type: jobPaginationTypeSelect.value,
        next_button_selector: jobNextSelectorInput.value,
        url_pattern: jobUrlPatternInput.value,
        login_url: jobLoginUrlInput.value,
        login_username_selector: jobLoginUserSelectorInput.value,
        login_username_value: jobLoginUserValueInput.value,
        login_password_selector: jobLoginPassSelectorInput.value,
        login_password_value: jobLoginPassValueInput.value,
        login_submit_selector: jobLoginSubmitSelectorInput.value
    };

    if (id) {
        payload.id = id;
    }

    const method = id ? 'PUT' : 'POST';
    const endpoint = id ? `${API_BASE}/api/jobs/${id}` : `${API_BASE}/api/jobs`;

    try {
        const response = await fetch(endpoint, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            loadJobs();
            showSubview('dashboard-subview');
        } else {
            const err = await response.json();
            alert(`Error: ${err.detail || 'Failed to save job'}`);
        }
    } catch (e) {
        alert("Connection to backend server failed.");
    }
}

async function deleteJob(jobId) {
    if (!confirm("Are you sure you want to delete this scrape job configuration?")) return;

    try {
        const response = await fetch(`${API_BASE}/api/jobs/${jobId}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            loadJobs();
        }
    } catch (e) {
        console.error("Delete failed", e);
    }
}

async function duplicateJob(job) {
    const dup = { ...job };
    dup.name = `${job.name} (Copy)`;

    try {
        const response = await fetch(`${API_BASE}/api/jobs/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dup)
        });
        if (response.ok) {
            loadJobs();
        }
    } catch (e) {
        console.error("Duplicate failed", e);
    }
}

// Config JSON Import
async function importConfig(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const jobData = JSON.parse(event.target.result);
            // Quick schema validation
            if (!jobData.name || !jobData.url || !jobData.fields) {
                alert("Invalid configuration JSON structure.");
                return;
            }

            const response = await fetch(`${API_BASE}/api/jobs/import`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(jobData)
            });

            if (response.ok) {
                loadJobs();
                alert("Job configuration imported successfully!");
            }
        } catch (err) {
            alert("Error parsing JSON file.");
        }
    };
    reader.readAsText(file);
    // Reset file input value
    importFileInput.value = '';
}

// Scraping Console WebSocket Monitor
function startScrapeFlow(jobId, preview = false) {
    currentJobId = jobId;
    const job = allJobs.find(j => j.id === jobId);

    monitorJobName.innerText = preview ? `Preview: ${job.name}` : job.name;
    monitorJobDesc.innerText = job.description || 'No description provided.';
    monitorProgressBar.style.width = '0%';

    monitorStatusBadge.className = 'status-badge running';
    monitorStatusText.innerText = 'Initializing...';

    consoleLogsContainer.innerHTML = '<div class="console-line system-msg">Connecting to Playwright stream...</div>';

    // Disable download / preview until finished
    downloadExcelBtn.disabled = true;
    showPreviewBtn.disabled = true;
    stopScrapeBtn.disabled = false;

    showSubview('scrape-monitor-subview');

    // Connect WebSocket first
    connectWebSocket(jobId);

    // Trigger Scrape/Preview API call
    const runEndpoint = preview ? `${API_BASE}/api/jobs/${jobId}/preview` : `${API_BASE}/api/jobs/${jobId}/scrape`;

    fetch(runEndpoint, { method: 'POST' })
        .then(res => {
            if (!res.ok) {
                appendLog("Failed to initiate scraping process on backend.", "error-msg");
            }
        })
        .catch(err => {
            appendLog("Backend connection error when starting job.", "error-msg");
        });
}

function connectWebSocket(jobId) {
    if (socket) {
        socket.close();
    }

    socket = new WebSocket(`${WS_BASE}/ws/logs/${jobId}`);

    socket.onopen = () => {
        appendLog("WebSocket connection established.", "system-msg");
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'init') {
            updateStatusUI(data.status);
            consoleLogsContainer.innerHTML = '';
            data.logs.forEach(log => appendLog(log));
        } else if (data.type === 'log') {
            appendLog(data.message);
        } else if (data.type === 'status') {
            updateStatusUI(data.status);
        }
    };

    socket.onclose = () => {
        appendLog("WebSocket disconnected.", "system-msg");
    };

    socket.onerror = () => {
        appendLog("WebSocket error encountered.", "error-msg");
    };
}

function appendLog(message, className = "") {
    const div = document.createElement('div');
    div.className = `console-line ${className}`;
    div.innerText = message;
    consoleLogsContainer.appendChild(div);
    consoleLogsContainer.scrollTop = consoleLogsContainer.scrollHeight;
}

function updateStatusUI(status) {
    monitorStatusBadge.className = `status-badge ${status}`;

    if (status === 'pending') {
        monitorStatusText.innerText = 'Pending';
        monitorProgressBar.style.width = '10%';
    } else if (status === 'running') {
        monitorStatusText.innerText = 'Scraping';
        monitorProgressBar.style.width = '50%';
    } else if (status === 'done') {
        monitorStatusText.innerText = 'Completed';
        monitorProgressBar.style.width = '100%';
        stopScrapeBtn.disabled = true;
        downloadExcelBtn.disabled = false;
        showPreviewBtn.disabled = false;

        // Load count of scraped items
        fetchScrapedResultsCount();
        appendLog("Extraction done! Excel workbook generated successfully in-memory.", "success-msg");
    } else if (status === 'error') {
        monitorStatusText.innerText = 'Failed';
        monitorProgressBar.style.width = '100%';
        stopScrapeBtn.disabled = true;
        appendLog("Process halted due to failure or user stop command.", "error-msg");
    }
}

async function fetchScrapedResultsCount() {
    try {
        const response = await fetch(`${API_BASE}/api/jobs/${currentJobId}/state`);
        if (response.ok) {
            const state = await response.json();
            monitorScrapedRows.innerText = state.data ? state.data.length : 0;
        }
    } catch (e) {
        console.error(e);
    }
}

function stopScraping() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ command: 'stop' }));
        appendLog("Stop signal sent to Playwright process...", "system-msg");
    }
}

// Preview Data & Excel Download
async function openPreviewTable(jobId) {
    showSubview('data-preview-subview');
    previewTableHead.innerHTML = '';
    previewTableBody.innerHTML = '';

    try {
        const response = await fetch(`${API_BASE}/api/jobs/${jobId}/state`);
        if (response.ok) {
            const state = await response.json();
            const data = state.data || [];

            if (data.length === 0) {
                previewTableBody.innerHTML = '<tr><td colspan="100%" class="text-center">No records extracted.</td></tr>';
                return;
            }

            // Render Headers
            const headers = Object.keys(data[0]);
            const headerRow = document.createElement('tr');
            headers.forEach(h => {
                const th = document.createElement('th');
                th.innerText = h;
                headerRow.appendChild(th);
            });
            previewTableHead.appendChild(headerRow);

            // Render Rows
            data.forEach(row => {
                const tr = document.createElement('tr');
                headers.forEach(h => {
                    const td = document.createElement('td');
                    td.innerText = row[h] ?? '';
                    td.title = row[h] ?? '';
                    tr.appendChild(td);
                });
                previewTableBody.appendChild(tr);
            });
        }
    } catch (e) {
        console.error("Preview failed", e);
    }
}

function downloadExcel(jobId) {
    window.location.href = `${API_BASE}/api/jobs/${jobId}/download`;
}

// Helpers
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// --- SELENIUM ROBOT MODULE FUNCTIONS ---
async function loadRobots() {
    try {
        const response = await fetch(`${API_BASE}/api/robots`);
        if (response.ok) {
            allRobots = await response.json();
            renderRobotsList();
        }
    } catch (err) {
        console.error("Failed to load robots", err);
    }
}

function renderRobotsList() {
    const robotsListContainer = document.getElementById('robots-list-container');
    robotsListContainer.innerHTML = '';
    
    if (allRobots.length === 0) {
        robotsListContainer.innerHTML = '<div class="no-jobs-text">No robots configured yet.</div>';
        return;
    }
    
    allRobots.forEach(robot => {
        const item = document.createElement('div');
        item.className = 'job-item';
        item.dataset.id = robot.id;
        
        item.innerHTML = `
            <div class="job-item-info">
                <span class="job-item-name" style="color: var(--purple); font-weight: 600;">${escapeHTML(robot.name)}</span>
                <span class="job-item-url">${escapeHTML(robot.description || 'Selenium Robot Script')}</span>
            </div>
            <div class="job-item-actions">
                <button class="job-item-btn play-robot-btn" title="Run Robot">
                    <i data-lucide="play"></i>
                </button>
                <button class="job-item-btn edit-robot-btn" title="Edit Robot">
                    <i data-lucide="edit"></i>
                </button>
                <button class="job-item-btn delete-robot-btn" title="Delete Robot">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
        
        item.querySelector('.play-robot-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            startRobotMonitorFlow(robot.id);
        });
        
        item.querySelector('.edit-robot-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openRobotBuilder(robot);
        });
        
        item.querySelector('.delete-robot-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteRobot(robot.id);
        });
        
        item.addEventListener('click', () => {
            document.querySelectorAll('.job-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            openRobotBuilder(robot);
        });
        
        robotsListContainer.appendChild(item);
    });
    lucide.createIcons();
}

const DEFAULT_SELENIUM_SCRIPT = `# Selenium Robot template using Headless Chrome
import time
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager

print("Initializing Chrome Webdriver...")

chrome_options = Options()
chrome_options.add_argument("--headless")
chrome_options.add_argument("--no-sandbox")
chrome_options.add_argument("--disable-dev-shm-usage")

# Auto-downloads ChromeDriver
service = Service(ChromeDriverManager().install())
driver = webdriver.Chrome(service=service, options=chrome_options)

try:
    print("Navigating to target site...")
    driver.get("https://example.com")
    time.sleep(2)
    
    print(f"Page title retrieved: {driver.title}")
    
    print("Robot process finished successfully.")
finally:
    driver.quit()
`;

function openRobotBuilder(robot = null) {
    showSubview('robot-builder-subview');
    
    const robotBuilderTitle = document.getElementById('robot-builder-title');
    const builderRobotId = document.getElementById('builder-robot-id');
    const robotNameInput = document.getElementById('robot-name');
    const robotDescInput = document.getElementById('robot-desc');
    const robotScriptCodeInput = document.getElementById('robot-script-code');
    
    if (robot) {
        robotBuilderTitle.innerText = "Edit Selenium Robot";
        builderRobotId.value = robot.id;
        robotNameInput.value = robot.name || '';
        robotDescInput.value = robot.description || '';
        robotScriptCodeInput.value = robot.script_code || '';
    } else {
        robotBuilderTitle.innerText = "Create Selenium Robot";
        builderRobotId.value = "";
        robotNameInput.value = "";
        robotDescInput.value = "";
        robotScriptCodeInput.value = DEFAULT_SELENIUM_SCRIPT;
    }
}

async function saveRobot() {
    const builderRobotId = document.getElementById('builder-robot-id');
    const id = builderRobotId.value || null;
    const name = document.getElementById('robot-name').value;
    const description = document.getElementById('robot-desc').value;
    const script_code = document.getElementById('robot-script-code').value;
    
    if (!name || !script_code) {
        alert("Robot Name and Script Code are required!");
        return;
    }
    
    const payload = {
        name,
        description,
        script_code
    };
    
    if (id) {
        payload.id = id;
    }
    
    const method = id ? 'PUT' : 'POST';
    const endpoint = id ? `${API_BASE}/api/robots/${id}` : `${API_BASE}/api/robots`;
    
    try {
        const response = await fetch(endpoint, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            loadRobots();
            showSubview('dashboard-subview');
        } else {
            const err = await response.json();
            alert(`Error: ${err.detail || 'Failed to save robot'}`);
        }
    } catch (e) {
        alert("Connection to backend server failed.");
    }
}

async function deleteRobot(robotId) {
    if (!confirm("Are you sure you want to delete this Selenium Robot script?")) return;
    try {
        const response = await fetch(`${API_BASE}/api/robots/${robotId}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            loadRobots();
        }
    } catch (e) {
        console.error("Delete failed", e);
    }
}

function startRobotMonitorFlow(robotId) {
    currentRobotId = robotId;
    const robot = allRobots.find(r => r.id === robotId);
    
    document.getElementById('monitor-robot-name').innerText = robot.name;
    document.getElementById('monitor-robot-desc').innerText = robot.description || 'Custom Selenium Script';
    document.getElementById('robot-progress-bar').style.width = '0%';
    
    const statusBadge = document.getElementById('robot-status-badge');
    statusBadge.className = 'status-badge running';
    document.getElementById('robot-status-text').innerText = 'Initializing...';
    
    const logsContainer = document.getElementById('robot-console-logs-container');
    logsContainer.innerHTML = '<div class="console-line system-msg">Connecting to Selenium stdout stream...</div>';
    
    showSubview('robot-monitor-subview');
    connectRobotWebSocket(robotId);
}

function connectRobotWebSocket(robotId) {
    if (robotSocket) {
        robotSocket.close();
    }
    
    robotSocket = new WebSocket(`${WS_BASE}/ws/robots/logs/${robotId}`);
    
    robotSocket.onopen = () => {
        appendRobotLog("WebSocket connection established.", "system-msg");
    };
    
    robotSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'init') {
            updateRobotStatusUI(data.status);
            document.getElementById('robot-console-logs-container').innerHTML = '';
            data.logs.forEach(log => appendRobotLog(log));
        } else if (data.type === 'log') {
            appendRobotLog(data.message);
        } else if (data.type === 'status') {
            updateRobotStatusUI(data.status);
        }
    };
    
    robotSocket.onclose = () => {
        appendRobotLog("WebSocket disconnected.", "system-msg");
    };
}

function appendRobotLog(message, className = "") {
    const container = document.getElementById('robot-console-logs-container');
    const div = document.createElement('div');
    div.className = `console-line ${className}`;
    div.innerText = message;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function updateRobotStatusUI(status) {
    const statusBadge = document.getElementById('robot-status-badge');
    const statusText = document.getElementById('robot-status-text');
    const progressBar = document.getElementById('robot-progress-bar');
    
    statusBadge.className = `status-badge ${status}`;
    
    if (status === 'pending') {
        statusText.innerText = 'Pending';
        progressBar.style.width = '10%';
    } else if (status === 'running') {
        statusText.innerText = 'Running';
        progressBar.style.width = '50%';
    } else if (status === 'done') {
        statusText.innerText = 'Completed';
        progressBar.style.width = '100%';
        appendRobotLog("Selenium Robot process completed successfully.", "success-msg");
    } else if (status === 'error') {
        statusText.innerText = 'Failed';
        progressBar.style.width = '100%';
        appendRobotLog("Process terminated with error.", "error-msg");
    }
}

function startRobotExecution() {
    if (!currentRobotId) return;
    
    const logsContainer = document.getElementById('robot-console-logs-container');
    logsContainer.innerHTML = '<div class="console-line system-msg">Spawning Selenium background process...</div>';
    
    fetch(`${API_BASE}/api/robots/${currentRobotId}/run`, { method: 'POST' })
        .then(res => {
            if (!res.ok) {
                appendRobotLog("Failed to start Selenium Robot execution on backend.", "error-msg");
            }
        })
        .catch(err => {
            appendRobotLog("Backend connection error when starting robot.", "error-msg");
        });
}

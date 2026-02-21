let token = localStorage.getItem('token');
let currentUser = localStorage.getItem('username');
let userRole = localStorage.getItem('role');
let currentPath = '';
let selectedFiles = new Set();
let allFiles = [];
let currentPreviewIndex = -1;

// Network folder navigation state
let currentNetworkFolderId = null;
let currentNetworkSubfolder = '';

// Network selection state
let selectedNetworkItems = new Set();
let allNetworkItems = [];

// Pinned folders + favorites (server-synced)
let pinnedFolders = [];
let userFavorites = new Set(); // set of file paths

/* ========================
   UPLOAD QUEUE + CANCEL
   ======================== */
const uploadQueue = {
    total: 0,
    done: 0,
    active: '',
    cancelled: false,
    activeUploadId: null,
    currentAbortController: null
};

function uploadProgressShow() {
    document.getElementById('uploadProgress').style.display = 'flex';
    document.getElementById('uploadCancelBtn').style.display = 'inline-flex';
    uploadQueue.cancelled = false;
}

function uploadProgressHide() {
    document.getElementById('uploadProgress').style.display = 'none';
    document.getElementById('uploadCancelBtn').style.display = 'none';
    uploadQueue.total = 0;
    uploadQueue.done  = 0;
    uploadQueue.active = '';
    uploadQueue.cancelled = false;
    uploadQueue.activeUploadId = null;
    uploadQueue.currentAbortController = null;
}

function cancelUpload() {
    uploadQueue.cancelled = true;
    // Abort current XHR/fetch if possible
    if (uploadQueue.currentAbortController) {
        uploadQueue.currentAbortController.abort();
    }
    // Cancel on server
    if (uploadQueue.activeUploadId) {
        fetch('/api/upload/chunk/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ upload_id: uploadQueue.activeUploadId })
        }).catch(() => {});
    }
    showToast('Upload cancelled', 'error');
    uploadProgressHide();
}

function uploadProgressUpdate(filename, chunkPct) {
    const remaining = uploadQueue.total - uploadQueue.done;
    document.getElementById('uploadProgressName').textContent = filename;
    document.getElementById('uploadProgressCount').textContent =
        remaining + ' file' + (remaining !== 1 ? 's' : '') + ' left';
    document.getElementById('uploadProgressBar').style.width = chunkPct + '%';
}

// Theme management
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const sunSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    const moonSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    const icon = theme === 'dark' ? sunSvg : moonSvg;
    const title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) { themeToggle.innerHTML = icon; themeToggle.title = title; }
    // Also update auth page icon
    const authIcon = document.getElementById('authThemeIcon')?.parentElement;
    if (authIcon) { authIcon.innerHTML = icon; authIcon.title = title; }
}

// Sidebar toggle
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('show');
}

// Initialize theme on page load
initTheme();

if (token) showMainPanel();

/* =======================
   PINNED FOLDERS (server-synced)
   ======================= */
async function loadPinnedFolders() {
    try {
        const res = await fetch('/api/pinned', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) return;
        const data = await safeJson(res);
        pinnedFolders = data.pinned || [];
        renderPinnedFolders();
    } catch (e) { /* silently ignore */ }
}

async function addPinnedFolder() {
    if (!currentPath) {
        showToast('Navigate to a folder first', 'error');
        return;
    }
    try {
        const res = await fetch('/api/pinned', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ path: currentPath, name: currentPath.split('/').pop() || 'Root' })
        });
        const data = await safeJson(res);
        if (res.status === 409) { showToast('Already pinned', 'error'); return; }
        if (!res.ok) throw new Error(data.msg);
        pinnedFolders = data.pinned;
        renderPinnedFolders();
        showToast('Folder pinned', 'success');
    } catch (e) { showToast(e.message, 'error'); }
}

async function unpinFolder(path) {
    try {
        const res = await fetch('/api/pinned', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ path })
        });
        const data = await safeJson(res);
        pinnedFolders = data.pinned;
        renderPinnedFolders();
    } catch (e) { /* ignore */ }
}

function renderPinnedFolders() {
    const container = document.getElementById('pinnedFolders');
    const section = document.getElementById('pinnedSection');
    if (!container) return;
    if (pinnedFolders.length === 0) {
        container.innerHTML = '';
        if (section) section.style.display = 'none';
        return;
    }
    if (section) section.style.display = 'block';
    container.innerHTML = pinnedFolders.map(folder => `
        <div class="pinned-folder-item" onclick="loadFiles('${escapeHtml(folder.path)}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(folder.name)}</span>
            <button class="unpin-btn" onclick="unpinFolder('${escapeHtml(folder.path)}'); event.stopPropagation();" title="Unpin">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `).join('');
}

/* =======================
   FAVORITES (server-synced)
   ======================= */
async function loadFavorites() {
    try {
        const res = await fetch('/api/favorites', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) return;
        const data = await safeJson(res);
        userFavorites = new Set((data.favorites || []).map(f => f.path));
    } catch (e) { /* ignore */ }
}

async function toggleFavorite(filePath, fileName, event) {
    if (event) event.stopPropagation();
    const isFav = userFavorites.has(filePath);
    try {
        const res = await fetch('/api/favorites', {
            method: isFav ? 'DELETE' : 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ path: filePath, name: fileName })
        });
        if (!res.ok && res.status !== 409) return;
        const data = await safeJson(res);
        userFavorites = new Set((data.favorites || []).map(f => f.path));
        // Update star in UI without full reload
        const btn = document.querySelector(`.fav-btn[data-path="${CSS.escape(filePath)}"]`);
        if (btn) btn.innerHTML = getFavStar(filePath);
    } catch (e) { /* ignore */ }
}

function getFavStar(filePath) {
    const on = userFavorites.has(filePath);
    return on
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="#f9ab00" stroke="#f9ab00" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
}

/* =======================
   NETWORK MULTI-SELECT
   ======================= */
function toggleNetworkItemSelection(itemId) {
    if (selectedNetworkItems.has(itemId)) {
        selectedNetworkItems.delete(itemId);
    } else {
        selectedNetworkItems.add(itemId);
    }
    updateNetworkListUI();
    updateNetworkBulkActionsBar();
}

function clearNetworkSelection() {
    selectedNetworkItems.clear();
    updateNetworkListUI();
    updateNetworkBulkActionsBar();
}

function updateNetworkBulkActionsBar() {
    const bar = document.getElementById('networkBulkActionsBar');
    const count = document.getElementById('networkSelectedCount');
    if (selectedNetworkItems.size > 0) {
        bar.style.display = 'flex';
        count.textContent = selectedNetworkItems.size;
    } else {
        bar.style.display = 'none';
    }
}

function updateNetworkListUI() {
    document.querySelectorAll('.network-checkbox').forEach(checkbox => {
        const itemId = checkbox.dataset.itemid;
        checkbox.checked = selectedNetworkItems.has(itemId);
        const listItem = checkbox.closest('.list-item');
        if (selectedNetworkItems.has(itemId)) {
            listItem.classList.add('selected');
        } else {
            listItem.classList.remove('selected');
        }
    });
}

async function bulkDownloadNetwork() {
    if (selectedNetworkItems.size === 0) return;
    for (const itemId of selectedNetworkItems) {
        const item = allNetworkItems.find(i => i.id === itemId);
        if (item) {
            downloadNetworkFile(itemId);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    showToast(`Downloading ${selectedNetworkItems.size} file(s)`, 'success');
}

/* =======================
   SAFE JSON PARSER
   ======================= */
async function safeJson(res) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        console.error('Non-JSON response:', text);
        throw new Error('Server returned HTML instead of JSON');
    }
}

/* =======================
   UI HELPERS
   ======================= */
function showMessage(msg, type, container = 'alert') {
    const el = document.getElementById(container);
    if (!el) { showToast(msg, type); return; }
    el.textContent = msg;
    el.className = 'alert alert-' + type + ' show';
    setTimeout(() => el.classList.remove('show'), 4000);
}

// Non-layout-shifting toast notification
function showToast(msg, type = 'success') {
    let toast = document.getElementById('globalToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'globalToast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = 'global-toast toast-' + type + ' show';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 3500);
}

function showLogin() {
    document.getElementById('loginView').style.display = 'block';
    document.getElementById('registerView').style.display = 'none';
}

function showRegister() {
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('registerView').style.display = 'block';
}

function togglePassword(inputId, buttonId) {
    const input = document.getElementById(inputId);
    const button = typeof buttonId === 'string' ? document.getElementById(buttonId) : buttonId;
    if (input.type === 'password') {
        input.type = 'text';
        button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
        button.title = 'Hide password';
    } else {
        input.type = 'password';
        button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        button.title = 'Show password';
    }
}

function showTab(tabName) {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const navItem = Array.from(document.querySelectorAll('.nav-item')).find(item =>
        item.getAttribute('onclick')?.includes(`showTab('${tabName}')`)
    );
    if (navItem) navItem.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(tabName + 'Content').classList.add('active');

    if (tabName === 'files') {
        loadFiles();
    } else if (tabName === 'users') {
        loadUsers();
    } else if (tabName === 'pending') {
        loadPendingUsers();
    } else if (tabName === 'shares') {
        loadPendingShares();
    } else if (tabName === 'network') {
        currentNetworkFolderId = null;
        currentNetworkSubfolder = '';
        selectedNetworkItems.clear();
        loadNetworkFiles();
    }
}

function updateMobileNav(tab) {
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('mobile' + tab.charAt(0).toUpperCase() + tab.slice(1) + 'Btn');
    if (btn) btn.classList.add('active');
}

function showMobileUploadMenu() {
    const existing = document.getElementById('mobileUploadSheet');
    if (existing) { existing.remove(); return; }
    
    const sheet = document.createElement('div');
    sheet.id = 'mobileUploadSheet';
    sheet.className = 'mobile-upload-sheet';
    sheet.innerHTML = `
        <div class="mobile-sheet-backdrop" onclick="document.getElementById('mobileUploadSheet').remove()"></div>
        <div class="mobile-sheet-panel">
            <div class="mobile-sheet-handle"></div>
            <div class="mobile-sheet-title">Add files</div>
            <button class="mobile-sheet-item" onclick="document.getElementById('fileInput').click(); document.getElementById('mobileUploadSheet').remove()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <div>
                    <div class="mobile-sheet-item-title">Upload Files</div>
                    <div class="mobile-sheet-item-sub">Photos, videos, documents</div>
                </div>
            </button>
            <button class="mobile-sheet-item" onclick="document.getElementById('folderInput').click(); document.getElementById('mobileUploadSheet').remove()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                <div>
                    <div class="mobile-sheet-item-title">Upload Folder</div>
                    <div class="mobile-sheet-item-sub">Upload an entire folder</div>
                </div>
            </button>
            <button class="mobile-sheet-item" onclick="createFolder(); document.getElementById('mobileUploadSheet').remove()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                <div>
                    <div class="mobile-sheet-item-title">New Folder</div>
                    <div class="mobile-sheet-item-sub">Create an empty folder here</div>
                </div>
            </button>
            <button class="mobile-sheet-item" onclick="createTextFile(); document.getElementById('mobileUploadSheet').remove()">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                <div>
                    <div class="mobile-sheet-item-title">New Text File</div>
                    <div class="mobile-sheet-item-sub">Create and edit a text file</div>
                </div>
            </button>
        </div>
    `;
    document.body.appendChild(sheet);
    // Animate in
    requestAnimationFrame(() => sheet.classList.add('open'));
}

/* =======================
   SETTINGS MODAL
   ======================= */
let userPrefs = (() => {
    try { return JSON.parse(localStorage.getItem('userPrefs') || '{}'); } catch { return {}; }
})();

function savePref(key, value) {
    userPrefs[key] = value;
    localStorage.setItem('userPrefs', JSON.stringify(userPrefs));
}

function openSettings() {
    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.id = 'settingsModal';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    const editorDefault = userPrefs.editorDefault !== false;

    modal.innerHTML = `
        <div class="settings-content">
            <div class="settings-header">
                <h2 class="settings-title">Settings</h2>
                <button class="settings-close" onclick="document.getElementById('settingsModal').remove()">×</button>
            </div>
            <div class="settings-body">
                <div id="settingsAlert" class="alert"></div>

                <div class="settings-section">
                    <h3 class="settings-section-title">Preferences</h3>
                    <div class="settings-pref-row">
                        <div>
                            <div class="settings-pref-label">Open text files in editor by default</div>
                            <div class="settings-pref-sub">Click on .txt / .md / etc → opens editor instead of preview</div>
                        </div>
                        <label class="settings-toggle">
                            <input type="checkbox" id="prefEditorDefault" ${editorDefault ? 'checked' : ''}
                                   onchange="savePref('editorDefault', this.checked)">
                            <span class="settings-toggle-slider"></span>
                        </label>
                    </div>
                </div>

                <div class="settings-section">
                    <h3 class="settings-section-title">Change Password</h3>
                    <div class="form-group">
                        <label>Current Password</label>
                        <div class="password-input">
                            <input type="password" id="currentPassword" placeholder="Enter current password">
                            <button type="button" class="password-toggle" onclick="togglePassword('currentPassword', this)">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>New Password</label>
                        <div class="password-input">
                            <input type="password" id="newPassInSettings" placeholder="Enter new password (min 6 characters)">
                            <button type="button" class="password-toggle" onclick="togglePassword('newPassInSettings', this)">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Confirm New Password</label>
                        <div class="password-input">
                            <input type="password" id="confirmNewPassword" placeholder="Confirm new password">
                            <button type="button" class="password-toggle" onclick="togglePassword('confirmNewPassword', this)">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="changePassword()">Update Password</button>
                </div>
                <div class="settings-section">
                    <h3 class="settings-section-title">Change Username</h3>
                    <div class="form-group">
                        <label>New Username</label>
                        <input type="text" id="newUsernameSettings" placeholder="Enter new username (3-32 characters)">
                        <small class="form-help">Only letters, numbers, and underscores</small>
                    </div>
                    <div class="form-group">
                        <label>Confirm Password</label>
                        <div class="password-input">
                            <input type="password" id="confirmPasswordUsername" placeholder="Enter your password to confirm">
                            <button type="button" class="password-toggle" onclick="togglePassword('confirmPasswordUsername', this)">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="changeUsername()">Update Username</button>
                </div>
                <div class="settings-section">
                    <h3 class="settings-section-title">Account Information</h3>
                    <p style="color: var(--text-secondary); margin-bottom: 8px;"><strong>Username:</strong> ${currentUser}</p>
                    <p style="color: var(--text-secondary);"><strong>Role:</strong> ${userRole}</p>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

async function changePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassInSettings').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
        showMessage('Please fill in all fields', 'error', 'settingsAlert');
        return;
    }
    if (newPassword !== confirmNewPassword) {
        showMessage('New passwords do not match', 'error', 'settingsAlert');
        return;
    }
    if (newPassword.length < 6) {
        showMessage('New password must be at least 6 characters', 'error', 'settingsAlert');
        return;
    }
    try {
        const res = await fetch('/api/account/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to change password');
        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'settingsAlert');
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassInSettings').value = '';
        document.getElementById('confirmNewPassword').value = '';
    } catch (e) {
        showMessage(e.message, 'error', 'settingsAlert');
    }
}

async function changeUsername() {
    const newUsername = document.getElementById('newUsernameSettings').value.trim();
    const password = document.getElementById('confirmPasswordUsername').value;

    if (!newUsername || !password) {
        showMessage('Please fill in all fields', 'error', 'settingsAlert');
        return;
    }
    if (newUsername === currentUser) {
        showMessage('New username must be different', 'error', 'settingsAlert');
        return;
    }
    try {
        const res = await fetch('/api/account/change-username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ new_username: newUsername, password: password })
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to change username');
        const data = await safeJson(res);
        token = data.access_token;
        currentUser = data.new_username;
        localStorage.setItem('token', token);
        localStorage.setItem('username', currentUser);
        showMessage(data.msg + '. Refreshing...', 'success', 'settingsAlert');
        setTimeout(() => location.reload(), 1000);
    } catch (e) {
        showMessage(e.message, 'error', 'settingsAlert');
    }
}

/* =======================
   AUTH
   ======================= */
async function login() {
    const username = loginUsername.value.trim();
    const password = loginPassword.value;

    if (!username || !password) {
        showMessage('Please fill in all fields', 'error');
        return;
    }
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        if (!res.ok) {
            const error = (await safeJson(res)).msg || 'Login failed';
            showMessage(error, 'error');
            loginPassword.value = '';
            throw new Error(error);
        }
        const data = await safeJson(res);
        token = data.access_token;
        currentUser = username;
        userRole = data.role;
        localStorage.setItem('token', token);
        localStorage.setItem('username', username);
        localStorage.setItem('role', userRole);
        showMainPanel();
    } catch (e) {
        console.error('Login error:', e.message);
    }
}

async function register() {
    const username = regUsername.value.trim();
    const password = regPassword.value;
    const confirm = regPasswordConfirm.value;

    if (!username || !password || password !== confirm) {
        showMessage('Invalid registration details', 'error');
        return;
    }
    if (password.length < 6) {
        showMessage('Password must be at least 6 characters', 'error');
        return;
    }
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Registration failed');
        const data = await safeJson(res);
        showMessage(data.msg + '. You will be notified once approved.', 'success');
        setTimeout(showLogin, 2000);
    } catch (e) {
        showMessage(e.message, 'error');
    }
}

function logout() {
    localStorage.clear();
    location.reload();
}

/* =======================
   MAIN PANEL
   ======================= */
function showMainPanel() {
    authContainer.style.display = 'none';
    mainContainer.style.display = 'flex';
    navbar.style.display = 'block';
    document.getElementById('mobileBottomNav').style.display = 'flex';

    navUsername.textContent = currentUser;
    updateThemeIcon(document.documentElement.getAttribute('data-theme'));

    if (userRole === 'admin') {
        document.getElementById('adminNav').style.display = 'block';
    }

    currentPath = '';
    // Load server-synced data then files
    Promise.all([loadPinnedFolders(), loadFavorites()]).then(() => loadFiles());
    // Init music player in background
    setTimeout(mpInit, 800);
}

/* =======================
   FILES & FOLDERS
   ======================= */
function toggleFileSelection(filepath) {
    if (selectedFiles.has(filepath)) {
        selectedFiles.delete(filepath);
    } else {
        selectedFiles.add(filepath);
    }
    updateFileListUI();
    updateBulkActionsBar();
}

function clearSelection() {
    selectedFiles.clear();
    updateFileListUI();
    updateBulkActionsBar();
}

function updateBulkActionsBar() {
    const bar = document.getElementById('bulkActionsBar');
    const count = document.getElementById('selectedCount');
    if (selectedFiles.size > 0) {
        bar.style.display = 'flex';
        count.textContent = selectedFiles.size;
    } else {
        bar.style.display = 'none';
    }
}

function updateFileListUI() {
    document.querySelectorAll('.file-checkbox').forEach(checkbox => {
        const filepath = checkbox.dataset.filepath;
        checkbox.checked = selectedFiles.has(filepath);
        const listItem = checkbox.closest('.list-item');
        if (selectedFiles.has(filepath)) {
            listItem.classList.add('selected');
        } else {
            listItem.classList.remove('selected');
        }
    });
}

async function bulkDeleteFiles() {
    if (selectedFiles.size === 0) return;
    if (!confirm(`Delete ${selectedFiles.size} selected file(s)?`)) return;
    try {
        const res = await fetch('/api/bulk/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ filepaths: Array.from(selectedFiles) })
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Bulk delete failed');
        const data = await safeJson(res);
        showToast(data.msg, 'success');
        clearSelection();
        loadFiles(currentPath);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function bulkMoveFiles() {
    if (selectedFiles.size === 0) return;
    const destination = prompt('Enter destination folder path (leave empty for root):');
    if (destination === null) return;
    try {
        const res = await fetch('/api/bulk/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ filepaths: Array.from(selectedFiles), destination: destination.trim() })
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Bulk move failed');
        const data = await safeJson(res);
        showToast(data.msg, 'success');
        clearSelection();
        loadFiles(currentPath);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function bulkShareFiles() {
    if (selectedFiles.size === 0) return;
    if (!confirm(`Share ${selectedFiles.size} selected file(s) on the network?`)) return;
    try {
        const res = await fetch('/api/bulk/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ filepaths: Array.from(selectedFiles) })
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Bulk share failed');
        const data = await safeJson(res);
        showToast(data.msg, 'success');
        clearSelection();
        loadFiles(currentPath);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function loadGlobalStats() {
    try {
        const res = await fetch('/api/stats', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) return;
        const data = await safeJson(res);
        const percentage = Math.min(100, (data.total_size / (10 * 1024 * 1024 * 1024)) * 100);
        document.getElementById('storageBar').style.width = percentage + '%';
        document.getElementById('storageUsedText').textContent = data.total_size_formatted;
    } catch (e) { /* silently ignore */ }
}

async function loadFiles(path = '') {
    currentPath = path || '';
    selectedFiles.clear();
    allFiles = [];

    try {
        const res = await fetch('/api/files?folder=' + encodeURIComponent(currentPath), {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to load files');
        const data = await safeJson(res);

        loadGlobalStats();
        updateBreadcrumb(currentPath);

        const fileListEl = document.getElementById('fileList');
        let html = '';
        const newFiles = []; // collect locally, assign atomically at end

        if (data.folders && data.folders.length > 0) {
            html += '<div class="section-header">Folders</div>';
            html += data.folders.map(folder => {
                const folderPath = currentPath ? currentPath + '/' + folder.name : folder.name;
                return `
                <div class="list-item" 
                     draggable="true"
                     data-path="${escapeHtml(folderPath)}"
                     data-type="folder"
                     data-drop-target="true"
                     ondragstart="onDragStart(event)"
                     ondragover="onDragOver(event)"
                     ondragleave="onDragLeave(event)"
                     ondrop="onDrop(event)">
                    <div class="item-info">
                        <div class="item-name folder-item" onclick="loadFiles('${escapeHtml(folderPath)}')">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                            ${escapeHtml(folder.name)}
                            ${folder.is_shared ? '<span class="badge badge-shared">Shared</span>' : ''}
                        </div>
                        <div class="item-meta">${formatDate(folder.modified)}</div>
                    </div>
                    <div class="item-actions">
                        <div class="kebab-wrap">
                            <button class="btn-kebab" onclick="toggleMenu(event, '${pathToId('mf-'+folderPath)}')" title="Options">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                            </button>
                            <div class="kebab-menu" id="${pathToId('mf-'+folderPath)}">
                                ${!folder.is_shared ? `<button class="kebab-item" onclick="requestFolderShare('${escapeHtml(folderPath)}'); closeAllMenus()">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                                    Share</button>` : ''}
                                <button class="kebab-item" onclick="promptMoveItem('${escapeHtml(folderPath)}', 'folder'); closeAllMenus()">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="5 9 2 12 5 15"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                                    Move</button>
                                <button class="kebab-item" onclick="renameFileInline('${escapeHtml(folderPath)}', '${escapeHtml(folder.name)}'); closeAllMenus()">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    Rename</button>
                            </div>
                        </div>
                        <button class="btn btn-text btn-danger-text" onclick="deleteFolder('${escapeHtml(folderPath)}'); event.stopPropagation();">Delete</button>
                    </div>
                </div>`;
            }).join('');
        }

        // Drop zone: when inside a folder, the root drop zone = the PARENT folder (enables drag-out)
        const parentPath = currentPath.includes('/')
            ? currentPath.substring(0, currentPath.lastIndexOf('/'))
            : '';
        html += `<div class="list-drop-root" data-path="${escapeHtml(parentPath)}" data-type="folder" data-drop-target="true"
                      ondragover="onDragOver(event)" ondragleave="onDragLeave(event)" ondrop="onDrop(event)">
                    ${currentPath ? `<span class="drop-root-label">↑ Drop here to move to ${parentPath ? escapeHtml(parentPath.split('/').pop()) : 'root'}</span>` : ''}
                 </div>`;

        if (data.files && data.files.length > 0) {
            html += '<div class="section-header">Files</div>';
            html += data.files.map((file, index) => {
                const filePath = currentPath ? currentPath + '/' + file.name : file.name;
                const canPreview = file.type !== 'other';
                const canEdit = isEditableFile(file.name);
                newFiles.push({ path: filePath, type: file.type, name: file.name });

                // Respect user preference: open editable files in editor by default
                const preferEditor = (userPrefs.editorDefault !== false);
                const nameClick = canEdit && preferEditor
                    ? `onclick="openEditor('${escapeHtml(filePath)}', '${escapeHtml(file.name)}')"`
                    : canPreview
                        ? `onclick="previewFile('${escapeHtml(filePath)}', ${index})"`
                        : canEdit ? `onclick="openEditor('${escapeHtml(filePath)}', '${escapeHtml(file.name)}')"` : '';
                return `
                    <div class="list-item"
                         draggable="true"
                         data-path="${escapeHtml(filePath)}"
                         data-type="file"
                         ondragstart="onDragStart(event)">
                        <div class="item-info" style="display: flex; align-items: center; gap: 12px;">
                            <input type="checkbox" class="file-checkbox" data-filepath="${escapeHtml(filePath)}"
                                   onclick="toggleFileSelection('${escapeHtml(filePath)}'); event.stopPropagation();">
                            <div style="flex: 1; min-width: 0;">
                                <div class="item-name ${canPreview || canEdit ? 'item-name-clickable' : ''}" ${nameClick}>
                                    ${getFileIcon(file.type)} <span class="item-name-text">${escapeHtml(file.name)}</span>
                                    ${file.is_shared ? '<span class="badge badge-shared">Shared</span>' : ''}
                                </div>
                                <div class="item-meta">${file.size_formatted} • ${formatDate(file.modified)}</div>
                            </div>
                        </div>
                        <div class="item-actions">
                            <button class="fav-btn icon-btn" data-path="${escapeHtml(filePath)}"
                                    onclick="toggleFavorite('${escapeHtml(filePath)}', '${escapeHtml(file.name)}', event)"
                                    title="${userFavorites.has(filePath) ? 'Remove from favorites' : 'Add to favorites'}">
                                ${getFavStar(filePath)}
                            </button>
                            <div class="kebab-wrap">
                                <button class="btn-kebab" onclick="toggleMenu(event, '${pathToId('mf-'+filePath)}')" title="Options">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                                </button>
                                <div class="kebab-menu" id="${pathToId('mf-'+filePath)}">
                                    ${canEdit ? `<button class="kebab-item kebab-item-edit" onclick="openEditor('${escapeHtml(filePath)}', '${escapeHtml(file.name)}'); closeAllMenus()">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                        Edit</button>` : ''}
                                    ${canPreview ? `<button class="kebab-item" onclick="previewFile('${escapeHtml(filePath)}', ${index}); closeAllMenus()">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                        Preview</button>` : ''}
                                    <button class="kebab-item" onclick="downloadFile('${escapeHtml(filePath)}'); closeAllMenus()">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                        Download</button>
                                    ${!file.is_shared ? `<button class="kebab-item" onclick="requestShare('${escapeHtml(filePath)}'); closeAllMenus()">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                                        Share</button>` : ''}
                                    <button class="kebab-item" onclick="promptMoveItem('${escapeHtml(filePath)}', 'file'); closeAllMenus()">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="5 9 2 12 5 15"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                                        Move</button>
                                    <button class="kebab-item" onclick="renameFileInline('${escapeHtml(filePath)}', '${escapeHtml(file.name)}'); closeAllMenus()">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                        Rename</button>
                                    <button class="kebab-item kebab-item-danger" onclick="deleteFile('${escapeHtml(filePath)}'); closeAllMenus()">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                                        Delete</button>
                                </div>
                            </div>
                        </div>
                    </div>`;
            }).join('');
        }

        if (!html) {
            html = '<div class="empty-state"><div class="empty-state-icon">📁</div><div class="empty-state-text">This folder is empty</div></div>';
        }

        allFiles = newFiles; // atomic assignment — no race condition duplicates
        fileListEl.innerHTML = html;
        updateBulkActionsBar();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function updateBreadcrumb(path) {
    const breadcrumbEl = document.getElementById('breadcrumb');
    if (!path) {
        breadcrumbEl.innerHTML = '<span class="breadcrumb-item active">My Files</span>';
        return;
    }
    const parts = path.split('/');
    let html = '<span class="breadcrumb-item" onclick="loadFiles()">My Files</span>';
    let currentPathBuild = '';
    parts.forEach((part, index) => {
        currentPathBuild += (currentPathBuild ? '/' : '') + part;
        const pathToNavigate = currentPathBuild;
        html += ' / ';
        if (index === parts.length - 1) {
            html += `<span class="breadcrumb-item active">${escapeHtml(part)}</span>`;
        } else {
            html += `<span class="breadcrumb-item" onclick="loadFiles('${escapeHtml(pathToNavigate)}')">${escapeHtml(part)}</span>`;
        }
    });
    breadcrumbEl.innerHTML = html;
}

function getFileIcon(type) {
    const icons = {
        'image': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
        'pdf': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>',
        'text': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>',
        'docx': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
        'xlsx': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
        'video': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
        'other': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>'
    };
    return icons[type] || icons['other'];
}

async function createFolder() {
    const folderName = prompt('Enter folder name:');
    if (!folderName || !folderName.trim()) return;
    try {
        const res = await fetch('/api/folder/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ current_path: currentPath, folder_name: folderName.trim() })
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to create folder');
        const data = await safeJson(res);
        showToast(data.msg, 'success');
        loadFiles(currentPath);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function deleteFolder(folderPath) {
    if (!confirm(`Delete folder "${folderPath}" and all its contents?`)) return;
    try {
        const res = await fetch('/api/folder/delete?path=' + encodeURIComponent(folderPath), {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to delete folder');
        const data = await safeJson(res);
        showToast(data.msg, 'success');
        loadFiles(currentPath);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

/* =======================
   UPLOAD (with chunking + cancel)
   ======================= */
const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB per chunk

function generateUploadId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

async function uploadWithChunks(file, folder, relPath) {
    if (uploadQueue.cancelled) throw new Error('Cancelled');

    const name        = relPath || file.name;
    const isFolderUp  = !!relPath && relPath.includes('/');
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;
    const uploadId    = generateUploadId();
    uploadQueue.activeUploadId = uploadId;

    for (let i = 0; i < totalChunks; i++) {
        if (uploadQueue.cancelled) {
            // Server-side cleanup
            fetch('/api/upload/chunk/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ upload_id: uploadId })
            }).catch(() => {});
            throw new Error('Cancelled');
        }

        const start = i * CHUNK_SIZE;
        const chunk = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
        const pct   = Math.round(((i + 1) / totalChunks) * 100);

        uploadProgressUpdate(name, pct);

        const formData = new FormData();
        formData.append('file',             chunk);
        formData.append('upload_id',        uploadId);
        formData.append('filename',         name);
        formData.append('chunk_index',      i);
        formData.append('total_chunks',     totalChunks);
        formData.append('folder',           folder);
        if (isFolderUp) formData.append('is_folder_upload', 'true');

        const controller = new AbortController();
        uploadQueue.currentAbortController = controller;

        let res;
        try {
            res = await fetch('/api/upload/chunk', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + token },
                body: formData,
                signal: controller.signal
            });
        } catch (e) {
            if (e.name === 'AbortError' || uploadQueue.cancelled) throw new Error('Cancelled');
            throw e;
        }

        if (!res.ok) {
            fetch('/api/upload/chunk/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ upload_id: uploadId })
            }).catch(() => {});
            const err = (await safeJson(res).catch(() => ({}))).msg || 'Upload failed';
            throw new Error(err);
        }
    }
}

async function uploadFiles() {
    const files = Array.from(fileInput.files);
    if (!files.length) return;

    // Lock destination at upload START — changing folders won't affect in-progress upload
    const uploadDestination = currentPath;

    uploadQueue.total += files.length;
    uploadProgressShow();

    let succeeded = 0, failed = 0;

    for (const file of files) {
        if (uploadQueue.cancelled) break;
        try {
            await uploadWithChunks(file, uploadDestination, null);
            succeeded++;
        } catch (e) {
            if (e.message === 'Cancelled') break;
            failed++;
            showToast(`"${file.name}" failed: ${e.message}`, 'error');
        }
        uploadQueue.done++;
    }

    fileInput.value = '';
    await loadFiles(currentPath);
    await loadGlobalStats();

    if (!uploadQueue.cancelled) {
        uploadProgressHide();
        if (failed === 0 && succeeded > 0)
            showToast(`Uploaded ${succeeded} file${succeeded !== 1 ? 's' : ''} successfully`, 'success');
        else if (succeeded > 0 || failed > 0)
            showToast(`${succeeded} uploaded, ${failed} failed`, failed > 0 ? 'error' : 'success');
    }
}

async function uploadFolder() {
    const files = Array.from(document.getElementById('folderInput').files);
    if (!files.length) return;

    // Lock destination at upload START
    const uploadDestination = currentPath;

    uploadQueue.total += files.length;
    uploadProgressShow();

    let succeeded = 0, failed = 0;

    for (const file of files) {
        if (uploadQueue.cancelled) break;
        const relPath = file.webkitRelativePath || file.name;
        try {
            await uploadWithChunks(file, uploadDestination, relPath);
            succeeded++;
        } catch (e) {
            if (e.message === 'Cancelled') break;
            failed++;
        }
        uploadQueue.done++;
    }

    document.getElementById('folderInput').value = '';
    await loadFiles(currentPath);
    await loadGlobalStats();

    if (!uploadQueue.cancelled) {
        uploadProgressHide();
        if (failed === 0 && succeeded > 0)
            showToast(`Uploaded ${succeeded} file${succeeded !== 1 ? 's' : ''} successfully`, 'success');
        else if (succeeded > 0 || failed > 0)
            showToast(`${succeeded} uploaded, ${failed} failed`, failed > 0 ? 'error' : 'success');
    }
}

/* =======================
   PREVIEW MODAL (larger)
   ======================= */
function previewFile(filepath, index = -1) {
    currentPreviewIndex = index;

    const file = allFiles[index];
    let previewUrl;

    if (file && file.type === 'docx') {
        previewUrl = `/api/preview/docx/${encodeURIComponent(filepath)}?token=${token}`;
        openPreviewModal(previewUrl, file ? file.name : filepath.split('/').pop(), index, allFiles.length, 'iframe');
    } else if (file && file.type === 'xlsx') {
        previewUrl = `/api/preview/xlsx/${encodeURIComponent(filepath)}?token=${token}`;
        openPreviewModal(previewUrl, file ? file.name : filepath.split('/').pop(), index, allFiles.length, 'iframe');
    } else if (file && file.type === 'video') {
        previewUrl = `/api/preview/${encodeURIComponent(filepath)}?token=${token}`;
        openPreviewModal(previewUrl, file ? file.name : filepath.split('/').pop(), index, allFiles.length, 'video');
    } else {
        previewUrl = `/api/preview/${encodeURIComponent(filepath)}?token=${token}`;
        openPreviewModal(previewUrl, file ? file.name : filepath.split('/').pop(), index, allFiles.length, 'iframe');
    }
}

function openPreviewModal(previewUrl, filename, index, total, mode = 'iframe') {
    const existing = document.getElementById('previewModal');
    if (existing) existing.remove();

    const hasNav = index >= 0 && total > 1;
    const hasPrev = index > 0;
    const hasNext = index < total - 1;

    if (mode === 'video') {
        // ── YouTube-style video player ──────────────────────────────
        const modal = document.createElement('div');
        modal.id = 'previewModal';
        modal.className = 'video-modal';

        modal.innerHTML = `
            <div class="video-modal-inner" onclick="event.stopPropagation()">
                <div class="video-modal-topbar">
                    ${hasNav && hasPrev ? `<button class="vmb" onclick="navigatePreview(-1)">‹ Prev</button>` : '<span></span>'}
                    <span class="video-modal-title">${escapeHtml(filename)}</span>
                    ${hasNav && hasNext ? `<button class="vmb" onclick="navigatePreview(1)">Next ›</button>` : '<span></span>'}
                    <button class="vmb vmb-close" onclick="document.getElementById('previewModal').remove()">✕</button>
                </div>
                <div class="video-modal-player">
                    <video id="previewVideo"
                           controls autoplay preload="auto"
                           class="video-player-el"
                           playsinline
                           webkit-playsinline>
                        <source src="${previewUrl}">
                    </video>
                </div>
                <div class="video-modal-bar">
                    <div class="vmb-group">
                        <span class="vmb-label">Speed</span>
                        <select class="vmb-select" onchange="setVideoSpeed(this.value)">
                            <option value="0.25">0.25×</option>
                            <option value="0.5">0.5×</option>
                            <option value="0.75">0.75×</option>
                            <option value="1" selected>Normal</option>
                            <option value="1.25">1.25×</option>
                            <option value="1.5">1.5×</option>
                            <option value="1.75">1.75×</option>
                            <option value="2">2×</option>
                        </select>
                    </div>
                    <span class="vmb-res" id="videoQualityInfo"></span>
                    <button class="vmb vmb-fs" onclick="toggleVideoFullscreen()">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                        Fullscreen
                    </button>
                </div>
            </div>
        `;

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.body.appendChild(modal);

        const vid = document.getElementById('previewVideo');
        if (vid) {
            const savedSpeed = parseFloat(localStorage.getItem('videoSpeed') || '1');
            vid.playbackRate = savedSpeed;
            modal.querySelector('.vmb-select').value = String(savedSpeed);
            vid.addEventListener('loadedmetadata', () => {
                const qi = document.getElementById('videoQualityInfo');
                if (qi && vid.videoWidth) qi.textContent = `${vid.videoWidth}×${vid.videoHeight}`;
            });
        }

        // Keyboard shortcut to close
        const escHandler = (e) => {
            if (e.key === 'Escape' && !document.fullscreenElement) {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

    } else {
        // ── Standard iframe preview ─────────────────────────────────
        const modal = document.createElement('div');
        modal.className = 'preview-modal';
        modal.id = 'previewModal';
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

        const content = document.createElement('div');
        content.className = 'preview-content';

        content.innerHTML = `
            <div class="preview-header">
                <div class="preview-nav">
                    ${hasNav && hasPrev ? `<button class="preview-nav-btn" onclick="navigatePreview(-1); event.stopPropagation();">← Prev</button>` : '<div></div>'}
                    <div class="preview-filename">${escapeHtml(filename)}</div>
                    ${hasNav && hasNext ? `<button class="preview-nav-btn" onclick="navigatePreview(1); event.stopPropagation();">Next →</button>` : '<div></div>'}
                </div>
                <button class="preview-close-inline" onclick="document.getElementById('previewModal').remove()">×</button>
            </div>
            <iframe src="${previewUrl}" class="preview-frame" allowfullscreen></iframe>
        `;

        modal.appendChild(content);
        document.body.appendChild(modal);
    }
}

function setVideoSpeed(speed) {
    const vid = document.getElementById('previewVideo');
    if (vid) {
        vid.playbackRate = parseFloat(speed);
        localStorage.setItem('videoSpeed', speed);
    }
}

function toggleVideoFullscreen() {
    const vid = document.getElementById('previewVideo');
    if (!vid) return;
    if (document.fullscreenElement) {
        document.exitFullscreen();
    } else {
        const container = vid.closest('.video-modal-player') || vid;
        (container.requestFullscreen || vid.requestFullscreen.bind(vid))();
    }
}

function navigatePreview(direction) {
    const newIndex = currentPreviewIndex + direction;
    if (newIndex >= 0 && newIndex < allFiles.length) {
        const modal = document.getElementById('previewModal');
        if (modal) modal.remove();
        const newFile = allFiles[newIndex];
        previewFile(newFile.path, newIndex);
    }
}

function downloadFile(filepath) {
    window.open(`/api/download/${encodeURIComponent(filepath)}?token=${token}`, '_blank');
}

async function deleteFile(filepath) {
    const filename = filepath.split('/').pop();
    if (!confirm(`Delete "${filename}"?`)) return;
    try {
        const res = await fetch(`/api/delete/${encodeURIComponent(filepath)}`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Delete failed');
        const data = await safeJson(res);
        showToast(data.msg, 'success');
        loadFiles(currentPath);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

/* =======================
   NETWORK SHARING
   ======================= */
async function requestShare(filepath) {
    if (!confirm('Share this file on the network?')) return;
    try {
        const res = await fetch('/api/share/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ filepath })
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to request share');
        const data = await safeJson(res);
        showToast(data.msg, 'success');
        loadFiles(currentPath);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function requestFolderShare(folderPath) {
    if (!confirm('Share this folder and all its contents on the network?')) return;
    try {
        const res = await fetch('/api/share/folder/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ folder_path: folderPath })
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to request folder share');
        const data = await safeJson(res);
        showToast(data.msg, 'success');
        loadFiles(currentPath);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function loadPendingShares() {
    try {
        const res = await fetch('/api/share/pending', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to load pending shares');
        const data = await safeJson(res);

        const sharesListEl = document.getElementById('sharesList');
        let html = '';

        if (data.shares.length === 0 && data.folders.length === 0) {
            html = '<div class="empty-state"><div class="empty-state-icon">✓</div><div class="empty-state-text">No pending share requests</div></div>';
        } else {
            if (data.folders && data.folders.length > 0) {
                html += '<div class="section-header">Folder Share Requests</div>';
                html += data.folders.map(folder => `
                    <div class="list-item">
                        <div class="item-info">
                            <div class="item-name">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                </svg>
                                ${escapeHtml(folder.folder_name)}
                            </div>
                            <div class="item-meta">By ${escapeHtml(folder.username)} • ${formatDate(new Date(folder.requested_at).getTime() / 1000)}</div>
                        </div>
                        <div class="item-actions">
                            <button class="btn btn-text" style="color: var(--success);" onclick="approveFolderShare('${escapeHtml(folder.id)}')">Approve</button>
                            <button class="btn btn-text btn-danger-text" onclick="rejectFolderShare('${escapeHtml(folder.id)}')">Reject</button>
                        </div>
                    </div>`).join('');
            }
            if (data.shares && data.shares.length > 0) {
                html += '<div class="section-header">File Share Requests</div>';
                html += data.shares.map(share => `
                    <div class="list-item">
                        <div class="item-info">
                            <div class="item-name">${getFileIcon(share.file_type)} ${escapeHtml(share.filename)}</div>
                            <div class="item-meta">By ${escapeHtml(share.username)} • ${formatSize(share.file_size)} • ${formatDate(new Date(share.requested_at).getTime() / 1000)}</div>
                        </div>
                        <div class="item-actions">
                            <button class="btn btn-text" style="color: var(--success);" onclick="approveShare('${escapeHtml(share.id)}')">Approve</button>
                            <button class="btn btn-text btn-danger-text" onclick="rejectShare('${escapeHtml(share.id)}')">Reject</button>
                        </div>
                    </div>`).join('');
            }
        }
        sharesListEl.innerHTML = html;
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function approveShare(fileId) {
    try {
        const res = await fetch(`/api/share/approve/${encodeURIComponent(fileId)}`, {
            method: 'POST', headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to approve');
        showToast((await safeJson(res)).msg, 'success');
        loadPendingShares();
    } catch (e) { showToast(e.message, 'error'); }
}

async function approveFolderShare(folderId) {
    try {
        const res = await fetch(`/api/share/folder/approve/${encodeURIComponent(folderId)}`, {
            method: 'POST', headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to approve folder');
        showToast((await safeJson(res)).msg, 'success');
        loadPendingShares();
    } catch (e) { showToast(e.message, 'error'); }
}

async function rejectShare(fileId) {
    if (!confirm('Reject this share request?')) return;
    try {
        const res = await fetch(`/api/share/reject/${encodeURIComponent(fileId)}`, {
            method: 'POST', headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to reject');
        showToast((await safeJson(res)).msg, 'success');
        loadPendingShares();
    } catch (e) { showToast(e.message, 'error'); }
}

async function rejectFolderShare(folderId) {
    if (!confirm('Reject this folder share request?')) return;
    try {
        const res = await fetch(`/api/share/folder/reject/${encodeURIComponent(folderId)}`, {
            method: 'POST', headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to reject folder');
        showToast((await safeJson(res)).msg, 'success');
        loadPendingShares();
    } catch (e) { showToast(e.message, 'error'); }
}

async function loadNetworkFiles() {
    try {
        const res = await fetch('/api/network/files', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to load network files');
        const data = await safeJson(res);

        allNetworkItems = [
            ...data.files.map(f => ({ ...f, type: 'file' })),
            ...data.folders.map(f => ({ ...f, type: 'folder' }))
        ];

        const networkListEl = document.getElementById('networkList');
        let html = '';

        if (data.files.length === 0 && data.folders.length === 0) {
            html = '<div class="empty-state"><div class="empty-state-icon">🌐</div><div class="empty-state-text">No shared files available</div></div>';
        } else {
            if (data.folders && data.folders.length > 0) {
                html += '<div class="section-header">Shared Folders</div>';
                html += data.folders.map(folder => {
                    const isOwner = folder.username === currentUser;
                    const isAdmin = userRole === 'admin';
                    return `
                        <div class="list-item">
                            <div class="item-info" style="display: flex; align-items: center; gap: 12px;">
                                <input type="checkbox" class="network-checkbox" data-itemid="${escapeHtml(folder.id)}"
                                       onclick="toggleNetworkItemSelection('${escapeHtml(folder.id)}'); event.stopPropagation();">
                                <div style="flex: 1;">
                                    <div class="item-name folder-item" onclick="viewNetworkFolder('${escapeHtml(folder.id)}', '')">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                        </svg>
                                        ${escapeHtml(folder.folder_name)}
                                    </div>
                                    <div class="item-meta">Shared by ${escapeHtml(folder.username)} • ${formatDate(new Date(folder.approved_at).getTime() / 1000)}</div>
                                </div>
                            </div>
                            <div class="item-actions">
                                <button class="btn btn-text" onclick="viewNetworkFolder('${escapeHtml(folder.id)}', ''); event.stopPropagation();">Open</button>
                                ${(isOwner || isAdmin) ? `<button class="btn btn-text btn-danger-text" onclick="removeFolderShare('${escapeHtml(folder.id)}'); event.stopPropagation();">Remove</button>` : ''}
                            </div>
                        </div>`;
                }).join('');
            }

            if (data.files && data.files.length > 0) {
                html += '<div class="section-header">Shared Files</div>';
                html += data.files.map(file => {
                    const canPreview = file.file_type !== 'other';
                    const isOwner = file.username === currentUser;
                    const isAdmin = userRole === 'admin';
                    return `
                        <div class="list-item">
                            <div class="item-info" style="display: flex; align-items: center; gap: 12px;">
                                <input type="checkbox" class="network-checkbox" data-itemid="${escapeHtml(file.id)}"
                                       onclick="toggleNetworkItemSelection('${escapeHtml(file.id)}'); event.stopPropagation();">
                                <div style="flex: 1;">
                                    <div class="item-name">${getFileIcon(file.file_type)} ${escapeHtml(file.filename)}</div>
                                    <div class="item-meta">Shared by ${escapeHtml(file.username)} • ${formatSize(file.file_size)} • ${formatDate(new Date(file.approved_at).getTime() / 1000)}</div>
                                </div>
                            </div>
                            <div class="item-actions">
                                ${canPreview ? `<button class="btn btn-text" onclick="previewNetworkFile('${escapeHtml(file.id)}', '${escapeHtml(file.file_type)}')">Preview</button>` : ''}
                                <button class="btn btn-text" onclick="downloadNetworkFile('${escapeHtml(file.id)}')">Download</button>
                                ${(isOwner || isAdmin) ? `<button class="btn btn-text btn-danger-text" onclick="removeNetworkShare('${escapeHtml(file.id)}')">Remove</button>` : ''}
                            </div>
                        </div>`;
                }).join('');
            }
        }
        networkListEl.innerHTML = html;
        updateNetworkBulkActionsBar();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function viewNetworkFolder(folderId, subfolder) {
    currentNetworkFolderId = folderId;
    currentNetworkSubfolder = subfolder || '';

    try {
        let url = `/api/network/folder/${encodeURIComponent(folderId)}`;
        if (currentNetworkSubfolder) url += `?subfolder=${encodeURIComponent(currentNetworkSubfolder)}`;

        const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });

        if (!res.ok) {
            const error = (await safeJson(res)).msg || 'Failed to load folder';
            if (error.includes('removed from shares')) {
                showToast(error, 'error');
                loadNetworkFiles();
                return;
            }
            throw new Error(error);
        }

        const data = await safeJson(res);

        let breadcrumb = `<span class="breadcrumb-item" onclick="loadNetworkFiles(); event.stopPropagation();">Shared with me</span>`;
        breadcrumb += ` / <span class="breadcrumb-item" onclick="viewNetworkFolder('${escapeHtml(folderId)}', ''); event.stopPropagation();">${escapeHtml(data.folder.folder_name)}</span>`;

        if (currentNetworkSubfolder) {
            const parts = currentNetworkSubfolder.split('/');
            let pathBuild = '';
            parts.forEach((part, idx) => {
                pathBuild += (pathBuild ? '/' : '') + part;
                const navPath = pathBuild;
                breadcrumb += ' / ';
                if (idx === parts.length - 1) {
                    breadcrumb += `<span class="breadcrumb-item active">${escapeHtml(part)}</span>`;
                } else {
                    breadcrumb += `<span class="breadcrumb-item" onclick="viewNetworkFolder('${escapeHtml(folderId)}', '${escapeHtml(navPath)}'); event.stopPropagation();">${escapeHtml(part)}</span>`;
                }
            });
        }

        let html = `<div style="margin-bottom: 16px;"><button class="btn btn-text" onclick="loadNetworkFiles()">← Back</button></div>`;
        html += `<div class="breadcrumb-container"><div class="breadcrumb">${breadcrumb}</div></div>`;

        if (data.folders && data.folders.length > 0) {
            html += '<div class="section-header">Folders</div>';
            html += data.folders.map(folder => {
                const fullPath = folder.relative_path;
                const canManage = data.folder.username === currentUser || userRole === 'admin';
                return `
                    <div class="list-item">
                        <div class="item-info">
                            <div class="item-name folder-item" onclick="viewNetworkFolder('${escapeHtml(folderId)}', '${escapeHtml(fullPath)}')">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                </svg>
                                ${escapeHtml(folder.name)}
                            </div>
                            <div class="item-meta">${formatDate(folder.modified)}</div>
                        </div>
                        <div class="item-actions">
                            <button class="btn btn-text" onclick="viewNetworkFolder('${escapeHtml(folderId)}', '${escapeHtml(fullPath)}'); event.stopPropagation();">Open</button>
                            ${canManage ? `<button class="btn btn-text btn-danger-text" onclick="deleteSharedItem('${escapeHtml(folderId)}', '${escapeHtml(fullPath)}', 'folder', '${escapeHtml(folder.name)}'); event.stopPropagation();">Delete</button>` : ''}
                        </div>
                    </div>`;
            }).join('');
        }

        if (data.files && data.files.length > 0) {
            html += '<div class="section-header">Files</div>';
            html += data.files.map(file => {
                const canPreview = file.file_type !== 'other';
                const canManage = data.folder.username === currentUser || userRole === 'admin';
                return `
                    <div class="list-item">
                        <div class="item-info">
                            <div class="item-name">${getFileIcon(file.file_type)} ${escapeHtml(file.filename)}</div>
                            <div class="item-meta">${formatSize(file.file_size)} • ${formatDate(file.modified)}</div>
                        </div>
                        <div class="item-actions">
                            ${canPreview ? `<button class="btn btn-text" onclick="previewFile('${escapeHtml(file.filepath)}')">Preview</button>` : ''}
                            <button class="btn btn-text" onclick="downloadFile('${escapeHtml(file.filepath)}')">Download</button>
                            ${canManage ? `<button class="btn btn-text btn-danger-text" onclick="deleteSharedItem('${escapeHtml(folderId)}', '${escapeHtml(file.relative_path)}', 'file', '${escapeHtml(file.filename)}'); event.stopPropagation();">Delete</button>` : ''}
                        </div>
                    </div>`;
            }).join('');
        }

        if (data.folders.length === 0 && data.files.length === 0) {
            html += '<div class="empty-state"><div class="empty-state-icon">📁</div><div class="empty-state-text">This folder is empty</div></div>';
        }

        document.getElementById('networkList').innerHTML = html;
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function removeFolderShare(folderId) {
    if (!confirm('Remove this folder from network sharing?')) return;
    try {
        const res = await fetch(`/api/share/folder/remove/${encodeURIComponent(folderId)}`, {
            method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to remove folder share');
        showToast((await safeJson(res)).msg, 'success');
        loadNetworkFiles();
    } catch (e) { showToast(e.message, 'error'); }
}

async function deleteSharedItem(folderId, itemPath, itemType, itemName) {
    const label = itemType === 'folder' ? `folder "${itemName}" and all its contents` : `"${itemName}"`;
    if (!confirm(`Delete ${label}?`)) return;
    try {
        const url = `/api/network/folder/${encodeURIComponent(folderId)}/delete` +
                    `?path=${encodeURIComponent(itemPath)}&type=${encodeURIComponent(itemType)}`;
        const res = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Delete failed');
        showToast((await safeJson(res)).msg, 'success');
        viewNetworkFolder(folderId, currentNetworkSubfolder);
    } catch (e) { showToast(e.message, 'error'); }
}

function previewNetworkFile(fileId, fileType) {
    const previewUrl = `/api/network/preview/${encodeURIComponent(fileId)}?token=${token}`;
    const mode = fileType === 'video' ? 'video' : 'iframe';
    openPreviewModal(previewUrl, fileId, -1, 0, mode);
}

function downloadNetworkFile(fileId) {
    window.open(`/api/network/download/${encodeURIComponent(fileId)}?token=${token}`, '_blank');
}

async function removeNetworkShare(fileId) {
    if (!confirm('Remove this file from network sharing?')) return;
    try {
        const res = await fetch(`/api/share/remove/${encodeURIComponent(fileId)}`, {
            method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to remove share');
        showToast((await safeJson(res)).msg, 'success');
        loadNetworkFiles();
    } catch (e) { showToast(e.message, 'error'); }
}

/* =======================
   USERS (ADMIN)
   ======================= */
async function loadUsers() {
    try {
        const res = await fetch('/api/users', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to load users');
        const data = await safeJson(res);

        const userListEl = document.getElementById('userList');
        if (data.users.length === 0) {
            userListEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-text">No users found</div></div>';
        } else {
            userListEl.innerHTML = data.users.map(user => `
                <div class="list-item user-management-item">
                    <div class="item-info">
                        <div class="item-name">
                            ${escapeHtml(user.username)}
                            <span class="badge badge-${user.role}">${user.role}</span>
                            <span class="badge badge-${user.status}">${user.status}</span>
                            ${user.trusted_uploader ? '<span class="badge badge-trusted">Trusted</span>' : ''}
                            ${user.auto_share ? '<span class="badge badge-shared">Auto-share</span>' : ''}
                        </div>
                        <div class="item-meta">Created: ${formatDate(new Date(user.created_at).getTime() / 1000)} • Storage: ${formatSize(user.storage_used)}</div>
                    </div>
                    <div class="item-actions user-action-group">
                        <div class="toggle-group">
                            <label class="toggle-label" title="Allow sharing without admin approval">
                                <input type="checkbox" class="toggle-checkbox" ${user.trusted_uploader ? 'checked' : ''}
                                    onchange="setTrustedUploader('${escapeHtml(user.username)}', this.checked)">
                                <span class="toggle-slider"></span>
                                <span class="toggle-text">Trusted uploader</span>
                            </label>
                            <label class="toggle-label" title="Auto-share all uploaded files">
                                <input type="checkbox" class="toggle-checkbox" ${user.auto_share ? 'checked' : ''}
                                    onchange="setAutoShare('${escapeHtml(user.username)}', this.checked)">
                                <span class="toggle-slider"></span>
                                <span class="toggle-text">Auto-share uploads</span>
                            </label>
                        </div>
                        ${user.username !== 'admin' ? `<button class="btn btn-text btn-danger-text" onclick="removeUser('${escapeHtml(user.username)}')">Delete</button>` : ''}
                    </div>
                </div>`).join('');
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function setTrustedUploader(username, value) {
    try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}/trusted`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ trusted_uploader: value })
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed');
        showToast(`${username}: Trusted uploader ${value ? 'enabled' : 'disabled'}`, 'success');
    } catch (e) {
        showToast(e.message, 'error');
        loadUsers(); // revert UI
    }
}

async function setAutoShare(username, value) {
    try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}/auto_share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ auto_share: value })
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed');
        showToast(`${username}: Auto-share uploads ${value ? 'enabled' : 'disabled'}`, 'success');
    } catch (e) {
        showToast(e.message, 'error');
        loadUsers();
    }
}

async function loadPendingUsers() {
    try {
        const res = await fetch('/api/users/pending', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to load pending users');
        const data = await safeJson(res);

        const pendingListEl = document.getElementById('pendingList');
        if (data.users.length === 0) {
            pendingListEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✓</div><div class="empty-state-text">No pending approvals</div></div>';
        } else {
            pendingListEl.innerHTML = data.users.map(user => `
                <div class="list-item">
                    <div class="item-info">
                        <div class="item-name">${escapeHtml(user.username)}</div>
                        <div class="item-meta">Requested: ${formatDate(new Date(user.created_at).getTime() / 1000)}</div>
                    </div>
                    <div class="item-actions">
                        <button class="btn btn-text" style="color: var(--success);" onclick="approveUser('${escapeHtml(user.username)}')">Approve</button>
                        <button class="btn btn-text btn-danger-text" onclick="rejectUser('${escapeHtml(user.username)}')">Reject</button>
                    </div>
                </div>`).join('');
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function addUser() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newRole').value;

    if (!username || !password) {
        showToast('Please fill in all fields', 'error');
        return;
    }
    try {
        const res = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ username, password, role })
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to add user');
        const data = await safeJson(res);
        showToast(data.msg, 'success');
        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('newRole').value = 'user';
        loadUsers();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function approveUser(username) {
    try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}/approve`, {
            method: 'POST', headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to approve');
        showToast((await safeJson(res)).msg, 'success');
        loadPendingUsers();
    } catch (e) { showToast(e.message, 'error'); }
}

async function rejectUser(username) {
    if (!confirm(`Reject user "${username}"?`)) return;
    try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}/reject`, {
            method: 'POST', headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to reject');
        showToast((await safeJson(res)).msg, 'success');
        loadPendingUsers();
    } catch (e) { showToast(e.message, 'error'); }
}

async function removeUser(username) {
    if (!confirm(`Delete user "${username}" and all their files?`)) return;
    try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
            method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to delete user');
        showToast((await safeJson(res)).msg, 'success');
        loadUsers();
    } catch (e) { showToast(e.message, 'error'); }
}

/* =======================
   UTIL
   ======================= */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// Generate a safe DOM id from an arbitrary path string (no slashes, quotes, etc.)
function pathToId(path) {
    // Replace non-alphanumeric chars with underscores, keep it unique via simple hash
    let hash = 0;
    for (let i = 0; i < path.length; i++) {
        hash = (Math.imul(31, hash) + path.charCodeAt(i)) | 0;
    }
    return 'p' + Math.abs(hash).toString(36) + '_' + path.replace(/[^a-zA-Z0-9]/g, '_');
}

function formatDate(timestamp) {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' hours ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' days ago';
    return date.toLocaleDateString();
}

function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return size.toFixed(2) + ' ' + units[unitIndex];
}

document.addEventListener('DOMContentLoaded', () => {
    loginPassword?.addEventListener('keydown', e => {
        if (e.key === 'Enter') login();
    });
    loginUsername?.addEventListener('keydown', e => {
        if (e.key === 'Enter') login();
    });
});

/* =====================================================
   TEXT / MARKDOWN EDITOR
   ===================================================== */

const EDITABLE_EXTS = new Set(['md','txt','json','xml','csv','log','yaml','yml','toml','ini','cfg','conf']);

function isEditableFile(filename) {
    if (!filename.includes('.')) return false;
    return EDITABLE_EXTS.has(filename.split('.').pop().toLowerCase());
}

// Track unsaved state
let editorDirty = false;
let editorFilepath = null;
let editorFilename = null;
let editorSaveTimeout = null;

/* ------ Create new text/md file ------ */
async function createTextFile() {
    const raw = prompt('File name (e.g. "notes" or "README.md"):');
    if (raw === null || !raw.trim()) return;

    const filename = raw.trim();
    try {
        const res = await fetch('/api/file/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ folder: currentPath, filename })
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.msg || 'Failed to create file');

        showToast(`Created ${data.filename}`, 'success');
        await loadFiles(currentPath);

        // Open it in the editor immediately
        openEditor(data.filepath, data.filename);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

/* ------ Open editor modal ------ */
async function openEditor(filepath, filename) {
    editorFilepath = filepath;
    editorFilename = filename;
    editorDirty = false;

    // Load content
    let content = '';
    try {
        const res = await fetch(`/api/file/read/${encodeURIComponent(filepath)}`, {
            headers: { Authorization: 'Bearer ' + token }
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.msg || 'Failed to load file');
        content = data.content;
    } catch (e) {
        showToast(e.message, 'error');
        return;
    }

    const isMarkdown = filename.toLowerCase().endsWith('.md');
    const existing = document.getElementById('editorModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'editorModal';
    modal.className = 'editor-modal';

    modal.innerHTML = `
        <div class="editor-shell">
            <!-- Editor Titlebar -->
            <div class="editor-titlebar">
                <div class="editor-titlebar-left">
                    <div class="editor-file-icon">${isMarkdown ? '📝' : '📄'}</div>
                    <div class="editor-filename-wrap">
                        <span class="editor-filename" id="editorFilenameDisplay">${escapeHtml(filename)}</span>
                        <span class="editor-dirty-dot" id="editorDirtyDot" style="display:none" title="Unsaved changes">●</span>
                    </div>
                </div>
                <div class="editor-titlebar-center">
                    ${isMarkdown ? `
                    <div class="editor-mode-tabs">
                        <button class="editor-mode-tab active" id="tabWrite" onclick="setEditorMode('write')">Write</button>
                        <button class="editor-mode-tab" id="tabPreview" onclick="setEditorMode('preview')">Preview</button>
                        <button class="editor-mode-tab" id="tabSplit" onclick="setEditorMode('split')">Split</button>
                    </div>` : ''}
                </div>
                <div class="editor-titlebar-right">
                    <div class="editor-status" id="editorStatus">Ready</div>
                    <button class="editor-btn editor-btn-save" id="editorSaveBtn" onclick="saveEditor()" title="Save (Ctrl+S)">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                        Save
                    </button>
                    <button class="editor-btn editor-btn-close" onclick="closeEditor()" title="Close">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        Close
                    </button>
                </div>
            </div>

            ${isMarkdown ? `<!-- MD toolbar -->
            <div class="editor-toolbar" id="editorToolbar">
                <div class="editor-toolbar-group">
                    <button class="editor-tool" onclick="mdWrap('**','**')" title="Bold"><strong>B</strong></button>
                    <button class="editor-tool" onclick="mdWrap('*','*')" title="Italic"><em>I</em></button>
                    <button class="editor-tool" onclick="mdWrap('~~','~~')" title="Strikethrough"><s>S</s></button>
                    <button class="editor-tool" onclick="mdWrap('\`','\`')" title="Inline code"><code style="font-size:12px">{ }</code></button>
                </div>
                <div class="editor-toolbar-sep"></div>
                <div class="editor-toolbar-group">
                    <button class="editor-tool" onclick="mdInsertLine('# ')" title="Heading 1">H1</button>
                    <button class="editor-tool" onclick="mdInsertLine('## ')" title="Heading 2">H2</button>
                    <button class="editor-tool" onclick="mdInsertLine('### ')" title="Heading 3">H3</button>
                </div>
                <div class="editor-toolbar-sep"></div>
                <div class="editor-toolbar-group">
                    <button class="editor-tool" onclick="mdInsertLine('- ')" title="Bullet list">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="6" x2="20" y2="6"></line><line x1="9" y1="12" x2="20" y2="12"></line><line x1="9" y1="18" x2="20" y2="18"></line><circle cx="4" cy="6" r="1" fill="currentColor"></circle><circle cx="4" cy="12" r="1" fill="currentColor"></circle><circle cx="4" cy="18" r="1" fill="currentColor"></circle></svg>
                    </button>
                    <button class="editor-tool" onclick="mdInsertLine('1. ')" title="Numbered list">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="21" y2="6"></line><line x1="10" y1="12" x2="21" y2="12"></line><line x1="10" y1="18" x2="21" y2="18"></line><path d="M4 6h1v4"></path><path d="M4 10h2"></path><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"></path></svg>
                    </button>
                    <button class="editor-tool" onclick="mdInsertLine('- [ ] ')" title="Task list">☑</button>
                    <button class="editor-tool" onclick="mdInsertLine('> ')" title="Blockquote">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"></path></svg>
                    </button>
                </div>
                <div class="editor-toolbar-sep"></div>
                <div class="editor-toolbar-group">
                    <button class="editor-tool" onclick="mdInsertLink()" title="Link">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                    </button>
                    <button class="editor-tool" onclick="mdInsertHR()" title="Horizontal rule">—</button>
                    <button class="editor-tool" onclick="mdInsertCodeBlock()" title="Code block">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                    </button>
                    <button class="editor-tool" onclick="mdInsertTable()" title="Table">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="12" y1="3" x2="12" y2="21"></line></svg>
                    </button>
                </div>
                <div style="margin-left:auto; display:flex; align-items:center; gap:6px;">
                    <div class="editor-zoom-controls">
                        <button class="editor-tool" onclick="editorZoomOut()" title="Decrease font size">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                        </button>
                        <span class="editor-zoom-label" id="editorFontSizeDisplay">${editorFontSize}px</span>
                        <button class="editor-tool" onclick="editorZoomIn()" title="Increase font size">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                        </button>
                        <button class="editor-tool" onclick="editorZoomReset()" title="Reset font size" style="font-size:10px;width:auto;padding:0 6px;">1:1</button>
                    </div>
                    <div class="editor-toolbar-sep"></div>
                    <select class="editor-font-select" id="editorFontFamily" title="Font family" onchange="applyEditorFont(this.value)">
                        <option value="monospace">Mono</option>
                        <option value="'Segoe UI',Arial,sans-serif">Sans-serif</option>
                        <option value="Georgia,serif">Serif</option>
                        <option value="'Courier New',monospace">Courier</option>
                    </select>
                    <span class="editor-word-count" id="editorWordCount">0 words</span>
                </div>
            </div>` : `
            <div class="editor-toolbar" id="editorToolbar">
                <div style="margin-left:auto; display:flex; align-items:center; gap:6px;">
                    <div class="editor-zoom-controls">
                        <button class="editor-tool" onclick="editorZoomOut()" title="Decrease font size">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                        </button>
                        <span class="editor-zoom-label" id="editorFontSizeDisplay">${editorFontSize}px</span>
                        <button class="editor-tool" onclick="editorZoomIn()" title="Increase font size">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                        </button>
                        <button class="editor-tool" onclick="editorZoomReset()" title="Reset font size" style="font-size:10px;width:auto;padding:0 6px;">1:1</button>
                    </div>
                    <div class="editor-toolbar-sep"></div>
                    <select class="editor-font-select" id="editorFontFamily" title="Font family" onchange="applyEditorFont(this.value)">
                        <option value="monospace">Mono</option>
                        <option value="'Segoe UI',Arial,sans-serif">Sans-serif</option>
                        <option value="Georgia,serif">Serif</option>
                        <option value="'Courier New',monospace">Courier</option>
                    </select>
                    <span class="editor-word-count" id="editorWordCount">0 words</span>
                </div>
            </div>`}

            <!-- Editor body -->
            <div class="editor-body" id="editorBody">
                <div class="editor-pane editor-pane-write" id="editorPaneWrite">
                    <textarea class="editor-textarea" id="editorTextarea" spellcheck="true"
                        placeholder="Start writing…">${escapeHtml(content)}</textarea>
                </div>
                ${isMarkdown ? `
                <div class="editor-pane editor-pane-preview" id="editorPanePreview" style="display:none;">
                    <div class="editor-preview-content markdown-body" id="editorPreviewContent"></div>
                </div>` : ''}
            </div>

            <!-- Footer / status bar -->
            <div class="editor-footer">
                <span id="editorLineCol">Ln 1, Col 1</span>
                <span class="editor-footer-sep">|</span>
                <span>${isMarkdown ? 'Markdown' : filename.split('.').pop().toUpperCase()}</span>
                <span class="editor-footer-sep">|</span>
                <span>UTF-8</span>
                <span style="margin-left:auto; font-size:11px; opacity:0.6;">Ctrl+S to save</span>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const textarea = document.getElementById('editorTextarea');

    // Set initial mode for markdown
    window._editorIsMarkdown = isMarkdown;
    window._editorMode = 'write';

    // Events
    textarea.addEventListener('input', onEditorInput);
    textarea.addEventListener('keydown', onEditorKeydown);
    textarea.addEventListener('click', updateLineCol);
    textarea.addEventListener('keyup', updateLineCol);

    // Init word count & line/col
    updateWordCount(textarea.value);
    updateLineCol();

    // If markdown, render preview immediately
    if (isMarkdown) {
        renderMarkdownPreview(textarea.value);
    }

    // Focus
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    // Apply saved font size and family
    applyEditorFontSize();
    applyEditorFont();
}

function closeEditor() {
    if (editorDirty) {
        if (!confirm('You have unsaved changes. Close anyway?')) return;
    }
    const modal = document.getElementById('editorModal');
    if (modal) modal.remove();
    editorFilepath = null;
    editorFilename = null;
    editorDirty = false;
    clearTimeout(editorSaveTimeout);
}

function setEditorDirty(dirty) {
    editorDirty = dirty;
    const dot = document.getElementById('editorDirtyDot');
    const btn = document.getElementById('editorSaveBtn');
    if (dot) dot.style.display = dirty ? 'inline' : 'none';
    if (btn) btn.classList.toggle('unsaved', dirty);
}

function onEditorInput() {
    setEditorDirty(true);
    const ta = document.getElementById('editorTextarea');
    updateWordCount(ta.value);
    if (window._editorIsMarkdown && window._editorMode !== 'write') {
        renderMarkdownPreview(ta.value);
    }
    updateLineCol();

    // Auto-save after 2s idle
    clearTimeout(editorSaveTimeout);
    editorSaveTimeout = setTimeout(() => {
        if (editorDirty) saveEditor(true);
    }, 2000);
}

function onEditorKeydown(e) {
    // Ctrl+S / Cmd+S → save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveEditor();
        return;
    }
    // Ctrl+= or Ctrl++ → zoom in
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        editorZoomIn();
        return;
    }
    // Ctrl+- → zoom out
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        editorZoomOut();
        return;
    }
    // Ctrl+0 → reset zoom
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        editorZoomReset();
        return;
    }
    // Tab → insert 2 spaces
    if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.target;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        ta.value = ta.value.slice(0, start) + '  ' + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + 2;
        onEditorInput();
    }
}

function updateLineCol() {
    const ta = document.getElementById('editorTextarea');
    const el = document.getElementById('editorLineCol');
    if (!ta || !el) return;
    const text = ta.value.slice(0, ta.selectionStart);
    const lines = text.split('\n');
    el.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
}

function updateWordCount(text) {
    const el = document.getElementById('editorWordCount');
    if (!el) return;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    el.textContent = `${words} words · ${chars} chars`;
}

async function saveEditor(silent = false) {
    if (!editorFilepath) return;
    const ta = document.getElementById('editorTextarea');
    if (!ta) return;

    const statusEl = document.getElementById('editorStatus');
    if (statusEl) statusEl.textContent = 'Saving…';

    try {
        const res = await fetch(`/api/file/write/${encodeURIComponent(editorFilepath)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ content: ta.value })
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.msg || 'Save failed');

        setEditorDirty(false);
        if (statusEl) {
            statusEl.textContent = 'Saved ✓';
            setTimeout(() => { if (statusEl) statusEl.textContent = 'Ready'; }, 2000);
        }
        if (!silent) showToast('Saved successfully', 'success');
        // Refresh file list in background
        loadFiles(currentPath);
    } catch (e) {
        if (statusEl) statusEl.textContent = 'Save failed!';
        if (!silent) showToast(e.message, 'error');
    }
}

/* ------ Mode switcher (write / preview / split) ------ */
function setEditorMode(mode) {
    window._editorMode = mode;
    const write = document.getElementById('editorPaneWrite');
    const preview = document.getElementById('editorPanePreview');
    const body = document.getElementById('editorBody');
    const ta = document.getElementById('editorTextarea');

    document.querySelectorAll('.editor-mode-tab').forEach(t => t.classList.remove('active'));
    const tab = document.getElementById('tab' + mode.charAt(0).toUpperCase() + mode.slice(1));
    if (tab) tab.classList.add('active');

    if (mode === 'write') {
        write.style.display = 'flex';
        if (preview) preview.style.display = 'none';
        body.classList.remove('split-mode');
    } else if (mode === 'preview') {
        write.style.display = 'none';
        if (preview) preview.style.display = 'flex';
        body.classList.remove('split-mode');
        renderMarkdownPreview(ta.value);
    } else {
        write.style.display = 'flex';
        if (preview) preview.style.display = 'flex';
        body.classList.add('split-mode');
        renderMarkdownPreview(ta.value);
    }
}

/* ------ Markdown renderer (no external deps, pure JS) ------ */
function renderMarkdownPreview(text) {
    const el = document.getElementById('editorPreviewContent');
    if (!el) return;
    el.innerHTML = parseMarkdown(text);
    // Highlight code blocks if possible
    el.querySelectorAll('pre code').forEach(block => {
        block.style.display = 'block';
    });
}

function parseMarkdown(md) {
    // Escape HTML first (for security), then apply markdown
    let html = md
        // Escape HTML tags
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Fenced code blocks (``` ... ```)
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
        `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`);

    // Block: headers
    html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Blockquote
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // HR
    html = html.replace(/^(---|\*\*\*|___)$/gm, '<hr>');

    // Task lists (before regular lists)
    html = html.replace(/^- \[x\] (.+)$/gm, '<li class="task-done"><input type="checkbox" checked disabled> $1</li>');
    html = html.replace(/^- \[ \] (.+)$/gm, '<li class="task"><input type="checkbox" disabled> $1</li>');

    // Unordered list items
    html = html.replace(/^[-*+] (.+)$/gm, '<li>$1</li>');
    // Ordered list items
    html = html.replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>');

    // Wrap adjacent <li> in <ul>, <oli> in <ol>
    html = html.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
    html = html.replace(/(<oli>.*<\/oli>\n?)+/g, m => `<ol>${m.replace(/<\/?oli>/g, m2 => m2.replace('oli','li'))}</ol>`);

    // Tables
    html = html.replace(/((?:^\|.+\|\n?)+)/gm, (tableBlock) => {
        const rows = tableBlock.trim().split('\n');
        let tableHtml = '<table>';
        rows.forEach((row, i) => {
            if (/^\|[-:| ]+\|$/.test(row.trim())) return; // separator row
            const cells = row.split('|').slice(1, -1);
            const tag = i === 0 ? 'th' : 'td';
            tableHtml += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
        });
        tableHtml += '</table>';
        return tableHtml;
    });

    // Inline: bold, italic, strikethrough, code, links, images
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%">');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Paragraphs: blank lines → <p> breaks
    html = html.replace(/\n{2,}/g, '</p><p>');
    html = '<p>' + html + '</p>';

    // Clean up empty <p>
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>(<h[1-6]|<ul|<ol|<blockquote|<pre|<hr|<table)/g, '$1');
    html = html.replace(/(<\/h[1-6]>|<\/ul>|<\/ol>|<\/blockquote>|<\/pre>|<hr>|<\/table>)<\/p>/g, '$1');

    return html;
}

/* ------ Markdown toolbar helpers ------ */
function mdWrap(before, after) {
    const ta = document.getElementById('editorTextarea');
    const start = ta.selectionStart, end = ta.selectionEnd;
    const selected = ta.value.slice(start, end) || 'text';
    const replacement = before + selected + after;
    ta.setRangeText(replacement, start, end, 'select');
    ta.focus();
    onEditorInput();
}

function mdInsertLine(prefix) {
    const ta = document.getElementById('editorTextarea');
    const start = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    ta.setRangeText(prefix, lineStart, lineStart, 'end');
    ta.focus();
    onEditorInput();
}

function mdInsertLink() {
    const url = prompt('URL:', 'https://');
    if (!url) return;
    const text = prompt('Link text:', 'link text') || 'link text';
    const ta = document.getElementById('editorTextarea');
    const start = ta.selectionStart, end = ta.selectionEnd;
    ta.setRangeText(`[${text}](${url})`, start, end, 'end');
    ta.focus();
    onEditorInput();
}

function mdInsertHR() {
    const ta = document.getElementById('editorTextarea');
    const pos = ta.selectionStart;
    ta.setRangeText('\n\n---\n\n', pos, pos, 'end');
    ta.focus();
    onEditorInput();
}

function mdInsertCodeBlock() {
    const lang = prompt('Language (optional):', '') || '';
    const ta = document.getElementById('editorTextarea');
    const start = ta.selectionStart, end = ta.selectionEnd;
    const selected = ta.value.slice(start, end) || 'code here';
    ta.setRangeText(`\n\`\`\`${lang}\n${selected}\n\`\`\`\n`, start, end, 'end');
    ta.focus();
    onEditorInput();
}

function mdInsertTable() {
    const cols = parseInt(prompt('Number of columns:', '3')) || 3;
    const rows = parseInt(prompt('Number of rows (excluding header):', '2')) || 2;
    const header = Array.from({length: cols}, (_, i) => ` Col ${i+1} `).join('|');
    const sep = Array.from({length: cols}, () => ' --- ').join('|');
    const row = Array.from({length: cols}, () => '     ').join('|');
    const table = `\n|${header}|\n|${sep}|\n` + Array.from({length: rows}, () => `|${row}|`).join('\n') + '\n';
    const ta = document.getElementById('editorTextarea');
    const pos = ta.selectionStart;
    ta.setRangeText(table, pos, pos, 'end');
    ta.focus();
    onEditorInput();
}

/* =====================================================
   EDITOR FONT ZOOM & FAMILY
   ===================================================== */

let editorFontSize = parseInt(localStorage.getItem('editorFontSize') || '14');
let editorFontFamily = localStorage.getItem('editorFontFamily') || 'monospace';

function applyEditorFontSize() {
    const ta = document.getElementById('editorTextarea');
    if (ta) ta.style.fontSize = editorFontSize + 'px';
    const display = document.getElementById('editorFontSizeDisplay');
    if (display) display.textContent = editorFontSize + 'px';
    localStorage.setItem('editorFontSize', editorFontSize);
}

function applyEditorFont(family) {
    editorFontFamily = family || editorFontFamily;
    const ta = document.getElementById('editorTextarea');
    if (ta) ta.style.fontFamily = editorFontFamily;
    const sel = document.getElementById('editorFontFamily');
    if (sel) sel.value = editorFontFamily;
    localStorage.setItem('editorFontFamily', editorFontFamily);
}

function editorZoomIn() {
    if (editorFontSize < 32) { editorFontSize += 2; applyEditorFontSize(); }
}

function editorZoomOut() {
    if (editorFontSize > 10) { editorFontSize -= 2; applyEditorFontSize(); }
}

function editorZoomReset() {
    editorFontSize = 14; applyEditorFontSize();
}

/* =====================================================
   HAMBURGER / KEBAB MENU
   ===================================================== */

function toggleMenu(event, menuId) {
    event.stopPropagation();
    const menu = document.getElementById(menuId);
    if (!menu) return;

    const isOpen = menu.classList.contains('open');
    closeAllMenus();

    if (!isOpen) {
        menu.classList.add('open');

        // Flip to left if too close to right edge
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth - 16) {
            menu.style.right = '0';
            menu.style.left = 'auto';
        } else {
            menu.style.left = '0';
            menu.style.right = 'auto';
        }

        // Flip up if too close to bottom
        setTimeout(() => {
            const r = menu.getBoundingClientRect();
            if (r.bottom > window.innerHeight - 16) {
                menu.style.bottom = '100%';
                menu.style.top = 'auto';
            }
        }, 0);
    }
}

function closeAllMenus() {
    document.querySelectorAll('.kebab-menu.open').forEach(m => {
        m.classList.remove('open');
        m.style.bottom = '';
        m.style.top = '';
    });
}

// Close menus on any click outside
document.addEventListener('click', closeAllMenus);

/* =====================================================
   DRAG & DROP — MOVE FILES/FOLDERS
   ===================================================== */

let dragItem = null;  // { path, type }

function onDragStart(event) {
    const el = event.currentTarget;
    dragItem = {
        path: el.dataset.path,
        type: el.dataset.type
    };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragItem.path);
    el.classList.add('dragging');
    document.body.classList.add('is-dragging');
}

document.addEventListener('dragend', () => {
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.body.classList.remove('is-dragging');
    dragItem = null;
});

function onDragOver(event) {
    if (!dragItem) return;
    const el = event.currentTarget;
    const targetPath = el.dataset.path;
    const targetType = el.dataset.type;

    // Only allow drop on folders or the root drop zone
    if (targetType !== 'folder') return;
    // Don't allow dropping onto itself
    if (targetPath === dragItem.path) return;
    // Don't allow dropping a folder into its own subfolder
    if (dragItem.type === 'folder' && targetPath.startsWith(dragItem.path + '/')) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    el.classList.add('drag-over');
}

function onDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
}

async function onDrop(event) {
    event.preventDefault();
    const el = event.currentTarget;
    el.classList.remove('drag-over');

    if (!dragItem) return;

    const dstFolder = el.dataset.path || '';  // empty = root
    const src = dragItem.path;

    // No-op: dropping into current parent
    const srcParent = src.includes('/') ? src.substring(0, src.lastIndexOf('/')) : '';
    if (dstFolder === srcParent) return;
    // Can't drop folder into its own descendant
    if (dragItem.type === 'folder' && (dstFolder === src || dstFolder.startsWith(src + '/'))) return;

    try {
        const res = await fetch('/api/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ src, dst_folder: dstFolder })
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.msg || 'Move failed');
        showToast(data.msg, 'success');
        loadFiles(currentPath);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

/* =====================================================
   MOVE VIA DIALOG (for the menu "Move" option)
   ===================================================== */

async function promptMoveItem(srcPath, type) {
    // Load folder list to show options
    let folderList = ['(root)'];
    try {
        const res = await fetch('/api/files?folder=', {
            headers: { Authorization: 'Bearer ' + token }
        });
        const d = await safeJson(res);
        if (d.folders) {
            // Build flat list recursively (shallow: just top-level for now)
            folderList = folderList.concat(d.folders.map(f => f.name));
        }
    } catch (_) {}

    const existing = document.getElementById('moveDialog');
    if (existing) existing.remove();

    const name = srcPath.includes('/') ? srcPath.substring(srcPath.lastIndexOf('/') + 1) : srcPath;
    const dialog = document.createElement('div');
    dialog.id = 'moveDialog';
    dialog.className = 'move-dialog-overlay';
    dialog.innerHTML = `
        <div class="move-dialog">
            <div class="move-dialog-header">
                <span>Move "${escapeHtml(name)}"</span>
                <button class="move-dialog-close" onclick="document.getElementById('moveDialog').remove()">✕</button>
            </div>
            <div class="move-dialog-body">
                <label class="move-dialog-label">Destination folder path</label>
                <input class="move-dialog-input" id="moveDestInput" type="text"
                       placeholder="Leave blank for root, or type folder path"
                       value="${escapeHtml(currentPath)}">
                <div class="move-dialog-hint">Examples: <code>photos</code> · <code>work/docs</code> · leave blank for root</div>
                <div class="move-dialog-quick">Quick jump:</div>
                <div class="move-dialog-folders" id="moveFolderList">
                    <button class="move-folder-btn" onclick="document.getElementById('moveDestInput').value=''">📁 Root</button>
                    ${folderList.filter(f => f !== '(root)').map(f => `
                        <button class="move-folder-btn" onclick="document.getElementById('moveDestInput').value='${escapeHtml(f)}'">📁 ${escapeHtml(f)}</button>
                    `).join('')}
                </div>
            </div>
            <div class="move-dialog-footer">
                <button class="btn btn-text" onclick="document.getElementById('moveDialog').remove()">Cancel</button>
                <button class="btn btn-primary" onclick="executeMoveDialog('${escapeHtml(srcPath)}')">Move</button>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);
    document.getElementById('moveDestInput').focus();
}

async function executeMoveDialog(srcPath) {
    const dest = document.getElementById('moveDestInput')?.value.trim() || '';
    document.getElementById('moveDialog')?.remove();

    try {
        const res = await fetch('/api/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ src: srcPath, dst_folder: dest })
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.msg || 'Move failed');
        showToast(data.msg, 'success');
        loadFiles(currentPath);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

/* ═══════════════════════════════════════════════════════════════════
   RENAME FILE / FOLDER
═══════════════════════════════════════════════════════════════════ */
async function renameFileInline(filepath, currentName) {
    const newName = prompt(`Rename "${currentName}" to:`, currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;
    try {
        const res = await fetch('/api/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ filepath, new_name: newName.trim() })
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.msg || 'Rename failed');
        showToast('Renamed to ' + newName.trim(), 'success');
        loadFiles(currentPath);
    } catch (e) { showToast(e.message, 'error'); }
}

/* ═══════════════════════════════════════════════════════════════════
   MUSIC PLAYER
═══════════════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────────────
const mp = {
    tracks: [],
    playlists: [],
    favorites: new Set(),
    currentTrack: null,
    currentIndex: -1,
    queue: [],
    tab: 'all',      // 'all' | 'artist' | 'fav' | 'pl'
    activePl: null,
    shuffle: false,
    loop: 0,
    isInMusicMode: false,
    dlPollTimer: null,
    sidebarOpen: true,
};

const mpAudio = document.getElementById('mpAudio');

// ── Init ────────────────────────────────────────────────────────────
async function mpInit() {
    await mpLoadPrefs();
    await mpLoadTracks();
    mpRenderAll();
    mpBindAudio();
}

async function mpLoadPrefs() {
    try {
        const res = await fetch('/api/music/prefs', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) return;
        const data = await safeJson(res);
        mp.playlists = data.playlists || [];
        mp.favorites = new Set(data.favorites || []);
    } catch {}
}

async function mpSavePrefs() {
    try {
        await fetch('/api/music/prefs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ playlists: mp.playlists, favorites: [...mp.favorites] })
        });
    } catch {}
}

async function mpLoadTracks() {
    try {
        const res = await fetch('/api/music/tracks', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) return;
        const data = await safeJson(res);
        mp.tracks = data.tracks || [];
    } catch {}
}

// ── Mode switch ──────────────────────────────────────────────────────
function enterMusicMode() {
    mp.isInMusicMode = true;
    document.getElementById('musicOverlay').style.display = 'flex';
    document.getElementById('mpMiniBar').style.display = 'none';
    document.body.classList.remove('mp-mini-active');
    // Refresh tracks
    mpLoadTracks().then(() => mpRenderAll());
    // On mobile, default to "now playing" tab
    if (window.innerWidth <= 768) {
        mpMobileTab('now');
    }
}

function exitMusicMode() {
    mp.isInMusicMode = false;
    document.getElementById('musicOverlay').style.display = 'none';
    // Show mini bar if something is playing
    if (mp.currentTrack && !mpAudio.paused) {
        document.getElementById('mpMiniBar').style.display = 'flex';
        document.body.classList.add('mp-mini-active');
        document.getElementById('mpMiniTitle').textContent = mp.currentTrack;
    }
}

// ── Mobile tab switching ─────────────────────────────────────────────
function mpMobileTab(tab) {
    if (window.innerWidth > 768) return; // no-op on desktop
    const sidebar = document.getElementById('mpSidebar');
    const lyricsPanel = document.getElementById('mpLyricsPanel');
    const mainEl = document.getElementById('mpMain');

    // Deactivate all
    sidebar?.classList.remove('mp-mob-active');
    lyricsPanel?.classList.remove('mp-mob-active');
    if (mainEl) mainEl.style.display = '';

    document.querySelectorAll('.mp-mob-tab').forEach(b => b.classList.remove('active'));

    if (tab === 'songs') {
        sidebar?.classList.add('mp-mob-active');
        if (mainEl) mainEl.style.display = 'none';
        document.getElementById('mpMobTabSongs')?.classList.add('active');
    } else if (tab === 'lyrics') {
        lyricsPanel?.classList.add('mp-mob-active');
        if (mainEl) mainEl.style.display = 'none';
        document.getElementById('mpMobTabLyrics')?.classList.add('active');
        // Auto-fetch lyrics if needed
        if (mp.currentTrack && mp.currentTrack !== mpLyrics.loadedFor) {
            mpFetchLyrics(mp.currentTrack);
        } else if (mpLyrics.synced) {
            mpStartLyricSync();
        }
    } else { // 'now'
        if (mainEl) mainEl.style.display = '';
        document.getElementById('mpMobTabNow')?.classList.add('active');
    }
}

// ── Tab switching ────────────────────────────────────────────────────
function mpSetTab(tab) {
    mp.tab = tab;
    mp.activePl = null;
    document.querySelectorAll('.mp-tab').forEach(t => t.classList.remove('active'));
    const ids = {all:'All', artist:'Artist', fav:'Fav', pl:'Pl'};
    document.getElementById('mpTab' + (ids[tab] || 'All'))?.classList.add('active');
    const trackList = document.getElementById('mpTrackList');
    const artistPanel = document.getElementById('mpArtistPanel');
    const plPanel = document.getElementById('mpPlaylistPanel');
    if (trackList) trackList.style.display  = (tab === 'pl' || tab === 'artist') ? 'none' : 'block';
    if (artistPanel) artistPanel.style.display = tab === 'artist' ? 'block' : 'none';
    if (plPanel) plPanel.style.display      = tab === 'pl' ? 'flex' : 'none';
    if (tab === 'artist') mpRenderArtistPanel();
    else if (tab === 'pl') mpRenderPlaylists();
    else mpRenderTrackList();
}

function mpToggleSidebar() {
    const sb = document.getElementById('mpSidebar');
    if (!sb) return;
    if (window.innerWidth <= 768) {
        sb.classList.toggle('mp-open');
    } else {
        sb.classList.toggle('mp-collapsed');
    }
}

// ── Filter / sort ────────────────────────────────────────────────────
function mpFilterTracks() {
    mpRenderTrackList();
}

function mpGetFilteredTracks() {
    const q = (document.getElementById('mpSearch')?.value || '').toLowerCase();
    const sort = document.getElementById('mpSort')?.value || 'name';
    let list = mp.tracks.filter(t => {
        if (mp.tab === 'fav' && !mp.favorites.has(t.name)) return false;
        if (q && !t.name.toLowerCase().includes(q)) return false;
        return true;
    });
    if (sort === 'recent') list = [...list].sort((a,b) => b.modified - a.modified);
    else if (sort === 'fav') list = [...list].sort((a,b) => {
        const fa = mp.favorites.has(a.name), fb = mp.favorites.has(b.name);
        if (fa && !fb) return -1; if (!fa && fb) return 1; return a.name.localeCompare(b.name);
    });
    else list = [...list].sort((a,b) => a.name.localeCompare(b.name));
    return list;
}

// ── Render ────────────────────────────────────────────────────────────
function mpRenderAll() {
    mpRenderTrackList();
    mpRenderNowPlaying();
    mpRenderBtns();
}

function mpThumbUrl(trackName) {
    // Look for matching .webp sidecar file
    const base = trackName.replace(/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|webm)$/i, '');
    return '/api/music/stream/' + encodeURIComponent(base + '.webp') + '?token=' + encodeURIComponent(token);
}

function mpTrackHasThumb(trackName) {
    // Check if a webp exists in track list
    const base = trackName.replace(/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|webm)$/i, '');
    return mp.tracks.some(t => t.name === base + '.webp');
}

function mpRenderTrackRow(t, i, context, plId) {
    const isActive = t.name === mp.currentTrack;
    const isFav = mp.favorites.has(t.name);
    const title = mpGuessTitle(t.name);
    const artist = mpGuessArtist(t.name);
    const hasThumb = mpTrackHasThumb(t.name);
    const thumbUrl = hasThumb ? mpThumbUrl(t.name) : '';
    const onClick = context === 'pl'
        ? `mpPlayTrackFrom('${escapeHtml(t.name)}','pl','${escapeHtml(plId)}')`
        : `mpPlayTrack('${escapeHtml(t.name)}')`;
    return `<div class="mp-track-item${isActive ? ' active' : ''}" onclick="${onClick}">
        <div class="mp-track-art">
            ${hasThumb
                ? `<img src="${thumbUrl}" loading="lazy" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`
                : ''}
            <div class="mp-track-art-placeholder" style="${hasThumb ? 'display:none' : ''}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            </div>
            <div class="mp-track-art-overlay">
                ${isActive
                    ? '<span></span><span></span><span></span>'
                    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`}
            </div>
        </div>
        <div class="mp-track-info">
            <div class="mp-track-name${isActive ? ' active' : ''}">${escapeHtml(title)}</div>
            <div class="mp-track-sub">${artist ? escapeHtml(artist) : '<span style="opacity:.5">Unknown Artist</span>'}</div>
        </div>
        <button class="mp-track-fav${isFav ? ' liked' : ''}" onclick="mpToggleFavTrack('${escapeHtml(t.name)}',event)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFav ? '#f472b6' : 'none'}" stroke="${isFav ? '#f472b6' : 'currentColor'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
        <button class="mp-track-more" onclick="mpOpenTrackCtx(event,'${escapeHtml(t.name)}')">⋯</button>
    </div>`;
}

function mpRenderTrackList() {
    const el = document.getElementById('mpTrackList');
    if (!el) return;
    const list = mpGetFilteredTracks();
    if (list.length === 0) {
        if (mp.tab === 'fav') {
            el.innerHTML = `<div class="mp-empty">
                <div class="mp-empty-icon">♡</div>
                <div>No liked songs yet</div>
                <div style="font-size:12px;margin-top:4px;opacity:.6">Heart a track to add it here</div>
            </div>`;
        } else if (mp.tracks.filter(t => !/\.(webp)$/i.test(t.name)).length === 0) {
            // Truly empty library — show graphic
            el.innerHTML = `<div class="mp-library-empty">
                <div class="mp-library-empty-graphic">
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M9 18V5l12-2v13"/>
                        <circle cx="6" cy="18" r="3"/>
                        <circle cx="18" cy="16" r="3"/>
                    </svg>
                </div>
                <div class="mp-library-empty-title">Your library is empty</div>
                <div class="mp-library-empty-sub">Add songs via YouTube link,<br>channel download, or file upload</div>
                <button class="mp-library-empty-btn" onclick="openMusicAddPanel()">
                    + Add Music
                </button>
            </div>`;
        } else {
            el.innerHTML = `<div class="mp-empty">
                <div class="mp-empty-icon">🔍</div>
                <div>No tracks found</div>
                <div style="font-size:12px;margin-top:4px;opacity:.6">Try a different search</div>
            </div>`;
        }
        return;
    }
    el.innerHTML = list.map((t, i) => mpRenderTrackRow(t, i, 'all', null)).join('');
}

function mpRenderArtistPanel() {
    const el = document.getElementById('mpArtistPanel');
    if (!el) return;
    // Group by artist
    const groups = {};
    const sorted = [...mp.tracks]
        .filter(t => !/\.(webp)$/i.test(t.name))
        .sort((a,b) => a.name.localeCompare(b.name));
    sorted.forEach(t => {
        const artist = mpGuessArtist(t.name) || 'Unknown Artist';
        if (!groups[artist]) groups[artist] = [];
        groups[artist].push(t);
    });
    const artistNames = Object.keys(groups).sort((a,b) => a.localeCompare(b));
    if (!artistNames.length) {
        el.innerHTML = '<div class="mp-empty"><div class="mp-empty-icon">🎤</div><div>No artists found</div><div style="font-size:12px;margin-top:4px;opacity:.6">Click "Find Artists" to tag your library</div></div>';
        return;
    }
    el.innerHTML = artistNames.map(artist => {
        const tracks = groups[artist];
        const initial = artist.charAt(0).toUpperCase();
        // Try to find thumbnail from first track
        const firstWithThumb = tracks.find(t => mpTrackHasThumb(t.name));
        const thumbHtml = firstWithThumb
            ? `<img src="${mpThumbUrl(firstWithThumb.name)}" loading="lazy" onerror="this.style.display='none'">`
            : `<span>${initial}</span>`;
        const tracksHtml = tracks.map((t, i) => mpRenderTrackRow(t, i, 'all', null)).join('');
        const safeArtist = escapeHtml(artist).replace(/'/g, "\'");
        return `<div class="mp-artist-section" id="mpArtist_${initial}_${tracks.length}">
            <div class="mp-artist-row" onclick="mpToggleArtist(this)">
                <div class="mp-artist-img">${thumbHtml}</div>
                <div class="mp-artist-info">
                    <div class="mp-artist-name">${escapeHtml(artist)}</div>
                    <div class="mp-artist-count">${tracks.length} song${tracks.length !== 1 ? 's' : ''}</div>
                </div>
                <svg class="mp-artist-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
            <div class="mp-artist-tracks" style="display:none">${tracksHtml}</div>
        </div>`;
    }).join('');
}

function mpToggleArtist(rowEl) {
    const section = rowEl.closest('.mp-artist-section');
    const tracks = section.querySelector('.mp-artist-tracks');
    const chevron = section.querySelector('.mp-artist-chevron');
    const isOpen = tracks.style.display !== 'none';
    tracks.style.display = isOpen ? 'none' : 'block';
    chevron.style.transform = isOpen ? '' : 'rotate(90deg)';
}

function mpRenderNowPlaying() {
    const titleEl   = document.getElementById('mpNowTitle');
    const subEl     = document.getElementById('mpNowSub');
    const vinyl     = document.getElementById('mpVinyl');
    const bars      = document.getElementById('mpBars');
    const miniTitle = document.getElementById('mpMiniTitle');
    const miniSub   = document.getElementById('mpMiniSub');
    if (!titleEl) return;

    if (mp.currentTrack) {
        const title  = mpGuessTitle(mp.currentTrack);
        const artist = mpGuessArtist(mp.currentTrack);
        titleEl.textContent = title;
        subEl.textContent   = artist || 'Unknown Artist';
        document.title      = title + ' — Home Server';
        if (miniTitle) miniTitle.textContent = title;
        if (miniSub)   miniSub.textContent   = artist || 'Unknown Artist';

        // Show thumbnail in artwork panel
        const thumbImg    = document.getElementById('mpThumbImg');
        const vinylInner  = document.getElementById('mpVinylInner');
        const hasThumb    = mpTrackHasThumb(mp.currentTrack);
        if (thumbImg) {
            if (hasThumb) {
                thumbImg.src = mpThumbUrl(mp.currentTrack);
                thumbImg.style.display = 'block';
                vinyl?.classList.add('has-thumb');
                if (vinylInner) vinylInner.style.display = 'none';
            } else {
                thumbImg.style.display = 'none';
                vinyl?.classList.remove('has-thumb');
                if (vinylInner) vinylInner.style.display = '';
            }
        }

        // Mini bar thumbnail
        const miniThumb = document.getElementById('mpMiniThumb');
        if (miniThumb) {
            if (hasThumb) {
                miniThumb.innerHTML = `<img src="${mpThumbUrl(mp.currentTrack)}" onerror="this.parentNode.innerHTML='♪'">`;
            } else {
                miniThumb.textContent = '♪';
            }
        }
    } else {
        titleEl.textContent = 'No track selected';
        subEl.textContent   = 'Add music to get started';
        document.title      = 'Home Server';
        const thumbImg = document.getElementById('mpThumbImg');
        if (thumbImg) thumbImg.style.display = 'none';
        document.getElementById('mpVinyl')?.classList.remove('has-thumb');
    }

    const playing = mp.currentTrack && !mpAudio.paused;
    if (bars) bars.classList.toggle('playing', playing);

    // Heart button
    const heartBtn  = document.getElementById('mpHeartBtn');
    const heartIcon = document.getElementById('mpHeartIcon');
    if (heartBtn && mp.currentTrack) {
        const isFav = mp.favorites.has(mp.currentTrack);
        heartBtn.classList.toggle('active', isFav);
        if (heartIcon) heartIcon.setAttribute('fill', isFav ? '#f472b6' : 'none');
    }
}

function mpToggleExpand() {
    document.getElementById('mpMain')?.classList.toggle('expanded');
}

function mpRenderBtns() {
    const playIconEl = document.getElementById('mpPlayIconSvg');
    const playIcon = document.getElementById('mpPlayIcon');
    const miniPlay = document.getElementById('mpMiniPlay');
    const playing = !mpAudio.paused && mp.currentTrack;
    if (playIcon) {
        if (playing) {
            // Pause icon
            playIcon.setAttribute('points', '');
            playIconEl.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>';
        } else {
            playIconEl.innerHTML = '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>';
        }
    }
    if (miniPlay) miniPlay.textContent = playing ? '⏸' : '▶';

    // Vinyl spin
    const vinyl = document.getElementById('mpVinyl');
    if (vinyl) vinyl.classList.toggle('spinning', !!playing);

    const nav = document.getElementById('musicNavItem');
    const badge = document.getElementById('musicNavBadge');
    if (nav && badge) badge.style.display = playing ? 'inline' : 'none';

    // Shuffle
    const shuffleBtn = document.getElementById('mpShuffleBtn');
    if (shuffleBtn) shuffleBtn.classList.toggle('active', mp.shuffle);

    // Loop — distinct icons for off/all/one
    const loopBtn = document.getElementById('mpLoopBtn');
    if (loopBtn) {
        loopBtn.classList.remove('loop-all', 'loop-one');
        if (mp.loop === 1) {
            loopBtn.classList.add('active', 'loop-all');
            loopBtn.title = 'Loop all';
        } else if (mp.loop === 2) {
            loopBtn.classList.add('active', 'loop-one');
            loopBtn.title = 'Loop one';
        } else {
            loopBtn.classList.remove('active');
            loopBtn.title = 'Loop off';
        }
    }
}

function mpRenderPlaylists() {
    const el = document.getElementById('mpPlaylists');
    if (!el) return;
    if (mp.playlists.length === 0) {
        el.innerHTML = '<div style="color:#555;font-size:13px;padding:12px 8px">No playlists yet. Create one above.</div>';
    } else {
        el.innerHTML = mp.playlists.map(pl => `
            <div class="mp-pl-item${mp.activePl === pl.id ? ' active' : ''}" onclick="mpSelectPlaylist('${escapeHtml(pl.id)}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                <div class="mp-pl-name">${escapeHtml(pl.name)}</div>
                <div class="mp-pl-count">${pl.tracks.length}</div>
                <div class="mp-pl-actions" onclick="event.stopPropagation()">
                    <button class="mp-pl-edit" onclick="mpRenamePlaylist('${escapeHtml(pl.id)}')" title="Rename">✎</button>
                    <button class="mp-pl-del" onclick="mpDeletePlaylist('${escapeHtml(pl.id)}',event)" title="Delete">✕</button>
                </div>
            </div>`).join('');
    }
    if (mp.activePl) mpRenderPlaylistTracks();
}

function mpRenamePlaylist(id) {
    const pl = mp.playlists.find(p => p.id === id);
    if (!pl) return;
    const newName = prompt('Rename playlist:', pl.name);
    if (!newName || !newName.trim() || newName.trim() === pl.name) return;
    pl.name = newName.trim();
    mpSavePrefs();
    mpRenderPlaylists();
    showToast('Playlist renamed', 'success');
}

function mpRenderPlaylistTracks() {
    const el = document.getElementById('mpPlaylistTracks');
    if (!el) return;
    const pl = mp.playlists.find(p => p.id === mp.activePl);
    if (!pl) { el.innerHTML = ''; return; }

    // Edit bar with controls
    const editBar = `<div class="mp-pl-edit-bar">
        <span class="mp-pl-edit-title">✎ ${escapeHtml(pl.name)}</span>
        <button onclick="mpPlayPlaylist('${escapeHtml(pl.id)}')">▶ Play all</button>
        <button onclick="mpPlAddSongs('${escapeHtml(pl.id)}')">+ Add songs</button>
    </div>`;

    if (pl.tracks.length === 0) {
        el.innerHTML = editBar + `<div class="mp-empty" style="padding:16px 8px"><div class="mp-empty-icon">🎵</div><div>Playlist is empty</div><div style="font-size:11px;opacity:.6;margin-top:4px">Click "+ Add songs" or right-click a track</div></div>`;
        return;
    }

    const rows = pl.tracks.map((tn, i) => {
        const title = mpGuessTitle(tn);
        const artist = mpGuessArtist(tn);
        const isActive = tn === mp.currentTrack;
        const hasThumb = mpTrackHasThumb(tn);
        return `<div class="mp-track-item${isActive ? ' active' : ''}" draggable="true"
            data-pl-track="${escapeHtml(tn)}" data-pl-idx="${i}"
            ondragstart="mpPlDragStart(event,${i})"
            ondragover="mpPlDragOver(event)"
            ondrop="mpPlDrop(event,'${escapeHtml(pl.id)}')"
            ondragend="mpPlDragEnd(event)"
            onclick="mpPlayTrackFrom('${escapeHtml(tn)}','pl','${escapeHtml(pl.id)}')" >
            <div class="mp-drag-handle" title="Drag to reorder">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
            </div>
            <div class="mp-track-art">
                ${hasThumb ? `<img src="${mpThumbUrl(tn)}" loading="lazy" onerror="this.style.display='none';this.nextSibling.style.display='flex'">` : ''}
                <div class="mp-track-art-placeholder" style="${hasThumb ? 'display:none' : ''}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                </div>
                <div class="mp-track-art-overlay">${isActive ? '<span></span><span></span><span></span>' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>'}</div>
            </div>
            <div class="mp-track-info">
                <div class="mp-track-name${isActive ? ' active' : ''}">${escapeHtml(title)}</div>
                <div class="mp-track-sub">${artist ? escapeHtml(artist) : '<span style="opacity:.5">Unknown Artist</span>'}</div>
            </div>
            <button class="mp-pl-del" onclick="mpPlRemoveTrack('${escapeHtml(pl.id)}','${escapeHtml(tn)}',event)" title="Remove">✕</button>
        </div>`;
    }).join('');

    el.innerHTML = editBar + rows;
}

// Drag-to-reorder for playlists
let _mpDragIdx = -1;
function mpPlDragStart(e, idx) {
    _mpDragIdx = idx;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}
function mpPlDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}
function mpPlDrop(e, plId) {
    e.preventDefault();
    const target = e.currentTarget;
    const toIdx = parseInt(target.dataset.plIdx, 10);
    if (_mpDragIdx === -1 || _mpDragIdx === toIdx) return;
    const pl = mp.playlists.find(p => p.id === plId);
    if (!pl) return;
    const moved = pl.tracks.splice(_mpDragIdx, 1)[0];
    pl.tracks.splice(toIdx, 0, moved);
    _mpDragIdx = -1;
    mpSavePrefs();
    mpRenderPlaylistTracks();
}
function mpPlDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    _mpDragIdx = -1;
}

function mpPlRemoveTrack(plId, trackName, event) {
    event.stopPropagation();
    const pl = mp.playlists.find(p => p.id === plId);
    if (!pl) return;
    pl.tracks = pl.tracks.filter(t => t !== trackName);
    mpSavePrefs();
    mpRenderPlaylistTracks();
}

function mpPlAddSongs(plId) {
    // Show a modal/sheet with all tracks not already in playlist
    const pl = mp.playlists.find(p => p.id === plId);
    if (!pl) return;
    const available = mp.tracks.filter(t => !/\.(webp)$/i.test(t.name) && !pl.tracks.includes(t.name));
    if (!available.length) { showToast('All tracks already in playlist', 'info'); return; }

    // Simple prompt-style: show list in a context menu approach
    const menu = document.getElementById('mpAddToPLMenu');
    if (!menu) return;
    menu.innerHTML = `<div style="padding:6px 10px 4px;font-size:11px;font-weight:700;color:var(--mp-sub);text-transform:uppercase;letter-spacing:.5px">Add to "${escapeHtml(pl.name)}"</div>
        <div class="mp-ctx-sep"></div>` +
        available.slice(0, 30).map(t => `
        <button class="mp-ctx-item" onclick="mpAddTrackToPl('${escapeHtml(t.name)}','${escapeHtml(plId)}')">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            ${escapeHtml(mpGuessTitle(t.name))}
        </button>`).join('') +
        (available.length > 30 ? `<div style="padding:6px 12px;font-size:11px;color:var(--mp-sub)">(${available.length - 30} more — use right-click on tracks)</div>` : '');

    const btn = document.querySelector('.mp-pl-edit-bar button:last-child');
    mpPositionMenu(menu, btn);
}

// ── Playback ──────────────────────────────────────────────────────────
function mpBuildQueue(startName) {
    const list = mpGetFilteredTracks().map(t => t.name);
    if (mp.shuffle) {
        const i = list.indexOf(startName);
        const rest = list.filter(n => n !== startName);
        for (let j = rest.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [rest[j], rest[k]] = [rest[k], rest[j]];
        }
        mp.queue = [startName, ...rest];
    } else {
        const idx = list.indexOf(startName);
        mp.queue = [...list.slice(idx), ...list.slice(0, idx)];
    }
    mp.currentIndex = 0;
}

function mpPlayTrack(name) {
    mpBuildQueue(name);
    mpLoad(name);
    mpAudio.play().catch(() => {});
}

function mpPlayTrackFrom(name, context, plId) {
    if (context === 'pl') {
        const pl = mp.playlists.find(p => p.id === plId);
        if (pl) mp.queue = [...pl.tracks];
        mp.currentIndex = mp.queue.indexOf(name);
    } else {
        mpBuildQueue(name);
    }
    mpLoad(name);
    mpAudio.play().catch(() => {});
}

function mpPlayPlaylist(plId) {
    const pl = mp.playlists.find(p => p.id === plId);
    if (!pl || pl.tracks.length === 0) return showToast('Playlist is empty', 'error');
    mp.queue = [...pl.tracks];
    if (mp.shuffle) {
        for (let i = mp.queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [mp.queue[i], mp.queue[j]] = [mp.queue[j], mp.queue[i]];
        }
    }
    mp.currentIndex = 0;
    mpLoad(mp.queue[0]);
    mpAudio.play().catch(() => {});
}

function mpLoad(name) {
    mp.currentTrack = name;
    mpAudio.src = '/api/music/stream/' + encodeURIComponent(name) + '?token=' + encodeURIComponent(token);
    mpAudio.load();
    mpRenderNowPlaying();
    mpRenderTrackList();
    mpRenderBtns();
    // Auto-fetch lyrics for new track
    if (name !== mpLyrics.loadedFor) {
        mpStopLyricSync();
        mpLyrics.loadedFor = null;
        mpFetchLyrics(name);
    }
}

function mpTogglePlay() {
    if (!mp.currentTrack) {
        const list = mpGetFilteredTracks();
        if (list.length > 0) mpPlayTrack(list[0].name);
        return;
    }
    if (mpAudio.paused) mpAudio.play().catch(() => {});
    else mpAudio.pause();
}

function mpPrev() {
    if (!mp.queue.length) return;
    if (mpAudio.currentTime > 3) { mpAudio.currentTime = 0; return; }
    mp.currentIndex = (mp.currentIndex - 1 + mp.queue.length) % mp.queue.length;
    mpLoad(mp.queue[mp.currentIndex]);
    mpAudio.play().catch(() => {});
}

function mpNext() {
    if (!mp.queue.length) return;
    if (mp.loop === 2) { mpAudio.currentTime = 0; mpAudio.play().catch(() => {}); return; }
    mp.currentIndex = (mp.currentIndex + 1) % mp.queue.length;
    if (mp.currentIndex === 0 && mp.loop === 0) { mpAudio.pause(); return; }
    mpLoad(mp.queue[mp.currentIndex]);
    mpAudio.play().catch(() => {});
}

function mpToggleShuffle() {
    mp.shuffle = !mp.shuffle;
    if (mp.currentTrack) mpBuildQueue(mp.currentTrack);
    mpRenderBtns();
}

function mpCycleLoop() {
    mp.loop = (mp.loop + 1) % 3;
    mpRenderBtns();
}

function mpSetVol(v) {
    mpAudio.volume = v / 100;
    const lbl = document.getElementById('mpVolLabel');
    if (lbl) lbl.textContent = v + '%';
}

// ── Audio event binding ──────────────────────────────────────────────
function mpBindAudio() {
    mpAudio.addEventListener('play',    () => { mpRenderBtns(); mpRenderNowPlaying(); });
    mpAudio.addEventListener('pause',   () => { mpRenderBtns(); mpRenderNowPlaying(); });
    mpAudio.addEventListener('ended',   mpNext);

    // Auto-remove broken/missing tracks
    mpAudio.addEventListener('error', () => {
        if (!mp.currentTrack) return;
        const broken = mp.currentTrack;
        console.warn('Track failed to load, removing:', broken);
        // Remove from tracks list
        mp.tracks = mp.tracks.filter(t => t.name !== broken);
        // Remove from all playlists
        mp.playlists.forEach(pl => { pl.tracks = pl.tracks.filter(n => n !== broken); });
        mp.favorites.delete(broken);
        // Remove from queue
        const qi = mp.queue.indexOf(broken);
        if (qi !== -1) mp.queue.splice(qi, 1);
        if (mp.currentIndex >= mp.queue.length) mp.currentIndex = 0;
        mpSavePrefs();
        showToast('Removed broken track: ' + mpGuessTitle(broken), 'error');
        // Try to delete from server silently
        fetch('/api/music/delete', {
            method: 'DELETE',
            headers: {'Content-Type':'application/json', Authorization: 'Bearer ' + token},
            body: JSON.stringify({filename: broken})
        }).catch(() => {});
        // Play next if queue has tracks
        if (mp.queue.length > 0) {
            mpLoad(mp.queue[mp.currentIndex]);
            mpAudio.play().catch(() => {});
        } else {
            mp.currentTrack = null;
            mpRenderNowPlaying();
        }
        mpRenderTrackList();
    });

    mpAudio.addEventListener('timeupdate', () => {
        if (!mpAudio.duration || !isFinite(mpAudio.duration)) return;
        const pct = (mpAudio.currentTime / mpAudio.duration) * 100;
        const fill  = document.getElementById('mpProgressFill');
        const thumb = document.getElementById('mpProgressThumb');
        const cur   = document.getElementById('mpCurrentTime');
        const dur   = document.getElementById('mpDuration');
        if (fill)  fill.style.width  = pct + '%';
        if (thumb) thumb.style.left  = pct + '%';
        if (cur)   cur.textContent   = mpFmtTime(mpAudio.currentTime);
        if (dur)   dur.textContent   = mpFmtTime(mpAudio.duration);
    });

    // Progress bar click + drag
    const bar = document.getElementById('mpProgressBar');
    if (bar) {
        let dragging = false;
        const seek = (e) => {
            const r = bar.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            if (mpAudio.duration) mpAudio.currentTime = pct * mpAudio.duration;
        };
        bar.addEventListener('mousedown', e => { dragging = true; seek(e); });
        document.addEventListener('mousemove', e => { if (dragging) seek(e); });
        document.addEventListener('mouseup',   () => { dragging = false; });
        bar.addEventListener('touchstart', e => { seek(e.touches[0]); }, { passive: true });
        bar.addEventListener('touchmove',  e => { seek(e.touches[0]); }, { passive: true });
    }
}

function mpFmtTime(s) {
    if (!s || !isFinite(s)) return '0:00';
    return Math.floor(s / 60) + ':' + Math.floor(s % 60).toString().padStart(2, '0');
}

// ── Favorites ────────────────────────────────────────────────────────
function mpToggleFav() {
    if (!mp.currentTrack) return;
    mpToggleFavTrack(mp.currentTrack);
}

function mpToggleFavTrack(name, event) {
    if (event) event.stopPropagation();
    if (mp.favorites.has(name)) mp.favorites.delete(name);
    else mp.favorites.add(name);
    mpSavePrefs();
    mpRenderTrackList();
    mpRenderNowPlaying();
}

// ── Playlists ────────────────────────────────────────────────────────
function mpCreatePlaylist() {
    const name = prompt('Playlist name:');
    if (!name || !name.trim()) return;
    const pl = { id: Date.now().toString(36) + Math.random().toString(36).slice(2), name: name.trim(), tracks: [] };
    mp.playlists.push(pl);
    mpSavePrefs();
    mpRenderPlaylists();
    showToast('Playlist "' + pl.name + '" created', 'success');
}

function mpSelectPlaylist(id) {
    mp.activePl = id;
    mpRenderPlaylists();
}

function mpDeletePlaylist(id, event) {
    event.stopPropagation();
    if (!confirm('Delete this playlist?')) return;
    mp.playlists = mp.playlists.filter(p => p.id !== id);
    if (mp.activePl === id) mp.activePl = null;
    mpSavePrefs();
    mpRenderPlaylists();
}

function mpAddToPlaylistMenu() {
    if (!mp.currentTrack) return showToast('No track playing', 'error');
    mpOpenAddToPlMenu(mp.currentTrack, document.getElementById('mpTrackMenuBtn'));
}

function mpOpenAddToPlMenu(trackName, anchor) {
    const menu = document.getElementById('mpAddToPLMenu');
    if (!menu) return;
    if (mp.playlists.length === 0) {
        menu.innerHTML = `<div class="mp-ctx-item" onclick="mpCreatePlaylist(); closeMpCtxMenus()">+ Create new playlist</div>`;
    } else {
        menu.innerHTML = mp.playlists.map(pl => `
            <button class="mp-ctx-item" onclick="mpAddTrackToPl('${escapeHtml(trackName)}','${escapeHtml(pl.id)}')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                ${escapeHtml(pl.name)} (${pl.tracks.length})
            </button>`).join('') +
            `<div class="mp-ctx-sep"></div>
             <button class="mp-ctx-item" onclick="mpCreatePlaylist(); closeMpCtxMenus()">+ New playlist</button>`;
    }
    mpPositionMenu(menu, anchor);
}

function mpAddTrackToPl(trackName, plId) {
    closeMpCtxMenus();
    const pl = mp.playlists.find(p => p.id === plId);
    if (!pl) return;
    if (pl.tracks.includes(trackName)) { showToast('Already in playlist', 'error'); return; }
    pl.tracks.push(trackName);
    mpSavePrefs();
    if (mp.activePl === plId) mpRenderPlaylistTracks();
    showToast('Added to "' + pl.name + '"', 'success');
}

// mpRemoveFromPlaylist kept for compatibility
function mpRemoveFromPlaylist(plId, trackName, event) {
    mpPlRemoveTrack(plId, trackName, event);
}

// ── Track context menu ────────────────────────────────────────────────
function mpOpenTrackCtx(event, trackName) {
    event.stopPropagation();
    const menu = document.getElementById('mpTrackCtxMenu');
    if (!menu) return;
    const isFav = mp.favorites.has(trackName);
    menu.innerHTML = `
        <button class="mp-ctx-item" onclick="mpPlayTrack('${escapeHtml(trackName)}'); closeMpCtxMenus()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play
        </button>
        <button class="mp-ctx-item" onclick="mpToggleFavTrack('${escapeHtml(trackName)}'); closeMpCtxMenus()">
            ${isFav ? '♥ Remove from favorites' : '♡ Add to favorites'}
        </button>
        <div class="mp-ctx-sep"></div>
        <button class="mp-ctx-item" onclick="closeMpCtxMenus(); mpOpenAddToPlMenu('${escapeHtml(trackName)}', document.getElementById('mpAddToPLMenu'))">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add to playlist
        </button>
        <div class="mp-ctx-sep"></div>
        <button class="mp-ctx-item" onclick="mpRenameTrack('${escapeHtml(trackName)}'); closeMpCtxMenus()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Rename
        </button>
        <button class="mp-ctx-item danger" onclick="mpDeleteTrack('${escapeHtml(trackName)}'); closeMpCtxMenus()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            Delete
        </button>`;
    mpPositionMenu(menu, event.currentTarget || event.target);
}

function mpOpenTrackMenu(event) {
    if (!mp.currentTrack) return;
    mpOpenTrackCtx(event, mp.currentTrack);
}

function mpPositionMenu(menu, anchor) {
    menu.style.display = 'block';
    const rect = anchor ? anchor.getBoundingClientRect() : { bottom: 100, left: 100, right: 100 };
    const mW = 200, mH = menu.scrollHeight || 200;
    let top  = rect.bottom + 4;
    let left = rect.left;
    if (top + mH > window.innerHeight) top = rect.top - mH - 4;
    if (left + mW > window.innerWidth) left = window.innerWidth - mW - 8;
    menu.style.top  = top + 'px';
    menu.style.left = left + 'px';
    setTimeout(() => document.addEventListener('click', closeMpCtxMenusOnce, { once: true }), 10);
}

function closeMpCtxMenusOnce() { closeMpCtxMenus(); }
function closeMpCtxMenus() {
    const m1 = document.getElementById('mpTrackCtxMenu');
    const m2 = document.getElementById('mpAddToPLMenu');
    if (m1) m1.style.display = 'none';
    if (m2) m2.style.display = 'none';
}

// ── Track actions ─────────────────────────────────────────────────────
async function mpRenameTrack(oldName) {
    const newName = prompt('Rename track:', oldName.replace(/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|webm)$/i, ''));
    if (!newName || !newName.trim()) return;
    try {
        const res = await fetch('/api/music/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ old_name: oldName, new_name: newName.trim() })
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.msg);
        // Update state
        if (mp.currentTrack === oldName) mp.currentTrack = data.new_name;
        mp.queue = mp.queue.map(n => n === oldName ? data.new_name : n);
        mp.playlists.forEach(pl => { pl.tracks = pl.tracks.map(n => n === oldName ? data.new_name : n); });
        if (mp.favorites.has(oldName)) { mp.favorites.delete(oldName); mp.favorites.add(data.new_name); }
        mpSavePrefs();
        await mpLoadTracks();
        mpRenderAll();
        showToast('Renamed', 'success');
    } catch (e) { showToast(e.message, 'error'); }
}

async function mpDeleteTrack(name) {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
        const res = await fetch('/api/music/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ filename: name })
        });
        if (!res.ok) throw new Error((await safeJson(res)).msg);
        if (mp.currentTrack === name) { mpAudio.pause(); mp.currentTrack = null; }
        mp.favorites.delete(name);
        mp.playlists.forEach(pl => { pl.tracks = pl.tracks.filter(t => t !== name); });
        mpSavePrefs();
        await mpLoadTracks();
        mpRenderAll();
        showToast('Deleted', 'success');
    } catch (e) { showToast(e.message, 'error'); }
}

// ── Add Music panel ───────────────────────────────────────────────────
function openMusicAddPanel() {
    document.getElementById('mpAddPanel').style.display = 'flex';
}
function closeMusicAddPanel() {
    document.getElementById('mpAddPanel').style.display = 'none';
}
function mpSwitchAddTab(tab) {
    document.querySelectorAll('.mp-add-tab').forEach(t => t.classList.remove('active'));
    const tabMap = { yt: 'YT', channel: 'Channel', file: 'File' };
    document.getElementById('mpAddTab' + tabMap[tab]).classList.add('active');
    document.getElementById('mpAddYTPane').style.display      = tab === 'yt'      ? 'block' : 'none';
    document.getElementById('mpAddChannelPane').style.display = tab === 'channel' ? 'block' : 'none';
    document.getElementById('mpAddFilePane').style.display    = tab === 'file'    ? 'block' : 'none';
}

// ─── Format selector state ────────────────────────────────────────
const _mpFmt = { yt: 'mp3', ch: 'mp3' };
function mpSelectFmt(scope, fmt, el) {
    _mpFmt[scope] = fmt;
    el.closest('.mp-format-btns').querySelectorAll('.mp-fmt-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
}

// ─── Seek forward / backward ──────────────────────────────────────
function mpSeekBy(seconds) {
    const audio = document.getElementById('mpAudio');
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + seconds));
}

async function mpDownloadYT() {
    const url   = document.getElementById('mpYTUrl').value.trim();
    const name  = document.getElementById('mpYTName').value.trim();
    const fmt   = _mpFmt.yt;
    const thumb = document.getElementById('mpYTThumb')?.checked ?? true;
    if (!url) return showToast('Enter a YouTube URL', 'error');
    const statusEl = document.getElementById('mpYTStatus');
    const btn      = document.getElementById('mpYTBtn');
    const show = (msg, cls) => { statusEl.innerHTML = msg; statusEl.className = 'mp-dl-status ' + cls; statusEl.style.display = 'block'; };
    btn.disabled = true;
    show('⏳ Starting download…', 'info');
    try {
        const res = await fetch('/api/music/youtube', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ url, name, format: fmt, thumbnail: thumb })
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.msg);
        const did = data.download_id;
        show(`⏬ Downloading & converting to ${fmt.toUpperCase()}…`, 'info');
        mp.dlPollTimer = setInterval(async () => {
            try {
                const sr = await fetch('/api/music/youtube/status/' + did, { headers: { Authorization: 'Bearer ' + token } });
                const sd = await safeJson(sr);
                if (sd.status === 'done') {
                    clearInterval(mp.dlPollTimer);
                    show('✓ Downloaded: ' + (sd.filename || 'track'), 'success');
                    btn.disabled = false;
                    document.getElementById('mpYTUrl').value = '';
                    document.getElementById('mpYTName').value = '';
                    await mpLoadTracks();
                    mpRenderTrackList();
                } else if (sd.status === 'error') {
                    clearInterval(mp.dlPollTimer);
                    show('✗ Error: ' + (sd.error || 'Unknown'), 'error');
                    btn.disabled = false;
                }
            } catch {}
        }, 3000);
    } catch (e) {
        show('✗ ' + e.message, 'error');
        btn.disabled = false;
    }
}

async function mpDownloadChannel() {
    const url     = document.getElementById('mpChUrl').value.trim();
    const limit   = parseInt(document.getElementById('mpChLimit').value || '0', 10);
    const plName  = document.getElementById('mpChPlName')?.value.trim() || '';
    const fmt     = _mpFmt.ch;
    const thumb   = document.getElementById('mpChThumb')?.checked ?? true;
    if (!url) return showToast('Enter a channel or playlist URL', 'error');
    const statusEl = document.getElementById('mpChStatus');
    const btn      = document.getElementById('mpChBtn');
    const show = (msg, cls) => { statusEl.innerHTML = msg; statusEl.className = 'mp-dl-status ' + cls; statusEl.style.display = 'block'; };
    btn.disabled = true;
    show('⏳ Starting channel download…', 'info');
    try {
        const res = await fetch('/api/music/channel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ url, format: fmt, thumbnail: thumb, limit, playlist_name: plName })
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.msg);
        const did = data.download_id;
        show('⏬ Downloading in background… (this may take a while)', 'info');
        const poll = setInterval(async () => {
            try {
                const sr = await fetch('/api/music/channel/status/' + did, { headers: { Authorization: 'Bearer ' + token } });
                const sd = await safeJson(sr);
                if (sd.status === 'done') {
                    clearInterval(poll);
                    const n = sd.count || sd.total || '?';
                    const plMsg = sd.playlist ? ` Playlist <b>"${escapeHtml(sd.playlist)}"</b> created.` : '';
                    show(`✓ Done! ${n} track(s) downloaded.${plMsg}`, 'success');
                    btn.disabled = false;
                    document.getElementById('mpChUrl').value = '';
                    await mpLoadTracks();
                    await mpLoadPrefs();   // reload playlists so new one appears
                    mpRenderTrackList();
                    mpRenderPlaylists();
                } else if (sd.status === 'error') {
                    clearInterval(poll);
                    show('✗ Error: ' + (sd.error || 'Unknown'), 'error');
                    btn.disabled = false;
                } else {
                    const n = sd.count || 0;
                    if (n > 0) show(`⏬ Downloaded ${n} track(s) so far…`, 'info');
                }
            } catch {}
        }, 5000);
    } catch (e) {
        show('✗ ' + e.message, 'error');
        btn.disabled = false;
    }
}

async function mpUploadFile(input) {
    const file = input.files[0];
    if (!file) return;
    const name  = document.getElementById('mpUploadName').value.trim();
    const formData = new FormData();
    formData.append('file', file);
    if (name) formData.append('name', name);
    const statusEl = document.getElementById('mpUploadStatus');
    const show = (msg, cls) => { statusEl.innerHTML = msg; statusEl.className = 'mp-dl-status ' + cls; statusEl.style.display = 'block'; };
    show('⏫ Uploading…', 'info');
    try {
        const res = await fetch('/api/music/upload', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token },
            body: formData
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.msg);
        show('✓ Uploaded: ' + data.filename, 'success');
        document.getElementById('mpUploadName').value = '';
        input.value = '';
        await mpLoadTracks();
        mpRenderTrackList();
    } catch (e) { show('✗ ' + e.message, 'error'); }
}

// Drop zone drag
document.addEventListener('DOMContentLoaded', () => {
    const dz = document.getElementById('mpDropZone');
    if (dz) {
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', e => {
            e.preventDefault();
            dz.classList.remove('dragover');
            const f = e.dataTransfer.files[0];
            if (f) {
                const inp = document.getElementById('mpFileIn');
                const dt = new DataTransfer();
                dt.items.add(f);
                inp.files = dt.files;
                mpUploadFile(inp);
            }
        });
    }
});

// Close context menus on Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMpCtxMenus(); closeMusicAddPanel(); }
});

/* ═══════════════════════════════════════════════════════════════════
   SMART TRACK NAME PARSING
   Handles: "Artist - Title.mp3", "01 - Title.mp3", "Title.mp3" etc.
═══════════════════════════════════════════════════════════════════ */

function mpCleanName(filename) {
    // Remove extension (audio + webp thumbnails)
    let n = filename.replace(/\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|webm|webp)$/i, '');
    // Strip leading track numbers: "01 - ", "01. ", "Track 01 - "
    n = n.replace(/^(track\s*)?\d+[\s.\-_]+/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return n;
}

function mpGuessTitle(filename) {
    const n = mpCleanName(filename);
    if (n.includes(' - ')) return n.split(' - ').slice(1).join(' - ').trim();
    return n;
}

function mpGuessArtist(filename) {
    const n = mpCleanName(filename);
    if (n.includes(' - ')) return n.split(' - ')[0].trim();
    return '';
}

/* ═══════════════════════════════════════════════════════════════════
   SCAN — refresh library (picks up files dropped into /tracks/)
═══════════════════════════════════════════════════════════════════ */

async function mpScanTracks() {
    const btn = event && event.currentTarget;
    if (btn) btn.style.opacity = '0.5';
    try {
        const res = await fetch('/api/music/scan', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token }
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.msg || 'Scan failed');
        mp.tracks = data.tracks || [];
        mpRenderTrackList();
        showToast(`Library refreshed — ${data.count} track${data.count !== 1 ? 's' : ''}`, 'success');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        if (btn) btn.style.opacity = '';
    }
}

async function mpEnrichLibrary() {
    const btn = document.querySelector('.mp-enrich-btn');
    if (btn) { btn.style.opacity = '0.5'; btn.style.pointerEvents = 'none'; }
    showToast('🔍 Looking up artists via MusicBrainz… this may take a minute', 'info');
    try {
        const res = await fetch('/api/music/enrich', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token }
        });
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.msg);
        const jid = data.job_id;
        // Poll until done
        const poll = setInterval(async () => {
            try {
                const sr = await fetch('/api/music/enrich/status/' + jid, {
                    headers: { Authorization: 'Bearer ' + token }
                });
                const sd = await safeJson(sr);
                const pct = sd.total ? Math.round((sd.done / sd.total) * 100) : 0;
                if (btn) btn.title = `${sd.done}/${sd.total} checked…`;
                if (!sd.running) {
                    clearInterval(poll);
                    const n = sd.renamed?.length || 0;
                    showToast(`✓ Done! Artist names found for ${n} track${n !== 1 ? 's' : ''}.`, 'success');
                    if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; btn.title = 'Auto-find artist names for all tracks'; }
                    // Reload library with new names
                    await mpLoadTracks();
                    mpRenderTrackList();
                }
            } catch {}
        }, 2000);
    } catch (e) {
        showToast(e.message, 'error');
        if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; }
    }
}

/* ═══════════════════════════════════════════════════════════════════
   LYRICS — fetch synced/plain lyrics from lrclib.net via server
═══════════════════════════════════════════════════════════════════ */

const mpLyrics = {
    lines: [],       // [{time_ms, text}]
    plain: '',
    synced: false,
    visible: true,   // always shown
    activeLine: -1,
    syncTimer: null,
    loadedFor: null, // track name lyrics are loaded for
};

function mpToggleLyrics() {
    // No-op — lyrics panel is always visible; on mobile use the tab
    if (window.innerWidth <= 768) mpMobileTab('lyrics');
}

async function mpFetchLyrics(filename) {
    if (!filename) return;
    mpLyrics.loadedFor = filename;
    const content = document.getElementById('mpLyricsContent');
    if (!content) return;
    content.innerHTML = '<div class="mp-lyrics-loading"><span class="mp-lyrics-spinner"></span>Searching for lyrics…</div>';

    const title  = mpGuessTitle(filename);
    const artist = mpGuessArtist(filename);

    try {
        const params = new URLSearchParams({ track_name: title });
        if (artist) params.append('artist_name', artist);
        const res = await fetch('/api/music/lyrics?' + params, {
            headers: { Authorization: 'Bearer ' + token }
        });
        const data = await safeJson(res);

        if (!data || !data.found) {
            content.innerHTML = `<div class="mp-lyrics-notfound">
                <div class="mp-lyrics-nf-icon">🎵</div>
                <div class="mp-lyrics-nf-title">No lyrics found</div>
                <div class="mp-lyrics-nf-name">"${escapeHtml(title)}"</div>
                ${artist ? `<div class="mp-lyrics-nf-artist">by ${escapeHtml(artist)}</div>` : ''}
                <div class="mp-lyrics-nf-tip">
                    Rename files as <code>Artist - Song Title.mp3</code> for better matching
                </div>
            </div>`;
            mpLyrics.synced = false; mpLyrics.lines = [];
            return;
        }

        mpLyrics.synced = data.synced || false;
        mpLyrics.lines  = data.lines  || [];
        mpLyrics.plain  = data.lyrics || '';
        mpLyrics.activeLine = -1;

        const header = `<div class="mp-lyrics-meta">
            <div class="mp-lyrics-meta-title">${escapeHtml(data.title || title)}</div>
            ${data.artist ? `<div class="mp-lyrics-meta-artist">${escapeHtml(data.artist)}</div>` : ''}
            ${data.synced ? '<div class="mp-lyrics-badge">🎵 Synced</div>' : '<div class="mp-lyrics-badge mp-lyrics-badge-plain">Plain text</div>'}
        </div>`;

        if (data.synced && data.lines && data.lines.length > 0) {
            const linesHtml = data.lines.map((l, i) =>
                `<div class="mp-lyric-line" id="mpl${i}" data-ms="${l.time_ms}" onclick="mpAudio.currentTime=${l.time_ms/1000}">${escapeHtml(l.text)}</div>`
            ).join('');
            content.innerHTML = header + `<div class="mp-lyric-lines" id="mpLyricLines">${linesHtml}</div>`;
            if (!mpAudio.paused) mpStartLyricSync();
        } else if (data.lyrics) {
            const plainHtml = data.lyrics.split('\n').map(l =>
                l.trim()
                    ? `<div class="mp-lyric-line-plain">${escapeHtml(l)}</div>`
                    : `<div class="mp-lyric-blank"></div>`
            ).join('');
            content.innerHTML = header + `<div class="mp-lyric-plain">${plainHtml}</div>`;
        }
    } catch (e) {
        content.innerHTML = `<div class="mp-lyrics-notfound"><div class="mp-lyrics-nf-icon">⚠️</div>Could not load lyrics:<br><small>${escapeHtml(e.message)}</small></div>`;
    }
}

function mpStartLyricSync() {
    mpStopLyricSync();
    if (!mpLyrics.synced || !mpLyrics.lines.length) return;
    const badge = document.getElementById('mpLyricsSyncBadge');
    if (badge) badge.style.display = 'inline-flex';
    mpLyrics.syncTimer = setInterval(() => {
        if (mpAudio.paused) return;
        const nowMs = mpAudio.currentTime * 1000;
        let idx = -1;
        for (let i = mpLyrics.lines.length - 1; i >= 0; i--) {
            if (nowMs >= mpLyrics.lines[i].time_ms) { idx = i; break; }
        }
        if (idx === mpLyrics.activeLine) return;
        mpLyrics.activeLine = idx;
        document.querySelectorAll('#mpLyricLines .mp-lyric-line').forEach((el, i) => {
            el.classList.remove('active', 'past');
            if (i < idx) el.classList.add('past');
        });
        if (idx >= 0) {
            const el = document.getElementById('mpl' + idx);
            if (el) {
                el.classList.add('active');
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, 150);
}

function mpStopLyricSync() {
    if (mpLyrics.syncTimer) { clearInterval(mpLyrics.syncTimer); mpLyrics.syncTimer = null; }
    const badge = document.getElementById('mpLyricsSyncBadge');
    if (badge) badge.style.display = 'none';
}

// Hook into audio events for lyrics sync
mpAudio.addEventListener('play',  () => { if (mpLyrics.synced) mpStartLyricSync(); });
mpAudio.addEventListener('pause', () => mpStopLyricSync());
mpAudio.addEventListener('seeked', () => { mpLyrics.activeLine = -1; });

// Reload lyrics when track changes (already handled in mpLoad, but keep override for safety)
const _origMpRenderNP = mpRenderNowPlaying;
window.mpRenderNowPlaying = function() {
    _origMpRenderNP();
};

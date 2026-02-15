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

// Pinned folders state
let pinnedFolders = JSON.parse(localStorage.getItem('pinnedFolders') || '[]');

/* Upload queue state */
const uploadQueue = { total: 0, done: 0, active: '' };

function uploadProgressShow() {
    document.getElementById('uploadProgress').style.display = 'flex';
}

function uploadProgressHide() {
    document.getElementById('uploadProgress').style.display = 'none';
    uploadQueue.total = 0;
    uploadQueue.done  = 0;
    uploadQueue.active = '';
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
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.innerHTML = theme === 'dark' 
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
        themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }
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
   PINNED FOLDERS
   ======================= */
function addPinnedFolder() {
    if (!currentPath) {
        showMessage('Navigate to a folder first', 'error', 'mainAlert');
        return;
    }
    
    // Check if already pinned
    if (pinnedFolders.some(f => f.path === currentPath)) {
        showMessage('Folder already pinned', 'error', 'mainAlert');
        return;
    }
    
    const folderName = currentPath.split('/').pop() || 'Root';
    pinnedFolders.push({ path: currentPath, name: folderName });
    localStorage.setItem('pinnedFolders', JSON.stringify(pinnedFolders));
    renderPinnedFolders();
    showMessage('Folder pinned', 'success', 'mainAlert');
}

function unpinFolder(path) {
    pinnedFolders = pinnedFolders.filter(f => f.path !== path);
    localStorage.setItem('pinnedFolders', JSON.stringify(pinnedFolders));
    renderPinnedFolders();
}

function renderPinnedFolders() {
    const container = document.getElementById('pinnedFolders');
    if (!container) return;
    
    if (pinnedFolders.length === 0) {
        container.innerHTML = '<div style="font-size: 12px; color: var(--text-tertiary); padding: 8px 12px;">No pinned folders</div>';
        return;
    }
    
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
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between downloads
        }
    }
    
    showMessage(`Downloading ${selectedNetworkItems.size} file(s)`, 'success', 'mainAlert');
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
    el.textContent = msg;
    el.className = 'alert alert-' + type + ' show';
    setTimeout(() => el.classList.remove('show'), 5000);
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
    const button = document.getElementById(buttonId);

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
    // Update sidebar nav
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    const navItem = Array.from(document.querySelectorAll('.nav-item')).find(item => 
        item.getAttribute('onclick')?.includes(`showTab('${tabName}')`)
    );
    if (navItem) navItem.classList.add('active');

    // Update content
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

/* =======================
   SETTINGS MODAL
   ======================= */
function openSettings() {
    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.id = 'settingsModal';
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };

    modal.innerHTML = `
        <div class="settings-content">
            <div class="settings-header">
                <h2 class="settings-title">Account Settings</h2>
                <button class="settings-close" onclick="document.getElementById('settingsModal').remove()">×</button>
            </div>
            <div class="settings-body">
                <div id="settingsAlert" class="alert"></div>
                
                <div class="settings-section">
                    <h3 class="settings-section-title">Change Password</h3>
                    <div class="form-group">
                        <label>Current Password</label>
                        <div class="password-input">
                            <input type="password" id="currentPassword" placeholder="Enter current password">
                            <button type="button" class="password-toggle" onclick="togglePassword('currentPassword', this)">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>New Password</label>
                        <div class="password-input">
                            <input type="password" id="newPassword" placeholder="Enter new password (min 6 characters)">
                            <button type="button" class="password-toggle" onclick="togglePassword('newPassword', this)">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Confirm New Password</label>
                        <div class="password-input">
                            <input type="password" id="confirmNewPassword" placeholder="Confirm new password">
                            <button type="button" class="password-toggle" onclick="togglePassword('confirmNewPassword', this)">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="changePassword()">Update Password</button>
                </div>

                <div class="settings-section">
                    <h3 class="settings-section-title">Change Username</h3>
                    <div class="form-group">
                        <label>New Username</label>
                        <input type="text" id="newUsername" placeholder="Enter new username (3-32 characters)">
                        <small class="form-help">Only letters, numbers, and underscores</small>
                    </div>
                    <div class="form-group">
                        <label>Confirm Password</label>
                        <div class="password-input">
                            <input type="password" id="confirmPasswordUsername" placeholder="Enter your password to confirm">
                            <button type="button" class="password-toggle" onclick="togglePassword('confirmPasswordUsername', this)">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
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
    const newPassword = document.getElementById('newPassword').value;
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                current_password: currentPassword,
                new_password: newPassword
            })
        });

        if (!res.ok) {
            const error = (await safeJson(res)).msg || 'Failed to change password';
            throw new Error(error);
        }

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'settingsAlert');
        
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmNewPassword').value = '';

    } catch (e) {
        showMessage(e.message, 'error', 'settingsAlert');
    }
}

async function changeUsername() {
    const newUsername = document.getElementById('newUsername').value.trim();
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                new_username: newUsername,
                password: password
            })
        });

        if (!res.ok) {
            const error = (await safeJson(res)).msg || 'Failed to change username';
            throw new Error(error);
        }

        const data = await safeJson(res);
        
        token = data.access_token;
        currentUser = data.new_username;
        localStorage.setItem('token', token);
        localStorage.setItem('username', currentUser);

        showMessage(data.msg + '. Refreshing...', 'success', 'settingsAlert');
        
        setTimeout(() => {
            location.reload();
        }, 1000);

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
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username, password })
        });

        if (!res.ok) {
            const error = (await safeJson(res)).msg || 'Login failed';
            showMessage(error, 'error');
            
            loginPassword.value = '';
            setTimeout(() => {
                showLogin();
            }, 2000);
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
            headers: {'Content-Type': 'application/json'},
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

    navUsername.textContent = currentUser;

    const currentTheme = document.documentElement.getAttribute('data-theme');
    updateThemeIcon(currentTheme);

    if (userRole === 'admin') {
        document.getElementById('adminNav').style.display = 'block';
    }

    currentPath = '';
    renderPinnedFolders();
    loadFiles();
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

function selectAllFiles() {
    allFiles.forEach(file => selectedFiles.add(file.path));
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ filepaths: Array.from(selectedFiles) })
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Bulk delete failed');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        clearSelection();
        loadFiles(currentPath);

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function bulkMoveFiles() {
    if (selectedFiles.size === 0) return;
    
    const destination = prompt('Enter destination folder path (leave empty for root):');
    if (destination === null) return;

    try {
        const res = await fetch('/api/bulk/move', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ 
                filepaths: Array.from(selectedFiles),
                destination: destination.trim()
            })
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Bulk move failed');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        clearSelection();
        loadFiles(currentPath);

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function bulkShareFiles() {
    if (selectedFiles.size === 0) return;
    
    if (!confirm(`Share ${selectedFiles.size} selected file(s) on the network?`)) return;

    try {
        const res = await fetch('/api/bulk/share', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ filepaths: Array.from(selectedFiles) })
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Bulk share failed');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        clearSelection();
        loadFiles(currentPath);

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function loadGlobalStats() {
    try {
        const res = await fetch('/api/stats', {
            headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) return;
        const data = await safeJson(res);
        
        // Update storage bar
        const percentage = Math.min(100, (data.total_size / (10 * 1024 * 1024 * 1024)) * 100); // Assume 10GB limit
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

        if (data.folders && data.folders.length > 0) {
            html += '<div class="section-header">Folders</div>';
            html += data.folders.map(folder => {
                const folderPath = currentPath ? currentPath + '/' + folder.name : folder.name;
                return `
                <div class="list-item">
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
                        ${!folder.is_shared ? `<button class="btn btn-text" onclick="requestFolderShare('${escapeHtml(folderPath)}'); event.stopPropagation();">Share</button>` : ''}
                        <button class="btn btn-text btn-danger-text" onclick="deleteFolder('${escapeHtml(folderPath)}'); event.stopPropagation();">Delete</button>
                    </div>
                </div>
            `;
            }).join('');
        }

        if (data.files && data.files.length > 0) {
            html += '<div class="section-header">Files</div>';
            html += data.files.map((file, index) => {
                const filePath = currentPath ? currentPath + '/' + file.name : file.name;
                const canPreview = file.type !== 'other';
                
                allFiles.push({ path: filePath, type: file.type, name: file.name });

                return `
                    <div class="list-item">
                        <div class="item-info" style="display: flex; align-items: center; gap: 12px;">
                            <input type="checkbox" class="file-checkbox" data-filepath="${escapeHtml(filePath)}" 
                                   onclick="toggleFileSelection('${escapeHtml(filePath)}'); event.stopPropagation();">
                            <div style="flex: 1;">
                                <div class="item-name">
                                    ${getFileIcon(file.type)} ${escapeHtml(file.name)}
                                    ${file.is_shared ? '<span class="badge badge-shared">Shared</span>' : ''}
                                </div>
                                <div class="item-meta">${file.size_formatted} • ${formatDate(file.modified)}</div>
                            </div>
                        </div>
                        <div class="item-actions">
                            ${canPreview ? `<button class="btn btn-text" onclick="previewFile('${escapeHtml(filePath)}', ${index})">Preview</button>` : ''}
                            <button class="btn btn-text" onclick="downloadFile('${escapeHtml(filePath)}')">Download</button>
                            ${!file.is_shared ? `<button class="btn btn-text" onclick="requestShare('${escapeHtml(filePath)}')">Share</button>` : ''}
                            <button class="btn btn-text btn-danger-text" onclick="deleteFile('${escapeHtml(filePath)}')">Delete</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        if (!html) {
            html = '<div class="empty-state"><div class="empty-state-icon">📁</div><div class="empty-state-text">This folder is empty</div></div>';
        }

        fileListEl.innerHTML = html;
        updateBulkActionsBar();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
                current_path: currentPath,
                folder_name: folderName.trim()
            })
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to create folder');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadFiles(currentPath);

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
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
        showMessage(data.msg, 'success', 'mainAlert');
        loadFiles(currentPath);

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

/* =======================
   UPLOAD (with chunking for large files)
   ======================= */
const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB per chunk

function generateUploadId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

async function uploadWithChunks(file, folder, relPath) {
    const name        = relPath || file.name;
    const isFolderUp  = !!relPath && relPath.includes('/');
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;
    const uploadId    = generateUploadId();

    for (let i = 0; i < totalChunks; i++) {
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

        const res = await fetch('/api/upload/chunk', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token },
            body: formData
        });

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

    uploadQueue.total += files.length;
    uploadProgressShow();

    let succeeded = 0, failed = 0;

    for (const file of files) {
        try {
            await uploadWithChunks(file, currentPath, null);
            succeeded++;
        } catch (e) {
            failed++;
            showMessage(`"${file.name}" failed: ${e.message}`, 'error', 'mainAlert');
        }
        uploadQueue.done++;
    }

    fileInput.value = '';

    await loadFiles(currentPath);
    await loadGlobalStats();

    if (uploadQueue.done >= uploadQueue.total) {
        uploadProgressHide();
        if (failed === 0)
            showMessage(`Uploaded ${succeeded} file${succeeded !== 1 ? 's' : ''} successfully`, 'success', 'mainAlert');
        else
            showMessage(`${succeeded} uploaded, ${failed} failed`, 'error', 'mainAlert');
    }
}

async function uploadFolder() {
    const files = Array.from(document.getElementById('folderInput').files);
    if (!files.length) return;

    uploadQueue.total += files.length;
    uploadProgressShow();

    let succeeded = 0, failed = 0;

    for (const file of files) {
        const relPath = file.webkitRelativePath || file.name;
        try {
            await uploadWithChunks(file, currentPath, relPath);
            succeeded++;
        } catch (e) {
            failed++;
        }
        uploadQueue.done++;
    }

    document.getElementById('folderInput').value = '';

    await loadFiles(currentPath);
    await loadGlobalStats();

    if (uploadQueue.done >= uploadQueue.total) {
        uploadProgressHide();
        if (failed === 0)
            showMessage(`Uploaded ${succeeded} file${succeeded !== 1 ? 's' : ''} successfully`, 'success', 'mainAlert');
        else
            showMessage(`${succeeded} uploaded, ${failed} failed`, 'error', 'mainAlert');
    }
}

function previewFile(filepath, index = -1) {
    currentPreviewIndex = index;
    
    const file = allFiles[index];
    let previewUrl;
    
    if (file && file.type === 'docx') {
        previewUrl = `/api/preview/docx/${encodeURIComponent(filepath)}?token=${token}`;
    } else if (file && file.type === 'xlsx') {
        previewUrl = `/api/preview/xlsx/${encodeURIComponent(filepath)}?token=${token}`;
    } else {
        previewUrl = `/api/preview/${encodeURIComponent(filepath)}?token=${token}`;
    }

    const modal = document.createElement('div');
    modal.className = 'preview-modal';
    modal.id = 'previewModal';
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };

    const content = document.createElement('div');
    content.className = 'preview-content';

    const header = document.createElement('div');
    header.className = 'preview-header';
    header.innerHTML = `
        <div class="preview-nav">
            ${currentPreviewIndex > 0 ? '<button class="preview-nav-btn" onclick="navigatePreview(-1); event.stopPropagation();">← Previous</button>' : '<div></div>'}
            <div class="preview-filename">${escapeHtml(file ? file.name : filepath.split('/').pop())}</div>
            ${currentPreviewIndex < allFiles.length - 1 && currentPreviewIndex >= 0 ? '<button class="preview-nav-btn" onclick="navigatePreview(1); event.stopPropagation();">Next →</button>' : '<div></div>'}
        </div>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'preview-close';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = () => modal.remove();

    const iframe = document.createElement('iframe');
    iframe.src = previewUrl;
    iframe.className = 'preview-frame';

    content.appendChild(closeBtn);
    content.appendChild(header);
    content.appendChild(iframe);
    modal.appendChild(content);
    document.body.appendChild(modal);
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
        showMessage(data.msg, 'success', 'mainAlert');
        loadFiles(currentPath);

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

/* =======================
   NETWORK SHARING
   ======================= */
async function requestShare(filepath) {
    if (!confirm('Request to share this file on the network?')) return;

    try {
        const res = await fetch('/api/share/request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ filepath })
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to request share');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadFiles(currentPath);

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function requestFolderShare(folderPath) {
    if (!confirm('Request to share this folder and all its contents on the network?')) return;

    try {
        const res = await fetch('/api/share/folder/request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ folder_path: folderPath })
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to request folder share');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadFiles(currentPath);

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function loadPendingShares() {
    try {
        const res = await fetch('/api/share/pending', {
            headers: { Authorization: 'Bearer ' + token }
        });

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
                    </div>
                `).join('');
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
                    </div>
                `).join('');
            }
        }

        sharesListEl.innerHTML = html;

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function approveShare(fileId) {
    try {
        const res = await fetch(`/api/share/approve/${encodeURIComponent(fileId)}`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to approve');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadPendingShares();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function approveFolderShare(folderId) {
    try {
        const res = await fetch(`/api/share/folder/approve/${encodeURIComponent(folderId)}`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to approve folder');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadPendingShares();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function rejectShare(fileId) {
    if (!confirm('Reject this share request?')) return;

    try {
        const res = await fetch(`/api/share/reject/${encodeURIComponent(fileId)}`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to reject');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadPendingShares();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function rejectFolderShare(folderId) {
    if (!confirm('Reject this folder share request?')) return;

    try {
        const res = await fetch(`/api/share/folder/reject/${encodeURIComponent(folderId)}`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to reject folder');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadPendingShares();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function loadNetworkFiles() {
    try {
        const res = await fetch('/api/network/files', {
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) {
            const error = (await safeJson(res)).msg || 'Failed to load network files';
            throw new Error(error);
        }

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
                        </div>
                    `;
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
                                ${canPreview ? `<button class="btn btn-text" onclick="previewNetworkFile('${escapeHtml(file.id)}')">Preview</button>` : ''}
                                <button class="btn btn-text" onclick="downloadNetworkFile('${escapeHtml(file.id)}')">Download</button>
                                ${(isOwner || isAdmin) ? `<button class="btn btn-text btn-danger-text" onclick="removeNetworkShare('${escapeHtml(file.id)}')">Remove</button>` : ''}
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        networkListEl.innerHTML = html;
        updateNetworkBulkActionsBar();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function viewNetworkFolder(folderId, subfolder) {
    currentNetworkFolderId = folderId;
    currentNetworkSubfolder = subfolder || '';

    try {
        let url = `/api/network/folder/${encodeURIComponent(folderId)}`;
        if (currentNetworkSubfolder) {
            url += `?subfolder=${encodeURIComponent(currentNetworkSubfolder)}`;
        }

        const res = await fetch(url, {
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) {
            const error = (await safeJson(res)).msg || 'Failed to load folder';
            if (error.includes('removed from shares')) {
                showMessage(error, 'error', 'mainAlert');
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

        let html = '';
        
        html += `
            <div style="margin-bottom: 16px;">
                <button class="btn btn-text" onclick="loadNetworkFiles()">← Back</button>
            </div>
        `;

        html += `<div class="breadcrumb-container"><div class="breadcrumb">${breadcrumb}</div></div>`;

        if (data.folders && data.folders.length > 0) {
            html += '<div class="section-header">Folders</div>';
            html += data.folders.map(folder => {
                const fullPath = folder.relative_path;
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
                    </div>
                `;
            }).join('');
        }

        if (data.files && data.files.length > 0) {
            html += '<div class="section-header">Files</div>';
            html += data.files.map(file => {
                const canPreview = file.file_type !== 'other';
                return `
                    <div class="list-item">
                        <div class="item-info">
                            <div class="item-name">${getFileIcon(file.file_type)} ${escapeHtml(file.filename)}</div>
                            <div class="item-meta">${formatSize(file.file_size)} • ${formatDate(file.modified)}</div>
                        </div>
                        <div class="item-actions">
                            ${canPreview ? `<button class="btn btn-text" onclick="previewFile('${escapeHtml(file.filepath)}')">Preview</button>` : ''}
                            <button class="btn btn-text" onclick="downloadFile('${escapeHtml(file.filepath)}')">Download</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        if (data.folders.length === 0 && data.files.length === 0) {
            html += '<div class="empty-state"><div class="empty-state-icon">📁</div><div class="empty-state-text">This folder is empty</div></div>';
        }

        document.getElementById('networkList').innerHTML = html;

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function removeFolderShare(folderId) {
    if (!confirm('Remove this folder from network sharing?')) return;

    try {
        const res = await fetch(`/api/share/folder/remove/${encodeURIComponent(folderId)}`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to remove folder share');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadNetworkFiles();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

function previewNetworkFile(fileId) {
    const previewUrl = `/api/network/preview/${encodeURIComponent(fileId)}?token=${token}`;

    const modal = document.createElement('div');
    modal.className = 'preview-modal';
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };

    const content = document.createElement('div');
    content.className = 'preview-content';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'preview-close';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = () => modal.remove();

    const iframe = document.createElement('iframe');
    iframe.src = previewUrl;
    iframe.className = 'preview-frame';

    content.appendChild(closeBtn);
    content.appendChild(iframe);
    modal.appendChild(content);
    document.body.appendChild(modal);
}

function downloadNetworkFile(fileId) {
    window.open(`/api/network/download/${encodeURIComponent(fileId)}?token=${token}`, '_blank');
}

async function removeNetworkShare(fileId) {
    if (!confirm('Remove this file from network sharing?')) return;

    try {
        const res = await fetch(`/api/share/remove/${encodeURIComponent(fileId)}`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to remove share');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadNetworkFiles();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

/* =======================
   USERS (ADMIN)
   ======================= */
async function loadUsers() {
    try {
        const res = await fetch('/api/users', {
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to load users');

        const data = await safeJson(res);

        const userListEl = document.getElementById('userList');
        if (data.users.length === 0) {
            userListEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-text">No users found</div></div>';
        } else {
            userListEl.innerHTML = data.users.map(user => `
                <div class="list-item">
                    <div class="item-info">
                        <div class="item-name">
                            ${user.username}
                            <span class="badge badge-${user.role}">${user.role}</span>
                            <span class="badge badge-${user.status}">${user.status}</span>
                        </div>
                        <div class="item-meta">Created: ${formatDate(new Date(user.created_at).getTime() / 1000)} • Storage: ${formatSize(user.storage_used)}</div>
                    </div>
                    <div class="item-actions">
                        ${user.username !== 'admin' ? `<button class="btn btn-text btn-danger-text" onclick="removeUser('${escapeHtml(user.username)}')">Delete</button>` : ''}
                    </div>
                </div>
            `).join('');
        }

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function loadPendingUsers() {
    try {
        const res = await fetch('/api/users/pending', {
            headers: { Authorization: 'Bearer ' + token }
        });

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
                </div>
            `).join('');
        }

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function addUser() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newRole').value;

    if (!username || !password) {
        showMessage('Please fill in all fields', 'error', 'mainAlert');
        return;
    }

    try {
        const res = await fetch('/api/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ username, password, role })
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to add user');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');

        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('newRole').value = 'user';

        loadUsers();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function approveUser(username) {
    try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}/approve`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to approve');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadPendingUsers();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function rejectUser(username) {
    if (!confirm(`Reject user "${username}"?`)) return;

    try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}/reject`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to reject');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadPendingUsers();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function removeUser(username) {
    if (!confirm(`Delete user "${username}" and all their files?`)) return;

    try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to delete user');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadUsers();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

/* =======================
   UTIL
   ======================= */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
});

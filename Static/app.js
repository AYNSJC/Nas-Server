let token = localStorage.getItem('token');
let currentUser = localStorage.getItem('username');
let userRole = localStorage.getItem('role');
let userAutoShare = localStorage.getItem('auto_share') === 'true';
let currentPath = '';
let selectedFiles = new Set();
let allFiles = [];
let currentPreviewIndex = -1;

// Theme management
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Auto-select light mode by default, unless user has saved preference
    const theme = savedTheme || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
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
        themeToggle.innerHTML = theme === 'dark' ? '☀️' : '🌙';
        themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }
}

// Initialize theme on page load
initTheme();

if (token) showMainPanel();

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
        button.innerHTML = '🙈';
        button.title = 'Hide password';
    } else {
        input.type = 'password';
        button.innerHTML = '👁️';
        button.title = 'Show password';
    }
}

function showTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    event.target.classList.add('active');
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
                            <button type="button" class="password-toggle" onclick="togglePassword('currentPassword', this)">👁️</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>New Password</label>
                        <div class="password-input">
                            <input type="password" id="newPassword" placeholder="Enter new password (min 6 characters)">
                            <button type="button" class="password-toggle" onclick="togglePassword('newPassword', this)">👁️</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Confirm New Password</label>
                        <div class="password-input">
                            <input type="password" id="confirmNewPassword" placeholder="Confirm new password">
                            <button type="button" class="password-toggle" onclick="togglePassword('confirmNewPassword', this)">👁️</button>
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
                            <button type="button" class="password-toggle" onclick="togglePassword('confirmPasswordUsername', this)">👁️</button>
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="changeUsername()">Update Username</button>
                </div>

                <div class="settings-section">
                    <h3 class="settings-section-title">Account Information</h3>
                    <p style="color: var(--text-secondary); margin-bottom: 0.5rem;"><strong>Username:</strong> ${currentUser}</p>
                    <p style="color: var(--text-secondary);"><strong>Role:</strong> ${userRole}</p>
                    ${userAutoShare ? '<p style="color: var(--text-secondary);"><strong>Auto-share:</strong> Enabled</p>' : ''}
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
        
        // Clear form
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
        
        // Update local storage with new token and username
        token = data.access_token;
        currentUser = data.new_username;
        localStorage.setItem('token', token);
        localStorage.setItem('username', currentUser);

        showMessage(data.msg + '. Refreshing...', 'success', 'settingsAlert');
        
        // Refresh page after 1 second
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
            
            // Clear password and wait 2 seconds then show login page
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
        userAutoShare = data.auto_share || false;

        localStorage.setItem('token', token);
        localStorage.setItem('username', username);
        localStorage.setItem('role', userRole);
        localStorage.setItem('auto_share', userAutoShare);

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
    mainContainer.style.display = 'block';
    navbar.style.display = 'block';

    navUsername.textContent = currentUser;
    navRole.textContent = ' • ' + userRole + (userAutoShare ? ' • Auto-share' : '');

    // Initialize theme toggle
    const currentTheme = document.documentElement.getAttribute('data-theme');
    updateThemeIcon(currentTheme);

    if (userRole === 'admin') {
        usersTab.style.display = 'block';
        pendingTab.style.display = 'block';
        sharesTab.style.display = 'block';
    }

    currentPath = '';
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

async function uploadFolder() {
    const files = folderInput.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    
    // Add files with their relative paths
    for (const file of files) {
        formData.append('files', file);
        formData.append('paths', file.webkitRelativePath || file.name);
    }
    
    formData.append('folder', currentPath);
    formData.append('is_folder_upload', 'true');

    try {
        const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token },
            body: formData
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Upload failed');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadFiles(currentPath);

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }

    folderInput.value = '';
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

        fileCount.textContent = data.total_files;
        storageUsed.textContent = data.total_size_formatted;

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
                            📁 ${escapeHtml(folder.name)}
                            ${folder.is_shared ? '<span class="badge badge-shared">Shared</span>' : ''}
                        </div>
                        <div class="item-meta">${formatDate(folder.modified)}</div>
                    </div>
                    <div class="item-actions">
                        ${!folder.is_shared ? `<button class="btn btn-success btn-small" onclick="requestFolderShare('${escapeHtml(folderPath)}'); event.stopPropagation();">Share Folder</button>` : ''}
                        <button class="btn btn-danger btn-small" onclick="deleteFolder('${escapeHtml(folderPath)}'); event.stopPropagation();">Delete</button>
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
                        <div class="item-info" style="display: flex; align-items: center; gap: 1rem;">
                            <input type="checkbox" class="file-checkbox" data-filepath="${escapeHtml(filePath)}" 
                                   onclick="toggleFileSelection('${escapeHtml(filePath)}'); event.stopPropagation();">
                            <div>
                                <div class="item-name">
                                    ${getFileIcon(file.type)} ${escapeHtml(file.name)}
                                    ${file.is_shared ? '<span class="badge badge-shared">Shared</span>' : ''}
                                </div>
                                <div class="item-meta">${file.size_formatted} • ${formatDate(file.modified)}</div>
                            </div>
                        </div>
                        <div class="item-actions">
                            ${canPreview ? `<button class="btn btn-secondary btn-small" onclick="previewFile('${escapeHtml(filePath)}', ${index})">Preview</button>` : ''}
                            <button class="btn btn-primary btn-small" onclick="downloadFile('${escapeHtml(filePath)}')">Download</button>
                            ${!file.is_shared ? `<button class="btn btn-success btn-small" onclick="requestShare('${escapeHtml(filePath)}')">Share</button>` : ''}
                            <button class="btn btn-danger btn-small" onclick="deleteFile('${escapeHtml(filePath)}')">Delete</button>
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
        breadcrumbEl.innerHTML = '<span class="breadcrumb-item active">Home</span>';
        return;
    }

    const parts = path.split('/');
    let html = '<span class="breadcrumb-item" onclick="loadFiles()">Home</span>';

    let currentPathBuild = '';
    parts.forEach((part, index) => {
        currentPathBuild += (currentPathBuild ? '/' : '') + part;
        const pathToNavigate = currentPathBuild;

        if (index === parts.length - 1) {
            html += ` / <span class="breadcrumb-item active">${escapeHtml(part)}</span>`;
        } else {
            html += ` / <span class="breadcrumb-item" onclick="loadFiles('${escapeHtml(pathToNavigate)}')">${escapeHtml(part)}</span>`;
        }
    });

    breadcrumbEl.innerHTML = html;
}

function getFileIcon(type) {
    const icons = {
        'image': '🖼️',
        'pdf': '📄',
        'text': '📝',
        'docx': '📘',
        'xlsx': '📊',
        'other': '📎'
    };
    return icons[type] || '📎';
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

async function uploadFiles() {
    const formData = new FormData();
    for (const f of fileInput.files) formData.append('files', f);
    formData.append('folder', currentPath);

    try {
        const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token },
            body: formData
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Upload failed');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadFiles(currentPath);

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }

    fileInput.value = '';
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
                            <div class="item-name">📁 ${escapeHtml(folder.folder_name)}</div>
                            <div class="item-meta">By ${escapeHtml(folder.username)} • ${formatDate(new Date(folder.requested_at).getTime() / 1000)}</div>
                        </div>
                        <div class="item-actions">
                            <button class="btn btn-success btn-small" onclick="approveFolderShare('${escapeHtml(folder.id)}')">Approve</button>
                            <button class="btn btn-danger btn-small" onclick="rejectFolderShare('${escapeHtml(folder.id)}')">Reject</button>
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
                            <button class="btn btn-success btn-small" onclick="approveShare('${escapeHtml(share.id)}')">Approve</button>
                            <button class="btn btn-danger btn-small" onclick="rejectShare('${escapeHtml(share.id)}')">Reject</button>
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
                            <div class="item-info">
                                <div class="item-name">📁 ${escapeHtml(folder.folder_name)}</div>
                                <div class="item-meta">Shared by ${escapeHtml(folder.username)} • ${formatDate(new Date(folder.approved_at).getTime() / 1000)}</div>
                            </div>
                            <div class="item-actions">
                                <button class="btn btn-primary btn-small" onclick="viewNetworkFolder('${escapeHtml(folder.id)}')">Open Folder</button>
                                ${(isOwner || isAdmin) ? `<button class="btn btn-danger btn-small" onclick="removeFolderShare('${escapeHtml(folder.id)}')">Remove</button>` : ''}
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
                            <div class="item-info">
                                <div class="item-name">${getFileIcon(file.file_type)} ${escapeHtml(file.filename)}</div>
                                <div class="item-meta">Shared by ${escapeHtml(file.username)} • ${formatSize(file.file_size)} • ${formatDate(new Date(file.approved_at).getTime() / 1000)}</div>
                            </div>
                            <div class="item-actions">
                                ${canPreview ? `<button class="btn btn-secondary btn-small" onclick="previewNetworkFile('${escapeHtml(file.id)}')">Preview</button>` : ''}
                                <button class="btn btn-primary btn-small" onclick="downloadNetworkFile('${escapeHtml(file.id)}')">Download</button>
                                ${(isOwner || isAdmin) ? `<button class="btn btn-danger btn-small" onclick="removeNetworkShare('${escapeHtml(file.id)}')">Remove</button>` : ''}
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        networkListEl.innerHTML = html;

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function viewNetworkFolder(folderId, subPath = '') {
    try {
        const url = subPath 
            ? `/api/network/folder/${encodeURIComponent(folderId)}?path=${encodeURIComponent(subPath)}`
            : `/api/network/folder/${encodeURIComponent(folderId)}`;
            
        const res = await fetch(url, {
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to load folder');

        const data = await safeJson(res);

        const modal = document.createElement('div');
        modal.className = 'preview-modal';
        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };

        const content = document.createElement('div');
        content.className = 'preview-content';
        content.style.maxHeight = '80vh';
        content.style.overflow = 'auto';
        content.style.padding = '2rem';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'preview-close';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = () => modal.remove();

        let html = `
            <h2 style="margin-bottom: 1rem; color: var(--text-primary); font-family: 'Syne', sans-serif;">📁 ${escapeHtml(data.folder.folder_name)}</h2>
            <p style="margin-bottom: 0.5rem; color: var(--text-secondary);">Shared by ${escapeHtml(data.folder.username)}</p>
        `;

        // Add breadcrumb for subfolders
        if (subPath) {
            const parts = subPath.split('/');
            let breadcrumb = `<div style="margin-bottom: 1rem; color: var(--text-secondary);">
                <span onclick="viewNetworkFolder('${folderId}')" style="cursor: pointer; color: var(--primary);">Root</span>`;
            
            let currentPath = '';
            parts.forEach((part, idx) => {
                currentPath += (currentPath ? '/' : '') + part;
                const path = currentPath;
                if (idx < parts.length - 1) {
                    breadcrumb += ` / <span onclick="viewNetworkFolder('${folderId}', '${path}')" style="cursor: pointer; color: var(--primary);">${escapeHtml(part)}</span>`;
                } else {
                    breadcrumb += ` / <span>${escapeHtml(part)}</span>`;
                }
            });
            breadcrumb += '</div>';
            html += breadcrumb;
        }

        if (data.files.length === 0 && data.subfolders.length === 0) {
            html += '<div class="empty-state"><div class="empty-state-icon">📁</div><div class="empty-state-text">This folder is empty</div></div>';
        } else {
            // Show subfolders first
            if (data.subfolders && data.subfolders.length > 0) {
                html += '<div class="section-header" style="margin-top: 1.5rem;">Folders</div>';
                data.subfolders.forEach(subfolder => {
                    html += `
                        <div class="list-item" style="margin-bottom: 0.75rem; cursor: pointer;" onclick="event.stopPropagation(); viewNetworkFolder('${folderId}', '${escapeHtml(subfolder.relative_path)}')">
                            <div class="item-info">
                                <div class="item-name">📁 ${escapeHtml(subfolder.name)}</div>
                            </div>
                        </div>
                    `;
                });
            }

            // Show files
            if (data.files && data.files.length > 0) {
                html += '<div class="section-header" style="margin-top: 1.5rem;">Files</div>';
                data.files.forEach(file => {
                    const canPreview = file.file_type !== 'other';
                    html += `
                        <div class="list-item" style="margin-bottom: 0.75rem;">
                            <div class="item-info">
                                <div class="item-name">${getFileIcon(file.file_type)} ${escapeHtml(file.relative_path)}</div>
                                <div class="item-meta">${formatSize(file.file_size)}</div>
                            </div>
                            <div class="item-actions">
                                ${canPreview ? `<button class="btn btn-secondary btn-small" onclick="previewFile('${escapeHtml(file.filepath)}')">Preview</button>` : ''}
                                <button class="btn btn-primary btn-small" onclick="downloadFile('${escapeHtml(file.filepath)}')">Download</button>
                            </div>
                        </div>
                    `;
                });
            }
        }

        content.innerHTML = html;
        content.insertBefore(closeBtn, content.firstChild);
        modal.appendChild(content);
        document.body.appendChild(modal);

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
                            👤 ${escapeHtml(user.username)}
                            <span class="badge badge-${user.role}">${user.role}</span>
                            <span class="badge badge-${user.status}">${user.status}</span>
                            ${user.auto_share ? '<span class="badge badge-shared">Auto-share</span>' : ''}
                        </div>
                        <div class="item-meta">Created: ${formatDate(new Date(user.created_at).getTime() / 1000)} • Storage: ${formatSize(user.storage_used)}</div>
                    </div>
                    <div class="item-actions">
                        ${user.username !== 'admin' ? `
                            <button class="btn btn-secondary btn-small" onclick="toggleAutoShare('${escapeHtml(user.username)}', ${!user.auto_share})">${user.auto_share ? 'Disable' : 'Enable'} Auto-share</button>
                            <button class="btn btn-danger btn-small" onclick="removeUser('${escapeHtml(user.username)}')">Delete</button>
                        ` : ''}
                    </div>
                </div>
            `).join('');
        }

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function toggleAutoShare(username, enable) {
    try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}/auto-share`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ auto_share: enable })
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to update auto-share');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadUsers();

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
                        <div class="item-name">👤 ${escapeHtml(user.username)}</div>
                        <div class="item-meta">Requested: ${formatDate(new Date(user.created_at).getTime() / 1000)}</div>
                    </div>
                    <div class="item-actions">
                        <button class="btn btn-success btn-small" onclick="approveUser('${escapeHtml(user.username)}')">Approve</button>
                        <button class="btn btn-danger btn-small" onclick="rejectUser('${escapeHtml(user.username)}')">Reject</button>
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
    const autoShare = document.getElementById('newAutoShare').checked;

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
            body: JSON.stringify({ username, password, role, auto_share: autoShare })
        });

        if (!res.ok) throw new Error((await safeJson(res)).msg || 'Failed to add user');

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');

        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('newRole').value = 'user';
        document.getElementById('newAutoShare').checked = false;

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

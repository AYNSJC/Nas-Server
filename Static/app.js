let token = localStorage.getItem('token');
let currentUser = localStorage.getItem('username');
let userRole = localStorage.getItem('role');

console.log('App initialized. Token exists:', !!token);

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

function showTab(tabName) {
    // Remove active class from all tabs and contents
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    // Add active class to selected tab and content
    event.target.classList.add('active');
    document.getElementById(tabName + 'Content').classList.add('active');
    
    // Load data based on tab
    if (tabName === 'files') {
        loadFiles();
    } else if (tabName === 'users') {
        loadUsers();
    } else if (tabName === 'pending') {
        loadPendingUsers();
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

        if (!res.ok) throw new Error(await res.text());

        const data = await safeJson(res);

        token = data.access_token;
        currentUser = username;
        userRole = data.role;

        localStorage.setItem('token', token);
        localStorage.setItem('username', username);
        localStorage.setItem('role', userRole);

        showMainPanel();

    } catch (e) {
        showMessage('Login failed: ' + e.message, 'error');
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

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username, password })
        });

        if (!res.ok) throw new Error(await res.text());

        const data = await safeJson(res);
        showMessage(data.msg, 'success');
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
    navRole.textContent = ' • ' + userRole;

    if (userRole === 'admin') {
        usersTab.style.display = 'block';
        pendingTab.style.display = 'block';
    }

    loadFiles();
}

/* =======================
   FILES
   ======================= */
async function loadFiles() {
    try {
        const res = await fetch('/api/files', {
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error(await res.text());

        const data = await safeJson(res);

        fileCount.textContent = data.total_files;
        storageUsed.textContent = data.total_size_formatted;

        // Render file list
        const fileListEl = document.getElementById('fileList');
        if (data.files.length === 0) {
            fileListEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📁</div><div>No files yet. Upload your first file!</div></div>';
        } else {
            fileListEl.innerHTML = data.files.map(file => `
                <div class="list-item">
                    <div class="item-info">
                        <div class="item-name">📄 ${escapeHtml(file.name)}</div>
                        <div class="item-meta">${file.size_formatted} • ${formatDate(file.modified)}</div>
                    </div>
                    <div class="item-actions">
                        <button class="btn btn-primary btn-small" onclick="downloadFile('${escapeHtml(file.name)}')">Download</button>
                        <button class="btn btn-danger btn-small" onclick="deleteFile('${escapeHtml(file.name)}')">Delete</button>
                    </div>
                </div>
            `).join('');
        }

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function uploadFiles() {
    const formData = new FormData();
    for (const f of fileInput.files) formData.append('files', f);

    try {
        const res = await fetch('/api/upload', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token },
            body: formData
        });

        if (!res.ok) throw new Error(await res.text());

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadFiles();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }

    fileInput.value = '';
}

function downloadFile(filename) {
    window.open(`/api/download/${encodeURIComponent(filename)}?token=${token}`, '_blank');
}

async function deleteFile(filename) {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

    try {
        const res = await fetch(`/api/delete/${encodeURIComponent(filename)}`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error(await res.text());

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadFiles();

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

        if (!res.ok) throw new Error(await res.text());

        const data = await safeJson(res);
        
        const userListEl = document.getElementById('userList');
        if (data.users.length === 0) {
            userListEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div><div>No users found</div></div>';
        } else {
            userListEl.innerHTML = data.users.map(user => `
                <div class="list-item">
                    <div class="item-info">
                        <div class="item-name">
                            ${escapeHtml(user.username)}
                            <span class="badge badge-${user.role}">${user.role}</span>
                            <span class="badge badge-${user.status}">${user.status}</span>
                        </div>
                        <div class="item-meta">Created: ${formatDate(new Date(user.created_at).getTime() / 1000)} • Storage: ${formatSize(user.storage_used)}</div>
                    </div>
                    <div class="item-actions">
                        ${user.username !== 'admin' ? `<button class="btn btn-danger btn-small" onclick="removeUser('${escapeHtml(user.username)}')">Delete</button>` : ''}
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

        if (!res.ok) throw new Error(await res.text());

        const data = await safeJson(res);
        
        const pendingListEl = document.getElementById('pendingList');
        if (data.users.length === 0) {
            pendingListEl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✓</div><div>No pending approvals</div></div>';
        } else {
            pendingListEl.innerHTML = data.users.map(user => `
                <div class="list-item">
                    <div class="item-info">
                        <div class="item-name">${escapeHtml(user.username)}</div>
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

        if (!res.ok) throw new Error(await res.text());

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        
        // Clear form
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

        if (!res.ok) throw new Error(await res.text());

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadPendingUsers();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function rejectUser(username) {
    if (!confirm(`Are you sure you want to reject user "${username}"?`)) return;

    try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}/reject`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error(await res.text());

        const data = await safeJson(res);
        showMessage(data.msg, 'success', 'mainAlert');
        loadPendingUsers();

    } catch (e) {
        showMessage(e.message, 'error', 'mainAlert');
    }
}

async function removeUser(username) {
    if (!confirm(`Are you sure you want to delete user "${username}" and all their files?`)) return;

    try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + token }
        });

        if (!res.ok) throw new Error(await res.text());

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

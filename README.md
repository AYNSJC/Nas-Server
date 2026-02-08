# 📦 Professional NAS System

A production-ready Network Attached Storage system with user management, file organization, and preview capabilities.

## ✨ Features

### 🔐 Authentication & User Management
- **User Registration** with admin approval workflow
- **Show/Hide Password** toggle on all password fields
- Role-based access control (Admin/User)
- Secure password hashing with bcrypt
- JWT token authentication

### 📁 File Management
- **Upload multiple files** with drag & drop support
- **Download files** with direct links
- **Preview files** in browser:
  - 🖼️ Images (PNG, JPG, JPEG, GIF, BMP, WEBP, SVG)
  - 📄 PDFs
  - 📝 Text files (TXT, MD, JSON, XML, CSV)
- **File type validation** with dangerous extension blocking
- Automatic duplicate file handling

### 📂 Folder Organization
- **Create folders** for better organization
- **Navigate folder structure** with breadcrumb navigation
- **Delete folders** and their contents
- Nested folder support

### 👥 Admin Features
- Approve/reject user registrations
- Create users directly (auto-approved)
- Delete users and their data
- View storage usage per user
- Manage user roles

### 🎨 Professional UI
- Clean, modern interface
- Responsive design (mobile-friendly)
- File type icons
- Real-time storage statistics
- Intuitive breadcrumb navigation
- Modal preview window

## 🚀 Installation

### Prerequisites
```bash
Python 3.8+
pip
```

### 1. Install Dependencies
```bash
pip install flask flask-jwt-extended flask-cors bcrypt Pillow
```

**Required packages:**
- `flask` - Web framework
- `flask-jwt-extended` - JWT authentication
- `flask-cors` - CORS support
- `bcrypt` - Password hashing
- `Pillow` - Image processing for previews

### 2. Project Structure
Create the following structure:
```
NASServer/
├── main.py              # Backend server
├── users.json           # Auto-generated user database
├── static/
│   ├── index.html       # Frontend HTML
│   ├── app.js          # Frontend JavaScript
│   └── style.css       # Frontend CSS
├── nas_storage/        # Auto-generated storage directory
│   ├── admin/          # Admin's files
│   └── username/       # Each user's files
└── logs/
    └── nas.log         # Auto-generated log file
```

### 3. Create Files

**Save the backend as `main.py`**
**Create `static/` folder and save:**
- `index.html`
- `app.js`
- `style.css`

### 4. Run the Server
```bash
python main.py
```

The server will start on `http://localhost:5000`

## 📖 Usage Guide

### First Time Setup

1. **Start the server**
   ```bash
   python main.py
   ```

2. **Login as admin**
   - Username: `admin`
   - Password: `admin123`
   - ⚠️ **Change this password immediately!**

3. **Create users or approve registrations**

### For Users

#### Register Account
1. Click "Don't have an account? Register"
2. Choose username (3-32 characters, letters/numbers/underscore)
3. Choose password (minimum 6 characters)
4. Wait for admin approval
5. Login once approved

#### Upload Files
1. Navigate to desired folder (or stay in root)
2. Click "📤 Upload Files"
3. Select files (multiple selection supported)
4. Files are uploaded to current folder

#### Organize with Folders
1. Click "📁 New Folder"
2. Enter folder name
3. Click on folder to navigate inside
4. Use breadcrumb to navigate back

#### Preview Files
1. Click "👁️ Preview" on supported files
2. View in modal window
3. Click outside modal or × to close

#### Download Files
1. Click "⬇️ Download" on any file
2. File downloads to your browser's download folder

### For Admins

#### Approve New Users
1. Go to "Pending Approvals" tab
2. Review registration requests
3. Click "✓ Approve" or "✗ Reject"

#### Create Users Directly
1. Go to "Users" tab
2. Fill in username and password
3. Select role (User or Admin)
4. Click "Add User"

#### Manage Users
1. Go to "Users" tab
2. View all users and their storage usage
3. Delete users if needed (except admin)

## 🔒 Security Features

### Password Security
- Show/hide password toggle on all password fields
- Minimum 6 character requirement
- Bcrypt hashing with salt
- Passwords never stored in plain text

### File Security
- Path traversal protection
- Dangerous file extension blocking
- User isolation (users can't access other's files)
- Secure filename sanitization

### Authentication
- JWT token-based authentication
- 8-hour token expiration
- Admin-only endpoints protected

### Validation
- Username format validation
- File type validation
- Path validation
- Input sanitization

## 📁 File Preview Support

| Type | Extensions | Preview |
|------|-----------|---------|
| **Images** | PNG, JPG, JPEG, GIF, BMP, WEBP, SVG | ✅ Full preview |
| **PDF** | PDF | ✅ In-browser viewer |
| **Text** | TXT, MD, JSON, XML, CSV, LOG | ✅ Text viewer |
| **Documents** | DOCX, XLSX, PPTX | ⬇️ Download only |
| **Archives** | ZIP, RAR, 7Z | ⬇️ Download only |
| **Media** | MP3, MP4, AVI, MKV | ⬇️ Download only |

## ⚙️ Configuration

### Environment Variables
```bash
# JWT Secret (highly recommended to set)
export JWT_SECRET_KEY="your-very-secret-key-here"

# Max file size (default 500MB)
export MAX_FILE_SIZE=524288000
```

### Allowed File Types
Edit in `main.py`:
```python
ALLOWED_EXTENSIONS = {
    'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif',
    # Add more extensions here
}
```

### Storage Location
Default: `./nas_storage/`

To change, edit in `main.py`:
```python
STORAGE_DIR = BASE_DIR / "nas_storage"  # Change path here
```

## 🌐 Production Deployment

### Using Gunicorn (Recommended)
```bash
# Install Gunicorn
pip install gunicorn

# Run with 4 workers
gunicorn -w 4 -b 0.0.0.0:5000 main:app
```

### Using systemd (Linux)
Create `/etc/systemd/system/nas.service`:
```ini
[Unit]
Description=NAS System
After=network.target

[Service]
User=your-user
WorkingDirectory=/path/to/NASServer
Environment="JWT_SECRET_KEY=your-secret-key"
ExecStart=/usr/bin/gunicorn -w 4 -b 0.0.0.0:5000 main:app
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable nas
sudo systemctl start nas
```

### Nginx Reverse Proxy
```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 500M;

    location / {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## 🐛 Troubleshooting

### "Module not found" errors
```bash
pip install flask flask-jwt-extended flask-cors bcrypt Pillow
```

### "Corrupted users.json" error
- Delete `users.json` file
- Restart server - it will create a new one

### Can't preview images
```bash
pip install Pillow
```

### Files not uploading
- Check file size (default limit: 500MB)
- Check file extension is allowed
- Check available disk space

### Port already in use
Change port in `main.py`:
```python
app.run(host="0.0.0.0", port=5001)  # Change 5000 to 5001
```

## 📝 Logging

Logs are stored in `logs/nas.log`

**Logged events:**
- User logins/registrations
- File uploads/downloads/deletions
- Folder creation/deletion
- User management actions
- Security warnings (path traversal attempts)
- Errors and exceptions

## 🔄 Backup

### Backup User Data
```bash
# Backup users database
cp users.json users_backup.json

# Backup all files
tar -czf nas_backup_$(date +%Y%m%d).tar.gz nas_storage/ users.json
```

### Restore
```bash
# Restore from backup
tar -xzf nas_backup_YYYYMMDD.tar.gz
```

## 📊 Storage Management

- Each user has isolated storage
- Storage usage tracked per user
- Admins can view all users' storage
- No global storage quotas (implement if needed)

## 🚧 Limitations

- Maximum file size: 500MB (configurable)
- No file versioning
- No file sharing between users
- No public file links
- Preview only for supported file types

## 🎯 Future Enhancements

Potential features to add:
- [ ] File sharing with other users
- [ ] Public file links with expiration
- [ ] Storage quotas per user
- [ ] File versioning
- [ ] Search functionality
- [ ] Bulk operations
- [ ] Mobile app
- [ ] Two-factor authentication

## 📄 License

This project is open source and available for personal and commercial use.

## 👤 Support

For issues or questions:
1. Check the troubleshooting section
2. Review logs in `logs/nas.log`
3. Check console output for errors

## 🎉 Credits

Built with:
- Flask - Web framework
- JWT - Authentication
- Bcrypt - Password security
- Pillow - Image processing
- Modern CSS - Professional UI

---

**⚠️ Important Security Notes:**
1. Change default admin password immediately
2. Set a strong JWT_SECRET_KEY in production
3. Use HTTPS in production
4. Regularly backup your data
5. Keep dependencies updated

**Happy file storing! 📦**
# Professional Network Storage System

A modern, secure network-attached storage (NAS) system with file sharing capabilities. All users must login to access network shared files.

## Features

### Core Features
- **User Authentication**: Secure login/registration with admin approval workflow
- **File Management**: Upload, download, preview, organize files in folders
- **Network Sharing**: Share files with admin approval - all viewers must be logged in
- **Access Control**: Only file owner and admin can delete shared files
- **Admin Dashboard**: User management, approve registrations and share requests
- **Professional UI**: Modern, clean design with improved aesthetics

### Network Sharing Workflow
1. **Request to Share**: Users can request to share their files on the network
2. **Admin Approval**: Admins review and approve/reject share requests
3. **Authenticated Access**: All users must login to view/download network files
4. **Delete Control**: Only file owner or admin can remove shared files

### User Roles & Permissions
- **Admin**: 
  - Full control over all files
  - Approve/reject user registrations
  - Approve/reject share requests
  - Delete any file (own or shared)
  - Manage all users

- **User**: 
  - Upload files to personal storage
  - Request to share files on network
  - View and download all network shared files (after login)
  - Delete only own files and own shares

- **Network Viewers**: 
  - Must be logged in
  - Can view and download all approved shared files
  - Cannot delete files unless they are the owner or admin

## Installation & Setup

### 1. Install Python Dependencies

```bash
pip install flask flask-jwt-extended flask-cors bcrypt pillow
```

### 2. Create Directory Structure

```bash
mkdir nas_system
cd nas_system
mkdir static
```

### 3. Copy Files

Place the files in the following structure:

```
nas_system/
├── app.py              # Backend server (main Python file)
├── static/
│   ├── index.html     # Frontend HTML
│   ├── app.js         # Frontend JavaScript
│   └── style.css      # Modern CSS styling
```

**Important**: 
- `app.py` goes in the root `nas_system/` directory
- `index.html`, `app.js`, and `style.css` go inside the `static/` subdirectory

### 4. Run the Application

```bash
python app.py
```

The server will start on `http://localhost:5000`

### 5. First Login

**Default Admin Credentials:**
- Username: `admin`
- Password: `admin123`

⚠️ **CRITICAL**: Change the admin password immediately after first login!

## File Locations After First Run

The application will automatically create these directories:

```
nas_system/
├── app.py
├── static/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── nas_storage/          # User files (auto-created)
│   └── username/         # Each user gets their own folder
├── users.json            # User database (auto-created)
├── shared_files.json     # Shared files database (auto-created)
└── logs/                 # Application logs (auto-created)
    └── nas.log
```

## Usage Guide

### For Regular Users

1. **Register Account**
   - Click "Register" on login page
   - Enter username and password
   - Wait for admin approval

2. **Upload Files**
   - Once approved, click "Upload Files" button
   - Select one or multiple files
   - Files are uploaded to your personal storage

3. **Organize Files**
   - Click "New Folder" to create folders
   - Navigate through folder structure using breadcrumbs

4. **Share Files on Network**
   - Find the file you want to share
   - Click "Share" button
   - Wait for admin approval
   - Once approved, file appears in "Network" tab for all users

5. **Browse Network Files**
   - Click "Network" tab
   - View all files shared by other users
   - Preview or download files
   - Only owner and admin can delete

### For Administrators

1. **Approve Users**
   - Click "User Approvals" tab
   - Review pending registrations
   - Click "Approve" or "Reject"

2. **Approve Shares**
   - Click "Share Requests" tab
   - Review pending file share requests
   - Click "Approve" to make file available on network
   - Click "Reject" to deny the request

3. **Manage Users**
   - Click "Users" tab
   - Add new users directly (bypassing approval)
   - Delete users and their files
   - View storage usage per user

4. **Monitor Network**
   - Click "Network" tab
   - View all shared files
   - Remove any inappropriate shares

## Security Features

✓ Password hashing with bcrypt
✓ JWT token-based authentication
✓ Path traversal prevention
✓ File type validation
✓ Dangerous file extension blocking
✓ Admin-only operations protection
✓ Authenticated network access

## Supported File Types

**Preview Available (in browser):**
- **Images**: PNG, JPG, JPEG, GIF, BMP, WEBP, SVG
- **Documents**: PDF
- **Text Files**: TXT, MD, JSON, XML, CSV, LOG

**Upload Supported:**
- **Documents**: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, ODT, ODS, ODP
- **Images**: PNG, JPG, JPEG, GIF, BMP, SVG, WEBP, ICO, TIFF
- **Archives**: ZIP, RAR, 7Z
- **Media**: MP3, MP4, AVI, MKV
- **Data**: CSV, JSON, XML
- **Text**: TXT, MD

**Blocked for Security:**
- Executable files: EXE, BAT, CMD, COM, SH, PS1
- Scripts: VBS, JS, JAR
- System files: DLL, SO, MSI

## Configuration Options

### Maximum File Size

Default: 500 MB. To change, edit `app.py`:

```python
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500 MB
```

### JWT Token Expiration

Default: 8 hours. To change, edit `app.py`:

```python
JWT_ACCESS_TOKEN_EXPIRES=timedelta(hours=8)
```

### Server Port

Default: 5000. To change, edit the last line in `app.py`:

```python
app.run(host="0.0.0.0", port=5000, debug=True)
```

## Network Access

To make the server accessible on your local network:

1. Find your server's IP address:
   - Windows: `ipconfig`
   - Linux/Mac: `ifconfig` or `ip addr`

2. Other devices can access at: `http://YOUR_IP:5000`

3. **Firewall**: Make sure port 5000 is open

## Troubleshooting

### "Module not found" errors
```bash
pip install flask flask-jwt-extended flask-cors bcrypt pillow
```

### "Permission denied" errors
- On Linux/Mac, you may need to use `sudo` or run as administrator

### Files not appearing
- Check that files are in the correct `static/` directory
- Verify the directory structure matches the layout above

### Preview not working
```bash
pip install Pillow
```

### Cannot access from other devices
- Check firewall settings
- Ensure server is running with `host="0.0.0.0"`
- Verify IP address is correct

## Production Deployment

For production use:

1. **Change debug mode** in `app.py`:
   ```python
   app.run(host="0.0.0.0", port=5000, debug=False)
   ```

2. **Set strong JWT secret**:
   ```bash
   export JWT_SECRET_KEY="your-very-long-random-secret-key-here"
   ```

3. **Use a production server** (not Flask's built-in):
   ```bash
   pip install gunicorn
   gunicorn -w 4 -b 0.0.0.0:5000 app:app
   ```

4. **Set up HTTPS** using nginx or Apache as reverse proxy

5. **Regular backups** of:
   - `nas_storage/` directory
   - `users.json`
   - `shared_files.json`

## Architecture

- **Backend**: Flask (Python web framework)
- **Authentication**: JWT tokens with bcrypt password hashing
- **Storage**: File system based (local storage)
- **Database**: JSON files (users.json, shared_files.json)
- **Frontend**: Vanilla JavaScript with modern CSS

## Browser Compatibility

✓ Chrome/Edge (recommended)
✓ Firefox
✓ Safari
✓ Opera

## License

Open source - use as you wish!

## Support

For issues or questions, check:
1. This README for common solutions
2. Application logs in `logs/nas.log`
3. Browser console for frontend errors

## Version

Version: 2.0
Last Updated: February 2026

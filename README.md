# Network Storage System - Improved Version

## Features Added
1. **Modern Dark UI**: Beautiful gradient-based design with animations and smooth transitions
2. **Account Settings**: Click on your username badge to access settings
   - Change password
   - Change username (requires password confirmation)
3. **Auto-redirect on Login Failure**: Automatically returns to login page after failed login attempts

## Installation

1. Install dependencies:
```bash
pip install flask flask-jwt-extended flask-cors bcrypt Pillow
```

2. Create the directory structure:
```bash
mkdir -p static
mv style.css static/
mv app.js static/
mv index.html static/
```

3. Run the application:
```bash
python app.py
```

4. Access at: http://localhost:5000

## Default Credentials
- Username: admin
- Password: admin123

⚠️ **IMPORTANT**: Change the admin password after first login!

## File Structure
```
nas_system/
├── app.py          # Flask backend with new API endpoints
├── static/
│   ├── index.html  # Main HTML with settings modal
│   ├── style.css   # Modern dark theme with animations
│   └── app.js      # Frontend logic with settings functionality
├── nas_storage/    # User file storage (created on run)
├── users.json      # User database (created on run)
└── shared_files.json  # Shared files database (created on run)
```

## New Features

### Account Settings
- Click on your username badge in the navbar to open settings
- Change password with current password verification
- Change username with password confirmation
- View account information

### UI Improvements
- Dark theme with gradient accents
- Smooth animations and transitions
- Better typography with Syne and DM Sans fonts
- Floating animations and glow effects
- Responsive design for mobile devices

### Security Features
- JWT token refresh on username change
- Password verification for sensitive operations
- Automatic logout redirect on auth failure

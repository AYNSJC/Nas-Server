from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from flask_cors import CORS
import bcrypt, json, os, shutil, secrets, re, mimetypes
from pathlib import Path
from datetime import datetime, timedelta
from werkzeug.utils import secure_filename
from PIL import Image
import io

try:
    import mammoth
    MAMMOTH_AVAILABLE = True
except ImportError:
    MAMMOTH_AVAILABLE = False
    print("⚠️  mammoth not installed - DOCX preview disabled. Run: pip install mammoth")

try:
    import openpyxl
    OPENPYXL_AVAILABLE = True
except ImportError:
    OPENPYXL_AVAILABLE = False
    print("⚠️  openpyxl not installed - Excel preview disabled. Run: pip install openpyxl")

BASE_DIR = Path(__file__).parent
STORAGE_DIR = BASE_DIR / "nas_storage"
USERS_FILE = BASE_DIR / "users.json"
SHARED_FILE = BASE_DIR / "shared_files.json"
LOG_DIR = BASE_DIR / "logs"
STATIC_DIR = BASE_DIR / "static"

STORAGE_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)
STATIC_DIR.mkdir(exist_ok=True)

JWT_SECRET = os.getenv("JWT_SECRET_KEY", secrets.token_urlsafe(64))
MAX_FILE_SIZE = 500 * 1024 * 1024

ALLOWED_EXTENSIONS = {
    'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx',
    'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'mp3',
    'mp4', 'avi', 'mkv', 'csv', 'json', 'xml', 'md', 'bmp', 'svg',
    'webp', 'ico', 'tiff', 'odt', 'ods', 'odp'
}

DANGEROUS_EXTENSIONS = {
    'exe', 'bat', 'cmd', 'com', 'pif', 'scr', 'vbs', 'js',
    'jar', 'msi', 'app', 'deb', 'rpm', 'sh', 'ps1', 'dll', 'so'
}

PREVIEWABLE_TYPES = {
    'image': {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'},
    'pdf': {'pdf'},
    'text': {'txt', 'md', 'json', 'xml', 'csv', 'log'},
    'docx': {'docx'},
    'xlsx': {'xlsx', 'xls'},
}


def allowed_file(filename):
    if '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    if ext in DANGEROUS_EXTENSIONS:
        return False
    return ext in ALLOWED_EXTENSIONS


def get_file_type(filename):
    if '.' not in filename:
        return 'unknown'
    ext = filename.rsplit('.', 1)[1].lower()
    for file_type, extensions in PREVIEWABLE_TYPES.items():
        if ext in extensions:
            return file_type
    return 'other'


def validate_username(username):
    if not username or len(username) < 3 or len(username) > 32:
        return False
    return bool(re.match(r'^[a-zA-Z0-9_]+$', username))


def validate_path(username, path):
    """Validate and sanitize path to prevent directory traversal"""
    if not path:
        return ""

    # Remove leading/trailing slashes and dots
    path = path.strip().strip('/').strip('.')

    # Split and sanitize each component
    components = [secure_filename(p) for p in path.split('/') if p and p != '..']

    return '/'.join(components)


def log_action(action, username, details=""):
    """Human-readable logging"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_message = f"[{timestamp}] {action.upper()} | User: {username}"
    if details:
        log_message += f" | {details}"
    print(log_message)
    
    # Also write to file
    with open(LOG_DIR / 'nas.log', 'a') as f:
        f.write(log_message + '\n')


class SharedFilesManager:
    def __init__(self, shared_file):
        self.shared_file = shared_file
        self.load_shared_files()

    def load_shared_files(self):
        if self.shared_file.exists():
            try:
                with open(self.shared_file, 'r', encoding='utf-8') as f:
                    self.shared_files = json.load(f)
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.shared_files = {"pending": [], "approved": [], "folders": []}
                self.save_shared_files()
        else:
            self.shared_files = {"pending": [], "approved": [], "folders": []}
            self.save_shared_files()

    def save_shared_files(self):
        with open(self.shared_file, 'w', encoding='utf-8') as f:
            json.dump(self.shared_files, f, indent=2, ensure_ascii=False)

    def request_share(self, username, filepath, filename, file_size, file_type):
        file_entry = {
            "id": secrets.token_urlsafe(16),
            "username": username,
            "filepath": filepath,
            "filename": filename,
            "file_size": file_size,
            "file_type": file_type,
            "requested_at": datetime.now().isoformat(),
            "status": "pending"
        }
        self.shared_files["pending"].append(file_entry)
        self.save_shared_files()
        return file_entry["id"]

    def request_folder_share(self, username, folder_path, folder_name):
        folder_entry = {
            "id": secrets.token_urlsafe(16),
            "username": username,
            "folder_path": folder_path,
            "folder_name": folder_name,
            "requested_at": datetime.now().isoformat(),
            "status": "pending"
        }
        if "pending_folders" not in self.shared_files:
            self.shared_files["pending_folders"] = []
        self.shared_files["pending_folders"].append(folder_entry)
        self.save_shared_files()
        return folder_entry["id"]

    def approve_share(self, file_id):
        for i, entry in enumerate(self.shared_files["pending"]):
            if entry["id"] == file_id:
                entry["status"] = "approved"
                entry["approved_at"] = datetime.now().isoformat()
                self.shared_files["approved"].append(entry)
                self.shared_files["pending"].pop(i)
                self.save_shared_files()
                return True
        return False

    def approve_folder_share(self, folder_id):
        if "pending_folders" not in self.shared_files:
            self.shared_files["pending_folders"] = []
        if "folders" not in self.shared_files:
            self.shared_files["folders"] = []

        for i, entry in enumerate(self.shared_files["pending_folders"]):
            if entry["id"] == folder_id:
                entry["status"] = "approved"
                entry["approved_at"] = datetime.now().isoformat()
                self.shared_files["folders"].append(entry)
                self.shared_files["pending_folders"].pop(i)
                self.save_shared_files()
                return True
        return False

    def reject_share(self, file_id):
        for i, entry in enumerate(self.shared_files["pending"]):
            if entry["id"] == file_id:
                self.shared_files["pending"].pop(i)
                self.save_shared_files()
                return True
        return False

    def reject_folder_share(self, folder_id):
        if "pending_folders" not in self.shared_files:
            return False

        for i, entry in enumerate(self.shared_files["pending_folders"]):
            if entry["id"] == folder_id:
                self.shared_files["pending_folders"].pop(i)
                self.save_shared_files()
                return True
        return False

    def remove_share(self, file_id):
        for i, entry in enumerate(self.shared_files["approved"]):
            if entry["id"] == file_id:
                self.shared_files["approved"].pop(i)
                self.save_shared_files()
                return True
        return False

    def remove_folder_share(self, folder_id):
        if "folders" not in self.shared_files:
            return False

        for i, entry in enumerate(self.shared_files["folders"]):
            if entry["id"] == folder_id:
                self.shared_files["folders"].pop(i)
                self.save_shared_files()
                return True
        return False

    def get_pending(self):
        return self.shared_files["pending"]

    def get_pending_folders(self):
        if "pending_folders" not in self.shared_files:
            self.shared_files["pending_folders"] = []
        return self.shared_files["pending_folders"]

    def get_approved(self):
        return self.shared_files["approved"]

    def get_approved_folders(self):
        if "folders" not in self.shared_files:
            self.shared_files["folders"] = []
        return self.shared_files["folders"]

    def is_file_shared(self, username, filepath):
        for entry in self.shared_files["approved"]:
            if entry["username"] == username and entry["filepath"] == filepath:
                return True
        return False

    def is_folder_shared(self, username, folder_path):
        if "folders" not in self.shared_files:
            return False
        for entry in self.shared_files["folders"]:
            if entry["username"] == username and entry["folder_path"] == folder_path:
                return True
        return False

    def is_in_shared_folder(self, username, filepath):
        """Check if a file is within a shared folder"""
        if "folders" not in self.shared_files:
            return False

        for folder in self.shared_files["folders"]:
            if folder["username"] == username:
                # Check if filepath starts with the folder path
                if filepath.startswith(folder["folder_path"] + "/") or filepath == folder["folder_path"]:
                    return True
        return False


class UserManager:
    def __init__(self, users_file):
        self.users_file = users_file
        self.load_users()

    def load_users(self):
        if self.users_file.exists():
            try:
                with open(self.users_file, 'r', encoding='utf-8') as f:
                    self.users = json.load(f)
            except (json.JSONDecodeError, UnicodeDecodeError):
                backup = self.users_file.with_suffix('.json.backup')
                self.users_file.rename(backup)
                print(f"⚠️  Corrupted users.json backed up to {backup}")
                self._create_default_user()
        else:
            self._create_default_user()

    def _create_default_user(self):
        self.users = {
            "admin": {
                "password_hash": bcrypt.hashpw("admin123".encode(), bcrypt.gensalt()).decode(),
                "role": "admin",
                "status": "approved",
                "created_at": datetime.now().isoformat(),
                "storage_used": 0,
                "auto_share": False
            }
        }
        self.save_users()

    def save_users(self):
        with open(self.users_file, 'w', encoding='utf-8') as f:
            json.dump(self.users, f, indent=2, ensure_ascii=False)

    def register_user(self, username, password):
        if not validate_username(username):
            return False, "Invalid username format"
        if username in self.users:
            return False, "Username already exists"
        if len(password) < 6:
            return False, "Password must be at least 6 characters"

        self.users[username] = {
            "password_hash": bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(),
            "role": "user",
            "status": "pending",
            "created_at": datetime.now().isoformat(),
            "storage_used": 0,
            "auto_share": False
        }
        self.save_users()
        return True, "Registration submitted for approval"

    def approve_user(self, username):
        if username not in self.users:
            return False, "User not found"
        self.users[username]["status"] = "approved"
        self.save_users()
        (STORAGE_DIR / username).mkdir(exist_ok=True)
        return True, "User approved"

    def reject_user(self, username):
        if username not in self.users or self.users[username]["status"] == "approved":
            return False, "Cannot reject"
        del self.users[username]
        self.save_users()
        return True, "User rejected"

    def add_user(self, username, password, role="user", auto_share=False):
        if not validate_username(username):
            return False, "Invalid username format"
        if username in self.users:
            return False, "User exists"
        if len(password) < 6:
            return False, "Password must be at least 6 characters"

        self.users[username] = {
            "password_hash": bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(),
            "role": role,
            "status": "approved",
            "created_at": datetime.now().isoformat(),
            "storage_used": 0,
            "auto_share": auto_share
        }
        self.save_users()
        (STORAGE_DIR / username).mkdir(exist_ok=True)
        return True, "User created"

    def delete_user(self, username):
        if username == "admin" or username not in self.users:
            return False, "Cannot delete"
        user_dir = STORAGE_DIR / username
        if user_dir.exists():
            shutil.rmtree(user_dir)
        del self.users[username]
        self.save_users()
        return True, "User deleted"

    def authenticate(self, username, password):
        if username not in self.users:
            return False
        if self.users[username]["status"] != "approved":
            return False
        return bcrypt.checkpw(password.encode(), self.users[username]["password_hash"].encode())

    def get_user(self, username):
        return self.users.get(username)

    def list_users(self, status=None):
        return [
            {
                "username": u,
                "role": d["role"],
                "status": d["status"],
                "created_at": d["created_at"],
                "storage_used": d["storage_used"],
                "auto_share": d.get("auto_share", False)
            }
            for u, d in self.users.items()
            if status is None or d["status"] == status
        ]

    def update_storage_used(self, username):
        user_dir = STORAGE_DIR / username
        if user_dir.exists():
            total = sum(f.stat().st_size for f in user_dir.rglob('*') if f.is_file())
            self.users[username]["storage_used"] = total
            self.save_users()

    def toggle_auto_share(self, username, enable):
        if username not in self.users:
            return False, "User not found"
        self.users[username]["auto_share"] = enable
        self.save_users()
        return True, f"Auto-share {'enabled' if enable else 'disabled'}"


app = Flask(__name__, static_folder='static')
app.config.update(
    JWT_SECRET_KEY=JWT_SECRET,
    JWT_ACCESS_TOKEN_EXPIRES=timedelta(hours=8),
    MAX_CONTENT_LENGTH=MAX_FILE_SIZE
)
CORS(app)
jwt = JWTManager(app)
user_manager = UserManager(USERS_FILE)
shared_manager = SharedFilesManager(SHARED_FILE)


def format_size(size):
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024:
            return f"{size:.2f} {unit}"
        size /= 1024
    return f"{size:.2f} PB"


# ==================== STATIC FILES ====================
@app.route("/")
def index():
    return send_file(STATIC_DIR / "index.html")


@app.route("/static/<path:filename>")
def serve_static(filename):
    return send_from_directory(STATIC_DIR, filename)


# ==================== API ENDPOINTS ====================
@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "")

    success, msg = user_manager.register_user(username, password)

    if success:
        log_action("register", username, "Registration submitted")
        return jsonify({"msg": msg}), 200
    return jsonify({"msg": msg}), 400


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not user_manager.authenticate(username, password):
        log_action("login_failed", username)
        return jsonify({"msg": "Invalid credentials"}), 401

    user = user_manager.get_user(username)
    access_token = create_access_token(identity=username)

    log_action("login", username)
    return jsonify({
        "access_token": access_token,
        "role": user["role"],
        "auto_share": user.get("auto_share", False),
        "msg": "Login successful"
    }), 200


@app.route("/api/upload", methods=["POST"])
@jwt_required()
def upload_files():
    username = get_jwt_identity()
    user = user_manager.get_user(username)
    folder_path = request.form.get('folder', '').strip()
    folder_path = validate_path(username, folder_path)
    is_folder_upload = request.form.get('is_folder_upload', 'false') == 'true'

    user_dir = STORAGE_DIR / username
    if folder_path:
        target_dir = user_dir / folder_path
    else:
        target_dir = user_dir

    target_dir.mkdir(parents=True, exist_ok=True)

    if 'files' not in request.files:
        return jsonify({"msg": "No files provided"}), 400

    files = request.files.getlist('files')
    paths = request.form.getlist('paths') if is_folder_upload else []
    uploaded = []
    errors = []

    for idx, file in enumerate(files):
        if file.filename == '':
            continue

        if not allowed_file(file.filename):
            errors.append(f"{file.filename}: File type not allowed")
            continue

        # Handle folder structure for folder uploads
        if is_folder_upload and idx < len(paths):
            relative_path = paths[idx]
            # Extract directory structure
            file_dir = os.path.dirname(relative_path)
            filename = os.path.basename(relative_path)
            
            # Create subdirectories
            if file_dir:
                full_dir = target_dir / file_dir
                full_dir.mkdir(parents=True, exist_ok=True)
                filepath = full_dir / filename
            else:
                filepath = target_dir / filename
        else:
            filename = secure_filename(file.filename)
            filepath = target_dir / filename

            if filepath.exists():
                name, ext = os.path.splitext(filename)
                counter = 1
                while filepath.exists():
                    filename = f"{name}_{counter}{ext}"
                    filepath = target_dir / filename
                    counter += 1

        try:
            file.save(str(filepath))
            uploaded.append(str(filepath.relative_to(user_dir)))
            
            # Auto-share if enabled
            if user.get("auto_share", False):
                stat = filepath.stat()
                file_id = shared_manager.request_share(
                    username,
                    str(filepath.relative_to(user_dir)),
                    filepath.name,
                    stat.st_size,
                    get_file_type(filepath.name)
                )
                shared_manager.approve_share(file_id)
                
            log_action("upload", username, f"{filepath.name}")
        except Exception as e:
            log_action("upload_error", username, f"{file.filename}: {str(e)}")
            errors.append(f"{file.filename}: Upload failed")

    user_manager.update_storage_used(username)

    if uploaded:
        msg = f"Uploaded {len(uploaded)} file(s)"
        if errors:
            msg += f". {len(errors)} file(s) failed"
        if user.get("auto_share", False):
            msg += " and auto-shared to network"
        return jsonify({"msg": msg, "uploaded": uploaded}), 200

    return jsonify({"msg": "No files uploaded", "errors": errors}), 400


@app.route("/api/files", methods=["GET"])
@jwt_required()
def list_files():
    username = get_jwt_identity()
    folder_path = request.args.get('folder', '').strip()
    folder_path = validate_path(username, folder_path)

    user_dir = STORAGE_DIR / username
    if folder_path:
        target_dir = user_dir / folder_path
    else:
        target_dir = user_dir

    if not target_dir.exists():
        return jsonify({
            "files": [],
            "folders": [],
            "current_path": folder_path,
            "total_files": 0,
            "total_size": 0,
            "total_size_formatted": "0 B"
        }), 200

    files = []
    folders = []
    total_size = 0

    for item in target_dir.iterdir():
        if item.is_file():
            stat = item.stat()
            ext = item.suffix[1:].lower() if item.suffix else ''
            filepath_relative = str(item.relative_to(user_dir))
            is_shared = shared_manager.is_file_shared(username,
                                                      filepath_relative) or shared_manager.is_in_shared_folder(username,
                                                                                                               filepath_relative)
            files.append({
                "name": item.name,
                "size": stat.st_size,
                "size_formatted": format_size(stat.st_size),
                "modified": stat.st_mtime,
                "type": get_file_type(item.name),
                "ext": ext,
                "is_shared": is_shared
            })
            total_size += stat.st_size
        elif item.is_dir():
            stat = item.stat()
            folder_relative = str(item.relative_to(user_dir))
            folders.append({
                "name": item.name,
                "modified": stat.st_mtime,
                "is_shared": shared_manager.is_folder_shared(username, folder_relative)
            })

    files.sort(key=lambda x: x["modified"], reverse=True)
    folders.sort(key=lambda x: x["name"])

    return jsonify({
        "files": files,
        "folders": folders,
        "current_path": folder_path,
        "total_files": len(files),
        "total_size": total_size,
        "total_size_formatted": format_size(total_size)
    }), 200


@app.route("/api/share/request", methods=["POST"])
@jwt_required()
def request_share():
    username = get_jwt_identity()
    user = user_manager.get_user(username)
    data = request.get_json()
    filepath = data.get('filepath', '').strip()

    filepath = validate_path(username, filepath)
    user_dir = STORAGE_DIR / username
    file_path = user_dir / filepath

    try:
        file_path.resolve().relative_to(user_dir.resolve())
    except ValueError:
        return jsonify({"msg": "Access denied"}), 403

    if not file_path.exists():
        return jsonify({"msg": "File not found"}), 404

    stat = file_path.stat()
    file_id = shared_manager.request_share(
        username,
        filepath,
        file_path.name,
        stat.st_size,
        get_file_type(file_path.name)
    )

    # Auto-approve if user is admin or has auto_share enabled
    if user["role"] == "admin" or user.get("auto_share", False):
        shared_manager.approve_share(file_id)
        log_action("share_auto_approved", username, filepath)
        return jsonify({"msg": "File shared successfully (auto-approved)", "file_id": file_id}), 200

    log_action("share_requested", username, filepath)
    return jsonify({"msg": "Share request submitted for approval", "file_id": file_id}), 200


@app.route("/api/share/folder/request", methods=["POST"])
@jwt_required()
def request_folder_share():
    username = get_jwt_identity()
    user = user_manager.get_user(username)
    data = request.get_json()
    folder_path = data.get('folder_path', '').strip()

    folder_path = validate_path(username, folder_path)
    user_dir = STORAGE_DIR / username
    folder_full_path = user_dir / folder_path

    try:
        folder_full_path.resolve().relative_to(user_dir.resolve())
    except ValueError:
        return jsonify({"msg": "Access denied"}), 403

    if not folder_full_path.exists() or not folder_full_path.is_dir():
        return jsonify({"msg": "Folder not found"}), 404

    folder_id = shared_manager.request_folder_share(
        username,
        folder_path,
        folder_full_path.name
    )

    # Auto-approve if user is admin or has auto_share enabled
    if user["role"] == "admin" or user.get("auto_share", False):
        shared_manager.approve_folder_share(folder_id)
        log_action("folder_share_auto_approved", username, folder_path)
        return jsonify({"msg": "Folder shared successfully (auto-approved)", "folder_id": folder_id}), 200

    log_action("folder_share_requested", username, folder_path)
    return jsonify({"msg": "Folder share request submitted for approval", "folder_id": folder_id}), 200


@app.route("/api/share/pending", methods=["GET"])
@jwt_required()
def get_pending_shares():
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    if user["role"] != "admin":
        return jsonify({"msg": "Admin access required"}), 403

    pending_files = shared_manager.get_pending()
    pending_folders = shared_manager.get_pending_folders()
    return jsonify({"shares": pending_files, "folders": pending_folders}), 200


@app.route("/api/share/approve/<file_id>", methods=["POST"])
@jwt_required()
def approve_share(file_id):
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    if user["role"] != "admin":
        return jsonify({"msg": "Admin access required"}), 403

    if shared_manager.approve_share(file_id):
        log_action("share_approved", username, file_id)
        return jsonify({"msg": "Share approved"}), 200

    return jsonify({"msg": "Share not found"}), 404


@app.route("/api/share/folder/approve/<folder_id>", methods=["POST"])
@jwt_required()
def approve_folder_share(folder_id):
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    if user["role"] != "admin":
        return jsonify({"msg": "Admin access required"}), 403

    if shared_manager.approve_folder_share(folder_id):
        log_action("folder_share_approved", username, folder_id)
        return jsonify({"msg": "Folder share approved"}), 200

    return jsonify({"msg": "Folder share not found"}), 404


@app.route("/api/share/reject/<file_id>", methods=["POST"])
@jwt_required()
def reject_share(file_id):
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    if user["role"] != "admin":
        return jsonify({"msg": "Admin access required"}), 403

    if shared_manager.reject_share(file_id):
        log_action("share_rejected", username, file_id)
        return jsonify({"msg": "Share rejected"}), 200

    return jsonify({"msg": "Share not found"}), 404


@app.route("/api/share/folder/reject/<folder_id>", methods=["POST"])
@jwt_required()
def reject_folder_share(folder_id):
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    if user["role"] != "admin":
        return jsonify({"msg": "Admin access required"}), 403

    if shared_manager.reject_folder_share(folder_id):
        log_action("folder_share_rejected", username, folder_id)
        return jsonify({"msg": "Folder share rejected"}), 200

    return jsonify({"msg": "Folder share not found"}), 404


@app.route("/api/share/remove/<file_id>", methods=["DELETE"])
@jwt_required()
def remove_share(file_id):
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    # Check if user is admin or file owner
    approved = shared_manager.get_approved()
    file_entry = None
    for entry in approved:
        if entry["id"] == file_id:
            file_entry = entry
            break

    if not file_entry:
        return jsonify({"msg": "Share not found"}), 404

    if user["role"] != "admin" and file_entry["username"] != username:
        return jsonify({"msg": "Permission denied"}), 403

    if shared_manager.remove_share(file_id):
        log_action("share_removed", username, file_id)
        return jsonify({"msg": "Share removed"}), 200

    return jsonify({"msg": "Share not found"}), 404


@app.route("/api/share/folder/remove/<folder_id>", methods=["DELETE"])
@jwt_required()
def remove_folder_share(folder_id):
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    # Check if user is admin or folder owner
    approved_folders = shared_manager.get_approved_folders()
    folder_entry = None
    for entry in approved_folders:
        if entry["id"] == folder_id:
            folder_entry = entry
            break

    if not folder_entry:
        return jsonify({"msg": "Folder share not found"}), 404

    if user["role"] != "admin" and folder_entry["username"] != username:
        return jsonify({"msg": "Permission denied"}), 403

    if shared_manager.remove_folder_share(folder_id):
        log_action("folder_share_removed", username, folder_id)
        return jsonify({"msg": "Folder share removed"}), 200

    return jsonify({"msg": "Folder share not found"}), 404


@app.route("/api/network/files", methods=["GET"])
@jwt_required()
def get_network_files():
    """Network files - requires login"""
    approved_files = shared_manager.get_approved()
    approved_folders = shared_manager.get_approved_folders()
    return jsonify({"files": approved_files, "folders": approved_folders}), 200


@app.route("/api/network/folder/<folder_id>", methods=["GET"])
@jwt_required()
def get_network_folder_contents(folder_id):
    """Get contents of a shared folder with subfolder support"""
    approved_folders = shared_manager.get_approved_folders()

    folder_entry = None
    for entry in approved_folders:
        if entry["id"] == folder_id:
            folder_entry = entry
            break

    if not folder_entry:
        return jsonify({"msg": "Folder not found"}), 404

    user_dir = STORAGE_DIR / folder_entry["username"]
    folder_path = user_dir / folder_entry["folder_path"]
    
    # Handle subpath if provided
    subpath = request.args.get('path', '').strip()
    if subpath:
        subpath = validate_path(folder_entry["username"], subpath)
        folder_path = folder_path / subpath

    if not folder_path.exists():
        return jsonify({"msg": "Folder not found"}), 404

    files = []
    subfolders = []

    for item in folder_path.iterdir():
        if item.is_file():
            stat = item.stat()
            relative_path = str(item.relative_to(user_dir / folder_entry["folder_path"]))
            files.append({
                "id": secrets.token_urlsafe(16),
                "username": folder_entry["username"],
                "filepath": str(item.relative_to(user_dir)),
                "filename": item.name,
                "relative_path": relative_path,
                "file_size": stat.st_size,
                "file_type": get_file_type(item.name),
                "modified": stat.st_mtime
            })
        elif item.is_dir():
            relative_path = str(item.relative_to(user_dir / folder_entry["folder_path"]))
            subfolders.append({
                "name": item.name,
                "relative_path": relative_path
            })

    return jsonify({
        "folder": folder_entry,
        "files": files,
        "subfolders": subfolders
    }), 200


@app.route("/api/folder/create", methods=["POST"])
@jwt_required()
def create_folder():
    username = get_jwt_identity()
    data = request.get_json()
    current_path = data.get('current_path', '').strip()
    folder_name = data.get('folder_name', '').strip()

    if not folder_name:
        return jsonify({"msg": "Folder name required"}), 400

    current_path = validate_path(username, current_path)
    folder_name = secure_filename(folder_name)

    user_dir = STORAGE_DIR / username
    if current_path:
        target_dir = user_dir / current_path / folder_name
    else:
        target_dir = user_dir / folder_name

    if target_dir.exists():
        return jsonify({"msg": "Folder already exists"}), 400

    try:
        target_dir.mkdir(parents=True, exist_ok=False)
        log_action("folder_created", username, f"{current_path}/{folder_name}")
        return jsonify({"msg": "Folder created successfully"}), 200
    except Exception as e:
        log_action("folder_create_error", username, str(e))
        return jsonify({"msg": "Failed to create folder"}), 500


@app.route("/api/folder/delete", methods=["DELETE"])
@jwt_required()
def delete_folder():
    username = get_jwt_identity()
    folder_path = request.args.get('path', '').strip()
    folder_path = validate_path(username, folder_path)

    if not folder_path:
        return jsonify({"msg": "Invalid folder path"}), 400

    user_dir = STORAGE_DIR / username
    target_dir = user_dir / folder_path

    try:
        target_dir.resolve().relative_to(user_dir.resolve())
    except ValueError:
        return jsonify({"msg": "Access denied"}), 403

    if not target_dir.exists() or not target_dir.is_dir():
        return jsonify({"msg": "Folder not found"}), 404

    try:
        shutil.rmtree(target_dir)
        user_manager.update_storage_used(username)
        log_action("folder_deleted", username, folder_path)
        return jsonify({"msg": "Folder deleted successfully"}), 200
    except Exception as e:
        log_action("folder_delete_error", username, str(e))
        return jsonify({"msg": "Failed to delete folder"}), 500


@app.route("/api/preview/<path:filepath>", methods=["GET"])
def preview_file(filepath):
    token = request.args.get('token')
    if not token:
        return jsonify({"msg": "No token provided"}), 401

    try:
        from flask_jwt_extended import decode_token
        decoded = decode_token(token)
        username = decoded['sub']
    except Exception:
        return jsonify({"msg": "Invalid token"}), 401

    filepath = validate_path(username, filepath)
    user_dir = STORAGE_DIR / username
    file_path = user_dir / filepath

    try:
        file_path.resolve().relative_to(user_dir.resolve())
    except ValueError:
        return jsonify({"msg": "Access denied"}), 403

    if not file_path.exists():
        return jsonify({"msg": "File not found"}), 404

    file_type = get_file_type(file_path.name)

    if file_type == 'image':
        return send_file(file_path, mimetype=mimetypes.guess_type(file_path)[0])

    elif file_type == 'pdf':
        # Add zoom controls to PDF preview
        html = f'''
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * {{ margin: 0; padding: 0; box-sizing: border-box; }}
                body {{ background: #525252; overflow: hidden; }}
                #pdf-container {{ width: 100vw; height: 100vh; }}
                .zoom-controls {{
                    position: fixed;
                    top: 15px;
                    right: 15px;
                    background: rgba(0, 0, 0, 0.85);
                    padding: 12px;
                    border-radius: 10px;
                    display: flex;
                    gap: 8px;
                    z-index: 1000;
                }}
                .zoom-btn {{
                    background: #4CAF50;
                    color: white;
                    border: none;
                    padding: 10px 16px;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 18px;
                    font-weight: bold;
                }}
                .zoom-btn:hover {{ background: #45a049; }}
                .zoom-level {{
                    color: white;
                    padding: 8px 12px;
                    font-weight: bold;
                    font-size: 16px;
                }}
            </style>
        </head>
        <body>
            <div class="zoom-controls">
                <button class="zoom-btn" onclick="zoomOut()">−</button>
                <span class="zoom-level" id="zoomLevel">100%</span>
                <button class="zoom-btn" onclick="zoomIn()">+</button>
                <button class="zoom-btn" onclick="resetZoom()">⟲</button>
            </div>
            <embed id="pdf-container" src="/api/download/{filepath}?token={token}" type="application/pdf">
            <script>
                let zoom = 100;
                function updateZoom() {{
                    const container = document.getElementById('pdf-container');
                    container.style.transform = 'scale(' + (zoom / 100) + ')';
                    container.style.transformOrigin = 'top left';
                    document.getElementById('zoomLevel').textContent = zoom + '%';
                }}
                function zoomIn() {{ if (zoom < 200) {{ zoom += 10; updateZoom(); }} }}
                function zoomOut() {{ if (zoom > 50) {{ zoom -= 10; updateZoom(); }} }}
                function resetZoom() {{ zoom = 100; updateZoom(); }}
            </script>
        </body>
        </html>
        '''
        return html, 200, {'Content-Type': 'text/html; charset=utf-8'}

    elif file_type == 'text':
        return send_file(file_path, mimetype='text/plain')

    else:
        return jsonify({"msg": "Preview not available for this file type"}), 400


@app.route("/api/network/preview/<file_id>", methods=["GET"])
def preview_network_file(file_id):
    """Preview for shared files - requires login via token"""
    token = request.args.get('token')
    if not token:
        return jsonify({"msg": "No token provided"}), 401

    try:
        from flask_jwt_extended import decode_token
        decoded = decode_token(token)
        username = decoded['sub']
    except Exception:
        return jsonify({"msg": "Invalid token"}), 401

    approved = shared_manager.get_approved()

    file_entry = None
    for entry in approved:
        if entry["id"] == file_id:
            file_entry = entry
            break

    if not file_entry:
        return jsonify({"msg": "File not found"}), 404

    user_dir = STORAGE_DIR / file_entry["username"]
    file_path = user_dir / file_entry["filepath"]

    if not file_path.exists():
        return jsonify({"msg": "File not found"}), 404

    file_type = get_file_type(file_path.name)

    if file_type == 'image':
        return send_file(file_path, mimetype=mimetypes.guess_type(file_path)[0])

    elif file_type == 'pdf':
        return send_file(file_path, mimetype='application/pdf')

    elif file_type == 'text':
        return send_file(file_path, mimetype='text/plain')

    else:
        return jsonify({"msg": "Preview not available for this file type"}), 400


@app.route("/api/download/<path:filepath>", methods=["GET"])
def download_file(filepath):
    token = request.args.get('token')
    if not token:
        return jsonify({"msg": "No token provided"}), 401

    try:
        from flask_jwt_extended import decode_token
        decoded = decode_token(token)
        username = decoded['sub']
    except Exception:
        return jsonify({"msg": "Invalid token"}), 401

    filepath = validate_path(username, filepath)
    user_dir = STORAGE_DIR / username
    file_path = user_dir / filepath

    try:
        file_path.resolve().relative_to(user_dir.resolve())
    except ValueError:
        log_action("path_traversal_attempt", username, filepath)
        return jsonify({"msg": "Access denied"}), 403

    if not file_path.exists():
        return jsonify({"msg": "File not found"}), 404

    log_action("download", username, filepath)
    return send_file(file_path, as_attachment=True, download_name=file_path.name)


@app.route("/api/network/download/<file_id>", methods=["GET"])
def download_network_file(file_id):
    """Download for shared files - requires login via token"""
    token = request.args.get('token')
    if not token:
        return jsonify({"msg": "No token provided"}), 401

    try:
        from flask_jwt_extended import decode_token
        decoded = decode_token(token)
        username = decoded['sub']
    except Exception:
        return jsonify({"msg": "Invalid token"}), 401

    approved = shared_manager.get_approved()

    file_entry = None
    for entry in approved:
        if entry["id"] == file_id:
            file_entry = entry
            break

    if not file_entry:
        return jsonify({"msg": "File not found"}), 404

    user_dir = STORAGE_DIR / file_entry["username"]
    file_path = user_dir / file_entry["filepath"]

    if not file_path.exists():
        return jsonify({"msg": "File not found"}), 404

    log_action("network_download", username, f"{file_entry['filename']} (by {file_entry['username']})")
    return send_file(file_path, as_attachment=True, download_name=file_path.name)


@app.route("/api/delete/<path:filepath>", methods=["DELETE"])
@jwt_required()
def delete_file(filepath):
    username = get_jwt_identity()
    filepath = validate_path(username, filepath)
    user_dir = STORAGE_DIR / username
    file_path = user_dir / filepath

    try:
        file_path.resolve().relative_to(user_dir.resolve())
    except ValueError:
        log_action("path_traversal_attempt", username, filepath)
        return jsonify({"msg": "Access denied"}), 403

    if not file_path.exists():
        return jsonify({"msg": "File not found"}), 404

    try:
        file_path.unlink()
        user_manager.update_storage_used(username)
        log_action("delete", username, filepath)
        return jsonify({"msg": "File deleted"}), 200
    except Exception as e:
        log_action("delete_error", username, f"{filepath}: {str(e)}")
        return jsonify({"msg": "Delete failed"}), 500


@app.route("/api/bulk/delete", methods=["POST"])
@jwt_required()
def bulk_delete_files():
    username = get_jwt_identity()
    data = request.get_json()
    filepaths = data.get('filepaths', [])

    if not filepaths:
        return jsonify({"msg": "No files specified"}), 400

    user_dir = STORAGE_DIR / username
    deleted = []
    errors = []

    for filepath in filepaths:
        filepath = validate_path(username, filepath)
        file_path = user_dir / filepath

        try:
            file_path.resolve().relative_to(user_dir.resolve())
            if file_path.exists() and file_path.is_file():
                file_path.unlink()
                deleted.append(filepath)
                log_action("bulk_delete", username, filepath)
            else:
                errors.append(filepath)
        except Exception as e:
            log_action("bulk_delete_error", username, f"{filepath}: {str(e)}")
            errors.append(filepath)

    user_manager.update_storage_used(username)

    msg = f"Deleted {len(deleted)} file(s)"
    if errors:
        msg += f". {len(errors)} failed"

    return jsonify({"msg": msg, "deleted": deleted, "errors": errors}), 200


@app.route("/api/bulk/move", methods=["POST"])
@jwt_required()
def bulk_move_files():
    username = get_jwt_identity()
    data = request.get_json()
    filepaths = data.get('filepaths', [])
    destination = data.get('destination', '').strip()

    if not filepaths:
        return jsonify({"msg": "No files specified"}), 400

    destination = validate_path(username, destination)
    user_dir = STORAGE_DIR / username
    dest_dir = user_dir / destination if destination else user_dir

    if not dest_dir.exists():
        return jsonify({"msg": "Destination folder not found"}), 404

    moved = []
    errors = []

    for filepath in filepaths:
        filepath = validate_path(username, filepath)
        file_path = user_dir / filepath

        try:
            file_path.resolve().relative_to(user_dir.resolve())
            if file_path.exists() and file_path.is_file():
                dest_path = dest_dir / file_path.name
                
                # Handle name conflicts
                if dest_path.exists():
                    name, ext = os.path.splitext(file_path.name)
                    counter = 1
                    while dest_path.exists():
                        dest_path = dest_dir / f"{name}_{counter}{ext}"
                        counter += 1
                
                shutil.move(str(file_path), str(dest_path))
                moved.append(filepath)
                log_action("bulk_move", username, f"{filepath} -> {destination}")
            else:
                errors.append(filepath)
        except Exception as e:
            log_action("bulk_move_error", username, f"{filepath}: {str(e)}")
            errors.append(filepath)

    msg = f"Moved {len(moved)} file(s)"
    if errors:
        msg += f". {len(errors)} failed"

    return jsonify({"msg": msg, "moved": moved, "errors": errors}), 200


@app.route("/api/bulk/share", methods=["POST"])
@jwt_required()
def bulk_share_files():
    username = get_jwt_identity()
    user = user_manager.get_user(username)
    data = request.get_json()
    filepaths = data.get('filepaths', [])

    if not filepaths:
        return jsonify({"msg": "No files specified"}), 400

    user_dir = STORAGE_DIR / username
    shared = []
    errors = []

    for filepath in filepaths:
        filepath = validate_path(username, filepath)
        file_path = user_dir / filepath

        try:
            file_path.resolve().relative_to(user_dir.resolve())
            if file_path.exists() and file_path.is_file():
                stat = file_path.stat()
                file_id = shared_manager.request_share(
                    username,
                    filepath,
                    file_path.name,
                    stat.st_size,
                    get_file_type(file_path.name)
                )
                
                # Auto-approve if admin or auto_share enabled
                if user["role"] == "admin" or user.get("auto_share", False):
                    shared_manager.approve_share(file_id)
                
                shared.append(filepath)
                log_action("bulk_share", username, filepath)
            else:
                errors.append(filepath)
        except Exception as e:
            log_action("bulk_share_error", username, f"{filepath}: {str(e)}")
            errors.append(filepath)

    msg = f"Shared {len(shared)} file(s)"
    if errors:
        msg += f". {len(errors)} failed"

    return jsonify({"msg": msg, "shared": shared, "errors": errors}), 200


@app.route("/api/preview/docx/<path:filepath>", methods=["GET"])
def preview_docx(filepath):
    if not MAMMOTH_AVAILABLE:
        return """
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h2>⚠️ DOCX Preview Unavailable</h2>
            <p>The mammoth library is not installed.</p>
            <p>Run: <code>pip install mammoth</code></p>
        </body>
        </html>
        """, 200, {'Content-Type': 'text/html; charset=utf-8'}

    token = request.args.get('token')
    if not token:
        return jsonify({"msg": "No token provided"}), 401

    try:
        from flask_jwt_extended import decode_token
        decoded = decode_token(token)
        username = decoded['sub']
    except Exception:
        return jsonify({"msg": "Invalid token"}), 401

    filepath = validate_path(username, filepath)
    user_dir = STORAGE_DIR / username
    file_path = user_dir / filepath

    try:
        file_path.resolve().relative_to(user_dir.resolve())
    except ValueError:
        return jsonify({"msg": "Access denied"}), 403

    if not file_path.exists():
        return jsonify({"msg": "File not found"}), 404

    try:
        import mammoth
        with open(file_path, "rb") as docx_file:
            result = mammoth.convert_to_html(docx_file)
            html = result.value
            
        html_output = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * {{ margin: 0; padding: 0; box-sizing: border-box; }}
                body {{ 
                    font-family: 'Calibri', 'Arial', sans-serif; 
                    padding: 40px;
                    max-width: 800px; 
                    margin: 0 auto;
                    background: #fff;
                    color: #000;
                    transform-origin: top left;
                    transition: transform 0.2s ease;
                }}
                img {{ max-width: 100%; height: auto; }}
                .zoom-controls {{
                    position: fixed;
                    top: 15px;
                    right: 15px;
                    background: rgba(0, 0, 0, 0.85);
                    padding: 12px;
                    border-radius: 10px;
                    display: flex;
                    gap: 8px;
                    z-index: 1000;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                    align-items: center;
                }}
                .zoom-btn {{
                    background: #4CAF50;
                    color: white;
                    border: none;
                    padding: 10px 16px;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 18px;
                    font-weight: bold;
                    transition: all 0.2s ease;
                    min-width: 40px;
                }}
                .zoom-btn:hover {{
                    background: #45a049;
                    transform: translateY(-2px);
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
                }}
                .zoom-btn:active {{
                    transform: translateY(0);
                }}
                .zoom-level {{
                    color: white;
                    padding: 8px 12px;
                    font-weight: bold;
                    font-size: 16px;
                    min-width: 60px;
                    text-align: center;
                }}
            </style>
            <script>
                let zoom = 100;
                function updateZoom() {{
                    document.body.style.transform = 'scale(' + (zoom / 100) + ')';
                    document.getElementById('zoomLevel').textContent = zoom + '%';
                }}
                function zoomIn() {{
                    if (zoom < 200) {{
                        zoom += 10;
                        updateZoom();
                    }}
                }}
                function zoomOut() {{
                    if (zoom > 50) {{
                        zoom -= 10;
                        updateZoom();
                    }}
                }}
                function resetZoom() {{
                    zoom = 100;
                    updateZoom();
                }}
            </script>
        </head>
        <body>
            <div class="zoom-controls">
                <button class="zoom-btn" onclick="zoomOut()" title="Zoom Out">−</button>
                <span class="zoom-level" id="zoomLevel">100%</span>
                <button class="zoom-btn" onclick="zoomIn()" title="Zoom In">+</button>
                <button class="zoom-btn" onclick="resetZoom()" title="Reset Zoom">⟲</button>
            </div>
            <div class="content">
                {html}
            </div>
        </body>
        </html>
        """
        return html_output, 200, {'Content-Type': 'text/html; charset=utf-8'}
    except Exception as e:
        log_action("docx_preview_error", username, str(e))
        return f"""
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h2>⚠️ Preview Error</h2>
            <p>Failed to preview DOCX file: {str(e)}</p>
        </body>
        </html>
        """, 200, {'Content-Type': 'text/html; charset=utf-8'}


@app.route("/api/preview/xlsx/<path:filepath>", methods=["GET"])
def preview_xlsx(filepath):
    if not OPENPYXL_AVAILABLE:
        return """
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h2>⚠️ Excel Preview Unavailable</h2>
            <p>The openpyxl library is not installed.</p>
            <p>Run: <code>pip install openpyxl</code></p>
        </body>
        </html>
        """, 200, {'Content-Type': 'text/html; charset=utf-8'}

    token = request.args.get('token')
    if not token:
        return jsonify({"msg": "No token provided"}), 401

    try:
        from flask_jwt_extended import decode_token
        decoded = decode_token(token)
        username = decoded['sub']
    except Exception:
        return jsonify({"msg": "Invalid token"}), 401

    filepath = validate_path(username, filepath)
    user_dir = STORAGE_DIR / username
    file_path = user_dir / filepath

    try:
        file_path.resolve().relative_to(user_dir.resolve())
    except ValueError:
        return jsonify({"msg": "Access denied"}), 403

    if not file_path.exists():
        return jsonify({"msg": "File not found"}), 404

    try:
        import openpyxl
        from openpyxl.utils import get_column_letter
        
        wb = openpyxl.load_workbook(file_path, data_only=True)
        
        html_parts = ['<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>']
        html_parts.append("""
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: 'Calibri', 'Arial', sans-serif; 
                padding: 20px; 
                background: #f5f5f5;
                transform-origin: top left;
                transition: transform 0.2s ease;
            }
            .zoom-controls {
                position: fixed;
                top: 15px;
                right: 15px;
                background: rgba(0, 0, 0, 0.85);
                padding: 12px;
                border-radius: 10px;
                display: flex;
                gap: 8px;
                z-index: 1000;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                align-items: center;
            }
            .zoom-btn {
                background: #4CAF50;
                color: white;
                border: none;
                padding: 10px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 18px;
                font-weight: bold;
                transition: all 0.2s ease;
                min-width: 40px;
            }
            .zoom-btn:hover {
                background: #45a049;
                transform: translateY(-2px);
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
            }
            .zoom-btn:active {
                transform: translateY(0);
            }
            .zoom-level {
                color: white;
                padding: 8px 12px;
                font-weight: bold;
                font-size: 16px;
                min-width: 60px;
                text-align: center;
            }
            .sheet-tabs {
                margin-bottom: 20px;
                border-bottom: 2px solid #ddd;
                background: white;
                padding: 10px;
                border-radius: 8px 8px 0 0;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .sheet-tab {
                display: inline-block;
                padding: 10px 20px;
                margin-right: 5px;
                background: #f5f5f5;
                border: 1px solid #ddd;
                border-bottom: none;
                cursor: pointer;
                border-radius: 5px 5px 0 0;
                transition: all 0.2s ease;
                font-weight: 600;
            }
            .sheet-tab:hover {
                background: #e8e8e8;
            }
            .sheet-tab.active {
                background: #4CAF50;
                color: white;
                font-weight: bold;
                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            }
            .sheet-content {
                display: none;
                background: white;
                padding: 20px;
                border-radius: 0 0 8px 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                overflow-x: auto;
            }
            .sheet-content.active {
                display: block;
            }
            table { 
                border-collapse: collapse; 
                width: 100%; 
                background: white;
                font-size: 14px;
            }
            th, td { 
                border: 1px solid #ddd; 
                padding: 10px 12px; 
                text-align: left;
                white-space: nowrap;
            }
            th { 
                background-color: #4CAF50; 
                color: white; 
                font-weight: bold;
                position: sticky;
                top: 0;
                z-index: 10;
            }
            tr:nth-child(even) { background-color: #f9f9f9; }
            tr:hover { background-color: #f0f0f0; }
            h2 {
                color: #333;
                margin-bottom: 15px;
                font-size: 24px;
            }
        </style>
        <script>
            let zoom = 100;
            function updateZoom() {
                document.body.style.transform = 'scale(' + (zoom / 100) + ')';
                document.getElementById('zoomLevel').textContent = zoom + '%';
            }
            function zoomIn() {
                if (zoom < 200) {
                    zoom += 10;
                    updateZoom();
                }
            }
            function zoomOut() {
                if (zoom > 50) {
                    zoom -= 10;
                    updateZoom();
                }
            }
            function resetZoom() {
                zoom = 100;
                updateZoom();
            }
            function showSheet(sheetName) {
                document.querySelectorAll('.sheet-content').forEach(s => s.classList.remove('active'));
                document.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
                document.getElementById('sheet-' + sheetName).classList.add('active');
                document.getElementById('tab-' + sheetName).classList.add('active');
            }
        </script>
        </head><body>
        <div class="zoom-controls">
            <button class="zoom-btn" onclick="zoomOut()" title="Zoom Out">−</button>
            <span class="zoom-level" id="zoomLevel">100%</span>
            <button class="zoom-btn" onclick="zoomIn()" title="Zoom In">+</button>
            <button class="zoom-btn" onclick="resetZoom()" title="Reset Zoom">⟲</button>
        </div>
        """)
        
        # Add tabs
        html_parts.append('<div class="sheet-tabs">')
        for idx, sheet_name in enumerate(wb.sheetnames):
            active_class = 'active' if idx == 0 else ''
            safe_name = sheet_name.replace("'", "\\'")
            html_parts.append(f'<div class="sheet-tab {active_class}" id="tab-{idx}" onclick="showSheet({idx})">{sheet_name}</div>')
        html_parts.append('</div>')
        
        # Add sheet contents
        for idx, sheet_name in enumerate(wb.sheetnames):
            ws = wb[sheet_name]
            active_class = 'active' if idx == 0 else ''
            html_parts.append(f'<div class="sheet-content {active_class}" id="sheet-{idx}">')
            html_parts.append(f'<h2>{sheet_name}</h2>')
            html_parts.append('<table>')
            
            for row_idx, row in enumerate(ws.iter_rows(max_row=min(100, ws.max_row)), 1):
                html_parts.append('<tr>')
                for cell in row:
                    value = cell.value if cell.value is not None else ''
                    # Escape HTML
                    value = str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                    tag = 'th' if row_idx == 1 else 'td'
                    html_parts.append(f'<{tag}>{value}</{tag}>')
                html_parts.append('</tr>')
            
            if ws.max_row > 100:
                html_parts.append(f'<tr><td colspan="{ws.max_column}"><em>... showing first 100 rows of {ws.max_row}</em></td></tr>')
            
            html_parts.append('</table></div>')
        
        html_parts.append('</body></html>')
        
        return ''.join(html_parts), 200, {'Content-Type': 'text/html; charset=utf-8'}
    except Exception as e:
        log_action("xlsx_preview_error", username, str(e))
        return f"""
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h2>⚠️ Preview Error</h2>
            <p>Failed to preview Excel file: {str(e)}</p>
        </body>
        </html>
        """, 200, {'Content-Type': 'text/html; charset=utf-8'}


@app.route("/api/users", methods=["GET"])
@jwt_required()
def get_users():
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    if user["role"] != "admin":
        return jsonify({"msg": "Admin access required"}), 403

    users = user_manager.list_users()
    return jsonify({"users": users}), 200


@app.route("/api/users/pending", methods=["GET"])
@jwt_required()
def get_pending_users():
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    if user["role"] != "admin":
        return jsonify({"msg": "Admin access required"}), 403

    users = user_manager.list_users(status="pending")
    return jsonify({"users": users}), 200


@app.route("/api/users", methods=["POST"])
@jwt_required()
def add_user():
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    if user["role"] != "admin":
        return jsonify({"msg": "Admin access required"}), 403

    data = request.get_json()
    new_username = data.get("username", "").strip()
    password = data.get("password", "")
    role = data.get("role", "user")
    auto_share = data.get("auto_share", False)

    if role not in ["user", "admin"]:
        return jsonify({"msg": "Invalid role"}), 400

    success, msg = user_manager.add_user(new_username, password, role, auto_share)

    if success:
        log_action("user_created", username, f"{new_username} ({role}) - auto_share: {auto_share}")
        return jsonify({"msg": msg}), 200
    return jsonify({"msg": msg}), 400


@app.route("/api/users/<target_username>/auto-share", methods=["POST"])
@jwt_required()
def toggle_user_auto_share(target_username):
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    if user["role"] != "admin":
        return jsonify({"msg": "Admin access required"}), 403

    data = request.get_json()
    enable = data.get("auto_share", False)

    success, msg = user_manager.toggle_auto_share(target_username, enable)

    if success:
        log_action("auto_share_toggled", username, f"{target_username}: {enable}")
        return jsonify({"msg": msg}), 200
    return jsonify({"msg": msg}), 400


@app.route("/api/users/<target_username>/approve", methods=["POST"])
@jwt_required()
def approve_user(target_username):
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    if user["role"] != "admin":
        return jsonify({"msg": "Admin access required"}), 403

    success, msg = user_manager.approve_user(target_username)

    if success:
        log_action("user_approved", username, target_username)
        return jsonify({"msg": msg}), 200
    return jsonify({"msg": msg}), 400


@app.route("/api/users/<target_username>/reject", methods=["POST"])
@jwt_required()
def reject_user(target_username):
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    if user["role"] != "admin":
        return jsonify({"msg": "Admin access required"}), 403

    success, msg = user_manager.reject_user(target_username)

    if success:
        log_action("user_rejected", username, target_username)
        return jsonify({"msg": msg}), 200
    return jsonify({"msg": msg}), 400


@app.route("/api/users/<target_username>", methods=["DELETE"])
@jwt_required()
def delete_user(target_username):
    username = get_jwt_identity()
    user = user_manager.get_user(username)

    if user["role"] != "admin":
        return jsonify({"msg": "Admin access required"}), 403

    success, msg = user_manager.delete_user(target_username)

    if success:
        log_action("user_deleted", username, target_username)
        return jsonify({"msg": msg}), 200
    return jsonify({"msg": msg}), 400


@app.route("/api/account/change-password", methods=["POST"])
@jwt_required()
def change_password():
    username = get_jwt_identity()
    data = request.get_json()
    current_password = data.get("current_password", "")
    new_password = data.get("new_password", "")

    if not current_password or not new_password:
        return jsonify({"msg": "All fields required"}), 400

    if not user_manager.authenticate(username, current_password):
        return jsonify({"msg": "Current password incorrect"}), 401

    if len(new_password) < 6:
        return jsonify({"msg": "New password must be at least 6 characters"}), 400

    user_manager.users[username]["password_hash"] = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
    user_manager.save_users()

    log_action("password_changed", username)
    return jsonify({"msg": "Password changed successfully"}), 200


@app.route("/api/account/change-username", methods=["POST"])
@jwt_required()
def change_username():
    old_username = get_jwt_identity()
    data = request.get_json()
    new_username = data.get("new_username", "").strip()
    password = data.get("password", "")

    if not new_username or not password:
        return jsonify({"msg": "All fields required"}), 400

    if not validate_username(new_username):
        return jsonify({"msg": "Invalid username format"}), 400

    if new_username in user_manager.users:
        return jsonify({"msg": "Username already exists"}), 400

    if not user_manager.authenticate(old_username, password):
        return jsonify({"msg": "Password incorrect"}), 401

    # Update username in users dict
    user_data = user_manager.users[old_username]
    del user_manager.users[old_username]
    user_manager.users[new_username] = user_data
    user_manager.save_users()

    # Rename storage directory
    old_dir = STORAGE_DIR / old_username
    new_dir = STORAGE_DIR / new_username
    if old_dir.exists():
        old_dir.rename(new_dir)

    # Update shared files
    for entry in shared_manager.shared_files.get("pending", []):
        if entry["username"] == old_username:
            entry["username"] = new_username

    for entry in shared_manager.shared_files.get("approved", []):
        if entry["username"] == old_username:
            entry["username"] = new_username

    for entry in shared_manager.shared_files.get("pending_folders", []):
        if entry["username"] == old_username:
            entry["username"] = new_username

    for entry in shared_manager.shared_files.get("folders", []):
        if entry["username"] == old_username:
            entry["username"] = new_username

    shared_manager.save_shared_files()

    # Generate new token
    new_token = create_access_token(identity=new_username)

    log_action("username_changed", new_username, f"from {old_username}")
    return jsonify({
        "msg": "Username changed successfully",
        "access_token": new_token,
        "new_username": new_username
    }), 200


if __name__ == "__main__":
    try:
        import PIL
        print("✓ Pillow installed - image preview enabled")
    except ImportError:
        print("⚠️  Pillow not installed - run: pip install Pillow")

    print("\n" + "=" * 60)
    print("📦 NAS SYSTEM STARTED")
    print("=" * 60)
    print(f"Storage: {STORAGE_DIR}")
    print(f"Static: {STATIC_DIR}")
    print(f"Users: {USERS_FILE}")
    print("\nDefault Admin:")
    print("  Username: admin")
    print("  Password: admin123")
    print("\n⚠️  CHANGE ADMIN PASSWORD AFTER FIRST LOGIN!")
    print("=" * 60 + "\n")
    app.run(host="0.0.0.0", port=5000, debug=False)

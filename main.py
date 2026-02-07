from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from flask_cors import CORS
import bcrypt, json, os, shutil, logging, secrets, re
from pathlib import Path
from datetime import datetime, timedelta
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).parent
STORAGE_DIR = BASE_DIR / "nas_storage"
USERS_FILE = BASE_DIR / "users.json"
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
    'mp4', 'avi', 'mkv', 'csv', 'json', 'xml', 'md', 'bmp', 'svg'
}

DANGEROUS_EXTENSIONS = {
    'exe', 'bat', 'cmd', 'com', 'pif', 'scr', 'vbs', 'js',
    'jar', 'msi', 'app', 'deb', 'rpm', 'sh', 'ps1', 'dll', 'so'
}


def allowed_file(filename):
    if '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    if ext in DANGEROUS_EXTENSIONS:
        return False
    return ext in ALLOWED_EXTENSIONS


def validate_username(username):
    if not username or len(username) < 3 or len(username) > 32:
        return False
    return bool(re.match(r'^[a-zA-Z0-9_]+$', username))


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
                "storage_used": 0
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
            "storage_used": 0
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

    def add_user(self, username, password, role="user"):
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
            "storage_used": 0
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
                "storage_used": d["storage_used"]
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


app = Flask(__name__, static_folder='static')
app.config.update(
    JWT_SECRET_KEY=JWT_SECRET,
    JWT_ACCESS_TOKEN_EXPIRES=timedelta(hours=8),
    MAX_CONTENT_LENGTH=MAX_FILE_SIZE
)
CORS(app)
jwt = JWTManager(app)
user_manager = UserManager(USERS_FILE)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_DIR / 'nas.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


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
        logger.info(f"New user registration: {username}")
        return jsonify({"msg": msg}), 200
    return jsonify({"msg": msg}), 400


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not user_manager.authenticate(username, password):
        logger.warning(f"Failed login attempt for: {username}")
        return jsonify({"msg": "Invalid credentials"}), 401

    user = user_manager.get_user(username)
    access_token = create_access_token(identity=username)

    logger.info(f"User logged in: {username}")
    return jsonify({
        "access_token": access_token,
        "role": user["role"],
        "msg": "Login successful"
    }), 200


@app.route("/api/upload", methods=["POST"])
@jwt_required()
def upload_files():
    username = get_jwt_identity()
    user_dir = STORAGE_DIR / username
    user_dir.mkdir(exist_ok=True)

    if 'files' not in request.files:
        return jsonify({"msg": "No files provided"}), 400

    files = request.files.getlist('files')
    uploaded = []
    errors = []

    for file in files:
        if file.filename == '':
            continue

        if not allowed_file(file.filename):
            errors.append(f"{file.filename}: File type not allowed")
            continue

        filename = secure_filename(file.filename)
        filepath = user_dir / filename

        if filepath.exists():
            name, ext = os.path.splitext(filename)
            counter = 1
            while filepath.exists():
                filename = f"{name}_{counter}{ext}"
                filepath = user_dir / filename
                counter += 1

        try:
            file.save(str(filepath))
            uploaded.append(filename)
            logger.info(f"File uploaded: {username}/{filename}")
        except Exception as e:
            logger.error(f"Upload error for {username}/{filename}: {str(e)}")
            errors.append(f"{file.filename}: Upload failed")

    user_manager.update_storage_used(username)

    if uploaded:
        msg = f"Uploaded {len(uploaded)} file(s)"
        if errors:
            msg += f". {len(errors)} file(s) failed"
        return jsonify({"msg": msg, "uploaded": uploaded}), 200

    return jsonify({"msg": "No files uploaded", "errors": errors}), 400


@app.route("/api/files", methods=["GET"])
@jwt_required()
def list_files():
    username = get_jwt_identity()
    user_dir = STORAGE_DIR / username

    if not user_dir.exists():
        return jsonify({
            "files": [],
            "total_files": 0,
            "total_size": 0,
            "total_size_formatted": "0 B"
        }), 200

    files = []
    total_size = 0

    for file_path in user_dir.iterdir():
        if file_path.is_file():
            stat = file_path.stat()
            files.append({
                "name": file_path.name,
                "size": stat.st_size,
                "size_formatted": format_size(stat.st_size),
                "modified": stat.st_mtime
            })
            total_size += stat.st_size

    files.sort(key=lambda x: x["modified"], reverse=True)

    return jsonify({
        "files": files,
        "total_files": len(files),
        "total_size": total_size,
        "total_size_formatted": format_size(total_size)
    }), 200


@app.route("/api/download/<filename>", methods=["GET"])
def download_file(filename):
    token = request.args.get('token')
    if not token:
        return jsonify({"msg": "No token provided"}), 401

    try:
        from flask_jwt_extended import decode_token
        decoded = decode_token(token)
        username = decoded['sub']
    except Exception:
        return jsonify({"msg": "Invalid token"}), 401

    safe_filename = secure_filename(filename)
    user_dir = STORAGE_DIR / username
    file_path = user_dir / safe_filename

    try:
        file_path.resolve().relative_to(user_dir.resolve())
    except ValueError:
        logger.warning(f"Path traversal attempt by {username}: {filename}")
        return jsonify({"msg": "Access denied"}), 403

    if not file_path.exists():
        return jsonify({"msg": "File not found"}), 404

    logger.info(f"File downloaded: {username}/{safe_filename}")
    return send_from_directory(user_dir, safe_filename, as_attachment=True)


@app.route("/api/delete/<filename>", methods=["DELETE"])
@jwt_required()
def delete_file(filename):
    username = get_jwt_identity()
    safe_filename = secure_filename(filename)
    user_dir = STORAGE_DIR / username
    file_path = user_dir / safe_filename

    try:
        file_path.resolve().relative_to(user_dir.resolve())
    except ValueError:
        logger.warning(f"Path traversal attempt by {username}: {filename}")
        return jsonify({"msg": "Access denied"}), 403

    if not file_path.exists():
        return jsonify({"msg": "File not found"}), 404

    try:
        file_path.unlink()
        user_manager.update_storage_used(username)
        logger.info(f"File deleted: {username}/{safe_filename}")
        return jsonify({"msg": "File deleted"}), 200
    except Exception as e:
        logger.error(f"Delete error for {username}/{safe_filename}: {str(e)}")
        return jsonify({"msg": "Delete failed"}), 500


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

    if role not in ["user", "admin"]:
        return jsonify({"msg": "Invalid role"}), 400

    success, msg = user_manager.add_user(new_username, password, role)

    if success:
        logger.info(f"User created by {username}: {new_username} ({role})")
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
        logger.info(f"User approved by {username}: {target_username}")
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
        logger.info(f"User rejected by {username}: {target_username}")
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
        logger.info(f"User deleted by {username}: {target_username}")
        return jsonify({"msg": msg}), 200
    return jsonify({"msg": msg}), 400


if __name__ == "__main__":
    # Create index.html if it doesn't exist
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        print("⚠️  Creating static/index.html - you need to create this file!")
        print("📝 See next message for HTML content")

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
    app.run(host="0.0.0.0", port=5000, debug=True)

import firebase_admin
from firebase_admin import credentials, firestore
import os

# Your service account as a Python dict
FIREBASE_SERVICE_ACCOUNT_KEY = {
    "type": "service_account",
    "project_id": "mksadmin-6ffeb",
    "private_key_id": "d3131f45b11b49bdbf227ab8dcc90363b564aa70",
    "private_key": """-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDrfYdMxHqnF7OG
lfFYMRgbuXYMwB36Wz3iX8U7rFHRVREXgmEveinNgmehyJBZFunGZNkv6qcaRVIP
...
-----END PRIVATE KEY-----""",
    "client_email": "firebase-adminsdk-fbsvc@mksadmin-6ffeb.iam.gserviceaccount.com",
    "client_id": "110174734290420528988",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40mksadmin-6ffeb.iam.gserviceaccount.com",
    "universe_domain": "googleapis.com"
}

# Create a temporary JSON file (required by firebase_admin)
import tempfile
import json

with tempfile.NamedTemporaryFile(mode="w+", delete=False) as f:
    json.dump(FIREBASE_SERVICE_ACCOUNT_KEY, f)
    temp_key_path = f.name

# Initialize Firebase Admin
cred = credentials.Certificate(temp_key_path)
firebase_admin.initialize_app(cred)

# Get Firestore client
firestore_db = firestore.client()
firestore_module = firestore  # if you need firestore.SERVER_TIMESTAMP

# Clean up temporary file
os.remove(temp_key_path)

print("Firestore initialized successfully!")

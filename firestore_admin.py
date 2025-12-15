# firestore_admin.py
import firebase_admin
from firebase_admin import credentials, firestore
from config import FIREBASE_SERVICE_ACCOUNT_KEY

# Initialize credentials directly from dict
cred = credentials.Certificate(FIREBASE_SERVICE_ACCOUNT_KEY)

# Initialize Firebase app only once
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)

# Firestore client
firestore_db = firestore.client()
firestore_ref = firestore  # For SERVER_TIMESTAMP

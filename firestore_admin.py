# firestore_admin.py
import firebase_admin
from firebase_admin import credentials, firestore
import os
import json

# Your service account dict
from config import FIREBASE_SERVICE_ACCOUNT_KEY

# Convert dict to JSON string and load as credentials
cred_json = json.dumps(FIREBASE_SERVICE_ACCOUNT_KEY)
cred = credentials.Certificate(json.loads(cred_json))

# Initialize Firebase app
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)

# Firestore client
firestore_db = firestore.client()
firestore_ref = firestore  # For SERVER_TIMESTAMP etc.

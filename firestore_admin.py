# firestore_admin.py
import firebase_admin
from firebase_admin import credentials, firestore

# Firebase service account key JSON file path
cred = credentials.Certificate("serviceAccountKey.json")  # သင့် JSON key path

# Initialize Firebase App
firebase_admin.initialize_app(cred)

# Firestore client
firestore_db = firestore.client()

# firestore_admin.py
import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate("serviceAccountKey.json")  # exact JSON path
firebase_admin.initialize_app(cred)
firestore_db = firestore.client()

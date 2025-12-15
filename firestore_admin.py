# firestore_admin.py
import firebase_admin
from firebase_admin import credentials, firestore

# Initialize Firebase app
cred = credentials.Certificate("serviceAccountKey.json")
app = firebase_admin.initialize_app(cred)

# Get Firestore client
firestore_db = firestore.client(app)


print("Firestore connected successfully!")

import firebase_admin
from firebase_admin import credentials, db

cred = credentials.Certificate("firebase.json")  # JSON file သုံးပါ

firebase_admin.initialize_app(cred, {
    "databaseURL": "https://mksadmin-6ffeb-default-rtdb.firebaseio.com/"
})


print("Firestore connected successfully!")

from firebase_admin import db
import time

def save_user(user):
    db.reference(f"tg_chats/{user.id}/user").update({
        "id": user.id,
        "name": user.first_name,
        "username": user.username
    })

def save_msg(user_id, sender, msg_type, data):
    payload = {
        "from": sender,
        "type": msg_type,
        "timestamp": int(time.time())
    }
    payload.update(data)

    db.reference(f"tg_chats/{user_id}/messages").push(payload)

    db.reference(f"tg_chats/{user_id}").update({
        "last_message": data.get("text", msg_type),
        "updated_at": payload["timestamp"]
    })

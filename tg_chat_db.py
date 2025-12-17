# tg_chat_db.py
from plugins.dbusers import db
import time

async def save_msg(user_id, sender, text):
    await db.chat.insert_one({
        "user_id": user_id,
        "sender": sender,
        "text": text,
        "time": int(time.time())
    })

async def get_user_messages(user_id, limit=100):
    cursor = db.chat.find({"user_id": user_id}).sort("time", 1).limit(limit)
    return [doc async for doc in cursor]

async def get_users_list():
    # Return unique user IDs + first name
    pipeline = [
        {"$group": {"_id": "$user_id", "user_name": {"$first": "$user_name"}}},
        {"$sort": {"_id": -1}}
    ]
    cursor = db.chat.aggregate(pipeline)
    return [{"user_id": doc["_id"], "user_name": doc.get("user_name", str(doc["_id"]))} async for doc in cursor]

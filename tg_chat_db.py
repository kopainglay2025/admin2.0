# tg_chat_db.py
from plugins.dbusers import db

async def save_msg(user_id, sender, text):
    await db.chat.insert_one({
        "user_id": user_id,
        "sender": sender,
        "text": text,
        "time": int(time.time())
    })

async def get_user_messages(limit=100):
    cursor = db.chat.find().sort("time", 1).limit(limit)
    return [doc async for doc in cursor]

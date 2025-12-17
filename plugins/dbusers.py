import motor.motor_asyncio
import time
from config import DB_URI, DB_NAME

class Database:
    def __init__(self, uri, database_name):
        self._client = motor.motor_asyncio.AsyncIOMotorClient(uri)
        self.db = self._client[database_name]
        self.col_users = self.db.users
        self.col_chat = self.db.chat

    # Users
    def new_user(self, id, name):
        return {"id": int(id), "name": name}

    async def add_user(self, id, name):
        user = self.new_user(id, name)
        await self.col_users.insert_one(user)

    async def is_user_exist(self, id):
        user = await self.col_users.find_one({"id": int(id)})
        return bool(user)

    async def get_all_users(self):
        return self.col_users.find({})

    async def total_users_count(self):
        return await self.col_users.count_documents({})

    async def delete_user(self, id):
        await self.col_users.delete_many({"id": int(id)})

    # Chat messages
    async def save_msg(self, user_id, sender, text, user_name=None):
        await self.col_chat.insert_one({
            "user_id": int(user_id),
            "user_name": user_name,
            "sender": sender,
            "text": text,
            "time": int(time.time())
        })

    async def get_user_messages(self, user_id, limit=100):
        cursor = self.col_chat.find({"user_id": int(user_id)}).sort("time", 1).limit(limit)
        return [doc async for doc in cursor]

    async def get_users_list(self):
        pipeline = [
            {"$group": {"_id": "$user_id", "user_name": {"$first": "$user_name"}}},
            {"$sort": {"_id": -1}}
        ]
        cursor = self.col_chat.aggregate(pipeline)
        return [{"user_id": doc["_id"], "user_name": doc.get("user_name", str(doc["_id"]))} async for doc in cursor]

db = Database(DB_URI, DB_NAME)

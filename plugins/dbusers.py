import motor.motor_asyncio
from datetime import datetime
from config import DB_NAME, DB_URI

class Database:
    def __init__(self, uri, database_name):
        self._client = motor.motor_asyncio.AsyncIOMotorClient(uri)
        self.db = self._client[database_name]
        self.users_col = self.db.users   # users collection
        self.chat_col = self.db.chat     # chat collection

    # ---- Users functions ----
    def new_user(self, id, name):
        return dict(
            id=int(id),
            name=name,
            created_at=datetime.utcnow()
        )

    async def add_user(self, id, name):
        if not await self.is_user_exist(id):
            user = self.new_user(id, name)
            await self.users_col.insert_one(user)

    async def is_user_exist(self, id):
        user = await self.users_col.find_one({'id': int(id)})
        return bool(user)

    async def total_users_count(self):
        return await self.users_col.count_documents({})

    async def get_all_users(self):
        return self.users_col.find({})

    async def delete_user(self, user_id):
        await self.users_col.delete_many({'id': int(user_id)})
        await self.chat_col.delete_many({'user_id': int(user_id)})

    # ---- Chat functions ----
    def new_chat(self, user_id, user_name, message, message_type='text'):
        """
        message_type: text, photo, video, sticker, emoji, command, etc.
        """
        return dict(
            user_id=int(user_id),
            user_name=user_name,
            message=message,
            message_type=message_type,
            timestamp=datetime.utcnow()
        )

    async def add_chat(self, user_id, user_name, message, message_type='text'):
        chat = self.new_chat(user_id, user_name, message, message_type)
        await self.chat_col.insert_one(chat)

    async def get_user_chats(self, user_id, limit=50):
        """
        Get last `limit` chats of a user
        """
        cursor = self.chat_col.find({'user_id': int(user_id)}).sort('timestamp', -1).limit(limit)
        return await cursor.to_list(length=limit)

    async def total_chats_count(self):
        return await self.chat_col.count_documents({})

# ---- Initialize DB ----
db = Database(DB_URI, DB_NAME)

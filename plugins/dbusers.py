import motor.motor_asyncio
from datetime import datetime
from config import DB_NAME, DB_URI

class Database:
    def __init__(self, uri, database_name):
        self._client = motor.motor_asyncio.AsyncIOMotorClient(uri)
        self.db = self._client[database_name]
        self.users_col = self.db.users  # single collection for users + chats

    # ---- User functions ----
    def new_user(self, id, name):
        return dict(
            id=int(id),
            name=name,
            created_at=datetime.utcnow(),
            chats=[]  # chat history stored here
        )

    async def add_user(self, id, name):
        if not await self.is_user_exist(id):
            user = self.new_user(id, name)
            await self.users_col.insert_one(user)

    async def is_user_exist(self, id):
        user = await self.users_col.find_one({'id': int(id)})
        return bool(user)

    async def total_users_count(self):
        count = await self.users_col.count_documents({})
        return count

    async def get_all_users(self):
        return self.users_col.find({})

    async def delete_user(self, user_id):
        await self.users_col.delete_many({'id': int(user_id)})

    # ---- Chat functions ----
    def new_chat(self, message, message_type):
        return dict(
            message=message,
            message_type=message_type,  # text, photo, video, sticker, emoji, command
            timestamp=datetime.utcnow()
        )

    async def add_chat(self, user_id, message, message_type='text'):
        chat = self.new_chat(message, message_type)
        # Push chat into user's chats array
        await self.users_col.update_one(
            {'id': int(user_id)},
            {'$push': {'chats': chat}}
        )

    async def get_user_chats(self, user_id, limit=50):
        user = await self.users_col.find_one({'id': int(user_id)}, {'chats': 1, '_id': 0})
        if not user or 'chats' not in user:
            return []
        # return last `limit` chats
        return user['chats'][-limit:]

# ---- Initialize DB ----
db = Database(DB_URI, DB_NAME)

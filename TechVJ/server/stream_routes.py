import re
import time
import math
import logging
import secrets
import mimetypes
from aiohttp import web
from aiohttp.http_exceptions import BadStatusLine
from TechVJ.bot import multi_clients, work_loads, StreamBot
from TechVJ.server.exceptions import FIleNotFound, InvalidHash
from TechVJ import StartTime, __version__
from ..utils.time_format import get_readable_time
from ..utils.custom_dl import ByteStreamer
from TechVJ.utils.render_template import render_page, render_page_stream
from config import MULTI_CLIENT
from plugins.dbusers import db
import json
import os
from datetime import datetime
from zoneinfo import ZoneInfo
routes = web.RouteTableDef()

# Websocket connections များကို သိမ်းဆည်းရန်
active_sockets = set()
UPLOAD_DIR = "static/uploads"
MM_TIMEZONE = ZoneInfo("Asia/Yangon")

@routes.get("/", allow_head=True)
async def root_route_handler(request):
    return web.json_response({
        "server_status": "running",
        "uptime": get_readable_time(time.time() - StartTime),
        "version": __version__
    })

@routes.get("/dashboard") # Dashboard Menu အတွက်
@routes.get("/tgchat")
async def tgchat_dashboard(request):
    try:
        # Fetch users with latest 20 messages for list
        cursor = db.chat_col.find({}, {"user_id": 1, "user_name": 1, "chats": {"$slice": -1}})
        users_list = await cursor.to_list(length=100)
        
        active_user_id = request.query.get('user_id')
        active_chat = None
        
        if active_user_id:
            u_id = int(active_user_id)
            # Set all messages to read when admin opens the chat
            await db.chat_col.update_one(
                {'user_id': u_id},
                {'$set': {'chats.$[].is_read': True}}
            )
            # Fetch full chat history for active user
            active_chat = await db.chat_col.find_one({'user_id': u_id})

        context = {
            "users": users_list,
            "active_chat": active_chat,
        }
        # Assuming you have a helper to render templates
        # return render_template("tg_chat.html", context) 
        return web.Response(text="Template Rendering Logic Here", content_type='text/html')
    except Exception as e:
        logging.error(f"Dashboard Error: {e}")
        return web.Response(text=str(e), status=500)

# 2. WebSocket Handler
@routes.get("/ws")
async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    active_sockets.add(ws)
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                pass # Client-side processing only
    finally:
        active_sockets.remove(ws)
    return ws

# 3. Handle New Inbound Message (From Telegram Bot)
async def notify_admin_new_message(user_id, user_name, message_text, msg_type="text"):
    now = datetime.now(MM_TIMEZONE)
    
    chat_entry = {
        "message": message_text,
        "message_type": msg_type,
        "from_admin": False,
        "timestamp": now,
        "is_read": False
    }
    
    # Save to MongoDB
    await db.chat_col.update_one(
        {'user_id': int(user_id)},
        {
            '$set': {'user_name': user_name},
            '$push': {'chats': chat_entry}
        },
        upsert=True
    )
    
    # Broadcast via WebSocket
    payload = {
        "type": "new_message",
        "user_id": str(user_id),
        "data": {
            "message": message_text,
            "message_type": msg_type,
            "from_admin": False,
            "timestamp": now.strftime("%I:%M %p")
        }
    }
    
    for ws in list(active_sockets):
        try:
            await ws.send_json(payload)
        except:
            continue

# 4. Send Message (Admin to User)
@routes.post("/send_message")
async def send_message_handler(request):
    data = await request.json()
    user_id = int(data.get("user_id"))
    text = data.get("message")
    
    # --- Telegram Sending Logic Here (Telethon/Pyrogram) ---
    # await bot.send_message(user_id, text)
    
    now = datetime.now(MM_TIMEZONE)
    chat_data = {
        "message": text,
        "message_type": "text",
        "from_admin": True,
        "timestamp": now
    }
    
    await db.chat_col.update_one(
        {'user_id': user_id},
        {'$push': {'chats': chat_data}},
        upsert=True
    )
    
    # Notify all admin windows
    for ws in list(active_sockets):
        try:
            await ws.send_json({
                "type": "new_message",
                "user_id": str(user_id),
                "data": {**chat_data, "timestamp": now.strftime("%I:%M %p")}
            })
        except: continue
        
    return web.json_response({"status": "success"})

# 5. Multimedia Upload & Send
@routes.post("/upload_and_send")
async def upload_and_send_handler(request):
    reader = await request.multipart()
    user_id = None
    file_path = ""
    content_type = ""
    
    while True:
        part = await reader.next()
        if part is None: break
        
        if part.name == 'file':
            content_type = part.headers.get('Content-Type', '').lower()
            ext = ".jpg" if "image" in content_type else ".mp4"
            filename = f"media_{int(datetime.utcnow().timestamp())}{ext}"
            file_path = os.path.join(UPLOAD_DIR, filename)
            
            async with aiofiles.open(file_path, mode='wb') as f:
                while True:
                    chunk = await part.read_chunk()
                    if not chunk: break
                    await f.write(chunk)
                    
        elif part.name == 'user_id':
            user_id = int(await part.text())

    # --- Telegram Multimedia Send Logic ---
    # if "image" in content_type: await bot.send_photo(user_id, file_path)
    # else: await bot.send_video(user_id, file_path)
    
    msg_type = "photo" if "image" in content_type else "video"
    public_url = f"/static/uploads/{os.path.basename(file_path)}"
    
    now = datetime.now(MM_TIMEZONE)
    chat_entry = {
        "message": public_url,
        "message_type": msg_type,
        "from_admin": True,
        "timestamp": now
    }
    
    await db.chat_col.update_one({'user_id': user_id}, {'$push': {'chats': chat_entry}})
    
    for ws in list(active_sockets):
        try:
            await ws.send_json({
                "type": "new_message",
                "user_id": str(user_id),
                "data": {**chat_entry, "timestamp": now.strftime("%I:%M %p")}
            })
        except: continue

    return web.json_response({"status": "success", "url": public_url})






@routes.get("/user")
async def show_user_chats(request):
    """
    Fetch all users and their last 50 messages
    """
    # Query all users who have chat
    cursor = db.get_user_chats.find({})
    users_chats = await cursor.to_list(length=100)  # 100 users max

    # Prepare data for template
    data = []
    for user_doc in users_chats:
        chats = user_doc.get('chats', [])[-50:]  # last 50 messages
        data.append({
            'user_name': user_doc.get('user_name'),
            'user_id': user_doc.get('user_id'),
            'chats': chats
        })

    return render_page("chats.html", users=data)



@routes.get(r"/watch/{path:\S+}", allow_head=True)
async def stream_handler(request: web.Request):
    try:
        path = request.match_info["path"]
        match = re.search(r"^([a-zA-Z0-9_-]{6})(\d+)$", path)
        if match:
            secure_hash = match.group(1)
            id = int(match.group(2))
        else:
            id = int(re.search(r"(\d+)(?:\/\S+)?", path).group(1))
            secure_hash = request.rel_url.query.get("hash")
        return web.Response(text=await render_page_stream(id, secure_hash), content_type='text/html')
    except InvalidHash as e:
        raise web.HTTPForbidden(text=e.message)
    except FIleNotFound as e:
        raise web.HTTPNotFound(text=e.message)
    except (AttributeError, BadStatusLine, ConnectionResetError):
        pass
    except Exception as e:
        logging.critical(e.with_traceback(None))
        raise web.HTTPInternalServerError(text=str(e))

@routes.get(r"/{path:\S+}", allow_head=True)
async def stream_handler(request: web.Request):
    try:
        path = request.match_info["path"]
        match = re.search(r"^([a-zA-Z0-9_-]{6})(\d+)$", path)
        if match:
            secure_hash = match.group(1)
            id = int(match.group(2))
        else:
            id = int(re.search(r"(\d+)(?:\/\S+)?", path).group(1))
            secure_hash = request.rel_url.query.get("hash")
        return await media_streamer(request, id, secure_hash)
    except InvalidHash as e:
        raise web.HTTPForbidden(text=e.message)
    except FIleNotFound as e:
        raise web.HTTPNotFound(text=e.message)
    except (AttributeError, BadStatusLine, ConnectionResetError):
        pass
    except Exception as e:
        logging.critical(e.with_traceback(None))
        raise web.HTTPInternalServerError(text=str(e))

class_cache = {}

async def media_streamer(request: web.Request, id: int, secure_hash: str):
    range_header = request.headers.get("Range", 0)
    
    index = min(work_loads, key=work_loads.get)
    faster_client = multi_clients[index]
    
    if MULTI_CLIENT:
        logging.info(f"Client {index} is now serving {request.remote}")

    if faster_client in class_cache:
        tg_connect = class_cache[faster_client]
        logging.debug(f"Using cached ByteStreamer object for client {index}")
    else:
        logging.debug(f"Creating new ByteStreamer object for client {index}")
        tg_connect = ByteStreamer(faster_client)
        class_cache[faster_client] = tg_connect
    logging.debug("before calling get_file_properties")
    file_id = await tg_connect.get_file_properties(id)
    logging.debug("after calling get_file_properties")
    
    if file_id.unique_id[:6] != secure_hash:
        logging.debug(f"Invalid hash for message with ID {id}")
        raise InvalidHash
    
    file_size = file_id.file_size

    if range_header:
        from_bytes, until_bytes = range_header.replace("bytes=", "").split("-")
        from_bytes = int(from_bytes)
        until_bytes = int(until_bytes) if until_bytes else file_size - 1
    else:
        from_bytes = request.http_range.start or 0
        until_bytes = (request.http_range.stop or file_size) - 1

    if (until_bytes > file_size) or (from_bytes < 0) or (until_bytes < from_bytes):
        return web.Response(
            status=416,
            body="416: Range not satisfiable",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    chunk_size = 1024 * 1024
    until_bytes = min(until_bytes, file_size - 1)

    offset = from_bytes - (from_bytes % chunk_size)
    first_part_cut = from_bytes - offset
    last_part_cut = until_bytes % chunk_size + 1

    req_length = until_bytes - from_bytes + 1
    part_count = math.ceil(until_bytes / chunk_size) - math.floor(offset / chunk_size)
    body = tg_connect.yield_file(
        file_id, index, offset, first_part_cut, last_part_cut, part_count, chunk_size
    )

    mime_type = file_id.mime_type
    file_name = file_id.file_name
    disposition = "attachment"

    if mime_type:
        if not file_name:
            try:
                file_name = f"{secrets.token_hex(2)}.{mime_type.split('/')[1]}"
            except (IndexError, AttributeError):
                file_name = f"{secrets.token_hex(2)}.unknown"
    else:
        if file_name:
            mime_type = mimetypes.guess_type(file_id.file_name)
        else:
            mime_type = "application/octet-stream"
            file_name = f"{secrets.token_hex(2)}.unknown"

    return web.Response(
        status=206 if range_header else 200,
        body=body,
        headers={
            "Content-Type": f"{mime_type}",
            "Content-Range": f"bytes {from_bytes}-{until_bytes}/{file_size}",
            "Content-Length": str(req_length),
            "Content-Disposition": f'{disposition}; filename="{file_name}"',
            "Accept-Ranges": "bytes",
        },
    )

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

@routes.get("/", allow_head=True)
async def root_route_handler(request):
    return web.json_response({
        "server_status": "running",
        "uptime": get_readable_time(time.time() - StartTime),
        "version": __version__
    })

@routes.get("/dashboard") # Dashboard Menu အတွက်
@routes.get("/tgchat") # Telegram Chat Main Page
async def tgchat_dashboard(request):
    try:
        cursor = db.chat_col.find({}, {"user_id": 1, "user_name": 1, "chats": {"$slice": -1}})
        users_list = await cursor.to_list(length=100)
        
        active_user_id = request.query.get('user_id')
        active_chat = None
        
        # user_id ပါလာမှသာ active_chat ကို ရှာဖွေမယ်
        if active_user_id:
            try:
                active_chat = await db.chat_col.find_one({'user_id': int(active_user_id)})
            except (ValueError, TypeError):
                active_chat = None

        # အရင်ကရှိခဲ့တဲ့ users_list[0] ကို auto ယူတဲ့ logic ကို ဖျက်လိုက်ပါပြီ

        context = {
            "users": users_list,
            "active_chat": active_chat,
            "active_page": "tg_chat",
            "now": datetime.now(ZoneInfo("Asia/Yangon")).strftime("%Y-%m-%d %H:%M:%S")
        }
        return await render_page(request, "dashboard.html", context)
    except Exception as e:
        logging.error(f"Dashboard Error: {e}")
        return web.Response(text=f"Error: {e}", status=500)

@routes.get("/ws")
async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    active_sockets.add(ws)
    try:
        async for msg in ws:
            pass 
    finally:
        active_sockets.remove(ws)
    return ws

# Bot ဆီမှ message အသစ်ရောက်လာလျှင် Dashboard သို့လှမ်းပို့ပေးမည့် function
# --- server/stream_routes.py ---

async def notify_admin_new_message(user_id, user_name, message_text, msg_type="text"):
    now_mm = datetime.now(ZoneInfo("Asia/Yangon"))
    
    # ၁။ Database ထဲမှာ အရင်သိမ်းပါ
    new_chat_entry = {
        "message": message_text,
        "message_type": msg_type,
        "from_admin": False,
        "timestamp": now_mm  # Object အနေနဲ့သိမ်းပါ
    }
    
    await db.chat_col.update_one(
        {'user_id': int(user_id)},
        {
            '$set': {'user_name': user_name}, # အမည်ပြောင်းသွားရင် update ဖြစ်အောင်
            '$push': {'chats': new_chat_entry}
        },
        upsert=True
    )
    
    # ၂။ ပြီးမှ WebSocket ကနေ Dashboard ဆီ ပို့ပါ
    payload = {
        "type": "new_message",
        "user_id": str(user_id),
        "user_name": user_name,
        "data": {
            "message": message_text,
            "message_type": msg_type,
            "from_admin": False,
            "timestamp": now_mm.strftime("%I:%M %p") # UI အတွက် format ပြောင်းပို့ပါ
        }
    }
    
    for ws in list(active_sockets):
        try:
            await ws.send_json(payload)
        except:
            continue


@routes.post("/send_message")
async def send_message_handler(request):
    try:
        data = await request.json()
        user_id = int(data.get("user_id"))
        text = data.get("message")

        if not text or not user_id:
            return web.json_response({"error": "Missing info"}, status=400)

        # Telegram ဆီ စာပို့ခြင်း
        client = multi_clients[0]
        sent_msg = await client.send_message(chat_id=user_id, text=text)

        # Database ထဲ သိမ်းခြင်း (timestamp ကို datetime object အနေနဲ့ သိမ်းပါ)
        now_mm = datetime.now(ZoneInfo("Asia/Yangon"))
        
        chat_data = {
            "message": text,
            "message_type": "text",
            "from_admin": True,
            "timestamp": now_mm  # <--- ဒီနေရာမှာ .strftime မလုပ်ပါနဲ့တော့
        }
        
        await db.chat_col.update_one(
            {'user_id': user_id},
            {'$push': {'chats': chat_data}},
            upsert=True
        )

        # WebSocket Update (Web UI အတွက်ကတော့ String ပို့ပေးရပါမယ်)
        ws_payload = {
            "type": "new_message",
            "user_id": user_id,
            "data": {
                "message": text,
                "message_type": "text",
                "from_admin": True,
                "timestamp": now_mm.strftime("%I:%M %p") 
            }
        }
        
        for ws in list(active_sockets):
            try:
                await ws.send_json(ws_payload)
            except: continue

        return web.json_response({"status": "success"})
    except Exception as e:
        print(f"Error: {e}") # Debugging အတွက်
        return web.json_response({"error": str(e)}, status=500)




import os
import aiofiles
from aiohttp import web
from datetime import datetime
import logging

UPLOAD_DIR = "static/uploads"
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

@routes.post("/upload_and_send")
async def upload_and_send_handler(request):
    try:
        reader = await request.multipart()
        user_id = None
        file_path = ""
        final_content_type = ""

        while True:
            part = await reader.next()
            if part is None: break
            
            if part.name == 'file':
                final_content_type = part.headers.get('Content-Type', '').lower()
                filename = part.filename
                
                # ၁။ Extension ကို စနစ်တကျ ခွဲထုတ်ပါ
                _, ext = os.path.splitext(filename)
                ext = ext.lower()
                
                # Extension မပါရင် format အလိုက် အတင်းထည့်ပေးပါ
                if not ext:
                    if "image" in final_content_type: ext = ".jpg"
                    elif "video" in final_content_type: ext = ".mp4"
                    else: ext = ".bin"

                # ၂။ ဖိုင်အမည်ကို timestamp ဖြင့် သိမ်းပါ
                new_filename = f"{int(datetime.utcnow().timestamp())}{ext}"
                file_path = os.path.join(UPLOAD_DIR, new_filename)
                
                async with aiofiles.open(file_path, mode='wb') as f:
                    while True:
                        chunk = await part.read_chunk()
                        if not chunk: break
                        await f.write(chunk)
            
            elif part.name == 'user_id':
                user_id_text = await part.text()
                user_id = int(user_id_text)

        if not file_path or not user_id:
            return web.json_response({"error": "Missing file or user_id"}, status=400)

        client = multi_clients[0]
        
        # ၃။ Photo သို့မဟုတ် Video ခွဲခြားခြင်း
        # Content type ဒါမှမဟုတ် extension ကိုကြည့်ပြီး ဆုံးဖြတ်ပါ
        valid_photo_exts = ('.jpg', '.jpeg', '.png', '.webp')
        is_photo = "image" in final_content_type or file_path.lower().endswith(valid_photo_exts)
        file_type = "photo" if is_photo else "video"

        try:
            # ၄။ အရေးကြီးဆုံးအချက် - ဖိုင်လမ်းကြောင်းကို တိုက်ရိုက်မပို့ဘဲ binary အနေနဲ့ ပို့ကြည့်ပါ
            # (Telethon သုံးထားလျှင် ဖိုင်လမ်းကြောင်းပေးရုံဖြင့် ရသော်လည်း အချို့ library များတွင် binary လိုအပ်သည်)
            if is_photo:
                await client.send_photo(chat_id=user_id, photo=file_path)
            else:
                await client.send_video(chat_id=user_id, video=file_path)
        except Exception as telegram_err:
            logging.error(f"Telegram API Error: {telegram_err}")
            # Extension error ဆက်တက်နေလျှင် send_file ကို fallback အနေနဲ့ သုံးပါ
            try:
                await client.send_file(chat_id=user_id, file=file_path)
            except:
                return web.json_response({"error": f"Telegram says: {str(telegram_err)}"}, status=400)

        file_url = f"/static/uploads/{os.path.basename(file_path)}" 

        # Database သိမ်းခြင်း
        now = datetime.now(ZoneInfo("Asia/Yangon")).strftime("%Y-%m-%d %H:%M:%S")
        chat_data = {
            "message": file_url,
            "message_type": file_type,
            "from_admin": True,
            "timestamp": now
        }
        await db.chat_col.update_one(
            {'user_id': user_id},
            {'$push': {'chats': chat_data}},
            upsert=True
        )

        # WebSocket Update
        ws_payload = {
            "type": "new_message",
            "user_id": str(user_id),
            "data": {
                "message": file_url,
                "message_type": file_type,
                "from_admin": True,
                "timestamp": now # UI အတွက် format လုပ်ပြီးပို့ပါ
            }
        }
        
        for ws in list(active_sockets):
            try:
                await ws.send_json(ws_payload)
            except: continue

        return web.json_response({"status": "success", "url": file_url})

    except Exception as e:
        logging.error(f"Critical Upload Error: {e}")
        return web.json_response({"error": str(e)}, status=500)


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

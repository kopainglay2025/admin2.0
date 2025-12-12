/*
AdminMessengerPanel.jsx
Single-file React component (default export) using Tailwind CSS.

Features implemented in this frontend mockup:
- Left vertical menu (multi-admin login, menu items on left)
- Channel filter (Telegram, Viber, FB, WhatsApp, All/Chats)
- Separate lists for each channel (Chats / Telegram user list)
- Chat list with search, pagination mock, unread badges, pinned
- Chat window with message history, typing indicator, read receipts
- Message input with attachments placeholder and send button
- Broadcast modal for Telegram users (select users, send broadcast)
- Multi-admin login modal (switchable active admin sessions)
- WebSocket / real-time hooks simulated (replace with real socket.io)

Integration notes (backend):
- Use a central socket.io (or similar) server to push incoming messages from Telegram bot, Facebook Page webhook, Viber, WhatsApp. The frontend expects events like:
  - "new_message": { channel, chatId, message, from, timestamp }
  - "chat_list_update": { channel, chats: [...] }
  - "typing": { channel, chatId, adminId }
- For Telegram broadcast & user list: when a user sends /start, your bot must save the user's info to DB (user_id, username, first_name, last_name, language_code, timestamp). Provide an API route to GET /api/telegram/users and POST /api/telegram/broadcast.
- For auth: this UI uses simple frontend-only multi-admin mock. Replace with your auth endpoints (login / sessions) and JWT/cookie storage.

ENV hints (backend):
- Keep TELEGRAM_BOT_TOKEN and Firebase service account on server side only. Never push private_key or tokens client-side.
- The provided FIREBASE_SERVICE_ACCOUNT_KEY must keep \n sequences escaped in .env and then parsed server-side.

Styling: Tailwind CSS. This component assumes tailwind is loaded in the app.

*/

import React, { useEffect, useMemo, useState, useRef } from "react";

export default function AdminMessengerPanel() {
  // Mock initial data - replace with API calls
  const initialAdmins = [
    { id: "admin1", name: "Admin Paing", avatar: "PA" },
    { id: "admin2", name: "Admin Su", avatar: "AS" },
  ];

  const [admins, setAdmins] = useState(initialAdmins);
  const [activeAdminId, setActiveAdminId] = useState(admins[0].id);
  const [showLoginModal, setShowLoginModal] = useState(false);

  const CHANNELS = ["All", "Telegram", "Viber", "Facebook", "WhatsApp"];
  const [activeChannel, setActiveChannel] = useState("All");
  const [search, setSearch] = useState("");

  // Chats grouped by channel
  const [chats, setChats] = useState(() => generateMockChats());
  const [selectedChat, setSelectedChat] = useState(null);
  const [typingStatus, setTypingStatus] = useState({});

  // Telegram user list (for broadcasts) - in real app fetch /api/telegram/users
  const [telegramUsers, setTelegramUsers] = useState(() => generateMockTelegramUsers());
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastSelection, setBroadcastSelection] = useState(new Set());

  const messageInputRef = useRef(null);
  const [messageText, setMessageText] = useState("");

  // Simulate real-time incoming messages
  useEffect(() => {
    const t = setInterval(() => {
      // randomly push a new message to a chat
      if (Math.random() < 0.25) {
        const cIndex = Math.floor(Math.random() * chats.length);
        const chat = chats[cIndex];
        const newMsg = {
          id: Math.random().toString(36).slice(2, 9),
          from: chat.peerName,
          text: "Auto reply at " + new Date().toLocaleTimeString(),
          ts: Date.now(),
          read: false,
        };
        const newChats = [...chats];
        newChats[cIndex] = { ...chat, messages: [...chat.messages, newMsg], unread: (chat.unread || 0) + 1 };
        setChats(newChats);
      }
    }, 5000);
    return () => clearInterval(t);
  }, [chats]);

  // filter chats by channel & search
  const filteredChats = useMemo(() => {
    return chats
      .filter((c) => (activeChannel === "All" ? true : c.channel === activeChannel))
      .filter((c) => c.peerName.toLowerCase().includes(search.toLowerCase()) || (c.lastMessage || "").toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  }, [chats, activeChannel, search]);

  useEffect(() => {
    // when selecting channel, auto-select first chat if none
    if (!selectedChat && filteredChats.length) setSelectedChat(filteredChats[0]);
  }, [activeChannel]);

  function openChat(chat) {
    setSelectedChat(chat);
    // mark read locally
    setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, unread: 0 } : c)));
  }

  function sendMessage() {
    if (!selectedChat || !messageText.trim()) return;
    const newMsg = {
      id: Math.random().toString(36).slice(2, 9),
      from: admins.find((a) => a.id === activeAdminId).name,
      text: messageText.trim(),
      ts: Date.now(),
      sentByAdmin: true,
      read: true,
    };
    setChats((prev) => prev.map((c) => (c.id === selectedChat.id ? { ...c, messages: [...c.messages, newMsg], lastMessage: newMsg.text, lastTs: newMsg.ts } : c)));
    setMessageText("");
    messageInputRef.current?.focus();

    // TODO: emit socket event to backend to actually send via the channel (Telegram / WhatsApp / FB / Viber)
  }

  function toggleAdminLogin() {
    setShowLoginModal(true);
  }

  function handleLogin(username) {
    // mock add admin
    const id = "admin_" + Math.random().toString(36).slice(2, 6);
    const newAdmin = { id, name: username, avatar: username.slice(0, 2).toUpperCase() };
    setAdmins((prev) => [...prev, newAdmin]);
    setActiveAdminId(id);
    setShowLoginModal(false);
  }

  function toggleBroadcastSelect(userId) {
    setBroadcastSelection((prev) => {
      const copy = new Set(prev);
      if (copy.has(userId)) copy.delete(userId);
      else copy.add(userId);
      return copy;
    });
  }

  function sendBroadcast() {
    // In real app POST /api/telegram/broadcast { recipients: [...], message }
    const recipients = Array.from(broadcastSelection);
    if (!recipients.length) return alert("Select at least one user");
    alert(`Broadcast sent to ${recipients.length} users (mock).`);
    setBroadcastSelection(new Set());
    setShowBroadcastModal(false);
  }

  return (
    <div className="h-screen flex bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Left menu */}
      <aside className="w-72 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex flex-col">
        <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-gray-800">
          <div className="text-lg font-semibold">AdminPanel</div>
          <div className="flex items-center gap-2">
            <button className="text-sm px-2 py-1 rounded bg-indigo-600 text-white" onClick={() => setShowBroadcastModal(true)}>
              Broadcast
            </button>
            <button className="text-sm px-2 py-1 rounded border" onClick={() => toggleAdminLogin()}>
              Multi Admin
            </button>
          </div>
        </div>

        {/* Admin switcher */}
        <div className="p-3 border-b border-gray-100 dark:border-gray-800">
          <div className="text-xs text-gray-500">Active Admin</div>
          <div className="mt-2 flex gap-2">
            {admins.map((a) => (
              <button key={a.id} onClick={() => setActiveAdminId(a.id)} className={`py-1 px-2 rounded ${a.id === activeAdminId ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800"}`}>
                {a.avatar}
              </button>
            ))}
          </div>
        </div>

        {/* Menu items */}
        <nav className="p-3 flex-1 overflow-auto">
          <div className="mb-3 text-xs text-gray-500">Menu</div>
          <ul className="space-y-2">
            <li>
              <button onClick={() => setActiveChannel("All")} className={`w-full text-left py-2 px-3 rounded ${activeChannel === "All" ? "bg-indigo-50 dark:bg-indigo-800" : "hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
                Chats
              </button>
            </li>
            <li>
              <button onClick={() => setActiveChannel("Telegram")} className={`w-full text-left py-2 px-3 rounded ${activeChannel === "Telegram" ? "bg-indigo-50 dark:bg-indigo-800" : "hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
                Telegram
              </button>
            </li>
            <li>
              <button onClick={() => setActiveChannel("Viber")} className={`w-full text-left py-2 px-3 rounded ${activeChannel === "Viber" ? "bg-indigo-50 dark:bg-indigo-800" : "hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
                Viber
              </button>
            </li>
            <li>
              <button onClick={() => setActiveChannel("Facebook")} className={`w-full text-left py-2 px-3 rounded ${activeChannel === "Facebook" ? "bg-indigo-50 dark:bg-indigo-800" : "hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
                Facebook Page
              </button>
            </li>
            <li>
              <button onClick={() => setActiveChannel("WhatsApp")} className={`w-full text-left py-2 px-3 rounded ${activeChannel === "WhatsApp" ? "bg-indigo-50 dark:bg-indigo-800" : "hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
                WhatsApp
              </button>
            </li>

            <li>
              <div className="mt-4 text-xs text-gray-500">Tools</div>
              <button onClick={() => alert('Open settings (mock)')} className="w-full text-left py-2 px-3 rounded hover:bg-gray-100 dark:hover:bg-gray-800 mt-2">
                Settings
              </button>
            </li>
          </ul>
        </nav>

        <div className="p-3 border-t text-xs text-gray-500">Logged in as: {admins.find((a) => a.id === activeAdminId)?.name}</div>
      </aside>

      {/* Middle column - Chat list */}
      <div className="w-96 border-r border-gray-200 dark:border-gray-800 flex flex-col bg-white dark:bg-gray-950">
        <div className="p-3 border-b">
          <div className="flex items-center gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats or messages..." className="flex-1 px-3 py-2 rounded border" />
            <div className="text-xs text-gray-500">{filteredChats.length} chats</div>
          </div>

          <div className="mt-3 flex gap-2 text-xs">
            {CHANNELS.map((ch) => (
              <button key={ch} onClick={() => setActiveChannel(ch)} className={`px-2 py-1 rounded ${activeChannel === ch ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800"}`}>
                {ch}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {filteredChats.map((chat) => (
            <div key={chat.id} onClick={() => openChat(chat)} className={`p-3 border-b cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900 flex items-start gap-3 ${selectedChat?.id === chat.id ? "bg-indigo-50 dark:bg-indigo-900" : ""}`}>
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-200 flex items-center justify-center">{chat.peerName[0]}</div>
              <div className="flex-1">
                <div className="flex justify-between items-center">
                  <div className="font-medium">{chat.peerName}</div>
                  <div className="text-xs text-gray-500">{timeAgo(chat.lastTs)}</div>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300 truncate">{chat.lastMessage}</div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{chat.channel}</div>
                  {chat.unread ? <div className="text-xs bg-red-500 text-white px-2 py-0.5 rounded">{chat.unread}</div> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right column - Chat view */}
      <div className="flex-1 flex flex-col">
        <div className="border-b p-3 flex items-center justify-between bg-white dark:bg-gray-950">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-200 flex items-center justify-center">{selectedChat?.peerName?.[0]}</div>
            <div>
              <div className="font-semibold">{selectedChat?.peerName || "Select a chat"}</div>
              <div className="text-xs text-gray-500">{selectedChat ? `${selectedChat.channel} • ${selectedChat.id}` : "No chat selected"}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div>{typingStatus[selectedChat?.id] ? "Typing..." : ""}</div>
            <button onClick={() => alert('Open attachments (mock)')} className="px-3 py-1 rounded border">Attach</button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 bg-gray-50 dark:bg-gray-900">
          {selectedChat ? (
            <div className="space-y-3">
              {selectedChat.messages.map((m) => (
                <div key={m.id} className={`max-w-xs ${m.sentByAdmin ? "ml-auto text-right" : ""}`}>
                  <div className={`inline-block px-3 py-2 rounded ${m.sentByAdmin ? "bg-indigo-600 text-white" : "bg-white dark:bg-gray-800"}`}>{m.text}</div>
                  <div className="text-xs text-gray-400 mt-1">{new Date(m.ts).toLocaleString()}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-500 mt-32">Pick a chat from the left to start</div>
          )}
        </div>

        {/* Input */}
        <div className="p-3 border-t bg-white dark:bg-gray-950">
          <div className="flex gap-2">
            <input ref={messageInputRef} value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder={selectedChat ? `Message ${selectedChat.peerName}...` : "Select a chat to message"} className="flex-1 px-3 py-2 rounded border" disabled={!selectedChat} />
            <button onClick={sendMessage} className="px-4 py-2 rounded bg-indigo-600 text-white" disabled={!selectedChat}>Send</button>
          </div>
        </div>
      </div>

      {/* Login modal (multi-admin) */}
      {showLoginModal ? (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-900 p-6 rounded shadow-lg w-96">
            <div className="text-lg font-semibold mb-2">Add / Switch Admin</div>
            <div className="text-sm text-gray-500 mb-4">Add a new admin (mock). In production, connect to your auth endpoint.</div>
            <AdminLoginForm onLogin={(u) => handleLogin(u)} onClose={() => setShowLoginModal(false)} />
          </div>
        </div>
      ) : null}

      {/* Broadcast modal */}
      {showBroadcastModal ? (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="bg-white dark:bg-gray-900 p-6 rounded shadow-lg w-2/3 max-w-4xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-lg font-semibold">Telegram Broadcast</div>
                <div className="text-sm text-gray-500">Select Telegram users and send a broadcast message</div>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1 border rounded" onClick={() => { setBroadcastSelection(new Set(telegramUsers.map((u) => u.id))); }}>
                  Select All
                </button>
                <button className="px-3 py-1 bg-red-600 text-white rounded" onClick={() => { setShowBroadcastModal(false); setBroadcastSelection(new Set()); }}>
                  Close
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-1 border-r pr-4">
                <div className="text-sm text-gray-500 mb-2">Users ({telegramUsers.length})</div>
                <div className="max-h-96 overflow-auto">
                  {telegramUsers.map((u) => (
                    <div key={u.id} className="flex items-center justify-between p-2 border-b">
                      <div>
                        <div className="font-medium">{u.name || u.username}</div>
                        <div className="text-xs text-gray-500">{u.username ? '@' + u.username : '—'}</div>
                      </div>
                      <div>
                        <input type="checkbox" checked={broadcastSelection.has(u.id)} onChange={() => toggleBroadcastSelect(u.id)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="col-span-2">
                <div className="mb-2 text-sm text-gray-500">Message</div>
                <textarea className="w-full h-48 p-3 border rounded" placeholder="Type broadcast message here" />
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => setBroadcastSelection(new Set())} className="px-3 py-1 border rounded">Clear</button>
                  <button onClick={sendBroadcast} className="px-3 py-1 bg-indigo-600 text-white rounded">Send Broadcast (mock)</button>
                </div>
              </div>
            </div>

          </div>
        </div>
      ) : null}
    </div>
  );
}

function AdminLoginForm({ onLogin, onClose }) {
  const [username, setUsername] = useState("");
  return (
    <div>
      <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Admin name" className="w-full px-3 py-2 border rounded mb-3" />
      <div className="flex justify-end gap-2">
        <button className="px-3 py-1 border rounded" onClick={onClose}>Cancel</button>
        <button className="px-3 py-1 bg-indigo-600 text-white rounded" onClick={() => onLogin(username || 'NewAdmin')}>Add</button>
      </div>
    </div>
  );
}

// Helpers & Mock Data
function timeAgo(ts) {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function generateMockChats() {
  const channels = ["Telegram", "Viber", "Facebook", "WhatsApp"];
  const now = Date.now();
  const arr = Array.from({ length: 14 }).map((_, i) => {
    const ch = channels[i % channels.length];
    const msgs = [
      { id: `m1-${i}`, from: `User${i}`, text: `Hello from ${ch} user #${i}`, ts: now - (i + 1) * 60000 },
      { id: `m2-${i}`, from: `Admin`, text: `Reply to ${i}`, ts: now - (i + 1) * 30000, sentByAdmin: true },
    ];
    return { id: `chat-${i}`, peerName: `${ch} User ${i}`, channel: ch, messages: msgs, lastMessage: msgs[msgs.length - 1].text, lastTs: msgs[msgs.length - 1].ts, unread: Math.random() < 0.3 ? Math.ceil(Math.random() * 5) : 0 };
  });
  return arr;
}

function generateMockTelegramUsers() {
  const arr = [];
  for (let i = 1; i <= 40; i++) {
    arr.push({ id: `tg_${i}`, name: `TG User ${i}`, username: `tguser${i}`, startedAt: Date.now() - i * 86400000 });
  }
  return arr;
}

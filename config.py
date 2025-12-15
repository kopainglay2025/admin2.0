# Don't Remove Credit Tg - @VJ_Botz
# Subscribe YouTube Channel For Amazing Bot https://youtube.com/@Tech_VJ
# Ask Doubt on telegram @KingVJ01


import re
import os
from os import environ
from Script import script

id_pattern = re.compile(r'^.\d+$')
def is_enabled(value, default):
    if value.lower() in ["true", "yes", "1", "enable", "y"]:
        return True
    elif value.lower() in ["false", "no", "0", "disable", "n"]:
        return False
    else:
        return default


FIREBASE_SERVICE_ACCOUNT_KEY = {
    "type": "service_account",
    "project_id": "mksadmin-6ffeb",
    "private_key_id": "d3131f45b11b49bdbf227ab8dcc90363b564aa70",
    "private_key": """-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDrfYdMxHqnF7OG
lfFYMRgbuXYMwB36Wz3iX8U7rFHRVREXgmEveinNgmehyJBZFunGZNkv6qcaRVIP
sWwf5vBdqGStIOejYsAtwFOrcXus6wnnrBkSV2HO8kQv7wf9+9tlHmudscFOfnKa
koyrbYK8Ts5YdRC3oe3G/auPt9BiPOwXodO3MyN9W/tVUcdNnseFTXras3e3cYoC
nFgXhiYIzRtJXkp2bRHS++EPwu6bXv2meAQkpsyQZDblJc8/05mGGvgUPiuxoGjC
fC9k3KyhIDx05LtpjgLkzwMLJ7ruM6DgyA11cRy/Jlhm18NskRHNP5rJmo7nLOgs
33qN5Ml3AgMBAAECggEACFh9iAn0Jgg5mfM/oPy0bWvoNB5G5OcagI0cvbdArkBR
uvL2I/gA+g7wda2LxN+1nAzzT+oEzz7vrPpNUHm49Dv4ijr+52DWwLuIYflDa2bO
n6hCVAHgYU4sS0QxLoSGscTsBj2uq4Wtsa6wT47+mB/bp9gWP8iV8OLVxq66ZhDQ
DZppfBjDLUz7trc5XYWozcQ9ExQVyBROjVKA3PfrvyeBTGd3VXfxGZ7gBVLNxdII
5mqmX1KE7c1WbmTNS5+DZVBOE5FvPfiHaAxzbkfxLAAapYM+YvnrWlxFSnMaRG7j
ZjdeSp5SRM70Hy2MemUuZ+HBBrmAJR7Gg0lRArgAMQKBgQD7H314HIL9qzJXZ0OP
KG4ikqsHnlvfNNG8r4AtWqejIRwLAGjqgN+bTRFfr5qjHr6dCUP1HvQUb0S7NZyB
GnFey4dTwOfhO1UQgPU9jlBTl6Pe141QKG92jFh8H6a5lpTglKaGHxqI8jBnUbPX
SZYg4N0SqT4AUvApBijHdqWcHwKBgQDwEFFAlone624FIln0V9KthSh7hwhXCu+q
OhsQ+267+CcrwxwRwNvEhRTCePRZFeCZ4SCSoSqL1D9PtwcaHmqxPFy7ETEqzlH7
ik+a1j4bXRG3f9Bz+1DF2alr7KxJi1dCD3f/FUi++JV2MYDmH+58aZnI5+RodlT9
4eNlBzgnqQKBgQCNyIfEqwRiSKhRpOIGD+Ou3XRV5cUlTuMkT0plUQvZFLaKl56k
2EJnoqmuhq0ecBta+oI+AU35w6DgujI0ykM8LFmptf61shQjD0xnhtRfffxtsvH8
UfgszKyg2BYALr671fH3Q9RtgaBGlWCeqtNymML46EkzUaB66RlZFOoILQKBgQDO
-----END PRIVATE KEY-----""",
    "client_email": "firebase-adminsdk-fbsvc@mksadmin-6ffeb.iam.gserviceaccount.com",
    "client_id": "110174734290420528988",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40mksadmin-6ffeb.iam.gserviceaccount.com",
    "universe_domain": "googleapis.com"
}




# Bot Information
API_ID = int(environ.get("API_ID", "23631217"))
API_HASH = environ.get("API_HASH", "567c6df308dc6901790309499f729d12")
BOT_TOKEN = environ.get("BOT_TOKEN", "8599597818:AAGiAJTpzFxV34rSZdLHrd9s3VrR5P0fb-k")

PICS = (environ.get('PICS', 'https://files.catbox.moe/ckoi9u.jpg https://i.postimg.cc/8C15CQ5y/1.png https://i.postimg.cc/gcNtrv0m/2.png https://i.postimg.cc/cHD71BBz/3.png https://i.postimg.cc/F1XYhY8q/4.png https://i.postimg.cc/1tNwGVxC/5.png https://i.postimg.cc/dtW30QpL/6.png https://i.postimg.cc/139dvs3c/7.png https://i.postimg.cc/QtXVtB8K/8.png https://i.postimg.cc/y8j8G1XV/9.png https://i.postimg.cc/zDF6KyJX/10.png https://i.postimg.cc/fyycVqzd/11.png https://i.postimg.cc/26ZBtBZr/13.png https://i.postimg.cc/PJn8nrWZ/14.png https://i.postimg.cc/cC7txyhz/15.png https://i.postimg.cc/kX9tjGXP/16.png https://i.postimg.cc/zXjH4NVb/17.png https://i.postimg.cc/sggGrLhn/18.png https://i.postimg.cc/y8pgYTh7/19.png')).split() # Bot Start Picture
ADMINS = [int(admin) if id_pattern.search(admin) else admin for admin in environ.get('ADMINS', '1113630298').split()]
BOT_USERNAME = environ.get("BOT_USERNAME", "MKS_KP_ADMINBOT") # without @
PORT = environ.get("PORT", "80")

# Clone Info :-
CLONE_MODE = bool(environ.get('CLONE_MODE', True)) # Set True or False

# If Clone Mode Is True Then Fill All Required Variable, If False Then Don't Fill.
CLONE_DB_URI = environ.get("CLONE_DB_URI", "mongodb+srv://Mrn_Officialx_imam_1503:Mrn_Officialx_imam_1503@cluster0.zfthfel.mongodb.net/?appName=Cluster0")
CDB_NAME = environ.get("CDB_NAME", "Mrn_Officialx_imam_1503")

# Database Information
DB_URI = environ.get("DB_URI", "mongodb+srv://msrpremium:msrpremium@cluster0.hhap4r4.mongodb.net/?retryWrites=true&w=majority")
DB_NAME = environ.get("DB_NAME", "Mrn_Officialx_imam_1503")

# Auto Delete Information
AUTO_DELETE_MODE = bool(environ.get('AUTO_DELETE_MODE', True)) # Set True or False

# If Auto Delete Mode Is True Then Fill All Required Variable, If False Then Don't Fill.
AUTO_DELETE = int(environ.get("AUTO_DELETE", "30")) # Time in Minutes
AUTO_DELETE_TIME = int(environ.get("AUTO_DELETE_TIME", "1800")) # Time in Seconds

# Channel Information
LOG_CHANNEL = int(environ.get("LOG_CHANNEL", "-1001254905376"))

# File Caption Information
CUSTOM_FILE_CAPTION = environ.get("CUSTOM_FILE_CAPTION", f"{script.CAPTION}")
BATCH_FILE_CAPTION = environ.get("BATCH_FILE_CAPTION", CUSTOM_FILE_CAPTION)

# Enable - True or Disable - False
PUBLIC_FILE_STORE = is_enabled((environ.get('MZAUTOFILTER', "True")), True)

# Verify Info :-
VERIFY_MODE = bool(environ.get('VERIFY_MODE', False)) # Set True or False

# If Verify Mode Is True Then Fill All Required Variable, If False Then Don't Fill.
SHORTLINK_URL = environ.get("SHORTLINK_URL", "linkshortify.com") # shortlink domain without https://
SHORTLINK_API = environ.get("SHORTLINK_API", "933f3923527586776d9c6c6c6eebd1a30563bee6") # shortlink api
VERIFY_TUTORIAL = environ.get("VERIFY_TUTORIAL", "https://mkschannel.org") # how to open link 

# Website Info:
WEBSITE_URL_MODE = bool(environ.get('WEBSITE_URL_MODE', True)) # Set True or False

# If Website Url Mode Is True Then Fill All Required Variable, If False Then Don't Fill.
WEBSITE_URL = environ.get("WEBSITE_URL", "https://mkschannel.org") # For More Information Check Video On Yt - @Tech_VJ

# File Stream Config
STREAM_MODE = bool(environ.get('STREAM_MODE', True)) # Set True or False

# If Stream Mode Is True Then Fill All Required Variable, If False Then Don't Fill.
MULTI_CLIENT = False
SLEEP_THRESHOLD = int(environ.get('SLEEP_THRESHOLD', '60'))
PING_INTERVAL = int(environ.get("PING_INTERVAL", "1200"))  # 20 minutes
if 'DYNO' in environ:
    ON_HEROKU = True
else:
    ON_HEROKU = False
URL = environ.get("URL", "https://mkschannel.org/")



# Avarpus API — Hostinger VPS पर setup (step by step)

यह guide Avarpus के backend (`artifacts/api-server`) को Hostinger KVM VPS पर
चलाने का पूरा क्रम है। Database भी VPS पर ही रहेगा (PostgreSQL 16), files
(photos/chat attachments) Google Cloud Storage bucket में।

इस folder की files:

| File | काम |
|---|---|
| `api.env.example` | production env की template → `/etc/avarpus/api.env` |
| `avarpus-api.service` | systemd service (auto-start, auto-restart) |
| `nginx-api.avarpus.com.conf` | Nginx reverse proxy (SSL certbot से) |
| `deploy.sh` | हर code update के लिए एक command |

Server तक हर command `ssh` से चलानी है। `root@` वाली commands root से,
बाकी `avarpus` user से।

---

## भाग A — बाहर की तैयारी (VPS छूने से पहले)

### A1. Google Cloud bucket + service account

1. <https://console.cloud.google.com> → नया project (जैसे `avarpus-prod`)।
2. **Cloud Storage → Buckets → Create**: नाम `avarpus-prod-objects`
   (global-unique होना चाहिए, न मिले तो कुछ और रखें और नीचे हर जगह वही use करें),
   Region `asia-south1 (Mumbai)`, Access control **Uniform**, Public access
   **Prevent**।
3. **IAM & Admin → Service Accounts → Create**: नाम `avarpus-api`।
   Role: **Storage Object Admin**।
4. उस service account पर → **Keys → Add key → JSON** → file download होगी।
   इसी को VPS पर `/etc/avarpus/gcs-service-account.json` रखना है।
5. Bucket पर CORS (phone/web से सीधे upload के लिए) — Cloud Shell में:
   ```bash
   cat > cors.json <<'EOF'
   [{"origin":["*"],"method":["GET","PUT","HEAD"],"responseHeader":["Content-Type"],"maxAgeSeconds":3600}]
   EOF
   gcloud storage buckets update gs://avarpus-prod-objects --cors-file=cors.json
   ```

### A2. Resend API key

Resend dashboard → **API Keys → Create** (Sending access, domain
`vmcelectronic.com`)। Key एक बार ही दिखती है — copy रखें।
बाद में Resend → **Webhooks** में endpoint URL `https://api.avarpus.com/api/webhooks/resend`
कर दें (signing secret वही रहेगा अगर endpoint edit करें; नया बनाया तो नया
`RESEND_WEBHOOK_SECRET`)।

### A3. Replit से values copy करना

Replit workspace → **Secrets** pane। `api.env.example` में जितने नाम हैं उनकी
values वहाँ से लें। Production DB का connection string: Replit → **Database**
tool → **Production** environment → connection string (इसे सिर्फ data
migrate करने के लिए चाहिए)।

---

> Optional variables (template में नहीं, default ठीक हैं): `MATRIX_PROVISION_TIMEOUT_MS`,
> `DISABLE_PUSH_DELIVERY`, `DISABLE_PUBLIC_REQUEST_ALERTS`, `EXPO_PUSH_API_URL`,
> `EXPO_PUSH_RECEIPTS_URL`, `SEED_DEMO_USERS` — production में इन्हें set **न** करें।

## भाग B — VPS base setup (root)

```bash
ssh root@<VPS-IP>

apt update && apt upgrade -y
apt install -y git curl ufw fail2ban nginx certbot python3-certbot-nginx \
               build-essential postgresql-16 postgresql-client-16 util-linux

# app user
adduser --gecos "" avarpus
usermod -aG sudo avarpus

# firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# Node 24 + pnpm 10 (project इन्हीं versions पर है)
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
corepack enable
corepack prepare pnpm@10.26.1 --activate
node -v   # v24.x
pnpm -v   # 10.26.x

# env folder
mkdir -p /etc/avarpus
chown avarpus:avarpus /etc/avarpus
chmod 750 /etc/avarpus
```

## भाग C — PostgreSQL (root)

```bash
sudo -u postgres psql <<'SQL'
CREATE USER avarpus WITH PASSWORD 'यहाँ-मज़बूत-password';
CREATE DATABASE avarpus OWNER avarpus;
SQL
```
Postgres सिर्फ `127.0.0.1` पर सुनता है (default) — बाहर से खुला नहीं। यही रखें।

## भाग D — Code + build (avarpus user)

```bash
su - avarpus

# GitHub deploy key (read-only)
ssh-keygen -t ed25519 -C "avarpus-vps" -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```
ऊपर जो line छपी उसे GitHub → repo `v1230pm-creator/Avarpus` → **Settings →
Deploy keys → Add deploy key** में paste करें (write access की ज़रूरत नहीं)।

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
chmod 600 ~/.ssh/config

git clone git@github.com:v1230pm-creator/Avarpus.git ~/avarpus
cd ~/avarpus
pnpm install --frozen-lockfile
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run build
ls artifacts/api-server/dist/index.mjs      # यह file बननी चाहिए
chmod +x deploy/vps/deploy.sh
```

## भाग E — Env file + service account key (avarpus user)

```bash
cp ~/avarpus/deploy/vps/api.env.example /etc/avarpus/api.env
nano /etc/avarpus/api.env        # हर खाली value भरें, DATABASE_URL में भाग C वाला password
chmod 600 /etc/avarpus/api.env
```
Google वाली JSON key अपने computer से VPS पर लाएँ:
```bash
# अपने computer पर:
scp ~/Downloads/avarpus-prod-xxxx.json avarpus@<VPS-IP>:/etc/avarpus/gcs-service-account.json
# VPS पर:
chmod 600 /etc/avarpus/gcs-service-account.json
```

Schema बनाएं (खाली DB में tables):
```bash
cd ~/avarpus
DATABASE_URL="$(grep ^DATABASE_URL= /etc/avarpus/api.env | cut -d= -f2-)" \
  pnpm --filter @workspace/db run push-force
```

## भाग F — systemd + nginx (root / sudo)

```bash
sudo cp ~/avarpus/deploy/vps/avarpus-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start avarpus-api                     # सिर्फ smoke test के लिए
sudo journalctl -u avarpus-api -n 30 --no-pager     # "listening" / port 8080 दिखे
curl -s http://127.0.0.1:8080/api/healthz            # {"status":"ok"}

sudo cp ~/avarpus/deploy/vps/nginx-api.avarpus.com.conf /etc/nginx/sites-available/api.avarpus.com
sudo ln -s /etc/nginx/sites-available/api.avarpus.com /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
curl -s -H "Host: api.avarpus.com" http://127.0.0.1/api/healthz   # {"status":"ok"}

sudo systemctl stop avarpus-api                      # ⚠️ ज़रूरी: cutover तक बंद रखें
sudo systemctl is-active avarpus-api                 # inactive
```
> **क्यों बंद रखना है:** API के background jobs bucket को scan करके ऐसी files
> हटाते हैं जिनका record DB में नहीं है। खाली DB के साथ चलता रहा तो migrate की
> हुई photos/attachments delete हो सकती हैं। Service सिर्फ भाग G में, data आने
> के **बाद** चालू होगी। VPS reboot हो जाए तब भी service खुद start नहीं होगी
> (enable भाग G में होता है)।

यहाँ तक असली users पर कोई असर नहीं — पुराना Replit server अभी भी
`api.avarpus.com` serve कर रहा है।

## भाग G — Data migration + DNS cutover

इस भाग में ~30–60 मिनट का downtime होगा। रात में/कम traffic में करें।

### G1. पहले से (downtime के बिना)
1. Hostinger hPanel → Domains → `avarpus.com` → **DNS** → `api` A-record का
   **TTL 300** कर दें। कम से कम 1–2 घंटे रुकें।
2. Files की पहली copy (Replit workspace के Shell में; यह सिर्फ Replit पर चलता
   है क्योंकि source Replit का bucket है):
   ```bash
   # JSON key को Replit shell में लाएँ (upload करके) — जैसे /tmp/gcs.json
   cd artifacts/api-server
   node scripts/migrate-objects-to-gcs.mjs --dest-bucket avarpus-prod-objects --key-file /tmp/gcs.json
   ```
   बड़ा data हो तो समय लगेगा; script दोबारा चलाने पर सिर्फ नई files copy होती हैं।
   काम के बाद Replit shell से key delete करें: `rm /tmp/gcs.json`।

### G2. Cutover (downtime शुरू) — क्रम बदलें नहीं
1. पक्का करें कि VPS की service बंद है: `sudo systemctl is-active avarpus-api` → `inactive`।
2. Replit → Publishing → deployment **Stop/Pause** करें (नया data आना बंद)।
3. Files की आख़िरी copy — G1 step 2 वाली command दोबारा (Replit shell में)।
   Output में `failed=0` होना चाहिए।
4. Database copy (VPS पर, avarpus user):
   ```bash
   PROD_URL='<Replit production connection string>'
   pg_dump --no-owner --no-acl --format=custom "$PROD_URL" -f /tmp/avarpus-prod.dump
   LOCAL_URL="$(grep ^DATABASE_URL= /etc/avarpus/api.env | cut -d= -f2-)"
   pg_restore --no-owner --no-acl --clean --if-exists -d "$LOCAL_URL" /tmp/avarpus-prod.dump
   psql "$LOCAL_URL" -c "select count(*) from users;"    # संख्या पुराने DB जैसी हो
   psql "$LOCAL_URL" -c "select count(*) from repairs;"
   rm /tmp/avarpus-prod.dump
   ```
5. अब service चालू करें (data और files दोनों आ चुके):
   ```bash
   sudo systemctl enable --now avarpus-api
   sudo journalctl -u avarpus-api -n 30 --no-pager
   curl -s http://127.0.0.1:8080/api/healthz
   ```
6. hPanel DNS: `api` A-record → **VPS का IP** (पुराना CNAME/A हटाएँ)।
   Check: `dig +short api.avarpus.com` में VPS IP आए (5 मिनट तक लग सकते हैं)।
7. SSL:
   ```bash
   sudo certbot --nginx -d api.avarpus.com --redirect -m <आपका email> --agree-tos -n
   curl -s https://api.avarpus.com/api/healthz
   ```
8. बाहरी services को नया URL बताएं (सब पहले भी `api.avarpus.com` थे तो कुछ नहीं बदलेगा):
   - Matrix/ESS appservice registration का `url` = `https://api.avarpus.com/api/matrix/appservice`
   - Google Cloud Console → OAuth client (`GOOGLE_BACKUP_CLIENT_ID`) → Authorized
     redirect URI = `https://api.avarpus.com/api/drive-backup/oauth/callback`
   - Resend webhook URL = `https://api.avarpus.com/api/webhooks/resend`

### G3. Verify (phone से)
OTP login → repair में photo upload और दोबारा खोलकर देखना → chat message +
attachment → Settings → Notifications → test push → staff invite email।
Web app / admin panel से login। कुछ fail हो तो:
```bash
sudo journalctl -u avarpus-api -n 200 --no-pager
```

---

## रोज़ का काम

**Code update:** `~/avarpus/deploy/vps/deploy.sh` (schema बदला हो तो `--schema`)।

**Backups (रोज़ 3 AM, 14 दिन रखें):** `crontab -e` (avarpus user) में:
```
0 3 * * * pg_dump --format=custom "$(grep ^DATABASE_URL= /etc/avarpus/api.env | cut -d= -f2-)" -f $HOME/backups/avarpus-$(date +\%F).dump && find $HOME/backups -name '*.dump' -mtime +14 -delete
```
(पहले `mkdir -p ~/backups`)। Hostinger panel में VPS **weekly snapshot** भी on रखें।
Google bucket पर **Object Versioning** on कर दें ताकि गलती से delete हुई
file वापस मिल सके।

**Monitoring:** UptimeRobot (free) पर `https://api.avarpus.com/api/healthz`
हर 5 मिनट; down होने पर SMS/email।

**Logs:** `sudo journalctl -u avarpus-api -f`

## Replit का क्या होगा?

Development (code बनाना, test करना) Replit workspace में वैसे ही चलता रहेगा —
वहाँ `OBJECT_STORAGE_PROVIDER`/`RESEND_API_KEY` set नहीं हैं इसलिए पुराना
Replit storage/connector रास्ता ही use होता है। सिर्फ production अब VPS पर है।
Cutover पक्का हो जाने के बाद Replit deployment को delete कर सकते हैं।

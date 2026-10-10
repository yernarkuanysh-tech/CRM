# Развёртывание GrantEd CRM на PS.kz

CRM должна работать на VPS или облачном сервере с постоянным диском. Обычного домена или статического виртуального хостинга недостаточно: приложению нужны Node.js 24, SQLite, постоянный процесс и HTTPS reverse proxy.

Во всех командах замените:

- `CRM_DOMAIN` — домен или поддомен, например `crm.granted.kz`;
- `SERVER_IP` — публичный IPv4 VPS;
- `SERVER_USER` — пользователь SSH, для Ubuntu в PS Cloud обычно `ubuntu`.

## 1. DNS в PS.kz

В консоли PS.kz откройте **Домены → Управление DNS → нужная зона → Изменить** и создайте запись:

| Тип | Имя | Значение | TTL |
| --- | --- | --- | --- |
| A | `crm` для поддомена или `@` для основного домена | `SERVER_IP` | `3600` |

Управление в PS.kz доступно, когда домен использует `ns1.ps.kz`, `ns2.ps.kz`, `ns3.ps.kz` и создана DNS-зона. Обновление DNS может занять 4–24 часа.

## 2. Подготовка Ubuntu VPS

В группе безопасности PS.kz откройте TCP-порты 22, 80 и 443. Подключитесь:

```bash
ssh SERVER_USER@SERVER_IP
```

Установите Node.js 24, Nginx, Certbot и rsync. После установки проверьте:

```bash
node --version
nginx -v
```

Версия Node.js должна быть 24 или новее.

Создайте системного пользователя и каталоги:

```bash
sudo useradd --system --home /opt/granted-crm --shell /usr/sbin/nologin grantedcrm
sudo mkdir -p /opt/granted-crm/data
sudo chown -R grantedcrm:grantedcrm /opt/granted-crm
```

## 3. Перенос приложения и базы

На Mac остановите локальную CRM, чтобы получить согласованную копию SQLite. Затем из папки `admissions-crm` соберите интерфейс и выполните перенос (на сервер попадает готовая папка `dist/`, `node_modules` не нужен):

```bash
npm ci && npm run build
rsync -av --exclude '.git' --exclude 'data' --exclude 'node_modules' ./ SERVER_USER@SERVER_IP:/tmp/granted-crm/
rsync -av ./data/ SERVER_USER@SERVER_IP:/tmp/granted-crm-data/
```

На VPS:

```bash
sudo rsync -a --delete /tmp/granted-crm/ /opt/granted-crm/
sudo rsync -a /tmp/granted-crm-data/ /opt/granted-crm/data/
sudo chown -R grantedcrm:grantedcrm /opt/granted-crm
sudo chmod 700 /opt/granted-crm/data
sudo chmod 600 /opt/granted-crm/data/*
```

Файл `data/encryption.key` переносите вместе с базой. Без него существующие Google OAuth-токены невозможно расшифровать.

## 4. Production-переменные

Скопируйте `deploy/pskz/production.env.example` в `/etc/granted-crm.env`, замените `CRM_DOMAIN` и при необходимости добавьте Google OAuth credentials:

```bash
sudo cp /opt/granted-crm/deploy/pskz/production.env.example /etc/granted-crm.env
sudo nano /etc/granted-crm.env
sudo chown root:grantedcrm /etc/granted-crm.env
sudo chmod 640 /etc/granted-crm.env
```

`APP_ORIGIN` должен точно совпадать с внешним HTTPS-адресом без завершающего `/`.

## 5. Постоянный запуск через systemd

```bash
sudo cp /opt/granted-crm/deploy/pskz/granted-crm.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now granted-crm
sudo systemctl status granted-crm
curl http://127.0.0.1:4173/api/auth/status
```

Ожидается JSON с `initialized: true` и HTTP 200.

## 6. Nginx и HTTPS

Скопируйте конфигурацию и замените домен:

```bash
sudo cp /opt/granted-crm/deploy/pskz/nginx.conf /etc/nginx/sites-available/granted-crm
sudo sed -i 's/CRM_DOMAIN/ВАШ_ДОМЕН/g' /etc/nginx/sites-available/granted-crm
sudo ln -s /etc/nginx/sites-available/granted-crm /etc/nginx/sites-enabled/granted-crm
sudo nginx -t
sudo systemctl reload nginx
```

После того как A-запись начала возвращать IP сервера, выпустите сертификат:

```bash
sudo certbot --nginx -d ВАШ_ДОМЕН
sudo certbot renew --dry-run
```

Проверьте `https://ВАШ_ДОМЕН/api/auth/status`, затем откройте CRM в браузере.

## 7. Приглашения сотрудников по email

Подтвердите домен отправителя в Resend и добавьте в `/etc/granted-crm.env`:

```text
RESEND_API_KEY=re_...
MAIL_FROM="GrantEd CRM <crm@ВАШ_ДОМЕН>"
```

Если эти параметры не заполнены, владелец всё равно может создать приглашение и скопировать одноразовую ссылку вручную.

## 8. Google Drive и Gmail

В Google Cloud Console добавьте точный redirect URI:

```text
https://ВАШ_ДОМЕН/oauth/google/callback
```

Перезапустите сервис после изменения `/etc/granted-crm.env`:

```bash
sudo systemctl restart granted-crm
sudo journalctl -u granted-crm -n 100 --no-pager
```

## 9. Резервные копии

CRM хранит локальные копии в `/opt/granted-crm/data/backups`, но они находятся на том же диске. Подключите автоматическое резервное копирование VPS в панели PS.kz и отдельно храните защищённую копию `crm.sqlite` вместе с `encryption.key`.

## Быстрая диагностика

```bash
sudo systemctl status granted-crm
sudo journalctl -u granted-crm -n 100 --no-pager
sudo nginx -t
curl -I http://127.0.0.1:4173/
curl -I https://ВАШ_ДОМЕН/
```

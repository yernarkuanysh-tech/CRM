# Развёртывание GrantEd CRM на PS.kz

Данные и вход CRM обслуживает Supabase, поэтому на сервере нужен только статический сайт: папка `dist/` и nginx с HTTPS. Подойдёт VPS или любой статический хостинг с поддержкой HTTPS.

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

В группе безопасности PS.kz откройте TCP-порты 22, 80 и 443. Подключитесь и установите nginx, Certbot и rsync:

```bash
ssh SERVER_USER@SERVER_IP
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx rsync
sudo mkdir -p /var/www/granted-crm
sudo chown SERVER_USER:SERVER_USER /var/www/granted-crm
```

## 3. Сборка и перенос

На своём компьютере, из папки проекта (адрес Supabase и publishable key берутся из `.env.production`):

```bash
npm ci && npm run build
rsync -av --delete dist/ SERVER_USER@SERVER_IP:/var/www/granted-crm/
```

Повторяйте эти две команды для каждого обновления.

## 4. Nginx и HTTPS

```bash
scp deploy/pskz/nginx.conf SERVER_USER@SERVER_IP:/tmp/granted-crm.conf
ssh SERVER_USER@SERVER_IP
sudo mv /tmp/granted-crm.conf /etc/nginx/sites-available/granted-crm
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

## 5. Supabase Auth

В панели Supabase откройте **Authentication → URL Configuration**: укажите `https://ВАШ_ДОМЕН` в **Site URL** и добавьте его в **Redirect URLs**.

## 6. Резервные копии

Клиентские данные хранятся в Supabase: включите резервное копирование в **Database → Backups** и периодически сохраняйте JSON-экспорт из CRM в защищённое место.

## Быстрая диагностика

```bash
sudo nginx -t
curl -I https://ВАШ_ДОМЕН/
```

# Calendar API

Node標準HTTPだけで動くバックエンドです。データはSQLiteの `src/Data/data/calendar.sqlite` に保存します。
初回起動時は空のDBを作成します。開発用シードを取り込む場合だけ `CALENDAR_SEED_DATA=1` を指定します。
ログは既定で `src/Data/data/logs/app.log` にJSON Lines形式で保存します。
APIアクセス、HTTPエラー、未処理エラー、ブラウザから送信されたクライアントエラーを記録します。

## 起動

```sh
npm run server:dev
```

既定URLは `http://127.0.0.1:8787` です。
本番や常時運用では、データ保存先をプロジェクト外に置くことを推奨します。
Webサーバーで公開するのはフロントの `dist/` だけにしてください。`src/Data/data/`、SQLite、ログ、バックアップ、サーバーコードはWeb公開ディレクトリに置かないでください。

```sh
CALENDAR_DATA_DIR=/var/lib/calendar LOG_FILE=/var/log/calendar/app.log npm run server:dev
```

本番公開時は、許可するフロントのURLを `CALENDAR_ALLOWED_ORIGINS` で固定してください。
`NODE_ENV=production` では `CALENDAR_ALLOWED_ORIGINS` 未設定のCORS許可は出しません。
リバースプロキシ配下で実IPを `X-Forwarded-For` から見る場合だけ `CALENDAR_TRUST_PROXY=1` を指定してください。

```sh
NODE_ENV=production \
CALENDAR_ALLOWED_ORIGINS=https://example.com \
CALENDAR_TRUST_PROXY=1 \
CALENDAR_DATA_DIR=/var/lib/calendar \
LOG_FILE=/var/log/calendar/app.log \
npm run server:dev
```

本番起動設定の雛形は `src/Data/Server/deploy/` にあります。
`production.env.example` をプロジェクト外へコピーして値を埋め、`start-production.sh` に渡して起動してください。
nginxでHTTPS終端する場合は `nginx-calendar.example.conf` をベースにできます。

個別にDBファイルを指定する場合は `DATABASE_PATH` を使えます。

```sh
DATABASE_PATH=/var/lib/calendar/calendar.sqlite npm run server:dev
```

Tailscaleなど別端末から接続する場合は、バックエンドを外部待受にします。

```sh
HOST=0.0.0.0 npm run server:dev
```

フロント側は、未指定なら表示中ページと同じホストの `:8787` をAPIとして使います。
明示したい場合は `VITE_API_BASE_URL` を指定します。

```sh
VITE_API_BASE_URL=http://<tailscale-ip-or-name>:8787 npm run dev -- --host 0.0.0.0
```

## 確認

```sh
npm run server:check
```

権限まわりのAPIテストは、一時DBでAPIサーバーを起動して確認します。

```sh
npm run test:api-authz
```

## バックアップ

SQLiteの `.backup` を使ってDBを一貫コピーし、`memo-images` と `logs` も同じバックアップフォルダにコピーします。

```sh
npm run backup:data
```

既定の出力先は `src/Data/data/backups/<timestamp>/` です。
本番ではデータ保存先・バックアップ先をプロジェクト外に置くことを推奨します。

```sh
CALENDAR_DATA_DIR=/var/lib/calendar CALENDAR_BACKUP_DIR=/var/backups/calendar npm run backup:data
```

個別DBを使っている場合はサーバー起動時と同じ `DATABASE_PATH` を指定してください。

```sh
DATABASE_PATH=/var/lib/calendar/calendar.sqlite CALENDAR_BACKUP_DIR=/var/backups/calendar npm run backup:data
```

定期バックアップ用の常駐プログラムもありますが、既定では無効です。
未公開・開発中は次のコマンドを実行してもバックアップは作られず、そのまま終了します。

```sh
npm run backup:schedule
```

本番公開後に有効化する場合だけ `CALENDAR_BACKUP_ENABLED=1` を付けます。
既定間隔は24時間です。起動直後にも1回作りたい場合は `CALENDAR_BACKUP_RUN_ON_START=1` を付けます。

```sh
CALENDAR_BACKUP_ENABLED=1 \
CALENDAR_BACKUP_INTERVAL_MINUTES=1440 \
CALENDAR_BACKUP_RUN_ON_START=1 \
CALENDAR_DATA_DIR=/var/lib/calendar \
CALENDAR_BACKUP_DIR=/var/backups/calendar \
npm run backup:schedule
```

## 主なAPI

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/client-logs`
- `GET /api/groups`
- `GET /api/join-requests?groupId=...`
- `POST /api/join-requests/:id/approve`
- `GET /api/schedules?role=User&member=佐藤&query=...&tag=#3b82f6`
- `POST /api/schedules`
- `PUT /api/schedules/:id`
- `DELETE /api/schedules/:id`
- `POST /api/schedules/:id/read`
- `GET /api/trash`
- `POST /api/trash/:id/restore`
- `GET /api/tags`
- `POST /api/tags`
- `PATCH /api/tags/:id`
- `DELETE /api/tags/:id`

登録ルールは `README-決定事項` の初期仕様に寄せています。
グループ未指定ならAdminとして個人グループ作成、存在しないグループ名なら新規Admin、既存グループIDなら参加申請を作成します。

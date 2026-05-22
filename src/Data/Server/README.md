# Calendar API

Node標準HTTPだけで動くバックエンドです。データはSQLiteの `src/Data/data/calendar.sqlite` に保存します。
初回起動時に既存の `src/Data/data/db.json` があれば取り込みます。
ログは既定で `src/Data/data/logs/app.log` にJSON Lines形式で保存します。
APIアクセス、HTTPエラー、未処理エラー、ブラウザから送信されたクライアントエラーを記録します。

## 起動

```sh
npm run server:dev
```

既定URLは `http://127.0.0.1:8787` です。
本番や常時運用では、データ保存先をプロジェクト外に置くことを推奨します。

```sh
CALENDAR_DATA_DIR=/var/lib/calendar LOG_FILE=/var/log/calendar/app.log npm run server:dev
```

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

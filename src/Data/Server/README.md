# Calendar API

Node標準HTTPだけで動く開発用バックエンドです。データは `src/Data/data/db.json` に保存します。
将来PostgreSQLへ移す場合は `store.ts` をDB実装に差し替える想定です。

## 起動

```sh
npm run server:dev
```

既定URLは `http://127.0.0.1:8787` です。

## 確認

```sh
npm run server:check
```

## 主なAPI

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
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

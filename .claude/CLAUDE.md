# emdash-cloudflare-email

EmDash CMS プラグイン: システムメール（マジックリンク / 招待 / パスワードリセット）を Cloudflare Email Sending の Workers バインディング経由で配信する。

## コマンド

```sh
pnpm build       # tsdown で dist/ を生成
pnpm typecheck   # tsc --noEmit で型チェック
```

## アーキテクチャ

- `src/index.ts` — descriptor ファクトリ。`PluginDescriptor` を返す（id / version / capabilities / entrypoint）。
- `src/sandbox-entry.ts` — `definePlugin({ hooks, routes })`。`email:deliver` 排他フックと管理画面 (Block Kit) を実装。
- ビルド成果物 `dist/*.mjs` + `.d.mts` を公開。`exports` の `.` と `./sandbox` で参照。
- 設定（From アドレス / バインディング名）は管理画面 + KV で実行時保持（emdash 0.19 の standard 形式は descriptor options が sandbox に届かないため）。

## GitHub ワークフロー

@.claude/skills/issue-lifecycle/SKILL.md

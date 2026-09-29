# PartBase

電子部品の登録・検索・在庫更新を行う Web アプリです。GitHub Pages に静的サイトとして公開し、データは Supabase の Postgres と Storage に保存します。ユーザーごとに在庫が分かれます。

## データベースの作り方

1. [Supabase Dashboard](https://supabase.com/dashboard/projects) で新しいプロジェクトを作成します。
2. プロジェクトの **SQL Editor** を開き、[supabase/schema.sql](supabase/schema.sql) の内容をすべて貼り付けて実行します。これで `parts` テーブル、数量を安全に増減する関数、非公開の画像バケット、本人のデータだけにアクセスできるルールが作られます。
3. **Connect** または **Settings → API Keys** で **Project URL** と **publishable key**（`sb_publishable_...`）を取得します。**secret key / service_role key は使わないでください。**
4. **Authentication → URL Configuration** の Site URL と Redirect URLs に `https://kentuc322.github.io/PartBase/` を登録します。ローカル開発時は `http://127.0.0.1:5173/` も Redirect URLs に追加します。
5. 公開した PartBase で「初めて使う方はこちら」からアカウントを作成し、必要なら確認メールのリンクを開きます。個人用として使うなら、アカウント作成後に Supabase の Authentication 設定で新規登録を停止できます。

最初にサイトを開いたときに Project URL と publishable key を入力できます。この設定はその端末に保存されます。すべての端末で入力を省くには、GitHub リポジトリの **Settings → Secrets and variables → Actions → Variables** に `SUPABASE_URL` と `SUPABASE_PUBLISHABLE_KEY` を設定し、Pages のワークフローを再実行してください。publishable key は公開用のキーです。実際のデータ保護は SQL の Row Level Security と Supabase Auth が行います。

## GitHub Pages

リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にします。`.github/workflows/deploy-pages.yml` が `main` への push で Vite アプリをビルドし、`dist` を公開します。

## ローカル実行

```sh
npm ci
npm run dev
```

表示された URL を開き、Supabase の Project URL と publishable key を入力します。確認用ビルドは `npm run build` です。

## データ設計

`parts` は UUID、所有者 ID、名前、型番、カテゴリ、タグ配列、数量、保管場所、仕様、購入先、データシート URL、画像パス、作成・更新日時を持ちます。画像本体は非公開 Storage バケット `part-images` に置きます。検索・絞り込みはログイン後に読み込んだ本人の部品に対して行います。数量の ±1 更新は Postgres 関数で単一の UPDATE として実行します。

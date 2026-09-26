# Vercel・API設定ガイド

## 1. GitHubからImport

対象: https://github.com/miki-826/Saudage

1. Vercelへログインし、**Add New → Project**。
2. GitHubの **miki-826/Saudage** を選び、**Import**。
3. 次の設定を使います。

| 項目              | 設定                       |
| ----------------- | -------------------------- |
| Framework Preset  | Next.js                    |
| Root Directory    | 空欄（リポジトリルート）   |
| Node.js           | 24.x                       |
| Install Command   | `npm ci`（または自動判定） |
| Build Command     | `npm run build`            |
| Output Directory  | 自動判定のまま             |
| Production Branch | main                       |

ローカルでは `app-source` フォルダに置いていますが、GitHubではその中身がリポジトリのルートです。Vercelに `app-source` と入力しないでください。

## 2. 環境変数

Import画面のEnvironment Variables、または **Project → Settings → Environment Variables** で登録します。
最初はProductionを選択。Previewも使うならPreviewにも登録します。

| 名前                                   | 必須条件               | 内容・取得先                                                                |
| -------------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `SESSION_SECRET`                       | **本番セーブ用に登録** | 32バイト以上のランダムな文字列。後述のコマンドで生成。ずっと同じ値を保持    |
| `OPENAI_API_KEY`                       | AI会話を使う場合       | OpenAI PlatformのAPI key。GPT-Live利用権限とAPI利用枠が必要                 |
| `OPENAI_LIVE_MODEL`                    | 任意                   | 既定 `gpt-live-1`                                                           |
| `OPENAI_ANALYSIS_MODEL`                | 任意                   | 既定 `gpt-5.6-luna`。Structured Outputsとlow reasoning対応モデル            |
| `OPENAI_TEXT_MODEL`                    | 任意                   | 既定 `gpt-5.6-luna`。テキスト会話用                                         |
| `NEXT_PUBLIC_SUPABASE_URL`             | クラウド保存時         | SupabaseのProject URL                                                       |
| `SUPABASE_SERVICE_ROLE_KEY`            | クラウド保存時         | Supabaseのサーバー用service_role key                                        |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 今回は不要             | 元仕様の予約項目。ブラウザからDBへ直接接続しないため使わない                |
| `GAME_ACCESS_CODE`                     | 任意                   | 設定するとAIの有料API呼び出しにプレイコードが必要。アプリの設定画面から入力 |

`SESSION_SECRET` は手元のターミナルで次を実行し、出力をVercelへコピーします。

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

秘密の値はGitHubに書かないでください。`OPENAI_API_KEY`、`SESSION_SECRET`、`SUPABASE_SERVICE_ROLE_KEY`、`GAME_ACCESS_CODE` に `NEXT_PUBLIC_` を付けないでください。
`SESSION_SECRET` を変更すると以前のセーブの署名が無効になります。OpenAIキーを変更してもセーブを維持するため、独立した `SESSION_SECRET` を使ってください。

OpenAIキーの取得: https://platform.openai.com/api-keys
ChatGPTの契約とは別のAPI利用設定です。GPT-Liveモデルにアクセスできるプロジェクトを使用してください。

## 3. Supabaseを使う場合

Supabase未設定でも、端末セーブ・OpenAI会話は利用できます。

1. Supabaseで新しいプロジェクトを作る、または利用するプロジェクトを開きます。
2. **SQL Editor → New query** で [schema.sql](../supabase/schema.sql) をすべて貼り付けて実行。
3. Project URLとservice_role keyをVercelに登録。
4. VercelをRedeploy。
5. 物語を進め、画面下の **記憶を保存** または設定の **保存** を押します。
6. 「この端末とクラウドに記憶を保存しました」と表示され、Supabaseの `game_sessions`、`memory_states`、`personality_states` にデータが入れば成功です。

この実装はログイン不要の端末別セーブです。DBへの読み書きはサーバーのみで行い、RLSを有効化し、ブラウザ用の公開キーによるテーブル読み書きを拒否します。匿名サインインの有効化は不要です。
Cookieを消した場合、別のブラウザ、別端末、Previewと本番の別ドメインへは引き継げません。書き出しファイルも元のCookieが必要です。
会話ごとは端末へ自動保存、クラウドは「保存」操作時に保存します。

## 4. Deploy / Redeploy

初回は **Deploy** を押します。ビルド完了後にVercelが発行したURLを開きます。
変数を追加・変更したら **Deployments → 対象のDeploymentのメニュー → Redeploy**。変数保存だけでは既存のデプロイに反映されません。

体験モードと「つづきから」は削除済みです。API設定後、**物語をはじめる** からAI会話を開始してください。

## 5. 最終チェック

1. API未設定なら設定案内を表示。設定済みの新規ゲームは「AI会話」と表示。
2. テキスト入力と選択肢で台詞が返り、複数の会話で記憶が解放される。
3. 「声で話しかける」を押し、マイクを許可。日本語で会話できる。
4. 音声終了・ホームへ移動・タブを隠すと接続を終了する。
5. カメラは任意。「カメラ補助をオン」から許可し、拒否してもテキストで続けられる。
6. 記憶ボード、解放演出、エンディング、右下の退出ボタンを確認。
7. スマートフォンでも文字入力・音声・BGMを確認。

音声はHTTPSかlocalhostで使用します。GPT-LiveはWebRTCを使うため、Vercel関数を音声の間ずっと実行する必要はありません。1回の接続はアプリ側で15分後に終了します。タブが非表示になる場合も停止します。

## よくある問題

| 状態                     | 確認すること                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------- |
| 本番で物語を開始できない | `SESSION_SECRET` とRedeploy                                                             |
| API登録後も設定案内    | Redeployし、新しい物語を開始                                                            |
| AIに接続できない         | キー、利用枠、`gpt-live-1` / テキストモデルの利用権限。Vercelログにはステータスのみ表示 |
| プレイコードを要求される | `GAME_ACCESS_CODE` と同じコードをアプリ設定へ入力                                       |
| クラウド保存失敗         | SQL実行、Project URL、サーバーキー。端末の保存は残る                                    |
| 古いセーブを検証できない | `SESSION_SECRET` を変えていないか、同じドメイン・Cookieか確認                           |
| マイクやカメラが動かない | HTTPS、ブラウザのサイト権限、他アプリによる占有                                         |
| 音が出ない               | サウンドをオン、端末の消音設定、ブラウザの再生制限                                      |

アクセス制限を付けずに公開すると、訪問者はサイトのAPIを利用できます。少人数の試遊では `GAME_ACCESS_CODE` を設定できます。アプリ内のリクエスト制限はインスタンス単位の簡易制限です。大規模公開時はVercel Firewall等の共有レート制限を追加してください。

## 参照した公式資料

- [GPT-Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)
- [GPT-Live sessions](https://developers.openai.com/api/docs/guides/live-conversations)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)

2026-09-26確認。APIの実接続・Vercel本番デプロイは、利用者による設定後に確認してください。

# KOAN サービス構成図

KOAN は、PC 上のコーディングエージェントをスマートフォンから操作するための、単一ユーザー向けローカルゲートウェイです。インターネット上に独立した KOAN サーバーを置くのではなく、PC 内の Gateway を Tailscale 経由で安全に公開します。

## 全体構成

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"system-ui, sans-serif","primaryTextColor":"#172033","lineColor":"#718096","clusterBkg":"#fafbfc","clusterBorder":"#cbd5e0"},"flowchart":{"curve":"basis","nodeSpacing":28,"rankSpacing":42}}}%%
flowchart LR
    user([利用者])

    subgraph phone[スマートフォン]
        pwa[KOAN PWA<br/>React SPA]
    end

    subgraph tailnet[Tailscale のプライベートネットワーク]
        serve[Tailscale Serve<br/>HTTPS / WSS]
    end

    subgraph pc[利用者の PC]
        direction TB

        subgraph gateway[Deno Gateway : 127.0.0.1:18787]
            static[SPA 配信]
            api[REST API<br/>認証・プロジェクト・セッション]
            ws[WebSocket<br/>イベント配信・再送]
            scheduler[Scheduler<br/>プロジェクト単位の FIFO キュー]
            adapters[Agent Adapter<br/>プロトコル差を共通イベントへ変換]
        end

        sqlite[(SQLite<br/>履歴・状態・端末・承認)]
        files[(添付ファイル<br/>KOAN データ領域)]
        project[(許可された<br/>プロジェクト領域)]

        subgraph agents[ローカルの AI エージェント]
            codex[Codex<br/>app-server]
            claude[Claude<br/>Agent SDK]
            acp[Kiro / Cline / OpenCode<br/>ACP]
        end
    end

    user --> pwa
    pwa <-->|HTTPS: API・画面| serve
    pwa <-->|WSS: 実行状況・回答| serve
    serve <-->|localhost のみ| static
    serve <--> api
    serve <--> ws

    api --> scheduler
    api <--> sqlite
    api <--> files
    scheduler -->|選択したエージェントを起動| adapters
    adapters <--> codex
    adapters <--> claude
    adapters <--> acp
    codex <--> project
    claude <--> project
    acp <--> project
    scheduler -->|正規化イベントを保存| sqlite
    scheduler -->|保存済みイベントを通知| ws
    files -->|添付ファイルのローカルパス| adapters

    classDef client fill:#e8f1ff,stroke:#4b82d0,color:#172033,stroke-width:1.5px;
    classDef network fill:#edf2f7,stroke:#718096,color:#1a202c,stroke-width:1.5px;
    classDef core fill:#fff4dd,stroke:#d99a2b,color:#352713,stroke-width:1.5px;
    classDef data fill:#f1edff,stroke:#816ac5,color:#211b33,stroke-width:1.5px;
    classDef agent fill:#e8f7ef,stroke:#41966a,color:#163326,stroke-width:1.5px;
    class user,pwa client;
    class serve network;
    class static,api,ws,scheduler core;
    class sqlite,files,project data;
    class adapters,codex,claude,acp agent;
```

## 1 回の依頼が処理される流れ

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontFamily":"system-ui, sans-serif","primaryTextColor":"#172033","lineColor":"#718096","actorBkg":"#e8f1ff","actorBorder":"#4b82d0","actorTextColor":"#172033","signalColor":"#4a5568","signalTextColor":"#172033","noteBkgColor":"#fff4dd","noteBorderColor":"#d99a2b","activationBkgColor":"#e8f7ef","activationBorderColor":"#41966a"}}}%%
sequenceDiagram
    autonumber
    actor User as 利用者
    participant PWA as スマホ PWA
    participant API as Gateway API
    participant DB as SQLite
    participant Queue as Scheduler
    participant Agent as Agent Adapter / CLI
    participant WS as WebSocket

    User->>PWA: プロンプトを送信
    PWA->>API: POST /sessions/:id/turns<br/>Idempotency-Key 付き
    API->>Queue: ターンを enqueue
    Queue->>DB: user message・queued 状態を保存
    Queue->>WS: 保存済みイベントを publish
    Queue-->>API: turnId
    API-->>PWA: 202 Accepted
    WS-->>PWA: queued / running をリアルタイム配信

    Note over Queue: 同じプロジェクト内は FIFO<br/>別プロジェクトは並列実行
    Queue->>Agent: プロジェクトの cwd で実行

    loop エージェントの実行中
        Agent->>Queue: 応答差分・思考・ツール結果
        Queue->>DB: 連番付きイベントとして保存
        Queue->>WS: イベントを publish
        WS-->>PWA: 画面を逐次更新
    end

    opt コマンド実行などに承認が必要
        Agent->>Queue: approval request
        Queue->>DB: pending approval を保存
        Queue->>WS: approval.requested
        WS-->>PWA: 承認シートを表示
        User->>PWA: 許可または拒否
        PWA->>API: POST /approvals/:id/resolve
        API->>Queue: 判定を返す
        Queue-->>Agent: 実行を継続または拒否
    end

    opt エージェントから追加質問がある
        Agent->>Queue: question request
        Queue->>DB: pending question を保存
        Queue->>WS: question.requested
        WS-->>PWA: 質問シートを表示
        User->>PWA: 回答
        PWA->>API: POST /questions/:id/resolve
        API->>Queue: 回答を返す
        Queue-->>Agent: 回答を渡して再開
    end

    Agent-->>Queue: 完了
    Queue->>DB: completed・最終イベントを保存
    Queue->>WS: turn.completed
    WS-->>PWA: 完了状態を表示
```

## 設計上の要点

- **PC 内で完結**: 会話履歴、添付ファイル、対象リポジトリ、エージェントプロセスは利用者の PC にあります。
- **外部から直接待ち受けない**: Gateway は `127.0.0.1:18787` のみに bind し、スマートフォンからは Tailscale Serve を経由します。
- **再接続に強い**: すべてのイベントにセッション内の連番を付けて SQLite に保存します。WebSocket 再接続時は端末側の cursor 以降を再送し、大きな欠落は REST API で再同期します。
- **実行順を制御**: 同じプロジェクトに対するターンは FIFO で直列化し、別プロジェクトのターンは並列に実行できます。ブラウザを閉じても実行は継続します。
- **エージェント差を吸収**: Codex、Claude、ACP 対応エージェントの出力を、メッセージ、ツール、承認、質問、差分などの共通イベントへ変換します。
- **認証と入力検証**: 初回は 10 分間有効な使い捨て 8 桁コードでペアリングし、以後は端末トークンの Secure Cookie を使います。更新 API には同一 Origin と CSRF ヘッダーも必要です。
- **ファイル境界**: 登録できるプロジェクトは明示した許可ルート配下だけです。real path を検証し、`..` やシンボリックリンクによる脱出を防ぎます。
- **サンドボックスの境界**: Gateway 自体には Deno の権限制限がありますが、子プロセスとして動くエージェントは Deno のサンドボックス外です。実際の変更権限は各エージェント側の sandbox・approval 設定でも制御します。

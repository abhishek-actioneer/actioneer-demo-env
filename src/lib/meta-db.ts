import Database from "better-sqlite3";
import { resolve } from "path";
import { resolveDataPath } from "./data-dir";

const DB_PATH = process.env.SENTINEL_META_DB_PATH?.trim()
  ? resolve(process.env.SENTINEL_META_DB_PATH.trim())
  : resolveDataPath("sentinel-meta.sqlite");

interface MetaDbGlobal {
  __meta_db__?: Database.Database;
  __meta_db_ready__?: boolean;
  __meta_db_ready_version__?: number;
}

const g = globalThis as MetaDbGlobal;
const CURRENT_SCHEMA_VERSION = 17;

function getDb(): Database.Database {
  if (!g.__meta_db__) {
    g.__meta_db__ = new Database(DB_PATH);
    g.__meta_db__.pragma("journal_mode = WAL");
    g.__meta_db__.pragma("busy_timeout = 5000");
    g.__meta_db__.pragma("synchronous = NORMAL");
    g.__meta_db__.pragma("foreign_keys = ON");
  }
  if (!g.__meta_db_ready__ || g.__meta_db_ready_version__ !== CURRENT_SCHEMA_VERSION) {
    g.__meta_db__.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        title TEXT NOT NULL,
        dataset_id TEXT,
        folder_id TEXT,
        origin TEXT DEFAULT 'user',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        tags TEXT,
        pending_actions TEXT,
        messages TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_conv_user_dataset
        ON conversations(user_id, dataset_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conv_folder
        ON conversations(folder_id) WHERE folder_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        dataset_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        view_mode TEXT DEFAULT 'document',
        global_time_range TEXT,
        deck_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_boards_user_dataset ON boards(user_id, dataset_id);

      CREATE TABLE IF NOT EXISTS board_cards (
        board_id TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (board_id, id),
        FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS board_sections (
        board_id TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (board_id, id),
        FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS board_connections (
        board_id TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (board_id, id),
        FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS board_frames (
        board_id TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (board_id, id),
        FOREIGN KEY(board_id) REFERENCES boards(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS playbooks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        dataset_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        schema_version INTEGER NOT NULL DEFAULT 2,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_playbooks_user_dataset
        ON playbooks(user_id, dataset_id);

      CREATE TABLE IF NOT EXISTS funnels (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        dataset_id TEXT,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        config TEXT NOT NULL,
        source TEXT DEFAULT 'manual',
        overall_conversion REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_funnels_user_dataset
        ON funnels(user_id, dataset_id);

      CREATE TABLE IF NOT EXISTS retentions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        dataset_id TEXT,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        config TEXT NOT NULL,
        source TEXT DEFAULT 'manual',
        d7_retention REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_retentions_user_dataset
        ON retentions(user_id, dataset_id);

      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        priority TEXT NOT NULL,
        source TEXT NOT NULL,
        date_added TEXT NOT NULL,
        added_by TEXT NOT NULL,
        reference_thread TEXT,
        source_conversation_id TEXT,
        source_url TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_entries_user_dataset
        ON knowledge_entries(user_id, dataset_id, date_added DESC);

      CREATE TABLE IF NOT EXISTS knowledge_dataset_resets (
        user_id TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        cleared_at TEXT NOT NULL,
        PRIMARY KEY (user_id, dataset_id)
      );

      CREATE TABLE IF NOT EXISTS segments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        dataset_id TEXT,
        name TEXT NOT NULL,
        sql TEXT NOT NULL,
        description TEXT DEFAULT '',
        user_count INTEGER DEFAULT 0,
        push_status TEXT DEFAULT '{}',
        source_conversation_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_segments_user_dataset
        ON segments(user_id, dataset_id);

      CREATE TABLE IF NOT EXISTS lifecycle_campaigns (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        lifecycle_profile_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        offer_id TEXT NOT NULL,
        as_of_date TEXT NOT NULL,
        attribution_window_days INTEGER NOT NULL,
        contact_policy_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lifecycle_campaigns_user_dataset
        ON lifecycle_campaigns(user_id, dataset_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS campaign_experiments (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        hypothesis TEXT NOT NULL,
        oec_metric TEXT NOT NULL,
        guardrail_metrics_json TEXT NOT NULL,
        randomization_unit TEXT NOT NULL,
        salt TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(campaign_id) REFERENCES lifecycle_campaigns(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_experiments_campaign
        ON campaign_experiments(campaign_id);

      CREATE TABLE IF NOT EXISTS experiment_arms (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        allocation_pct REAL NOT NULL,
        script_variant_id TEXT,
        voice_config_json TEXT,
        metadata_json TEXT,
        FOREIGN KEY(experiment_id) REFERENCES campaign_experiments(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_experiment_arms_experiment
        ON experiment_arms(experiment_id);

      CREATE TABLE IF NOT EXISTS lifecycle_enrollments (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        experiment_id TEXT NOT NULL,
        arm_id TEXT NOT NULL,
        investor_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        current_state TEXT NOT NULL,
        first_qualified_at TEXT NOT NULL,
        enrolled_at TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        attribution_window_ends_at TEXT NOT NULL,
        offer_instance_id TEXT,
        last_touch_at TEXT,
        cooldown_until TEXT,
        exit_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(campaign_id) REFERENCES lifecycle_campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY(experiment_id) REFERENCES campaign_experiments(id) ON DELETE CASCADE,
        FOREIGN KEY(arm_id) REFERENCES experiment_arms(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lifecycle_enrollments_campaign_investor
        ON lifecycle_enrollments(campaign_id, investor_id);
      CREATE INDEX IF NOT EXISTS idx_lifecycle_enrollments_campaign_arm
        ON lifecycle_enrollments(campaign_id, arm_id);

      CREATE TABLE IF NOT EXISTS offer_instances (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        experiment_id TEXT NOT NULL,
        arm_id TEXT NOT NULL,
        enrollment_id TEXT NOT NULL,
        investor_id TEXT NOT NULL,
        offer_id TEXT NOT NULL,
        sku_id TEXT,
        deeplink TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(campaign_id) REFERENCES lifecycle_campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY(experiment_id) REFERENCES campaign_experiments(id) ON DELETE CASCADE,
        FOREIGN KEY(arm_id) REFERENCES experiment_arms(id) ON DELETE CASCADE,
        FOREIGN KEY(enrollment_id) REFERENCES lifecycle_enrollments(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_instances_enrollment
        ON offer_instances(enrollment_id);

      CREATE TABLE IF NOT EXISTS campaign_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        experiment_id TEXT,
        arm_id TEXT,
        enrollment_id TEXT,
        offer_instance_id TEXT,
        investor_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        source TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(campaign_id) REFERENCES lifecycle_campaigns(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_type
        ON campaign_events(campaign_id, event_type, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_campaign_events_investor
        ON campaign_events(campaign_id, investor_id, occurred_at);

      CREATE TABLE IF NOT EXISTS contact_identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        phone_number TEXT NOT NULL,
        consent INTEGER NOT NULL,
        name TEXT,
        preferred_language TEXT,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_identities_entity
        ON contact_identities(user_id, dataset_id, entity_id);
      CREATE INDEX IF NOT EXISTS idx_contact_identities_phone
        ON contact_identities(user_id, dataset_id, phone_number);

      CREATE TABLE IF NOT EXISTS call_event_outbox (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        campaign_id TEXT,
        call_id TEXT NOT NULL,
        provider TEXT,
        event_type TEXT NOT NULL,
        event_ts TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        export_status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL,
        next_attempt_at TEXT NOT NULL,
        last_error TEXT,
        fivetran_response_code INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        delivered_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_call_event_outbox_idempotency
        ON call_event_outbox(idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_call_event_outbox_pending
        ON call_event_outbox(export_status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_call_event_outbox_lookup
        ON call_event_outbox(user_id, dataset_id, campaign_id, call_id, event_ts DESC);

      CREATE TABLE IF NOT EXISTS call_recordings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        call_id TEXT NOT NULL,
        recording_sid TEXT NOT NULL,
        provider TEXT,
        source TEXT,
        status TEXT NOT NULL,
        storage_key TEXT,
        recording_uri TEXT,
        provider_url TEXT,
        content_type TEXT,
        size_bytes INTEGER,
        duration_seconds INTEGER,
        channels INTEGER,
        started_at TEXT,
        stored_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_call_recordings_identity
        ON call_recordings(user_id, dataset_id, campaign_id, call_id, recording_sid);
      CREATE INDEX IF NOT EXISTS idx_call_recordings_campaign
        ON call_recordings(user_id, dataset_id, campaign_id, call_id, stored_at DESC);

      CREATE TABLE IF NOT EXISTS voice_eval_agents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        prompt TEXT NOT NULL,
        input_type TEXT NOT NULL,
        category TEXT NOT NULL,
        config_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_voice_eval_agents_scope
        ON voice_eval_agents(user_id, dataset_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS voice_eval_workbenches (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        eval_agent_ids_json TEXT NOT NULL,
        campaign_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_voice_eval_workbenches_scope
        ON voice_eval_workbenches(user_id, dataset_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS voice_eval_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        call_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL,
        next_attempt_at TEXT NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_eval_jobs_call
        ON voice_eval_jobs(user_id, dataset_id, campaign_id, call_id);
      CREATE INDEX IF NOT EXISTS idx_voice_eval_jobs_pending
        ON voice_eval_jobs(status, next_attempt_at);

      CREATE TABLE IF NOT EXISTS voice_eval_results (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        call_id TEXT NOT NULL,
        workbench_id TEXT NOT NULL,
        eval_agent_id TEXT NOT NULL,
        eval_agent_name TEXT NOT NULL,
        eval_agent_snapshot_json TEXT NOT NULL,
        verdict TEXT NOT NULL,
        score REAL,
        rationale TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES voice_eval_jobs(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_eval_results_identity
        ON voice_eval_results(job_id, workbench_id, eval_agent_id);
      CREATE INDEX IF NOT EXISTS idx_voice_eval_results_scope
        ON voice_eval_results(user_id, dataset_id, workbench_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT,
        background_summary TEXT,
        background_summary_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);

      CREATE TABLE IF NOT EXISTS contact_phones (
        phone TEXT NOT NULL,
        user_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
        PRIMARY KEY (phone, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_contact_phones_contact ON contact_phones(contact_id);

      CREATE TABLE IF NOT EXISTS channel_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        direction TEXT NOT NULL,
        actor TEXT NOT NULL,
        event_type TEXT,
        content TEXT,
        call_id TEXT,
        campaign_id TEXT,
        template_id TEXT,
        provider TEXT,
        provider_message_id TEXT,
        status TEXT,
        resolved_at TEXT,
        idempotency_key TEXT,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata_json TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_events_idempotency
        ON channel_events(idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_channel_events_contact
        ON channel_events(user_id, contact_id, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS treatment_tasks (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        experiment_id TEXT NOT NULL,
        arm_id TEXT NOT NULL,
        enrollment_id TEXT NOT NULL,
        offer_instance_id TEXT NOT NULL,
        investor_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        voice_campaign_id TEXT,
        voice_call_id TEXT,
        scheduled_for TEXT,
        started_at TEXT,
        ended_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(campaign_id) REFERENCES lifecycle_campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY(experiment_id) REFERENCES campaign_experiments(id) ON DELETE CASCADE,
        FOREIGN KEY(arm_id) REFERENCES experiment_arms(id) ON DELETE CASCADE,
        FOREIGN KEY(enrollment_id) REFERENCES lifecycle_enrollments(id) ON DELETE CASCADE,
        FOREIGN KEY(offer_instance_id) REFERENCES offer_instances(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_treatment_tasks_enrollment
        ON treatment_tasks(enrollment_id);
      CREATE INDEX IF NOT EXISTS idx_treatment_tasks_campaign_status
        ON treatment_tasks(campaign_id, status);

      CREATE TABLE IF NOT EXISTS decision_records (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        experiment_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        notes TEXT NOT NULL,
        next_step TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(campaign_id) REFERENCES lifecycle_campaigns(id) ON DELETE CASCADE,
        FOREIGN KEY(experiment_id) REFERENCES campaign_experiments(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_records_campaign_experiment
        ON decision_records(campaign_id, experiment_id);
    `);

    // ── Incremental migration runner ──────────────────────────────────────────
    // How to add a future migration:
    //   1. Bump CURRENT_SCHEMA_VERSION by 1.
    //   2. Add an `if (dbVersion < N)` block inside the transaction below.
    //   3. Put your ALTER TABLE / CREATE INDEX statements in that block.
    //      Do NOT use DEFAULT values in ALTER TABLE ADD COLUMN (DuckDB WAL
    //      limitation — same rule applies here for safety).
    // The transaction ensures all migrations in a batch are atomic; if any
    // statement throws the entire batch is rolled back and user_version stays
    // unchanged so the next boot retries from the same version.
    const dbVersion = g.__meta_db__.pragma("user_version", {
      simple: true,
    }) as number;

    if (dbVersion < CURRENT_SCHEMA_VERSION) {
      const runMigrations = g.__meta_db__.transaction(() => {
        if (dbVersion < 2) {
          g.__meta_db__!.exec(`
            CREATE TABLE IF NOT EXISTS folders (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              dataset_id TEXT,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);

            CREATE TABLE IF NOT EXISTS saved_charts (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              dataset_id TEXT NOT NULL,
              name TEXT NOT NULL,
              config TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_saved_charts_user_dataset ON saved_charts(user_id, dataset_id);

            CREATE TABLE IF NOT EXISTS credits (
              org_id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              balance INTEGER NOT NULL DEFAULT 0,
              transactions TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS forecast_seeds (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              dataset_id TEXT NOT NULL,
              model_data TEXT NOT NULL,
              seed_data TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_forecast_user_dataset ON forecast_seeds(user_id, dataset_id);
          `);
        }
        if (dbVersion < 3) {
          g.__meta_db__!.exec(`
            CREATE TABLE IF NOT EXISTS funnels (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL DEFAULT 'default',
              dataset_id TEXT,
              name TEXT NOT NULL,
              description TEXT DEFAULT '',
              config TEXT NOT NULL,
              source TEXT DEFAULT 'manual',
              overall_conversion REAL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_funnels_user_dataset
              ON funnels(user_id, dataset_id);
          `);
        }
        if (dbVersion < 4) {
          g.__meta_db__!.exec(`
            CREATE TABLE IF NOT EXISTS retentions (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL DEFAULT 'default',
              dataset_id TEXT,
              name TEXT NOT NULL,
              description TEXT DEFAULT '',
              config TEXT NOT NULL,
              source TEXT DEFAULT 'manual',
              d7_retention REAL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_retentions_user_dataset
              ON retentions(user_id, dataset_id);
          `);
        }
        if (dbVersion < 5) {
          g.__meta_db__!.exec(`
            CREATE TABLE IF NOT EXISTS segment_activity (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              segment_id TEXT NOT NULL,
              type TEXT NOT NULL,
              status TEXT NOT NULL,
              destination TEXT,
              channel TEXT,
              subject TEXT,
              user_count INTEGER,
              campaign_id INTEGER,
              dashboard_url TEXT,
              error TEXT,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_segment_activity_segment
              ON segment_activity(user_id, segment_id, created_at DESC);
          `);
        }
        if (dbVersion < 6) {
          // Store the rendered email HTML and template id at send time so the
          // /campaigns/[id] detail view can re-render the preview without
          // round-tripping through CleverTap (whose API doesn't expose body).
          g.__meta_db__!.exec(`
            ALTER TABLE segment_activity ADD COLUMN body_html TEXT;
            ALTER TABLE segment_activity ADD COLUMN template_id TEXT;
          `);
        }
        if (dbVersion < 8) {
          // First-party email engagement events. Populated by:
          //   - 'sent'        → at send time, one row per recipient identity
          //   - 'open'        → tracking pixel hits at /api/r/o/...
          //   - 'click'       → redirect endpoint at /api/r/c/...
          //   - 'unsubscribe' → unsub endpoint (TODO)
          //   - 'bounce'      → CleverTap webhook (TODO)
          // campaign_id is the segment_activity.id (we own it, generated ahead
          // of the CleverTap call so links can be rewritten before send).
          g.__meta_db__!.exec(`
            CREATE TABLE IF NOT EXISTS email_events (
              id TEXT PRIMARY KEY,
              campaign_id TEXT NOT NULL,
              user_id TEXT,
              variant_id TEXT NOT NULL DEFAULT 'default',
              event_type TEXT NOT NULL,
              url TEXT,
              ts INTEGER NOT NULL,
              ip TEXT,
              user_agent TEXT,
              meta TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_email_events_campaign
              ON email_events(campaign_id, event_type, ts);
            CREATE INDEX IF NOT EXISTS idx_email_events_user
              ON email_events(user_id, ts) WHERE user_id IS NOT NULL;
          `);
        }
        if (dbVersion < 7) {
          g.__meta_db__!.exec(`
            CREATE TABLE IF NOT EXISTS bugs (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              dataset_id TEXT,
              title TEXT NOT NULL,
              description TEXT NOT NULL,
              page_url TEXT,
              user_agent TEXT,
              screenshot_b64 TEXT,
              status TEXT NOT NULL DEFAULT 'new',
              cursor_agent_id TEXT,
              plan_markdown TEXT,
              diff_summary TEXT,
              pr_url TEXT,
              demo_video_url TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_bugs_user_status
              ON bugs(user_id, status, created_at DESC);
          `);
        }
        if (dbVersion < 9 && !columnExists(g.__meta_db__!, "segments", "config")) {
          g.__meta_db__!.exec(`ALTER TABLE segments ADD COLUMN config TEXT`);
        }
        if (dbVersion < 10) {
          g.__meta_db__!.exec(`
            CREATE TABLE IF NOT EXISTS lifecycle_campaigns (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              dataset_id TEXT NOT NULL,
              name TEXT NOT NULL,
              status TEXT NOT NULL,
              lifecycle_profile_id TEXT NOT NULL,
              segment_id TEXT NOT NULL,
              offer_id TEXT NOT NULL,
              as_of_date TEXT NOT NULL,
              attribution_window_days INTEGER NOT NULL,
              contact_policy_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_lifecycle_campaigns_user_dataset
              ON lifecycle_campaigns(user_id, dataset_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS campaign_experiments (
              id TEXT PRIMARY KEY,
              campaign_id TEXT NOT NULL,
              hypothesis TEXT NOT NULL,
              oec_metric TEXT NOT NULL,
              guardrail_metrics_json TEXT NOT NULL,
              randomization_unit TEXT NOT NULL,
              salt TEXT NOT NULL,
              status TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(campaign_id) REFERENCES lifecycle_campaigns(id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_experiments_campaign
              ON campaign_experiments(campaign_id);

            CREATE TABLE IF NOT EXISTS experiment_arms (
              id TEXT PRIMARY KEY,
              experiment_id TEXT NOT NULL,
              type TEXT NOT NULL,
              name TEXT NOT NULL,
              allocation_pct REAL NOT NULL,
              script_variant_id TEXT,
              voice_config_json TEXT,
              metadata_json TEXT,
              FOREIGN KEY(experiment_id) REFERENCES campaign_experiments(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_experiment_arms_experiment
              ON experiment_arms(experiment_id);

            CREATE TABLE IF NOT EXISTS lifecycle_enrollments (
              id TEXT PRIMARY KEY,
              campaign_id TEXT NOT NULL,
              experiment_id TEXT NOT NULL,
              arm_id TEXT NOT NULL,
              investor_id TEXT NOT NULL,
              segment_id TEXT NOT NULL,
              current_state TEXT NOT NULL,
              first_qualified_at TEXT NOT NULL,
              enrolled_at TEXT NOT NULL,
              assigned_at TEXT NOT NULL,
              attribution_window_ends_at TEXT NOT NULL,
              offer_instance_id TEXT,
              last_touch_at TEXT,
              cooldown_until TEXT,
              exit_reason TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(campaign_id) REFERENCES lifecycle_campaigns(id) ON DELETE CASCADE,
              FOREIGN KEY(experiment_id) REFERENCES campaign_experiments(id) ON DELETE CASCADE,
              FOREIGN KEY(arm_id) REFERENCES experiment_arms(id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_lifecycle_enrollments_campaign_investor
              ON lifecycle_enrollments(campaign_id, investor_id);
            CREATE INDEX IF NOT EXISTS idx_lifecycle_enrollments_campaign_arm
              ON lifecycle_enrollments(campaign_id, arm_id);

            CREATE TABLE IF NOT EXISTS offer_instances (
              id TEXT PRIMARY KEY,
              campaign_id TEXT NOT NULL,
              experiment_id TEXT NOT NULL,
              arm_id TEXT NOT NULL,
              enrollment_id TEXT NOT NULL,
              investor_id TEXT NOT NULL,
              offer_id TEXT NOT NULL,
              sku_id TEXT,
              deeplink TEXT,
              status TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(campaign_id) REFERENCES lifecycle_campaigns(id) ON DELETE CASCADE,
              FOREIGN KEY(experiment_id) REFERENCES campaign_experiments(id) ON DELETE CASCADE,
              FOREIGN KEY(arm_id) REFERENCES experiment_arms(id) ON DELETE CASCADE,
              FOREIGN KEY(enrollment_id) REFERENCES lifecycle_enrollments(id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_instances_enrollment
              ON offer_instances(enrollment_id);

            CREATE TABLE IF NOT EXISTS campaign_events (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              dataset_id TEXT NOT NULL,
              campaign_id TEXT NOT NULL,
              experiment_id TEXT,
              arm_id TEXT,
              enrollment_id TEXT,
              offer_instance_id TEXT,
              investor_id TEXT NOT NULL,
              event_type TEXT NOT NULL,
              occurred_at TEXT NOT NULL,
              source TEXT NOT NULL,
              metadata_json TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY(campaign_id) REFERENCES lifecycle_campaigns(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_type
              ON campaign_events(campaign_id, event_type, occurred_at);
            CREATE INDEX IF NOT EXISTS idx_campaign_events_investor
              ON campaign_events(campaign_id, investor_id, occurred_at);

            CREATE TABLE IF NOT EXISTS contact_identities (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              dataset_id TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              phone_number TEXT NOT NULL,
              consent INTEGER NOT NULL,
              name TEXT,
              preferred_language TEXT,
              source TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_identities_entity
              ON contact_identities(user_id, dataset_id, entity_id);
            CREATE INDEX IF NOT EXISTS idx_contact_identities_phone
              ON contact_identities(user_id, dataset_id, phone_number);

            CREATE TABLE IF NOT EXISTS treatment_tasks (
              id TEXT PRIMARY KEY,
              campaign_id TEXT NOT NULL,
              experiment_id TEXT NOT NULL,
              arm_id TEXT NOT NULL,
              enrollment_id TEXT NOT NULL,
              offer_instance_id TEXT NOT NULL,
              investor_id TEXT NOT NULL,
              channel TEXT NOT NULL,
              provider TEXT NOT NULL,
              status TEXT NOT NULL,
              voice_campaign_id TEXT,
              voice_call_id TEXT,
              scheduled_for TEXT,
              started_at TEXT,
              ended_at TEXT,
              last_error TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(campaign_id) REFERENCES lifecycle_campaigns(id) ON DELETE CASCADE,
              FOREIGN KEY(experiment_id) REFERENCES campaign_experiments(id) ON DELETE CASCADE,
              FOREIGN KEY(arm_id) REFERENCES experiment_arms(id) ON DELETE CASCADE,
              FOREIGN KEY(enrollment_id) REFERENCES lifecycle_enrollments(id) ON DELETE CASCADE,
              FOREIGN KEY(offer_instance_id) REFERENCES offer_instances(id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_treatment_tasks_enrollment
              ON treatment_tasks(enrollment_id);
            CREATE INDEX IF NOT EXISTS idx_treatment_tasks_campaign_status
              ON treatment_tasks(campaign_id, status);

            CREATE TABLE IF NOT EXISTS decision_records (
              id TEXT PRIMARY KEY,
              campaign_id TEXT NOT NULL,
              experiment_id TEXT NOT NULL,
              decision TEXT NOT NULL,
              notes TEXT NOT NULL,
              next_step TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(campaign_id) REFERENCES lifecycle_campaigns(id) ON DELETE CASCADE,
              FOREIGN KEY(experiment_id) REFERENCES campaign_experiments(id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_records_campaign_experiment
              ON decision_records(campaign_id, experiment_id);
          `);
        }
        if (dbVersion < 11) {
          // Provisioned prospect demo logins, created from the /admin panel.
          // Internal shared resource (not per-prospect-user scoped) — the whole
          // admin team sees the same list. Password is the readable demo password
          // we share with the prospect (synthetic-data login only).
          g.__meta_db__!.exec(`
            CREATE TABLE IF NOT EXISTS provisioned_creds (
              id TEXT PRIMARY KEY,
              clerk_user_id TEXT NOT NULL,
              login_email TEXT NOT NULL,
              password TEXT NOT NULL,
              company TEXT NOT NULL,
              industry TEXT NOT NULL,
              champion_name TEXT NOT NULL,
              champion_email TEXT NOT NULL,
              deal_owner_name TEXT NOT NULL,
              deal_owner_email TEXT NOT NULL,
              cc_json TEXT,
              bcc_json TEXT,
              magic_link TEXT NOT NULL,
              magic_link_expires_at TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'active',
              last_email_status TEXT,
              created_by TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_provisioned_creds_created
              ON provisioned_creds(created_at DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_provisioned_creds_login
              ON provisioned_creds(login_email);
          `);
        }
        if (dbVersion < 12) {
          // A prospect workspace can now be scoped to more than one industry, so
          // store the full set as a JSON array. The original single `industry`
          // column stays (holds the first one) to satisfy its NOT NULL.
          if (!columnExists(g.__meta_db__!, "provisioned_creds", "industries_json")) {
            g.__meta_db__!.exec(`ALTER TABLE provisioned_creds ADD COLUMN industries_json TEXT`);
          }
        }
        if (dbVersion < 14) {
          g.__meta_db__!.exec(`
            CREATE TABLE IF NOT EXISTS knowledge_entries (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              dataset_id TEXT NOT NULL,
              title TEXT,
              content TEXT NOT NULL,
              level TEXT NOT NULL,
              category TEXT NOT NULL,
              priority TEXT NOT NULL,
              source TEXT NOT NULL,
              date_added TEXT NOT NULL,
              added_by TEXT NOT NULL,
              reference_thread TEXT,
              source_conversation_id TEXT,
              source_url TEXT,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_knowledge_entries_user_dataset
              ON knowledge_entries(user_id, dataset_id, date_added DESC);
          `);
        }
        if (dbVersion < 15) {
          g.__meta_db__!.exec(`
            CREATE TABLE IF NOT EXISTS knowledge_dataset_resets (
              user_id TEXT NOT NULL,
              dataset_id TEXT NOT NULL,
              cleared_at TEXT NOT NULL,
              PRIMARY KEY (user_id, dataset_id)
            );
          `);
        }
        if (dbVersion < 17 && !columnExists(g.__meta_db__!, "voice_eval_agents", "config_json")) {
          g.__meta_db__!.exec(`ALTER TABLE voice_eval_agents ADD COLUMN config_json TEXT`);
        }
        g.__meta_db__!.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
      });
      runMigrations();
    }
    // ─────────────────────────────────────────────────────────────────────────
    g.__meta_db_ready__ = true;
    g.__meta_db_ready_version__ = CURRENT_SCHEMA_VERSION;
  }
  return g.__meta_db__;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  return db.prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => (row as { name?: string }).name === column);
}

// Prepared statements — created lazily, cached on the db instance
let _stmts: ReturnType<typeof prepareStatements> | null = null;

function prepareStatements(db: Database.Database) {
  return {
    listSummaries: db.prepare(`
      SELECT id, title, dataset_id, folder_id, updated_at, origin
      FROM conversations
      WHERE user_id = ? AND origin != 'deck'
      ORDER BY updated_at DESC
    `),
    listSummariesByDataset: db.prepare(`
      SELECT id, title, dataset_id, folder_id, updated_at, origin
      FROM conversations
      WHERE user_id = ? AND (dataset_id = ? OR dataset_id IS NULL) AND origin != 'deck'
      ORDER BY updated_at DESC
    `),
    getById: db.prepare(`
      SELECT * FROM conversations WHERE id = ? AND user_id = ?
    `),
    insertOrIgnore: db.prepare(`
      INSERT OR IGNORE INTO conversations (id, user_id, title, dataset_id, folder_id, origin, created_at, updated_at, tags, pending_actions, messages)
      VALUES (@id, @user_id, @title, @dataset_id, @folder_id, @origin, @created_at, @updated_at, @tags, @pending_actions, @messages)
    `),
    upsertFull: db.prepare(`
      INSERT INTO conversations (id, user_id, title, dataset_id, folder_id, origin, created_at, updated_at, tags, pending_actions, messages)
      VALUES (@id, @user_id, @title, @dataset_id, @folder_id, @origin, @created_at, @updated_at, @tags, @pending_actions, @messages)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        dataset_id = COALESCE(excluded.dataset_id, conversations.dataset_id),
        folder_id = excluded.folder_id,
        messages = excluded.messages,
        tags = excluded.tags,
        pending_actions = excluded.pending_actions,
        updated_at = excluded.updated_at
    `),
    upsertMessages: db.prepare(`
      INSERT INTO conversations (id, user_id, title, dataset_id, origin, created_at, updated_at, tags, pending_actions, messages)
      VALUES (@id, @user_id, @title, @dataset_id, @origin, @created_at, @updated_at, @tags, @pending_actions, @messages)
      ON CONFLICT(id) DO UPDATE SET
        messages = excluded.messages,
        tags = excluded.tags,
        pending_actions = excluded.pending_actions,
        updated_at = excluded.updated_at
    `),
    update: db.prepare(`
      UPDATE conversations
      SET title = @title, folder_id = @folder_id, messages = @messages,
          tags = @tags, pending_actions = @pending_actions, updated_at = @updated_at
      WHERE id = @id AND user_id = @user_id
    `),
    updateMessages: db.prepare(`
      UPDATE conversations
      SET messages = @messages, tags = @tags, pending_actions = @pending_actions, updated_at = @updated_at
      WHERE id = @id AND user_id = @user_id
    `),
    updateFolder: db.prepare(`
      UPDATE conversations SET folder_id = @folder_id, updated_at = @updated_at
      WHERE id = @id AND user_id = @user_id
    `),
    deleteById: db.prepare(`
      DELETE FROM conversations WHERE id = ? AND user_id = ?
    `),
    count: db.prepare(`
      SELECT COUNT(*) as cnt FROM conversations WHERE user_id = ?
    `),

    // ── Board statements ──
    boardInsertIgnore: db.prepare(`
      INSERT OR IGNORE INTO boards (id, user_id, dataset_id, name, description, view_mode, global_time_range, deck_id, created_at, updated_at)
      VALUES (@id, @user_id, @dataset_id, @name, @description, @view_mode, @global_time_range, @deck_id, @created_at, @updated_at)
    `),
    boardUpsert: db.prepare(`
      INSERT INTO boards (id, user_id, dataset_id, name, description, view_mode, global_time_range, deck_id, created_at, updated_at)
      VALUES (@id, @user_id, @dataset_id, @name, @description, @view_mode, @global_time_range, @deck_id, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        view_mode = excluded.view_mode,
        global_time_range = excluded.global_time_range,
        deck_id = excluded.deck_id,
        dataset_id = COALESCE(excluded.dataset_id, boards.dataset_id),
        updated_at = excluded.updated_at
    `),
    boardGetById: db.prepare(`SELECT * FROM boards WHERE id = ? AND user_id = ?`),
    boardListByUserDataset: db.prepare(`
      SELECT b.id, b.name, b.dataset_id, b.updated_at,
        (SELECT COUNT(*) FROM board_cards c WHERE c.board_id = b.id) as card_count
      FROM boards b
      WHERE b.user_id = ? AND b.dataset_id = ?
      ORDER BY b.updated_at DESC
    `),
    boardDelete: db.prepare(`DELETE FROM boards WHERE id = ? AND user_id = ?`),
    boardCount: db.prepare(`SELECT COUNT(*) as cnt FROM boards WHERE user_id = ?`),

    // ── Board card statements ──
    cardUpsert: db.prepare(`
      INSERT INTO board_cards (board_id, id, data) VALUES (@board_id, @id, @data)
      ON CONFLICT(board_id, id) DO UPDATE SET data = excluded.data
    `),
    cardGetByBoard: db.prepare(`SELECT id, data FROM board_cards WHERE board_id = ?`),
    cardGetOne: db.prepare(`SELECT data FROM board_cards WHERE board_id = ? AND id = ?`),
    cardDeleteOne: db.prepare(`DELETE FROM board_cards WHERE board_id = ? AND id = ?`),
    cardDeleteByBoard: db.prepare(`DELETE FROM board_cards WHERE board_id = ?`),

    // ── Board section statements ──
    sectionUpsert: db.prepare(`
      INSERT INTO board_sections (board_id, id, data) VALUES (@board_id, @id, @data)
      ON CONFLICT(board_id, id) DO UPDATE SET data = excluded.data
    `),
    sectionGetByBoard: db.prepare(`SELECT id, data FROM board_sections WHERE board_id = ?`),
    sectionDeleteOne: db.prepare(`DELETE FROM board_sections WHERE board_id = ? AND id = ?`),
    sectionDeleteByBoard: db.prepare(`DELETE FROM board_sections WHERE board_id = ?`),

    // ── Board connection statements ──
    connUpsert: db.prepare(`
      INSERT INTO board_connections (board_id, id, data) VALUES (@board_id, @id, @data)
      ON CONFLICT(board_id, id) DO UPDATE SET data = excluded.data
    `),
    connGetByBoard: db.prepare(`SELECT id, data FROM board_connections WHERE board_id = ?`),
    connDeleteOne: db.prepare(`DELETE FROM board_connections WHERE board_id = ? AND id = ?`),
    connDeleteByBoard: db.prepare(`DELETE FROM board_connections WHERE board_id = ?`),

    // ── Board frame statements ──
    frameUpsert: db.prepare(`
      INSERT INTO board_frames (board_id, id, data) VALUES (@board_id, @id, @data)
      ON CONFLICT(board_id, id) DO UPDATE SET data = excluded.data
    `),
    frameGetByBoard: db.prepare(`SELECT id, data FROM board_frames WHERE board_id = ?`),
    frameDeleteOne: db.prepare(`DELETE FROM board_frames WHERE board_id = ? AND id = ?`),
    frameDeleteByBoard: db.prepare(`DELETE FROM board_frames WHERE board_id = ?`),

    // ── Playbook statements ──
    playbookUpsert: db.prepare(`
      INSERT INTO playbooks (id, user_id, dataset_id, name, description, category, schema_version, data, created_at, updated_at)
      VALUES (@id, @user_id, @dataset_id, @name, @description, @category, @schema_version, @data, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        category = excluded.category,
        schema_version = excluded.schema_version,
        data = excluded.data,
        dataset_id = COALESCE(excluded.dataset_id, playbooks.dataset_id),
        updated_at = excluded.updated_at
    `),
    playbookGetById: db.prepare(`SELECT * FROM playbooks WHERE id = ? AND user_id = ?`),
    playbookListByUserDataset: db.prepare(`
      SELECT id, name, description, category, schema_version, dataset_id, created_at, updated_at
      FROM playbooks
      WHERE user_id = ? AND (dataset_id = ? OR dataset_id IS NULL)
      ORDER BY updated_at DESC
    `),
    playbookDelete: db.prepare(`DELETE FROM playbooks WHERE id = ? AND user_id = ?`),
    playbookInsertIgnore: db.prepare(`
      INSERT OR IGNORE INTO playbooks (id, user_id, dataset_id, name, description, category, schema_version, data, created_at, updated_at)
      VALUES (@id, @user_id, @dataset_id, @name, @description, @category, @schema_version, @data, @created_at, @updated_at)
    `),

    // ── Knowledge statements ──
    knowledgeUpsert: db.prepare(`
      INSERT INTO knowledge_entries (
        id, user_id, dataset_id, title, content, level, category, priority, source,
        date_added, added_by, reference_thread, source_conversation_id, source_url, updated_at
      ) VALUES (
        @id, @user_id, @dataset_id, @title, @content, @level, @category, @priority, @source,
        @date_added, @added_by, @reference_thread, @source_conversation_id, @source_url, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        level = excluded.level,
        category = excluded.category,
        priority = excluded.priority,
        source = excluded.source,
        added_by = excluded.added_by,
        reference_thread = excluded.reference_thread,
        source_conversation_id = excluded.source_conversation_id,
        source_url = excluded.source_url,
        updated_at = excluded.updated_at
    `),
    knowledgeListByUserDataset: db.prepare(`
      SELECT * FROM knowledge_entries
      WHERE user_id = ? AND dataset_id = ?
      ORDER BY date_added DESC
    `),
    knowledgeDelete: db.prepare(`
      DELETE FROM knowledge_entries WHERE id = ? AND user_id = ? AND dataset_id = ?
    `),
    knowledgeDeleteByUserDataset: db.prepare(`
      DELETE FROM knowledge_entries WHERE user_id = ? AND dataset_id = ?
    `),
    knowledgeDatasetResetGet: db.prepare(`
      SELECT cleared_at FROM knowledge_dataset_resets WHERE user_id = ? AND dataset_id = ?
    `),
    knowledgeDatasetResetUpsert: db.prepare(`
      INSERT INTO knowledge_dataset_resets (user_id, dataset_id, cleared_at)
      VALUES (@user_id, @dataset_id, @cleared_at)
      ON CONFLICT(user_id, dataset_id) DO UPDATE SET cleared_at = excluded.cleared_at
    `),

    // ── Funnel statements ──
    funnelUpsert: db.prepare(`
      INSERT INTO funnels (id, user_id, dataset_id, name, description, config, source, overall_conversion, created_at, updated_at)
      VALUES (@id, @user_id, @dataset_id, @name, @description, @config, @source, @overall_conversion, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        config = excluded.config,
        source = excluded.source,
        overall_conversion = excluded.overall_conversion,
        dataset_id = COALESCE(excluded.dataset_id, funnels.dataset_id),
        updated_at = excluded.updated_at
    `),
    funnelGetById: db.prepare(`SELECT * FROM funnels WHERE id = ? AND user_id = ?`),
    funnelListByUserDataset: db.prepare(`
      SELECT id, name, description, config, source, overall_conversion, dataset_id, created_at, updated_at
      FROM funnels
      WHERE user_id = ? AND (dataset_id = ? OR dataset_id IS NULL)
      ORDER BY updated_at DESC
    `),
    funnelDelete: db.prepare(`DELETE FROM funnels WHERE id = ? AND user_id = ?`),

    // ── Retention statements ──
    retentionUpsert: db.prepare(`
      INSERT INTO retentions (id, user_id, dataset_id, name, description, config, source, d7_retention, created_at, updated_at)
      VALUES (@id, @user_id, @dataset_id, @name, @description, @config, @source, @d7_retention, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        config = excluded.config,
        source = excluded.source,
        d7_retention = excluded.d7_retention,
        dataset_id = COALESCE(excluded.dataset_id, retentions.dataset_id),
        updated_at = excluded.updated_at
    `),
    retentionGetById: db.prepare(`SELECT * FROM retentions WHERE id = ? AND user_id = ?`),
    retentionListByUserDataset: db.prepare(`
      SELECT id, name, description, config, source, d7_retention, dataset_id, created_at, updated_at
      FROM retentions
      WHERE user_id = ? AND (dataset_id = ? OR dataset_id IS NULL)
      ORDER BY updated_at DESC
    `),
    retentionDelete: db.prepare(`DELETE FROM retentions WHERE id = ? AND user_id = ?`),

    // ── Segment statements ──
    segmentUpsert: db.prepare(`
      INSERT INTO segments (id, user_id, dataset_id, name, sql, description, user_count, push_status, source_conversation_id, config, created_at, updated_at)
      VALUES (@id, @user_id, @dataset_id, @name, @sql, @description, @user_count, @push_status, @source_conversation_id, @config, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name = CASE WHEN excluded.name IS NOT NULL THEN excluded.name ELSE segments.name END,
        sql = CASE WHEN excluded.sql IS NOT NULL THEN excluded.sql ELSE segments.sql END,
        description = CASE WHEN excluded.description IS NOT NULL THEN excluded.description ELSE segments.description END,
        user_count = CASE WHEN excluded.user_count IS NOT NULL THEN excluded.user_count ELSE segments.user_count END,
        push_status = CASE WHEN excluded.push_status IS NOT NULL THEN excluded.push_status ELSE segments.push_status END,
        config = CASE WHEN excluded.config IS NOT NULL THEN excluded.config ELSE segments.config END,
        dataset_id = COALESCE(excluded.dataset_id, segments.dataset_id),
        updated_at = excluded.updated_at
    `),
    segmentGetById: db.prepare(`SELECT * FROM segments WHERE id = ? AND user_id = ?`),
    segmentListByUserDataset: db.prepare(`
      SELECT id, name, sql, description, user_count, push_status, source_conversation_id, config, dataset_id, created_at, updated_at
      FROM segments
      WHERE user_id = ? AND (dataset_id = ? OR dataset_id IS NULL)
      ORDER BY updated_at DESC
    `),
    segmentDelete: db.prepare(`DELETE FROM segments WHERE id = ? AND user_id = ?`),
    segmentInsertIgnore: db.prepare(`
      INSERT OR IGNORE INTO segments (id, user_id, dataset_id, name, sql, description, user_count, push_status, source_conversation_id, config, created_at, updated_at)
      VALUES (@id, @user_id, @dataset_id, @name, @sql, @description, @user_count, @push_status, @source_conversation_id, @config, @created_at, @updated_at)
    `),
    segmentUpdatePushStatus: db.prepare(`
      UPDATE segments SET push_status = @push_status, updated_at = @updated_at
      WHERE id = @id AND user_id = @user_id
    `),

    // ── Segment activity statements ──
    segmentActivityInsert: db.prepare(`
      INSERT INTO segment_activity (
        id, user_id, segment_id, type, status,
        destination, channel, subject, user_count, campaign_id, dashboard_url, error, created_at,
        body_html, template_id
      ) VALUES (
        @id, @user_id, @segment_id, @type, @status,
        @destination, @channel, @subject, @user_count, @campaign_id, @dashboard_url, @error, @created_at,
        @body_html, @template_id
      )
    `),
    segmentActivityGetById: db.prepare(`
      SELECT * FROM segment_activity WHERE user_id = ? AND id = ? LIMIT 1
    `),
    segmentActivityListBySegment: db.prepare(`
      SELECT * FROM segment_activity
      WHERE user_id = ? AND segment_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `),
    segmentActivityListByUser: db.prepare(`
      SELECT * FROM segment_activity
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `),
    segmentActivityDeleteBySegment: db.prepare(`
      DELETE FROM segment_activity WHERE user_id = ? AND segment_id = ?
    `),
    segmentActivityTrimPerSegment: db.prepare(`
      DELETE FROM segment_activity
      WHERE user_id = @user_id AND segment_id = @segment_id
        AND id NOT IN (
          SELECT id FROM segment_activity
          WHERE user_id = @user_id AND segment_id = @segment_id
          ORDER BY created_at DESC
          LIMIT @keep
        )
    `),

    // ── Folder statements ──
    folderUpsert: db.prepare(`
      INSERT INTO folders (id, user_id, dataset_id, name, created_at)
      VALUES (@id, @user_id, @dataset_id, @name, @created_at)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, dataset_id = excluded.dataset_id
    `),
    folderListByUser: db.prepare(`SELECT * FROM folders WHERE user_id = ? ORDER BY created_at DESC`),
    folderDelete: db.prepare(`DELETE FROM folders WHERE id = ? AND user_id = ?`),

    // ── Saved chart statements ──
    savedChartUpsert: db.prepare(`
      INSERT INTO saved_charts (id, user_id, dataset_id, name, config, created_at)
      VALUES (@id, @user_id, @dataset_id, @name, @config, @created_at)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, config = excluded.config
    `),
    savedChartListByUserDataset: db.prepare(`
      SELECT * FROM saved_charts WHERE user_id = ? AND dataset_id = ? ORDER BY created_at DESC
    `),
    savedChartDelete: db.prepare(`DELETE FROM saved_charts WHERE id = ? AND user_id = ?`),

    // ── Credit statements ──
    creditGet: db.prepare(`SELECT * FROM credits WHERE user_id = ?`),
    creditUpsert: db.prepare(`
      INSERT INTO credits (org_id, user_id, balance, transactions)
      VALUES (@org_id, @user_id, @balance, @transactions)
      ON CONFLICT(org_id) DO UPDATE SET balance = excluded.balance, transactions = excluded.transactions
    `),

    // ── Forecast seed statements ──
    forecastSeedUpsert: db.prepare(`
      INSERT INTO forecast_seeds (id, user_id, dataset_id, model_data, seed_data, updated_at)
      VALUES (@id, @user_id, @dataset_id, @model_data, @seed_data, @updated_at)
      ON CONFLICT(id) DO UPDATE SET model_data = excluded.model_data, seed_data = excluded.seed_data, updated_at = excluded.updated_at
    `),
    forecastSeedListByUserDataset: db.prepare(`
      SELECT * FROM forecast_seeds WHERE user_id = ? AND dataset_id = ? ORDER BY updated_at DESC
    `),
    forecastSeedDelete: db.prepare(`DELETE FROM forecast_seeds WHERE id = ? AND user_id = ?`),
  };
}

function stmts() {
  const db = getDb();
  if (!_stmts) {
    _stmts = prepareStatements(db);
  }
  return _stmts;
}

export { getDb, stmts };

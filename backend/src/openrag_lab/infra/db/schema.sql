-- OpenRAG-Lab metadata schema (v1).
-- Authoritative source: docs/ARCHITECTURE_v3.md §5.2.
-- Vector data lives in ChromaDB; this DB only holds metadata + checkpoints.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    tags_json           TEXT NOT NULL DEFAULT '[]',
    created_at          TEXT NOT NULL,
    config_yaml_path    TEXT
);

CREATE TABLE IF NOT EXISTS document (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    source_path     TEXT NOT NULL,
    content_hash    TEXT NOT NULL,
    format          TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,
    added_at        TEXT NOT NULL,
    UNIQUE (workspace_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_document_workspace ON document(workspace_id);

CREATE TABLE IF NOT EXISTS chunk (
    id                  TEXT PRIMARY KEY,
    document_id         TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    chunk_config_key    TEXT NOT NULL,
    sequence            INTEGER NOT NULL,
    content             TEXT NOT NULL,
    token_count         INTEGER NOT NULL,
    metadata_json       TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_chunk_doc_cfg ON chunk(document_id, chunk_config_key);

CREATE TABLE IF NOT EXISTS experiment (
    id                      TEXT PRIMARY KEY,
    workspace_id            TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    config_fingerprint      TEXT NOT NULL,
    config_yaml             TEXT NOT NULL,
    status                  TEXT NOT NULL,
    started_at              TEXT NOT NULL,
    completed_at            TEXT,
    scores_json             TEXT,
    profile_json            TEXT,
    archived                INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_experiment_workspace ON experiment(workspace_id);
CREATE INDEX IF NOT EXISTS idx_experiment_fingerprint ON experiment(config_fingerprint);

CREATE TABLE IF NOT EXISTS golden_set (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS golden_pair (
    id                      TEXT PRIMARY KEY,
    golden_set_id           TEXT NOT NULL REFERENCES golden_set(id) ON DELETE CASCADE,
    question                TEXT NOT NULL,
    expected_answer         TEXT,
    expected_chunk_ids_json TEXT
);

CREATE TABLE IF NOT EXISTS chat_turn (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    experiment_id   TEXT NOT NULL REFERENCES experiment(id) ON DELETE CASCADE,
    question        TEXT NOT NULL,
    answer          TEXT,
    citations_json  TEXT NOT NULL DEFAULT '[]',
    chunks_json     TEXT NOT NULL DEFAULT '[]',
    latency_ms      INTEGER,
    tokens          INTEGER,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_turn_experiment ON chat_turn(experiment_id, created_at);

CREATE TABLE IF NOT EXISTS indexing_checkpoint (
    workspace_id        TEXT NOT NULL,
    document_id         TEXT NOT NULL,
    config_fingerprint  TEXT NOT NULL,
    status              TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    PRIMARY KEY (workspace_id, document_id, config_fingerprint)
);

CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(64) NOT NULL,
    setting_value JSON NOT NULL,
    updated_by INT UNSIGNED NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (setting_key),
    CONSTRAINT fk_system_settings_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canvas_projects (
    id VARCHAR(32) NOT NULL,
    owner_user_id INT UNSIGNED NOT NULL,
    title VARCHAR(200) NOT NULL,
    storage_path VARCHAR(1024) NOT NULL,
    version BIGINT UNSIGNED NOT NULL DEFAULT 1,
    content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    deleted_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    KEY idx_canvas_projects_owner_updated (owner_user_id, updated_at),
    KEY idx_canvas_projects_deleted_at (deleted_at),
    CONSTRAINT fk_canvas_projects_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canvas_files (
    id VARCHAR(64) NOT NULL,
    storage_key VARCHAR(128) NOT NULL,
    owner_user_id INT UNSIGNED NOT NULL,
    project_id VARCHAR(32) NULL,
    area VARCHAR(16) NOT NULL,
    relative_path VARCHAR(1024) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    width INT UNSIGNED NULL,
    height INT UNSIGNED NULL,
    duration_ms BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    deleted_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_canvas_files_owner_storage_key (owner_user_id, storage_key),
    KEY idx_canvas_files_project (project_id, area),
    KEY idx_canvas_files_deleted_at (deleted_at),
    CONSTRAINT fk_canvas_files_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_canvas_files_project FOREIGN KEY (project_id) REFERENCES canvas_projects (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trash_entries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    owner_user_id INT UNSIGNED NOT NULL,
    resource_type VARCHAR(16) NOT NULL,
    resource_id VARCHAR(64) NOT NULL,
    original_path VARCHAR(1024) NOT NULL,
    trash_path VARCHAR(1024) NOT NULL,
    deleted_by INT UNSIGNED NULL,
    deleted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    purge_after DATETIME(3) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'trashed',
    PRIMARY KEY (id),
    KEY idx_trash_entries_purge (status, purge_after),
    KEY idx_trash_entries_owner (owner_user_id, deleted_at),
    CONSTRAINT fk_trash_entries_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_trash_entries_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

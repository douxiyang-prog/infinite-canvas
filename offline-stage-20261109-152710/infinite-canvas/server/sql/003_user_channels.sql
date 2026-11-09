CREATE TABLE IF NOT EXISTS user_channel_assignments (
    user_id INT UNSIGNED NOT NULL,
    all_channels TINYINT(1) NOT NULL DEFAULT 1,
    channel_ids JSON NOT NULL,
    version BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_by INT UNSIGNED NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id),
    CONSTRAINT fk_user_channel_assignments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_user_channel_assignments_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_project_scenes (
    id VARCHAR(32) NOT NULL,
    team_project_id VARCHAR(32) NOT NULL,
    title VARCHAR(200) NOT NULL,
    hidden TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_by INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY idx_team_project_scenes_project (team_project_id, hidden, sort_order),
    CONSTRAINT fk_team_project_scenes_project FOREIGN KEY (team_project_id) REFERENCES team_projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_team_project_scenes_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

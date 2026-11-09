CREATE TABLE IF NOT EXISTS team_projects (
    id VARCHAR(32) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    created_by INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    deleted_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    KEY idx_team_projects_deleted_at (deleted_at),
    KEY idx_team_projects_created_by (created_by),
    CONSTRAINT fk_team_projects_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_project_members (
    project_id VARCHAR(32) NOT NULL,
    user_id INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (project_id, user_id),
    KEY idx_team_project_members_user (user_id, project_id),
    CONSTRAINT fk_team_project_members_project FOREIGN KEY (project_id) REFERENCES team_projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_team_project_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

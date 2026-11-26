-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(64) NOT NULL,
    `full_name` VARCHAR(128) NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('admin', 'viewer') NOT NULL DEFAULT 'viewer',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_login_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL,
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` INTEGER NOT NULL,
    `emp_code` VARCHAR(32) NOT NULL,
    `first_name` VARCHAR(100) NULL,
    `last_name` VARCHAR(100) NULL,
    `department_id` INTEGER NULL,
    `department_name` VARCHAR(128) NULL,
    `position_id` INTEGER NULL,
    `position_name` VARCHAR(128) NULL,
    `area_ids` JSON NULL,
    `area_names` VARCHAR(512) NULL,
    `card_no` VARCHAR(32) NULL,
    `mobile` VARCHAR(32) NULL,
    `email` VARCHAR(128) NULL,
    `gender` VARCHAR(8) NULL,
    `hire_date` VARCHAR(10) NULL,
    `enable_att` BOOLEAN NOT NULL DEFAULT true,
    `device_password` VARCHAR(8) NULL,
    `dev_privilege` SMALLINT NOT NULL DEFAULT 0,
    `created_in_app` BOOLEAN NOT NULL DEFAULT false,
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,
    `synced_at` DATETIME(0) NOT NULL,

    INDEX `employees_emp_code_idx`(`emp_code`),
    INDEX `employees_department_id_idx`(`department_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `devices` (
    `id` INTEGER NOT NULL,
    `sn` VARCHAR(64) NOT NULL,
    `alias` VARCHAR(128) NULL,
    `ip_address` VARCHAR(64) NULL,
    `state` SMALLINT NULL,
    `area_name` VARCHAR(128) NULL,
    `fw_ver` VARCHAR(64) NULL,
    `last_activity` DATETIME(0) NULL,
    `user_count` INTEGER NULL,
    `fp_count` INTEGER NULL,
    `face_count` INTEGER NULL,
    `transaction_count` INTEGER NULL,
    `synced_at` DATETIME(0) NOT NULL,

    INDEX `devices_sn_idx`(`sn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `punches` (
    `id` INTEGER NOT NULL,
    `source` ENUM('biotime', 'device') NOT NULL DEFAULT 'biotime',
    `emp_code` VARCHAR(32) NOT NULL,
    `punch_time` DATETIME(0) NOT NULL,
    `punch_state` VARCHAR(8) NULL,
    `verify_type` SMALLINT NULL,
    `work_code` VARCHAR(32) NULL,
    `terminal_sn` VARCHAR(64) NULL,
    `terminal_alias` VARCHAR(128) NULL,
    `area_alias` VARCHAR(128) NULL,
    `upload_time` DATETIME(0) NULL,
    `sync_run_id` INTEGER NULL,
    `synced_at` DATETIME(0) NOT NULL,

    INDEX `punches_punch_time_idx`(`punch_time`),
    INDEX `punches_emp_code_punch_time_idx`(`emp_code`, `punch_time`),
    INDEX `punches_terminal_sn_punch_time_idx`(`terminal_sn`, `punch_time`),
    INDEX `punches_sync_run_id_idx`(`sync_run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sync_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `job` ENUM('devices', 'employees', 'punches', 'device_punches') NOT NULL,
    `trigger` ENUM('startup', 'schedule', 'manual', 'personnel_change', 'range') NOT NULL,
    `status` ENUM('running', 'success', 'failed') NOT NULL DEFAULT 'running',
    `started_at` DATETIME(0) NOT NULL,
    `finished_at` DATETIME(0) NULL,
    `duration_ms` INTEGER NULL,
    `fetched` INTEGER NOT NULL DEFAULT 0,
    `created` INTEGER NOT NULL DEFAULT 0,
    `updated` INTEGER NOT NULL DEFAULT 0,
    `removed` INTEGER NOT NULL DEFAULT 0,
    `range_from` DATETIME(0) NULL,
    `range_to` DATETIME(0) NULL,
    `cursor_at` DATETIME(0) NULL,
    `webhooks_queued` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,

    INDEX `sync_runs_job_status_started_at_idx`(`job`, `status`, `started_at`),
    INDEX `sync_runs_started_at_idx`(`started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NULL,
    `username` VARCHAR(64) NULL,
    `action` VARCHAR(32) NOT NULL,
    `entity` VARCHAR(32) NOT NULL,
    `entity_id` VARCHAR(64) NULL,
    `summary` VARCHAR(255) NULL,
    `details` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `created_at` DATETIME(0) NOT NULL,

    INDEX `audit_logs_created_at_idx`(`created_at`),
    INDEX `audit_logs_entity_entity_id_idx`(`entity`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhooks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `url` VARCHAR(2048) NOT NULL,
    `secret` VARCHAR(128) NOT NULL,
    `events` JSON NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_delivery_at` DATETIME(0) NULL,
    `last_status` ENUM('pending', 'success', 'failed') NULL,
    `created_at` DATETIME(0) NOT NULL,
    `updated_at` DATETIME(0) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_deliveries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `webhook_id` INTEGER NOT NULL,
    `sync_run_id` INTEGER NULL,
    `event` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('pending', 'success', 'failed') NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(0) NULL,
    `response_status` INTEGER NULL,
    `response_body` TEXT NULL,
    `error` TEXT NULL,
    `duration_ms` INTEGER NULL,
    `created_at` DATETIME(0) NOT NULL,
    `delivered_at` DATETIME(0) NULL,

    INDEX `webhook_deliveries_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    INDEX `webhook_deliveries_webhook_id_created_at_idx`(`webhook_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `zk_devices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `mode` ENUM('pull', 'push', 'both') NOT NULL DEFAULT 'pull',
    `ip` VARCHAR(64) NULL,
    `port` INTEGER NOT NULL DEFAULT 4370,
    `serial_number` VARCHAR(64) NULL,
    `location` VARCHAR(128) NULL,
    `timeout_ms` INTEGER NOT NULL DEFAULT 10000,
    `chunk_size` INTEGER NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `model` VARCHAR(100) NULL,
    `firmware` VARCHAR(100) NULL,
    `last_seen_at` DATETIME(0) NULL,
    `operlog_stamp` VARCHAR(32) NULL,
    `created_at` DATETIME(0) NOT NULL,
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `zk_devices_serial_number_key`(`serial_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_settings` (
    `key` VARCHAR(64) NOT NULL,
    `value` JSON NOT NULL,
    `updated_at` DATETIME(0) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `org_units` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('department', 'area', 'position') NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `parent_id` INTEGER NULL,
    `created_at` DATETIME(0) NOT NULL,
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `org_units_kind_idx`(`kind`),
    UNIQUE INDEX `org_units_kind_code_key`(`kind`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_commands` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `device_id` INTEGER NOT NULL,
    `channel` ENUM('push', 'pull') NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `command` MEDIUMTEXT NOT NULL,
    `payload` JSON NULL,
    `emp_code` VARCHAR(32) NULL,
    `status` ENUM('pending', 'sent', 'success', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(0) NULL,
    `return_code` INTEGER NULL,
    `result` MEDIUMTEXT NULL,
    `created_by` VARCHAR(64) NULL,
    `created_at` DATETIME(0) NOT NULL,
    `sent_at` DATETIME(0) NULL,
    `completed_at` DATETIME(0) NULL,

    INDEX `device_commands_device_id_status_id_idx`(`device_id`, `status`, `id`),
    INDEX `device_commands_emp_code_id_idx`(`emp_code`, `id`),
    INDEX `device_commands_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    INDEX `device_commands_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `biometric_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `emp_code` VARCHAR(32) NOT NULL,
    `bio_type` SMALLINT NOT NULL,
    `bio_index` SMALLINT NOT NULL,
    `sub_index` SMALLINT NOT NULL DEFAULT 0,
    `format` VARCHAR(16) NOT NULL,
    `fields` JSON NOT NULL,
    `tmp_key` VARCHAR(8) NOT NULL DEFAULT 'TMP',
    `template` MEDIUMTEXT NOT NULL,
    `source_sn` VARCHAR(64) NULL,
    `created_at` DATETIME(0) NOT NULL,
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `biometric_templates_emp_code_idx`(`emp_code`),
    UNIQUE INDEX `biometric_templates_emp_code_bio_type_bio_index_sub_index_key`(`emp_code`, `bio_type`, `bio_index`, `sub_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `punches` ADD CONSTRAINT `punches_sync_run_id_fkey` FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_webhook_id_fkey` FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_deliveries` ADD CONSTRAINT `webhook_deliveries_sync_run_id_fkey` FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_commands` ADD CONSTRAINT `device_commands_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `zk_devices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


CREATE DATABASE IF NOT EXISTS nebula CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE nebula;

-- Users (includes moderation fields)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('user', 'moderator', 'admin') DEFAULT 'user',
    is_banned BOOLEAN DEFAULT FALSE,
    ban_reason TEXT NULL,
    banned_until TIMESTAMP NULL,
    banned_by VARCHAR(32) NULL,
    warnings_count INT DEFAULT 0,
    last_seen TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_role (role),
    INDEX idx_is_banned (is_banned)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rooms (group chats only)
CREATE TABLE IF NOT EXISTS rooms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_room_id (room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Room members
CREATE TABLE IF NOT EXISTS room_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id VARCHAR(100) NOT NULL,
    username VARCHAR(32) NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    UNIQUE KEY unique_room_member (room_id, username),
    INDEX idx_room_id (room_id),
    INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    message_id VARCHAR(100) UNIQUE NOT NULL,
    room_id VARCHAR(100) NOT NULL,
    username VARCHAR(32) NOT NULL,
    text TEXT,
    media_type VARCHAR(20),
    media_data LONGTEXT,
    media_name VARCHAR(255),
    reply_to_id VARCHAR(100),
    forwarded_from VARCHAR(32),
    forwarded_message_id VARCHAR(100),
    media_meta JSON NULL,
    expires_at TIMESTAMP NULL,
    edited BOOLEAN DEFAULT FALSE,
    edited_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    INDEX idx_message_id (message_id),
    INDEX idx_room_id (room_id),
    INDEX idx_created_at (created_at),
    INDEX idx_expires_at (expires_at),
    INDEX idx_username (username),
    INDEX idx_room_created (room_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reactions
CREATE TABLE IF NOT EXISTS reactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    message_id VARCHAR(100) NOT NULL,
    username VARCHAR(32) NOT NULL,
    emoji VARCHAR(32) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    UNIQUE KEY unique_reaction (message_id, username, emoji),
    INDEX idx_message_id (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Message read receipts
CREATE TABLE IF NOT EXISTS message_reads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    message_id VARCHAR(100) NOT NULL,
    username VARCHAR(32) NOT NULL,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_read (message_id, username),
    INDEX idx_message_id (message_id),
    INDEX idx_username (username),
    INDEX idx_username_message (username, message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- User blocks
CREATE TABLE IF NOT EXISTS blocked_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    blocker_username VARCHAR(32) NOT NULL,
    blocked_username VARCHAR(32) NOT NULL,
    blocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (blocker_username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (blocked_username) REFERENCES users(username) ON DELETE CASCADE,
    UNIQUE KEY unique_block (blocker_username, blocked_username),
    INDEX idx_blocker (blocker_username),
    INDEX idx_blocked (blocked_username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pinned messages
CREATE TABLE IF NOT EXISTS pinned_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id VARCHAR(100) NOT NULL,
    message_id VARCHAR(100) NOT NULL,
    pinned_by VARCHAR(32) NOT NULL,
    pinned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pinned_by) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE,
    UNIQUE KEY unique_pin (room_id, message_id),
    INDEX idx_room_id (room_id),
    INDEX idx_message_id (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- MODERATION TABLES
-- ============================================================================

-- Warnings
CREATE TABLE IF NOT EXISTS warnings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL,
    issued_by VARCHAR(32) NOT NULL,
    reason TEXT NOT NULL,
    message_id VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (issued_by) REFERENCES users(username) ON DELETE CASCADE,
    INDEX idx_username (username),
    INDEX idx_issued_by (issued_by),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ban history
CREATE TABLE IF NOT EXISTS ban_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL,
    banned_by VARCHAR(32) NOT NULL,
    reason TEXT NOT NULL,
    banned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    unbanned_at TIMESTAMP NULL,
    unbanned_by VARCHAR(32) NULL,
    duration_hours INT NULL COMMENT 'NULL = permanent ban',
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (banned_by) REFERENCES users(username) ON DELETE CASCADE,
    INDEX idx_username (username),
    INDEX idx_banned_by (banned_by),
    INDEX idx_banned_at (banned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Moderation logs
CREATE TABLE IF NOT EXISTS moderation_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    moderator_username VARCHAR(32) NOT NULL,
    action_type ENUM(
        'ban', 'unban', 'warn', 'dismiss_report', 'resolve_report'
    ) NOT NULL,
    target_username VARCHAR(32) NULL,
    target_message_id VARCHAR(100) NULL,
    reason TEXT NULL,
    details JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (moderator_username) REFERENCES users(username) ON DELETE CASCADE,
    INDEX idx_moderator (moderator_username),
    INDEX idx_action_type (action_type),
    INDEX idx_target_username (target_username),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Message reports
CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    message_id VARCHAR(100) NOT NULL,
    room_id VARCHAR(100) NULL,
    report_type VARCHAR(32) NOT NULL DEFAULT 'other',
    reported_by VARCHAR(32) NOT NULL,
    reported_user VARCHAR(32) NOT NULL,
    reason TEXT NOT NULL,
    status ENUM('pending', 'reviewed', 'resolved', 'dismissed') DEFAULT 'pending',
    reviewed_by VARCHAR(32) NULL,
    reviewed_at TIMESTAMP NULL,
    resolution_note TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reported_by) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (reported_user) REFERENCES users(username) ON DELETE CASCADE,
    INDEX idx_message_id (message_id),
    INDEX idx_reported_by (reported_by),
    INDEX idx_reported_user (reported_user),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    INDEX idx_status_created_at (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Message drafts (per-user per-room composer text)
CREATE TABLE IF NOT EXISTS message_drafts (
    username VARCHAR(32) NOT NULL,
    room_id VARCHAR(100) NOT NULL,
    draft_text TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (username, room_id),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mute notifications per chat (do not disturb)
CREATE TABLE IF NOT EXISTS chat_mute (
    username VARCHAR(32) NOT NULL,
    room_id VARCHAR(100) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (username, room_id),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Scheduled messages
CREATE TABLE IF NOT EXISTS scheduled_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id VARCHAR(100) NOT NULL,
    username VARCHAR(32) NOT NULL,
    text TEXT,
    media_type VARCHAR(20) NULL,
    media_path VARCHAR(500) NULL,
    media_name VARCHAR(255) NULL,
    media_meta JSON NULL,
    reply_to_json JSON NULL,
    scheduled_at TIMESTAMP NOT NULL,
    sent_message_id VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    INDEX idx_scheduled_at (scheduled_at),
    INDEX idx_room (room_id),
    INDEX idx_room_user_pending_time (room_id, username, sent_message_id, scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- User profiles (bio, avatar, nickname)
CREATE TABLE IF NOT EXISTS user_profiles (
    username VARCHAR(32) PRIMARY KEY,
    bio TEXT NULL,
    avatar VARCHAR(500) NULL,
    avatar_type VARCHAR(16) DEFAULT 'emoji',
    nickname VARCHAR(64) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

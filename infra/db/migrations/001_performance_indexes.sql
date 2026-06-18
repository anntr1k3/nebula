USE nebula;

SET @schema_name = DATABASE();

SET @idx_exists = (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = @schema_name
      AND table_name = 'messages'
      AND index_name = 'idx_room_created_id'
);
SET @sql = IF(
    @idx_exists = 0,
    'ALTER TABLE messages ADD INDEX idx_room_created_id (room_id, created_at, message_id)',
    'SELECT ''idx_room_created_id already exists'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = @schema_name
      AND table_name = 'messages'
      AND index_name = 'idx_room_expires_created'
);
SET @sql = IF(
    @idx_exists = 0,
    'ALTER TABLE messages ADD INDEX idx_room_expires_created (room_id, expires_at, created_at)',
    'SELECT ''idx_room_expires_created already exists'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = @schema_name
      AND table_name = 'messages'
      AND index_name = 'idx_username_created'
);
SET @sql = IF(
    @idx_exists = 0,
    'ALTER TABLE messages ADD INDEX idx_username_created (username, created_at)',
    'SELECT ''idx_username_created already exists'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = @schema_name
      AND table_name = 'messages'
      AND index_name = 'idx_messages_text_ft'
);
SET @sql = IF(
    @idx_exists = 0,
    'ALTER TABLE messages ADD FULLTEXT INDEX idx_messages_text_ft (text)',
    'SELECT ''idx_messages_text_ft already exists'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = @schema_name
      AND table_name = 'reactions'
      AND index_name = 'idx_message_user'
);
SET @sql = IF(
    @idx_exists = 0,
    'ALTER TABLE reactions ADD INDEX idx_message_user (message_id, username)',
    'SELECT ''idx_message_user already exists'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = @schema_name
      AND table_name = 'reports'
      AND index_name = 'idx_room_status_created'
);
SET @sql = IF(
    @idx_exists = 0,
    'ALTER TABLE reports ADD INDEX idx_room_status_created (room_id, status, created_at)',
    'SELECT ''idx_room_status_created already exists'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = @schema_name
      AND table_name = 'user_profiles'
      AND index_name = 'idx_nickname'
);
SET @sql = IF(
    @idx_exists = 0,
    'ALTER TABLE user_profiles ADD INDEX idx_nickname (nickname)',
    'SELECT ''idx_nickname already exists'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

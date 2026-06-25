-- Legacy table is retained as a read-only migration source. Runtime writes use the
-- normalized app_* tables below.
CREATE TABLE IF NOT EXISTS application_state (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_state_metadata (
  id text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0,
  migrated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'app_features', 'app_centers', 'app_campuses', 'app_buildings', 'app_rooms',
    'app_themes', 'app_roles', 'app_users', 'app_sessions', 'app_password_reset_tokens', 'app_oauth_states',
    'app_feature_grants', 'app_calendar_accounts', 'app_calendar_assignments',
    'app_calendar_events', 'app_calendar_conflicts', 'app_calendar_conflict_history',
    'app_calendar_sync_history', 'app_theme_schedules', 'app_room_groups',
    'app_upcoming_events', 'app_broadcasts', 'app_broadcast_templates',
    'app_email_notifications', 'app_notifications', 'app_kiosk_devices',
    'app_kiosk_pairing_codes', 'app_audit_logs', 'app_login_audit'
  ]
  LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I (
        id text PRIMARY KEY,
        position integer NOT NULL DEFAULT 0,
        data jsonb NOT NULL,
        version bigint NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
      )',
      table_name
    );
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email
  ON app_users (lower(data->>'email'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_rooms_code
  ON app_rooms ((data->>'code'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_rooms_kiosk_identifier
  ON app_rooms ((data->>'kioskIdentifier'))
  WHERE data->>'kioskIdentifier' IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_rooms_hierarchy
  ON app_rooms ((data->>'centerId'), (data->>'campusId'), (data->>'buildingId'));
CREATE INDEX IF NOT EXISTS idx_app_calendar_events_room_time
  ON app_calendar_events ((data->>'roomId'), (data->>'startsAt'), (data->>'endsAt'));
CREATE INDEX IF NOT EXISTS idx_app_notifications_user_created
  ON app_notifications ((data->>'userId'), (data->>'createdAt') DESC);
CREATE INDEX IF NOT EXISTS idx_app_sessions_token_hash
  ON app_sessions ((data->>'tokenHash'));
CREATE INDEX IF NOT EXISTS idx_app_sessions_expiration
  ON app_sessions ((data->>'expiresAt'));
CREATE INDEX IF NOT EXISTS idx_app_feature_grants_user_time
  ON app_feature_grants ((data->>'userId'), (data->>'startsAt'), (data->>'endsAt'));
CREATE INDEX IF NOT EXISTS idx_app_audit_created
  ON app_audit_logs ((data->>'createdAt') DESC);

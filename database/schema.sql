CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS application_state (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  logo_url text,
  contact_name text,
  contact_email text,
  contact_phone text,
  booking_url text,
  timezone text NOT NULL,
  default_theme_id uuid,
  upcoming_event_count integer NOT NULL DEFAULT 5 CHECK (upcoming_event_count BETWEEN 1 AND 10),
  show_event_description boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES centers(id),
  name text NOT NULL,
  address text,
  contact_name text,
  contact_email text,
  contact_phone text,
  booking_url text,
  default_theme_id uuid,
  upcoming_event_count integer CHECK (upcoming_event_count BETWEEN 1 AND 10),
  show_event_description boolean,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id uuid NOT NULL REFERENCES campuses(id),
  name text NOT NULL,
  code text,
  address text,
  floors text,
  timezone text,
  booking_url text,
  default_theme_id uuid,
  upcoming_event_count integer CHECK (upcoming_event_count BETWEEN 1 AND 10),
  show_event_description boolean,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kiosk_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  built_in boolean NOT NULL DEFAULT false,
  cloneable boolean NOT NULL DEFAULT true,
  base_theme_id uuid REFERENCES kiosk_themes(id),
  css_tokens jsonb NOT NULL DEFAULT '{}'::jsonb,
  orientation_mode text NOT NULL DEFAULT 'both' CHECK (orientation_mode IN ('both', 'landscape', 'portrait')),
  published boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  last_published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id uuid NOT NULL REFERENCES centers(id),
  campus_id uuid NOT NULL REFERENCES campuses(id),
  building_id uuid NOT NULL REFERENCES buildings(id),
  theme_id uuid REFERENCES kiosk_themes(id),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  room_number text,
  floor text,
  room_type text,
  capacity integer,
  booking_url text,
  equipment text,
  accessibility_notes text,
  maintenance_status text NOT NULL DEFAULT 'available' CHECK (maintenance_status IN ('available', 'maintenance', 'closed')),
  privacy_mode text NOT NULL DEFAULT 'standard' CHECK (privacy_mode IN ('standard', 'private-title', 'hide-details')),
  upcoming_event_count integer CHECK (upcoming_event_count BETWEEN 1 AND 10),
  show_event_description boolean,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'busy', 'warning', 'broadcast')),
  current_event_title text,
  current_event_until text,
  active boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS theme_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id uuid NOT NULL REFERENCES kiosk_themes(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  center_ids uuid[] NOT NULL DEFAULT '{}',
  campus_ids uuid[] NOT NULL DEFAULT '{}',
  building_ids uuid[] NOT NULL DEFAULT '{}',
  room_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  cloneable boolean NOT NULL DEFAULT true,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_center_access (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, center_id)
);

CREATE TABLE IF NOT EXISTS user_campus_access (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campus_id uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, campus_id)
);

CREATE TABLE IF NOT EXISTS user_building_access (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building_id uuid NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, building_id)
);

CREATE TABLE IF NOT EXISTS user_feature_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_name text NOT NULL,
  scope_type text NOT NULL,
  scope_ids uuid[] NOT NULL DEFAULT '{}',
  effective_start timestamptz,
  effective_end timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft365', 'caldav', 'public-url')),
  auth_mode text NOT NULL,
  account_name text NOT NULL,
  access_level text NOT NULL CHECK (access_level IN ('read-only', 'writable')),
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  tenant_id text,
  client_id text,
  mailbox text,
  server_url text,
  username text,
  principal_email text,
  encrypted_credential text,
  sync_interval_minutes integer NOT NULL DEFAULT 15 CHECK (sync_interval_minutes >= 5),
  webhook_status text NOT NULL DEFAULT 'not-configured',
  webhook_last_at timestamptz,
  webhook_expiration timestamptz,
  webhook_error text,
  auth_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  last_successful_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_account_id uuid NOT NULL REFERENCES calendar_accounts(id) ON DELETE CASCADE,
  external_calendar_id text NOT NULL,
  name text NOT NULL,
  mailbox text,
  access_role text,
  webhook_status text,
  webhook_channel_id text,
  encrypted_webhook_token text,
  webhook_resource_id text,
  webhook_subscription_id text,
  webhook_client_state text,
  webhook_expiration timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  last_attempt_at timestamptz,
  last_successful_sync_at timestamptz,
  last_sync_error text,
  UNIQUE (room_id, calendar_id)
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  external_event_id text,
  assignment_id uuid REFERENCES room_calendars(id) ON DELETE CASCADE,
  title text NOT NULL,
  class_name text,
  organizer text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  privacy_status text,
  description text,
  recurrence_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_sync_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid REFERENCES rooms(id) ON DELETE SET NULL,
  calendar_account_id uuid REFERENCES calendar_accounts(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  event_count integer,
  invalid_event_count integer,
  past_event_count integer,
  current_event_count integer,
  future_event_count integer,
  displayed_upcoming_event_count integer,
  first_event_at timestamptz,
  last_event_at timestamptz,
  next_event_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_ids uuid[] NOT NULL,
  external_event_ids text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'unresolved',
  selected_external_event_id text,
  resolution text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kiosk_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  client_device_id text UNIQUE NOT NULL,
  name text NOT NULL,
  device_type text,
  browser text,
  device_token text UNIQUE NOT NULL,
  pairing_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  platform text,
  viewport text,
  orientation text,
  audio_autoplay_enabled boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  last_seen_at timestamptz,
  last_data_at timestamptz,
  pending_command text,
  last_ip_address inet,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  room_ids uuid[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid,
  title text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL,
  audible_alert boolean NOT NULL DEFAULT true,
  center_ids uuid[] NOT NULL DEFAULT '{}',
  campus_ids uuid[] NOT NULL DEFAULT '{}',
  building_ids uuid[] NOT NULL DEFAULT '{}',
  room_group_ids uuid[] NOT NULL DEFAULT '{}',
  room_ids uuid[] NOT NULL DEFAULT '{}',
  resolved_room_codes text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  ended_by uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'ended', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS broadcast_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL,
  visual_style text NOT NULL DEFAULT 'emergency',
  audible_alert boolean NOT NULL DEFAULT true,
  default_target_scope text NOT NULL DEFAULT 'rooms',
  approval_required boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  source text,
  source_id uuid,
  action_url text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_settings (
  id text PRIMARY KEY DEFAULT 'primary',
  enabled boolean NOT NULL DEFAULT false,
  host text NOT NULL,
  port integer NOT NULL DEFAULT 587,
  secure boolean NOT NULL DEFAULT false,
  username text,
  encrypted_password text,
  from_name text NOT NULL,
  from_email text NOT NULL,
  reply_to text,
  last_test_at timestamptz,
  last_test_status text,
  last_test_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_delivery_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  recipient_email text NOT NULL,
  subject text NOT NULL,
  notification_type text NOT NULL,
  source text NOT NULL,
  status text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_calendar_events_room_time ON calendar_events(room_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_history_created_at ON calendar_sync_history(created_at);
CREATE INDEX IF NOT EXISTS idx_theme_schedules_time ON theme_schedules(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_broadcasts_status_time ON broadcasts(status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_email_delivery_history_created_at ON email_delivery_history(created_at);

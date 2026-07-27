-- Seed default badge layout into application_settings (idempotent).
INSERT INTO application_settings (key, value, updated_at) VALUES
  ('badge_layout', '{
    "registration": { "top": 2.28, "left": 0.25, "width": 3.5, "fontSize": 0.20, "color": "#cf252b" },
    "qr": { "top": 2.65, "left": 1.275, "size": 1.45 },
    "name": { "top": 4.20, "left": 0.25, "width": 3.5, "fontSize": 0.25, "color": "#17251f" }
  }'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

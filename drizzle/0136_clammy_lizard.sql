ALTER TABLE "gym_settings" ADD COLUMN "kiosk_pin_len" integer DEFAULT 0 NOT NULL;
UPDATE "gym_settings" SET "kiosk_pin_len" = char_length("kiosk_pin") WHERE "kiosk_pin" != '';

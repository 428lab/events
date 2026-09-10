-- Uploaded avatars use independent immutable R2 keys so in-flight SNS sync cannot overwrite them.
ALTER TABLE user ADD COLUMN avatar_uploaded_key TEXT;

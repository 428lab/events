-- New uploads stage immutable objects before publishing a qualified DB reference.
-- NULL preserves existing event covers until the next authorized replacement.
ALTER TABLE event_image ADD COLUMN object_key TEXT;

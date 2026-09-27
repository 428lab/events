-- User decision: pre-introduction public events cannot become nonpublic.
-- Older writers fail closed; only the new creation writer explicitly sets 1.
ALTER TABLE event ADD COLUMN nonpublic_eligible INTEGER NOT NULL DEFAULT 0
 CHECK(nonpublic_eligible IN (0,1));

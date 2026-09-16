-- Deterministic event paths only. Unresolved legacy bodies are never guessed.
UPDATE notification SET event_id = (
 SELECT e.id FROM event e WHERE notification.link = '/events/' || e.id
 OR substr(notification.link,1,length(e.id)+9) IN ('/events/'||e.id||'/', '/events/'||e.id||'?', '/events/'||e.id||'#')
) WHERE event_id IS NULL;

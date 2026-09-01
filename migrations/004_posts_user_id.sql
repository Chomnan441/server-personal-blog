ALTER TABLE posts
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE posts
SET user_id = (
  SELECT id FROM users WHERE role = 'admin' ORDER BY username ASC LIMIT 1
)
WHERE user_id IS NULL
  AND EXISTS (SELECT 1 FROM users WHERE role = 'admin');

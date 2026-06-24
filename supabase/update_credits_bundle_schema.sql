-- ============================================================
-- Owl Assist — Complete Credits Schema Migration
-- Run this ONCE in your Supabase SQL Editor
-- ============================================================

-- STEP 1: Change credits to numeric so decimals are stored accurately
ALTER TABLE businesses 
ALTER COLUMN credits TYPE numeric(10, 4) USING credits::numeric;

-- STEP 2: Add the three new columns (safe to run multiple times)
ALTER TABLE businesses 
ADD COLUMN IF NOT EXISTS purchased_credits numeric(10, 4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS purchased_credits_expires_at timestamptz,
ADD COLUMN IF NOT EXISTS plan_credit_limit numeric(10, 4) DEFAULT 500;

-- STEP 3: Initialise credits for EXISTING users who have 0 or null credits.
--         Pro users get their plan limit (500). Free users get 20.
--         Users who already have credits > 0 are left untouched.

UPDATE businesses 
SET credits = 500
WHERE 
  subscription_tier = 'pro'
  AND (credits IS NULL OR credits = 0);

UPDATE businesses 
SET credits = 20
WHERE 
  (subscription_tier IS NULL OR subscription_tier != 'pro')
  AND (credits IS NULL OR credits = 0);

-- STEP 4: Fill plan_credit_limit for any existing rows that have NULL
UPDATE businesses 
SET plan_credit_limit = 500 
WHERE plan_credit_limit IS NULL;

-- STEP 5: Fill purchased_credits default for any existing rows
UPDATE businesses 
SET purchased_credits = 0 
WHERE purchased_credits IS NULL;

-- Migration to update the `credits` column to support fractional tokens
-- Currently it might be an integer type.

ALTER TABLE businesses 
ALTER COLUMN credits TYPE numeric(10, 4) USING credits::numeric;

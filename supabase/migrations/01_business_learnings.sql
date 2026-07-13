-- Create business_learnings table
CREATE TABLE IF NOT EXISTS public.business_learnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id TEXT NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    insight_type TEXT NOT NULL CHECK (insight_type IN ('faq', 'preference', 'business_fact', 'correction')),
    content TEXT NOT NULL,
    source_session_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security
ALTER TABLE public.business_learnings ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies
CREATE POLICY "Allow business owners to select their own learnings" ON public.business_learnings
    FOR SELECT USING ((((SELECT auth.uid() AS uid))::text = business_id));

CREATE POLICY "Allow business owners to insert their own learnings" ON public.business_learnings
    FOR INSERT WITH CHECK ((((SELECT auth.uid() AS uid))::text = business_id));

CREATE POLICY "Allow business owners to update their own learnings" ON public.business_learnings
    FOR UPDATE USING ((((SELECT auth.uid() AS uid))::text = business_id)) WITH CHECK ((((SELECT auth.uid() AS uid))::text = business_id));

CREATE POLICY "Allow business owners to delete their own learnings" ON public.business_learnings
    FOR DELETE USING ((((SELECT auth.uid() AS uid))::text = business_id));

-- Create index on business_id for fast lookups
CREATE INDEX IF NOT EXISTS business_learnings_business_id_idx ON public.business_learnings(business_id);
